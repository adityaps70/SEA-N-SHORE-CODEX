#!/usr/bin/env bash
# Applies the round 4 product migrations (0042-0045) to the staging Aurora cluster through the RDS Data API.
# Each file is split on "-- statement-breakpoint", guarded against destructive SQL, and applied in its own
# transaction under an advisory lock. Every file is idempotent; a ledger row records each applied file.
set -euo pipefail
umask 077
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
CLUSTER_ID="sea-n-shore-staging-aurora"
DATABASE_NAME="sea_n_shore"
ACTION_FILE="scripts/aws/round-4-migration-action.txt"
MIGRATIONS=(
  "infra/aws/database/migrations/0042_profile_current_organization_link.sql"
  "infra/aws/database/migrations/0043_organization_page_profile.sql"
  "infra/aws/database/migrations/0044_posts_as_organization.sql"
  "infra/aws/database/migrations/0045_messaging_conversation_delete_for_me.sql"
)

[[ "${ROUND_4_MIGRATION_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "ROUND_4_MIGRATION_EXPECTED_SHA must be an exact commit SHA." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$ROUND_4_MIGRATION_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- "${MIGRATIONS[@]}" "$0" "$ACTION_FILE"
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]

ACTION="$(tr -d '[:space:]' < "$ACTION_FILE")"
# A manual "migrate-once" dispatch (already checked by the workflow: exact SHA + confirmation phrase)
# overrides the committed plan switch, so no execute/rearm commits are needed.
if [[ -n "${ROUND_4_MIGRATION_ACTION:-}" ]]; then
  ACTION="$(tr -d '[:space:]' <<<"$ROUND_4_MIGRATION_ACTION")"
fi
case "$ACTION" in
  plan|migrate-once) ;;
  *) echo "Unsupported round 4 migration action: $ACTION" >&2; exit 1 ;;
esac

validate_sql() {
  python3 - "$1" <<'PY'
import re, sys
path = sys.argv[1]
sql = open(path, encoding='utf-8').read().strip()
parts = [p.strip() for p in re.split(r'^\s*-- statement-breakpoint\s*$', sql, flags=re.M) if p.strip()]
if not parts:
    raise SystemExit(f'no statements in {path}')
for index, statement in enumerate(parts):
    code = '\n'.join(line for line in statement.splitlines() if not line.lstrip().startswith('--')).strip()
    if not code:
        continue
    if re.search(r'\b(drop\s+(table|column|type|schema)|truncate|delete\s+from)\b', code, re.I):
        raise SystemExit(f'round 4 migration {path} statement {index + 1} contains forbidden destructive SQL')
    if not code.rstrip().endswith(';'):
        raise SystemExit(f'round 4 migration {path} statement {index + 1} is missing a semicolon')
print(f'ROUND_4_SQL_GUARD=ADDITIVE file={path} statements={len(parts)}')
PY
}

for migration in "${MIGRATIONS[@]}"; do
  [[ -f "$migration" ]] || { echo "Missing migration $migration" >&2; exit 1; }
  validate_sql "$migration"
  echo "ROUND_4_MIGRATION_SHA256 $(basename "$migration")=$(sha256sum "$migration" | cut -d' ' -f1)"
done

CLUSTER_JSON="$(aws rds describe-db-clusters --region "$AWS_REGION" --db-cluster-identifier "$CLUSTER_ID" --output json)"
CLUSTER_ARN="$(jq -r '.DBClusters[0].DBClusterArn // empty' <<<"$CLUSTER_JSON")"
SECRET_ARN="$(jq -r '.DBClusters[0].MasterUserSecret.SecretArn // empty' <<<"$CLUSTER_JSON")"
[[ "$(jq -r '.DBClusters[0].Status // empty' <<<"$CLUSTER_JSON")" == "available" ]]
[[ "$(jq -r '.DBClusters[0].HttpEndpointEnabled // false' <<<"$CLUSTER_JSON")" == "true" ]]
[[ "$CLUSTER_ARN" == "arn:aws:rds:ap-south-1:310356785722:cluster:sea-n-shore-staging-aurora" ]]
[[ "$SECRET_ARN" == arn:aws:secretsmanager:ap-south-1:310356785722:secret:rds\!cluster-* ]]

data_api() {
  aws rds-data execute-statement --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" "$@"
}
read_count() { data_api --sql "$1" --output json | jq -r '.records[0][0].longValue'; }

# The tables these migrations extend must already exist.
PREREQUISITES="$(read_count "SELECT count(*)::bigint FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('maritime_profiles','companies','organization_follows','posts','conversation_participants')")"
[[ "$PREREQUISITES" == "5" ]] || {
  echo "Round 4 prerequisite tables are incomplete ($PREREQUISITES/5); refusing migration." >&2
  exit 1
}

