#!/usr/bin/env bash
# Applies the round DB indexes migrations (0100) to the staging Aurora cluster through the RDS Data API.
# Each file is split on "-- statement-breakpoint", checked against the additive-only rules (plus any statement listed
# word for word in APPROVED below), and applied in its own transaction under an advisory lock. Every file is
# idempotent; a ledger row records each applied file.
#
# A plan run previews the pending files in a transaction that is always rolled back.
# Evidence lines (the workflow reads only the last line of each path):
#   nothing pending  -> ROUND_DB_INDEXES_MIGRATION_ALREADY_APPLIED=true
#   plan             -> ROUND_DB_INDEXES_MIGRATION_PLAN_VERIFIED=true, then ROUND_DB_INDEXES_MIGRATION_PLAN_ONLY_NO_APPLY
#   migrate-once     -> ROUND_DB_INDEXES_MIGRATION_APPLY_VERIFIED=true
#
# Concurrent-index step (Round DB): a file listed in CONCURRENT_INDEX_MIGRATIONS holds exactly one
# "create index concurrently if not exists <name> on public.<table> (...)" and nothing else. It runs outside any
# transaction (CONCURRENTLY refuses one), so a plan run reports it instead of previewing it. On apply, an index of
# that name left INVALID by an earlier interrupted build is dropped first; after the build the index must be valid
# and ready, or it is dropped again and the run fails. Only then is the ledger row written.
set -euo pipefail
umask 077
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
CLUSTER_ID="sea-n-shore-staging-aurora"
DATABASE_NAME="sea_n_shore"
ACTION_FILE="scripts/aws/round-db-indexes-migration-action.txt"
MIGRATIONS=(
  "infra/aws/database/migrations/0100_round_db_claims_email_index.sql"
)
# Files the plan run previews in a rolled-back transaction. Leave out a file whose new enum values a later file in
# the same preview uses (Postgres refuses a new enum value inside the transaction that added it).
PREVIEW_MIGRATIONS=(

)
# Files that each hold one CREATE INDEX CONCURRENTLY (the concurrent-index step above). Never previewed.
CONCURRENT_INDEX_MIGRATIONS=(
  "infra/aws/database/migrations/0100_round_db_claims_email_index.sql"
)
is_concurrent_index() { local file; for file in "${CONCURRENT_INDEX_MIGRATIONS[@]}"; do [[ "$file" == "$1" ]] && return 0; done; return 1; }

[[ "${ROUND_DB_INDEXES_MIGRATION_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "ROUND_DB_INDEXES_MIGRATION_EXPECTED_SHA must be an exact commit SHA." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$ROUND_DB_INDEXES_MIGRATION_EXPECTED_SHA" ]] || { echo "Checkout is not the expected commit; refusing migration." >&2; exit 1; }
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]] || { echo "Checkout is not the Sea N Shore repository; refusing migration." >&2; exit 1; }
SHADOW_SQL_FILE="scripts/aws/round-db-final-reminder-shadow.sql"
git diff --quiet HEAD -- "${MIGRATIONS[@]}" "$0" "$ACTION_FILE" "$SHADOW_SQL_FILE" || { echo "Migration files differ from the commit; refusing migration." >&2; exit 1; }
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]] || { echo "Unexpected AWS account; refusing migration." >&2; exit 1; }

ACTION="$(cut -d' ' -f1 < "$ACTION_FILE" | tr -d '[:space:]')"
# A manual "migrate-once" dispatch (already checked by the workflow: exact SHA + confirmation phrase)
# overrides the committed plan switch, so no execute/rearm commits are needed.
if [[ -n "${ROUND_DB_INDEXES_MIGRATION_ACTION:-}" ]]; then
  ACTION="$(tr -d '[:space:]' <<<"$ROUND_DB_INDEXES_MIGRATION_ACTION")"
fi
case "$ACTION" in
  plan|migrate-once) ;;
  *) echo "Unsupported round DB indexes migration action: $ACTION" >&2; exit 1 ;;
esac

