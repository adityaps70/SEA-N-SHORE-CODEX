#!/usr/bin/env bash
# Applies the algorithms round G release 2 migrations (0084-0085) to the staging Aurora cluster through the RDS Data API.
# Each file is split on "-- statement-breakpoint", checked against the additive-only rules (plus any statement listed
# word for word in APPROVED below), and applied in its own transaction under an advisory lock. Every file is
# idempotent; a ledger row records each applied file.
#
# A plan run previews the pending files in a transaction that is always rolled back.
# Evidence lines (the workflow reads only the last line of each path):
#   nothing pending  -> ROUND_G_RELEASE_2_MIGRATION_ALREADY_APPLIED=true
#   plan             -> ROUND_G_RELEASE_2_MIGRATION_PLAN_VERIFIED=true, then ROUND_G_RELEASE_2_MIGRATION_PLAN_ONLY_NO_APPLY
#   migrate-once     -> ROUND_G_RELEASE_2_MIGRATION_APPLY_VERIFIED=true
set -euo pipefail
umask 077
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
CLUSTER_ID="sea-n-shore-staging-aurora"
DATABASE_NAME="sea_n_shore"
ACTION_FILE="scripts/aws/round-g-release-2-migration-action.txt"
MIGRATIONS=(
  "infra/aws/database/migrations/0084_algorithms_round_g_release_2_types.sql"
  "infra/aws/database/migrations/0085_algorithms_round_g_release_2.sql"
)
# Files the plan run previews in a rolled-back transaction. Leave out a file whose new enum values a later file in
# the same preview uses (Postgres refuses a new enum value inside the transaction that added it).
PREVIEW_MIGRATIONS=(
  "infra/aws/database/migrations/0085_algorithms_round_g_release_2.sql"
)

[[ "${ROUND_G_RELEASE_2_MIGRATION_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "ROUND_G_RELEASE_2_MIGRATION_EXPECTED_SHA must be an exact commit SHA." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$ROUND_G_RELEASE_2_MIGRATION_EXPECTED_SHA" ]] || { echo "Checkout is not the expected commit; refusing migration." >&2; exit 1; }
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]] || { echo "Checkout is not the Sea N Shore repository; refusing migration." >&2; exit 1; }
git diff --quiet HEAD -- "${MIGRATIONS[@]}" "$0" "$ACTION_FILE" || { echo "Migration files differ from the commit; refusing migration." >&2; exit 1; }
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]] || { echo "Unexpected AWS account; refusing migration." >&2; exit 1; }

ACTION="$(cut -d' ' -f1 < "$ACTION_FILE" | tr -d '[:space:]')"
# A manual "migrate-once" dispatch (already checked by the workflow: exact SHA + confirmation phrase)
# overrides the committed plan switch, so no execute/rearm commits are needed.
if [[ -n "${ROUND_G_RELEASE_2_MIGRATION_ACTION:-}" ]]; then
  ACTION="$(tr -d '[:space:]' <<<"$ROUND_G_RELEASE_2_MIGRATION_ACTION")"
fi
case "$ACTION" in
  plan|migrate-once) ;;
  *) echo "Unsupported algorithms round G release 2 migration action: $ACTION" >&2; exit 1 ;;
esac

validate_sql() {
  python3 - "$1" <<'PY'
import re, sys
path = sys.argv[1]
sql = open(path, encoding='utf-8').read().strip()
parts = [p.strip() for p in re.split(r'^\s*-- statement-breakpoint\s*$', sql, flags=re.M) if p.strip()]
if not parts:
    raise SystemExit(f'no statements in {path}')
def norm(text):
    return ' '.join(text.split())
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
        raise SystemExit(f'algorithms round G release 2 migration {path} statement {index + 1} contains forbidden destructive SQL')
    if re.search(r'\bsecurity\s+definer\b', code, re.I):
        raise SystemExit(f'algorithms round G release 2 migration {path} statement {index + 1} uses SECURITY DEFINER')
    if re.search(r'\bconcurrently\b', code, re.I):
        raise SystemExit(f'algorithms round G release 2 migration {path} statement {index + 1} is not transaction-safe')
    if not code.rstrip().endswith(';'):
        raise SystemExit(f'algorithms round G release 2 migration {path} statement {index + 1} is missing a semicolon')
print(f'ROUND_G_RELEASE_2_MIGRATION_SQL_GUARD=ADDITIVE file={path} statements={len(parts)}')
PY
}