ROUND_3_DONE="$(read_count "SELECT CASE WHEN to_regclass('public.sea_n_shore_applied_migrations') IS NULL THEN 0 ELSE (SELECT count(*) FROM public.sea_n_shore_applied_migrations WHERE name LIKE '003%' OR name LIKE '0041%') END::bigint")"
[[ "$ROUND_3_DONE" == "7" ]] || {
  echo "Round 3 migrations are not all recorded ($ROUND_3_DONE/7); apply round 3 first." >&2
  exit 1
}

LEDGER_EXISTS="$(read_count "SELECT count(*)::bigint FROM information_schema.tables WHERE table_schema='public' AND table_name='sea_n_shore_applied_migrations'")"
already_applied() {
  [[ "$LEDGER_EXISTS" == "1" ]] || return 1
  local name="$1"
  [[ "$(read_count "SELECT count(*)::bigint FROM public.sea_n_shore_applied_migrations WHERE name='$name'")" == "1" ]]
}

PENDING=()
for migration in "${MIGRATIONS[@]}"; do
  name="$(basename "$migration" .sql)"
  if already_applied "$name"; then
    echo "ROUND_4_MIGRATION_ALREADY_APPLIED $name"
  else
    echo "ROUND_4_MIGRATION_PENDING $name"
    PENDING+=("$migration")
  fi
done

if [[ "${#PENDING[@]}" -eq 0 ]]; then
  echo "ROUND_4_MIGRATION_ALREADY_APPLIED=true"
  exit 0
fi

echo "ROUND_4_MIGRATION_PLAN_VERIFIED=true"
if [[ "$ACTION" == "plan" ]]; then
  echo "ROUND_4_MIGRATION_PLAN_ONLY_NO_APPLY"
  exit 0
fi

[[ "$(git ls-remote origin refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$ROUND_4_MIGRATION_EXPECTED_SHA" ]]

data_api --sql "CREATE TABLE IF NOT EXISTS public.sea_n_shore_applied_migrations (name text PRIMARY KEY, sha256 text NOT NULL, git_sha text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())" >/dev/null

apply_migration_file() {
  local migration="$1"
  local name digest tx_id committed
  name="$(basename "$migration" .sql)"
  digest="$(sha256sum "$migration" | cut -d' ' -f1)"
  mapfile -t STATEMENT_B64 < <(python3 - "$migration" <<'PY'
import base64, re, sys
sql = open(sys.argv[1], encoding='utf-8').read().strip()
for part in [p.strip() for p in re.split(r'^\s*-- statement-breakpoint\s*$', sql, flags=re.M) if p.strip()]:
    code = '\n'.join(line for line in part.splitlines() if not line.lstrip().startswith('--')).strip()
    if code:
        print(base64.b64encode(part.encode()).decode())
PY
)
  [[ "${#STATEMENT_B64[@]}" -ge 1 ]]

  tx_id="$(aws rds-data begin-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" --query transactionId --output text)"
  [[ -n "$tx_id" ]]
  committed=false
  rollback_current_transaction() {
    if [[ "$committed" != true && -n "${tx_id:-}" ]]; then
      aws rds-data rollback-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --transaction-id "$tx_id" >/dev/null 2>&1 || true
    fi
  }
  trap rollback_current_transaction RETURN

  data_api --transaction-id "$tx_id" --sql "SELECT pg_advisory_xact_lock(hashtext('sea-n-shore-round-4-$name')::bigint)" >/dev/null
  for encoded in "${STATEMENT_B64[@]}"; do
    SQL="$(printf '%s' "$encoded" | base64 --decode)"
    data_api --transaction-id "$tx_id" --sql "$SQL" >/dev/null
  done
  data_api --transaction-id "$tx_id" --sql "INSERT INTO public.sea_n_shore_applied_migrations (name, sha256, git_sha) VALUES ('$name', '$digest', '$ROUND_4_MIGRATION_EXPECTED_SHA') ON CONFLICT (name) DO NOTHING" >/dev/null

  aws rds-data commit-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --transaction-id "$tx_id" >/dev/null
  committed=true
  trap - RETURN
  echo "ROUND_4_MIGRATION_APPLIED $name"
}

LEDGER_EXISTS=1
for migration in "${PENDING[@]}"; do
  apply_migration_file "$migration"
done

for migration in "${MIGRATIONS[@]}"; do
  name="$(basename "$migration" .sql)"
  already_applied "$name" || { echo "Ledger is missing $name after apply." >&2; exit 1; }
done
echo "ROUND_4_MIGRATION_APPLY_VERIFIED=true"