validate_sql() {
  python3 - "$1" "$2" <<'PY'
import re, sys
path, kind = sys.argv[1], sys.argv[2]
sql = open(path, encoding='utf-8').read().strip()
parts = [p.strip() for p in re.split(r'^\s*-- statement-breakpoint\s*$', sql, flags=re.M) if p.strip()]
if not parts:
    raise SystemExit(f'no statements in {path}')
def norm(text):
    return ' '.join(text.split())
if kind == 'concurrent':
    codes = [norm('\n'.join(l for l in p.splitlines() if not l.lstrip().startswith('--'))) for p in parts]
    codes = [c for c in codes if c]
    shape = re.compile(r'^create index concurrently if not exists [a-z_][a-z0-9_]{0,62} on public\.[a-z_][a-z0-9_]* (using btree )?\([^;]+\)( where [^;]+)?;$', re.I)
    if len(codes) != 1 or not shape.match(codes[0]):
        raise SystemExit(f'round DB indexes migration {path} must hold exactly one "create index concurrently if not exists <name> on public.<table> (...)"')
    if re.search(r'\b(drop|truncate|delete|update|alter|grant|revoke|security\s+definer|unique)\b', codes[0], re.I):
        raise SystemExit(f'round DB indexes migration {path} concurrent index contains forbidden SQL')
    print(f'ROUND_DB_INDEXES_MIGRATION_SQL_GUARD=CONCURRENT_INDEX file={path} statements=1')
    raise SystemExit(0)
# The only statements allowed to relax a rule or rewrite rows, word for word. Each needs the owner's approval and
# the same entry in the contract test's APPROVED list.
ALLOWED = {norm(s) for s in [
]}
for index, statement in enumerate(parts):
    code = '\n'.join(line for line in statement.splitlines() if not line.lstrip().startswith('--')).strip()
    if not code:
        continue
    if norm(code) in ALLOWED:
        continue
    if re.search(r'\b(drop\s+(table|column|type|schema|index|function|trigger|constraint)|drop\s+not\s+null|truncate|delete\s+from|update\s+public\.|alter\s+column\s+\w+\s+type)\b', code, re.I):
        raise SystemExit(f'round DB indexes migration {path} statement {index + 1} contains forbidden destructive SQL')
    if re.search(r'\bsecurity\s+definer\b', code, re.I):
        raise SystemExit(f'round DB indexes migration {path} statement {index + 1} uses SECURITY DEFINER')
    if re.search(r'\bconcurrently\b', code, re.I):
        raise SystemExit(f'round DB indexes migration {path} statement {index + 1} is not transaction-safe')
    if not code.rstrip().endswith(';'):
        raise SystemExit(f'round DB indexes migration {path} statement {index + 1} is missing a semicolon')
print(f'ROUND_DB_INDEXES_MIGRATION_SQL_GUARD=ADDITIVE file={path} statements={len(parts)}')
PY
}

for migration in "${MIGRATIONS[@]}"; do
  [[ -f "$migration" ]] || { echo "Missing migration $migration" >&2; exit 1; }
  if is_concurrent_index "$migration"; then validate_sql "$migration" concurrent; else validate_sql "$migration" plain; fi
  echo "ROUND_DB_INDEXES_MIGRATION_SHA256 $(basename "$migration")=$(sha256sum "$migration" | cut -d' ' -f1)"
done

CLUSTER_JSON="$(aws rds describe-db-clusters --region "$AWS_REGION" --db-cluster-identifier "$CLUSTER_ID" --output json)"
CLUSTER_ARN="$(jq -r '.DBClusters[0].DBClusterArn // empty' <<<"$CLUSTER_JSON")"
SECRET_ARN="$(jq -r '.DBClusters[0].MasterUserSecret.SecretArn // empty' <<<"$CLUSTER_JSON")"
# Each refusal names its reason (no ARNs or secrets are printed).
CLUSTER_STATUS="$(jq -r '.DBClusters[0].Status // empty' <<<"$CLUSTER_JSON")"
[[ "$CLUSTER_STATUS" == "available" ]] || { echo "Aurora cluster status is '$CLUSTER_STATUS', not available; refusing migration." >&2; exit 1; }
[[ "$(jq -r '.DBClusters[0].HttpEndpointEnabled // false' <<<"$CLUSTER_JSON")" == "true" ]] || { echo "Aurora Data API is not enabled; refusing migration." >&2; exit 1; }
[[ "$CLUSTER_ARN" == "arn:aws:rds:ap-south-1:310356785722:cluster:sea-n-shore-staging-aurora" ]] || { echo "Unexpected Aurora cluster; refusing migration." >&2; exit 1; }
[[ "$SECRET_ARN" == arn:aws:secretsmanager:ap-south-1:310356785722:secret:rds\!cluster-* ]] || { echo "Aurora master secret is not the managed rds!cluster secret; refusing migration." >&2; exit 1; }