for migration in "${MIGRATIONS[@]}"; do
  [[ -f "$migration" ]] || { echo "Missing migration $migration" >&2; exit 1; }
  validate_sql "$migration"
  echo "ROUND_G_RELEASE_2_MIGRATION_SHA256 $(basename "$migration")=$(sha256sum "$migration" | cut -d' ' -f1)"
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

# algorithms round G release 2 follows 0083_algorithms_round_g.
LEDGER_EXISTS="$(read_count "SELECT count(*)::bigint FROM information_schema.tables WHERE table_schema='public' AND table_name='sea_n_shore_applied_migrations'")"
[[ "$LEDGER_EXISTS" == "1" ]] || { echo "The migration ledger is missing; refusing migration." >&2; exit 1; }
already_applied() { [[ "$(read_count "SELECT count(*)::bigint FROM public.sea_n_shore_applied_migrations WHERE name='$1'")" == "1" ]]; }
already_applied 0083_algorithms_round_g || { echo "Migration 0083_algorithms_round_g is not applied yet; refusing migration." >&2; exit 1; }

# Round G release 2 sizing (read only, every path): counts only, never names, ids or text. SEARCH_SOURCES is the
# number of search_documents rows the 0085 backfill writes.
SIZING_SEARCH_SOURCES="$(read_count "SELECT ((SELECT count(*) FROM public.profiles) + (SELECT count(*) FROM public.companies) + (SELECT count(*) FROM public.community_groups) + (SELECT count(*) FROM public.jobs) + (SELECT count(*) FROM public.learning_courses) + (SELECT count(*) FROM public.events) + (SELECT count(*) FROM public.posts WHERE post_type <> 'repost'))::bigint")"
SIZING_JOB_ALERTS="$(read_count "SELECT count(*)::bigint FROM public.job_alerts")"
SIZING_VERIFIED_EMAILS="$(read_count "SELECT count(DISTINCT profile_id)::bigint FROM public.identity_accounts WHERE email_verified AND email IS NOT NULL")"
echo "ROUND_G_RELEASE_2_SIZING search_sources=$SIZING_SEARCH_SOURCES job_alerts=$SIZING_JOB_ALERTS members_with_verified_email=$SIZING_VERIFIED_EMAILS"

PENDING=()
for migration in "${MIGRATIONS[@]}"; do
  name="$(basename "$migration" .sql)"
  if already_applied "$name"; then
    echo "ROUND_G_RELEASE_2_MIGRATION_ALREADY_APPLIED $name"
  else
    echo "ROUND_G_RELEASE_2_MIGRATION_PENDING $name"
    PENDING+=("$migration")
  fi
done

if [[ "${#PENDING[@]}" -eq 0 ]]; then
  echo "ROUND_G_RELEASE_2_MIGRATION_ALREADY_APPLIED=true"
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
  echo "ROUND_G_RELEASE_2_MIGRATION_PREVIEW statements=${#PREVIEW_B64[@]} (rolled back)"
  echo "ROUND_G_RELEASE_2_MIGRATION_PLAN_VERIFIED=true"
  echo "ROUND_G_RELEASE_2_MIGRATION_PLAN_ONLY_NO_APPLY"
  exit 0
fi

[[ "$(bash scripts/aws/branch-head.sh refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$ROUND_G_RELEASE_2_MIGRATION_EXPECTED_SHA" ]] || { echo "The feature branch has moved past the approved commit; refusing migration." >&2; exit 1; }

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

  data_api --transaction-id "$tx_id" --sql "SELECT pg_advisory_xact_lock(hashtext('sea-n-shore-round-g-release-2-$name')::bigint)" >/dev/null
  for encoded in "${STATEMENT_B64[@]}"; do
    SQL="$(printf '%s' "$encoded" | base64 --decode)"
    data_api --transaction-id "$tx_id" --sql "$SQL" >/dev/null
  done
  data_api --transaction-id "$tx_id" --sql "INSERT INTO public.sea_n_shore_applied_migrations (name, sha256, git_sha) VALUES ('$name', '$digest', '$ROUND_G_RELEASE_2_MIGRATION_EXPECTED_SHA') ON CONFLICT (name) DO NOTHING" >/dev/null

  aws rds-data commit-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --transaction-id "$tx_id" >/dev/null
  committed=true
  trap - RETURN
  echo "ROUND_G_RELEASE_2_MIGRATION_APPLIED $name"
}