data_api() {
  aws rds-data execute-statement --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" "$@"
}
read_count() { data_api --sql "$1" --output json | jq -r '.records[0][0].longValue'; }
read_text() { data_api --sql "$1" --output json | jq -r '.records[0][0].stringValue // empty'; }
begin_transaction() { aws rds-data begin-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" --query transactionId --output text; }
rollback_transaction() { aws rds-data rollback-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --transaction-id "$1" >/dev/null 2>&1 || true; }

statements_b64() {
  python3 - "$1" <<'PY'
import base64, re, sys
sql = open(sys.argv[1], encoding='utf-8').read().strip()
for part in [p.strip() for p in re.split(r'^\s*-- statement-breakpoint\s*$', sql, flags=re.M) if p.strip()]:
    code = '\n'.join(line for line in part.splitlines() if not line.lstrip().startswith('--')).strip()
    if code:
        print(base64.b64encode(part.encode()).decode())
PY
}

# The index name and table of a concurrent-index file (already checked by validate_sql).
concurrent_index_parts() {
  python3 - "$1" <<'PY'
import re, sys
text = ' '.join(l for l in open(sys.argv[1], encoding='utf-8').read().splitlines() if not l.lstrip().startswith('--'))
m = re.search(r'create\s+index\s+concurrently\s+if\s+not\s+exists\s+([a-z_][a-z0-9_]*)\s+on\s+public\.([a-z_][a-z0-9_]*)', text, re.I)
print(m.group(1).lower(), m.group(2).lower())
PY
}
# absent, valid (valid and ready) or invalid.
index_state() {
  local state
  state="$(read_text "SELECT CASE WHEN i.indisvalid AND i.indisready THEN 'valid' ELSE 'invalid' END FROM pg_index i WHERE i.indexrelid = to_regclass('public.$1')")"
  printf '%s\n' "${state:-absent}"
}

# Round DB: the live shadow comparison of the final-reminder rule (previous, frozen, against the rewrite), in one READ
# ONLY transaction that is always rolled back. Prints reason names and counts only. Returns 1 on any mismatch.
shadow_compare() {
  local tx sql result rows total mismatched
  sql="$(grep -v '^--' "$SHADOW_SQL_FILE")"
  [[ "$sql" == "select previous.reason as previous_reason, current_rule.reason as current_reason, count(*)::int as n"* ]] || { echo "Unexpected shadow statement; refusing." >&2; exit 1; }
  tx="$(begin_transaction)"
  [[ -n "$tx" ]]
  data_api --transaction-id "$tx" --sql "SET TRANSACTION READ ONLY" >/dev/null
  if ! result="$(data_api --transaction-id "$tx" --sql "$sql" --format-records-as JSON --output json 2>/dev/null)"; then
    rollback_transaction "$tx"
    echo "ROUND_DB_INDEXES_MIGRATION_SHADOW_FINAL_REMINDER UNAVAILABLE (the comparison did not finish)"
    echo "ROUND_DB_INDEXES_MIGRATION_SHADOW_FINAL_REMINDER_MATCH=unknown"
    return 0
  fi
  rollback_transaction "$tx"
  rows="$(jq -c '.formattedRecords | fromjson | [.[] | {previous: .previous_reason, current: .current_reason, n: .n}]' <<<"$result")"
  jq -r '.[] | "ROUND_DB_INDEXES_MIGRATION_SHADOW_FINAL_REMINDER_REASON previous=\(.previous) current=\(.current) n=\(.n)"' <<<"$rows"
  total="$(jq '[.[].n] | add // 0' <<<"$rows")"
  mismatched="$(jq '[.[] | select(.previous != .current) | .n] | add // 0' <<<"$rows")"
  echo "ROUND_DB_INDEXES_MIGRATION_SHADOW_FINAL_REMINDER invites=$total mismatched=$mismatched"
  if [[ "$total" -gt 0 && "$mismatched" == "0" ]]; then
    echo "ROUND_DB_INDEXES_MIGRATION_SHADOW_FINAL_REMINDER_MATCH=true"
    return 0
  fi
  echo "ROUND_DB_INDEXES_MIGRATION_SHADOW_FINAL_REMINDER_MATCH=false"
  return 1
}

# round DB indexes follows 0099_legacy_final_reminders.
LEDGER_EXISTS="$(read_count "SELECT count(*)::bigint FROM information_schema.tables WHERE table_schema='public' AND table_name='sea_n_shore_applied_migrations'")"
[[ "$LEDGER_EXISTS" == "1" ]] || { echo "The migration ledger is missing; refusing migration." >&2; exit 1; }
already_applied() { [[ "$(read_count "SELECT count(*)::bigint FROM public.sea_n_shore_applied_migrations WHERE name='$1'")" == "1" ]]; }
already_applied 0099_legacy_final_reminders || { echo "Migration 0099_legacy_final_reminders is not applied yet; refusing migration." >&2; exit 1; }

PENDING=()
for migration in "${MIGRATIONS[@]}"; do
  name="$(basename "$migration" .sql)"
  if already_applied "$name"; then
    echo "ROUND_DB_INDEXES_MIGRATION_ALREADY_APPLIED $name"
  else
    echo "ROUND_DB_INDEXES_MIGRATION_PENDING $name"
    PENDING+=("$migration")
  fi
done

if [[ "${#PENDING[@]}" -eq 0 ]]; then
  echo "ROUND_DB_INDEXES_MIGRATION_ALREADY_APPLIED=true"
  exit 0
fi

if [[ "$ACTION" == "plan" ]]; then
  # Preview the pending files against the real schema in a transaction that is always rolled back.
  PREVIEW_B64=()
  for migration in "${PENDING[@]}"; do
    for preview in "${PREVIEW_MIGRATIONS[@]}"; do
      [[ "$migration" == "$preview" ]] || continue
      mapfile -t FILE_B64 < <(statements_b64 "$migration")
      PREVIEW_B64+=("${FILE_B64[@]}")
    done
  done
  # A concurrent index cannot run in a transaction: report its table and current state instead (counts only).
  for migration in "${PENDING[@]}"; do
    is_concurrent_index "$migration" || continue
    read -r INDEX TABLE < <(concurrent_index_parts "$migration")
    [[ "$(read_count "SELECT count(*)::bigint FROM pg_class WHERE oid = to_regclass('public.$TABLE')")" == "1" ]] || { echo "Table public.$TABLE does not exist; refusing migration." >&2; exit 1; }
    ROWS="$(read_count "SELECT greatest(reltuples, 0)::bigint FROM pg_class WHERE oid = to_regclass('public.$TABLE')")"
    echo "ROUND_DB_INDEXES_MIGRATION_CONCURRENT_INDEX_PLAN index=$INDEX table=$TABLE state=$(index_state "$INDEX") rows_estimate=$ROWS (built outside a transaction on apply)"
  done
  if [[ "${#PREVIEW_B64[@]}" -ge 1 ]]; then
    PREVIEW_TX="$(begin_transaction)"
    [[ -n "$PREVIEW_TX" ]]
    trap 'rollback_transaction "$PREVIEW_TX"' EXIT; trap 'exit 129' HUP; trap 'exit 130' INT; trap 'exit 143' TERM
    for encoded in "${PREVIEW_B64[@]}"; do
      data_api --transaction-id "$PREVIEW_TX" --sql "$(printf '%s' "$encoded" | base64 --decode)" >/dev/null
    done
    rollback_transaction "$PREVIEW_TX"
    trap - EXIT
  fi
  echo "ROUND_DB_INDEXES_MIGRATION_PREVIEW statements=${#PREVIEW_B64[@]} (rolled back)"
  # Round DB: the shadow comparison before the index exists (both rules, as the app runs them today).
  shadow_compare || { echo "The rewritten final-reminder rule disagrees with the previous one; refusing." >&2; exit 1; }
  echo "ROUND_DB_INDEXES_MIGRATION_PLAN_VERIFIED=true"
  echo "ROUND_DB_INDEXES_MIGRATION_PLAN_ONLY_NO_APPLY"
  exit 0
fi

[[ "$(bash scripts/aws/branch-head.sh refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$ROUND_DB_INDEXES_MIGRATION_EXPECTED_SHA" ]] || { echo "The feature branch has moved past the approved commit; refusing migration." >&2; exit 1; }

apply_migration_file() {
  local migration="$1"
  local name digest tx_id committed
  name="$(basename "$migration" .sql)"
  digest="$(sha256sum "$migration" | cut -d' ' -f1)"
  mapfile -t STATEMENT_B64 < <(statements_b64 "$migration")
  [[ "${#STATEMENT_B64[@]}" -ge 1 ]]

  tx_id="$(begin_transaction)"
  [[ -n "$tx_id" ]]
  committed=false
  rollback_current_transaction() {
    if [[ "$committed" != true && -n "${tx_id:-}" ]]; then
      rollback_transaction "$tx_id"
    fi
  }
  trap rollback_current_transaction RETURN

  data_api --transaction-id "$tx_id" --sql "SELECT pg_advisory_xact_lock(hashtext('sea-n-shore-round-db-indexes-$name')::bigint)" >/dev/null
  for encoded in "${STATEMENT_B64[@]}"; do
    SQL="$(printf '%s' "$encoded" | base64 --decode)"
    data_api --transaction-id "$tx_id" --sql "$SQL" >/dev/null
  done
  data_api --transaction-id "$tx_id" --sql "INSERT INTO public.sea_n_shore_applied_migrations (name, sha256, git_sha) VALUES ('$name', '$digest', '$ROUND_DB_INDEXES_MIGRATION_EXPECTED_SHA') ON CONFLICT (name) DO NOTHING" >/dev/null

  aws rds-data commit-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --transaction-id "$tx_id" >/dev/null
  committed=true
  trap - RETURN
  echo "ROUND_DB_INDEXES_MIGRATION_APPLIED $name"
}

# The concurrent-index step. Outside any transaction; the Data API call returns after 45 s at most while the build
# continues on the server, so the catalog is the evidence: valid and ready, or dropped and the run fails.
apply_concurrent_index_file() {
  local migration="$1"
  local name digest index table sql state output building
  name="$(basename "$migration" .sql)"
  digest="$(sha256sum "$migration" | cut -d' ' -f1)"
  read -r index table < <(concurrent_index_parts "$migration")
  mapfile -t STATEMENT_B64 < <(statements_b64 "$migration")
  [[ "${#STATEMENT_B64[@]}" -eq 1 ]] || { echo "$name must hold exactly one statement." >&2; exit 1; }
  sql="$(printf '%s' "${STATEMENT_B64[0]}" | base64 --decode)"

  state="$(index_state "$index")"
  if [[ "$state" == "invalid" ]]; then
    data_api --sql "DROP INDEX CONCURRENTLY IF EXISTS public.$index" >/dev/null
    echo "ROUND_DB_INDEXES_MIGRATION_CONCURRENT_INDEX_INVALID_DROPPED index=$index (left by an earlier interrupted build)"
  fi
  if ! output="$(data_api --continue-after-timeout --sql "$sql" 2>&1 >/dev/null)"; then
    echo "ROUND_DB_INDEXES_MIGRATION_CONCURRENT_INDEX_CALL $(grep -oE 'An error occurred \([A-Za-z]+\)' <<<"$output" | head -1 || echo 'failed') (checking the catalog)"
  fi
  for attempt in $(seq 1 180); do
    building="$(read_count "SELECT count(*)::bigint FROM pg_stat_progress_create_index WHERE relid = to_regclass('public.$table')")"
    [[ "$building" == "0" ]] && break
    sleep 5
  done
  [[ "$building" == "0" ]] || { echo "The $index build is still running after 15 minutes; refusing to record it." >&2; exit 1; }
  state="$(index_state "$index")"
  case "$state" in
    valid) ;;
    invalid)
      data_api --sql "DROP INDEX CONCURRENTLY IF EXISTS public.$index" >/dev/null
      echo "ROUND_DB_INDEXES_MIGRATION_CONCURRENT_INDEX_INVALID_DROPPED index=$index" >&2
      echo "The $index build left an INVALID index; it was dropped. Refusing migration." >&2
      exit 1 ;;
    *) echo "The $index index was not created; refusing migration." >&2; exit 1 ;;
  esac
  data_api --sql "INSERT INTO public.sea_n_shore_applied_migrations (name, sha256, git_sha) VALUES ('$name', '$digest', '$ROUND_DB_INDEXES_MIGRATION_EXPECTED_SHA') ON CONFLICT (name) DO NOTHING" >/dev/null
  echo "ROUND_DB_INDEXES_MIGRATION_CONCURRENT_INDEX_VALID index=$index table=$table"
  echo "ROUND_DB_INDEXES_MIGRATION_APPLIED $name"
}