for migration in "${PENDING[@]}"; do
  apply_migration_file "$migration"
done

for migration in "${MIGRATIONS[@]}"; do
  name="$(basename "$migration" .sql)"
  already_applied "$name" || { echo "Ledger is missing $name after apply." >&2; exit 1; }
done

# Round G release 2 checks after apply. They read schema and counts only, never member rows.
NEW_TABLES="$(read_count "SELECT count(*)::bigint FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('job_alert_deliveries','member_email_topics','ranking_emails','search_documents')")"
[[ "$NEW_TABLES" == "4" ]] || { echo "Expected 4 new round G release 2 tables after apply, found $NEW_TABLES." >&2; exit 1; }
LAST_CHECKED="$(read_count "SELECT count(*)::bigint FROM information_schema.columns WHERE table_schema='public' AND table_name='job_alerts' AND column_name='last_checked_at'")"
[[ "$LAST_CHECKED" == "1" ]] || { echo "job_alerts.last_checked_at is missing after apply." >&2; exit 1; }
ENUM_VALUE="$(read_count "SELECT count(*)::bigint FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname='network_notification_type' AND e.enumlabel='job_alert_match'")"
[[ "$ENUM_VALUE" == "1" ]] || { echo "The job_alert_match notification type is missing after apply." >&2; exit 1; }
TRIGGERS="$(read_count "SELECT count(*)::bigint FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('search_profiles','search_maritime_profiles','search_companies','search_community_groups','search_jobs','search_learning_courses','search_events','search_posts','search_post_hashtags')")"
[[ "$TRIGGERS" == "9" ]] || { echo "Expected 9 search triggers after apply, found $TRIGGERS." >&2; exit 1; }
SEARCH_MISSING="$(read_count "SELECT ((SELECT count(*) FROM public.profiles s WHERE NOT EXISTS (SELECT 1 FROM public.search_documents d WHERE d.kind='person' AND d.entity_id=s.id)) + (SELECT count(*) FROM public.companies s WHERE NOT EXISTS (SELECT 1 FROM public.search_documents d WHERE d.kind='org' AND d.entity_id=s.id)) + (SELECT count(*) FROM public.community_groups s WHERE NOT EXISTS (SELECT 1 FROM public.search_documents d WHERE d.kind='community' AND d.entity_id=s.id)) + (SELECT count(*) FROM public.jobs s WHERE NOT EXISTS (SELECT 1 FROM public.search_documents d WHERE d.kind='job' AND d.entity_id=s.id)) + (SELECT count(*) FROM public.learning_courses s WHERE NOT EXISTS (SELECT 1 FROM public.search_documents d WHERE d.kind='course' AND d.entity_id=s.id)) + (SELECT count(*) FROM public.events s WHERE NOT EXISTS (SELECT 1 FROM public.search_documents d WHERE d.kind='event' AND d.entity_id=s.id)) + (SELECT count(*) FROM public.posts s WHERE s.post_type <> 'repost' AND NOT EXISTS (SELECT 1 FROM public.search_documents d WHERE d.kind='post' AND d.entity_id=s.id)))::bigint")"
[[ "$SEARCH_MISSING" == "0" ]] || { echo "search_documents backfill missed $SEARCH_MISSING rows." >&2; exit 1; }
SEARCH_ROWS="$(read_count "SELECT count(*)::bigint FROM public.search_documents")"
SWITCHES="$(read_count "SELECT count(*)::bigint FROM public.ranking_settings WHERE key IN ('jobs','job_alerts','search','suggestions','notifications','weekly_digest')")"
[[ "$SWITCHES" == "6" ]] || { echo "Expected 6 release 2 ranking switches after apply, found $SWITCHES." >&2; exit 1; }
echo "ROUND_G_RELEASE_2_MIGRATION_SCHEMA tables=$NEW_TABLES last_checked_at=$LAST_CHECKED enum=$ENUM_VALUE triggers=$TRIGGERS search_documents=$SEARCH_ROWS search_missing=$SEARCH_MISSING switches=$SWITCHES"

echo "ROUND_G_RELEASE_2_MIGRATION_APPLY_VERIFIED=true"