for migration in "${PENDING[@]}"; do
  if is_concurrent_index "$migration"; then
    apply_concurrent_index_file "$migration"
  else
    apply_migration_file "$migration"
  fi
done

for migration in "${MIGRATIONS[@]}"; do
  name="$(basename "$migration" .sql)"
  already_applied "$name" || { echo "Ledger is missing $name after apply." >&2; exit 1; }
done

# Round DB: the index is the one reviewed (schema only).
DEFINITION="$(read_text "SELECT pg_get_indexdef(to_regclass('public.legacy_profile_claims_email_lookup_idx'))")"
[[ "$DEFINITION" == "CREATE INDEX legacy_profile_claims_email_lookup_idx ON public.legacy_profile_claims USING btree (lower(email), claimed_at, profile_id)" ]] || { echo "The claims email index is not the reviewed definition; refusing to verify." >&2; exit 1; }
echo "ROUND_DB_INDEXES_MIGRATION_INDEX_DEFINITION_VERIFIED=true"
# Round DB: the shadow comparison again, now with the index in place.
shadow_compare || { echo "The rewritten final-reminder rule disagrees with the previous one after the index; refusing to verify." >&2; exit 1; }

echo "ROUND_DB_INDEXES_MIGRATION_APPLY_VERIFIED=true"
