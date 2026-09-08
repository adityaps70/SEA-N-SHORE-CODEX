#!/usr/bin/env bash
set -euo pipefail
umask 077
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
CLUSTER_ID="sea-n-shore-staging-aurora"
DATABASE_NAME="sea_n_shore"
MIGRATION_FILE="infra/aws/database/migrations/0006_profile_passport.sql"
ACTION_FILE="scripts/aws/profile-passport-migration-action.txt"

[[ "${PROFILE_PASSPORT_MIGRATION_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "PROFILE_PASSPORT_MIGRATION_EXPECTED_SHA must be an exact commit SHA." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$PROFILE_PASSPORT_MIGRATION_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- "$MIGRATION_FILE" "$0" "$ACTION_FILE"
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]

ACTION="$(tr -d '[:space:]' < "$ACTION_FILE")"
case "$ACTION" in plan|apply-once) ;; *) echo "Unsupported Maritime Passport migration action." >&2; exit 1 ;; esac

python3 - "$MIGRATION_FILE" <<'PY'
import re, sys
sql=open(sys.argv[1], encoding='utf-8').read().strip()
if re.search(r'\b(drop|truncate|update|insert|alter)\b|\bdelete\s+from\b', sql, re.I):
    raise SystemExit('Maritime Passport migration contains destructive or data-changing SQL')
parts=[part.strip() for part in re.split(r'^\s*-- statement-breakpoint\s*$', sql, flags=re.M) if part.strip()]
if len(parts) != 4:
    raise SystemExit(f'Maritime Passport migration must contain exactly four statement-breakpoint bounded statements; found {len(parts)}')
starts=[
    r'^create\s+table\s+if\s+not\s+exists\s+public\.profile_experiences\b',
    r'^create\s+index\s+if\s+not\s+exists\s+profile_experiences_profile_order_idx\b',
    r'^create\s+table\s+if\s+not\s+exists\s+public\.profile_credentials\b',
    r'^create\s+index\s+if\s+not\s+exists\s+profile_credentials_profile_order_idx\b',
]
for part, pattern in zip(parts, starts):
    if not re.match(pattern, part, re.I):
        raise SystemExit('Maritime Passport migration statement order or scope changed')
    if not part.endswith(';'):
        raise SystemExit('Every Maritime Passport migration statement must end with a semicolon')
normalized=' '.join(sql.split()).lower()
required=[
    'profile_id uuid not null references public.profiles(id) on delete cascade',
    "track in ('sea_service', 'shore_role', 'training', 'other_maritime')",
    "cargo_experience text[] not null default '{}'::text[]",
    "engine_experience text[] not null default '{}'::text[]",
    "trading_areas text[] not null default '{}'::text[]",
    "verification_state text not null default 'self_reported'",
    "verification_state in ('self_reported', 'pending', 'verified', 'rejected')",
]
for token in required:
    if token not in normalized:
        raise SystemExit('Maritime Passport migration is missing approved schema token: '+token)
print('PROFILE_PASSPORT_MIGRATION_SQL_GUARD=ADDITIVE_PROFILE_TABLES_ONLY')
PY

echo "MIGRATION_SHA256=$(sha256sum "$MIGRATION_FILE" | cut -d' ' -f1)"

CLUSTER_JSON="$(aws rds describe-db-clusters --region "$AWS_REGION" --db-cluster-identifier "$CLUSTER_ID" --output json)"
CLUSTER_ARN="$(jq -r '.DBClusters[0].DBClusterArn // empty' <<<"$CLUSTER_JSON")"
SECRET_ARN="$(jq -r '.DBClusters[0].MasterUserSecret.SecretArn // empty' <<<"$CLUSTER_JSON")"
HTTP_ENDPOINT="$(jq -r '.DBClusters[0].HttpEndpointEnabled // false' <<<"$CLUSTER_JSON")"
STATUS="$(jq -r '.DBClusters[0].Status // empty' <<<"$CLUSTER_JSON")"
[[ "$STATUS" == "available" && "$HTTP_ENDPOINT" == "true" ]]
[[ "$CLUSTER_ARN" == "arn:aws:rds:ap-south-1:310356785722:cluster:sea-n-shore-staging-aurora" ]]
[[ "$SECRET_ARN" == arn:aws:secretsmanager:ap-south-1:310356785722:secret:rds\!cluster-* ]]

execute_read() {
  aws rds-data execute-statement --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" \
    --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" --sql "$1" --output json
}

read_count() {
  execute_read "$1" | jq -r '.records[0][0].longValue'
}

read_shape() {
  local table_count column_count constraint_count fk_count index_count
  table_count="$(read_count "SELECT count(*)::bigint FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('profile_experiences','profile_credentials')")"
  column_count="$(read_count "SELECT count(*)::bigint FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('profile_experiences','profile_credentials')")"
  constraint_count="$(read_count "SELECT count(*)::bigint FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname IN ('profile_experiences','profile_credentials') AND c.conname IN ('profile_experiences_track_check','profile_experiences_title_check','profile_experiences_organization_check','profile_experiences_vessel_check','profile_experiences_vessel_type_check','profile_experiences_location_check','profile_experiences_description_check','profile_experiences_dates_check','profile_experiences_cargo_count_check','profile_experiences_engine_count_check','profile_experiences_trading_count_check','profile_experiences_sort_order_check','profile_credentials_name_check','profile_credentials_issuer_check','profile_credentials_number_check','profile_credentials_dates_check','profile_credentials_verification_check','profile_credentials_sort_order_check')")"
  fk_count="$(read_count "SELECT count(*)::bigint FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname IN ('profile_experiences','profile_credentials') AND c.contype='f' AND c.confrelid='public.profiles'::regclass")"
  index_count="$(read_count "SELECT count(*)::bigint FROM pg_indexes WHERE schemaname='public' AND indexname IN ('profile_experiences_profile_order_idx','profile_credentials_profile_order_idx')")"
  printf '%s %s %s %s %s\n' "$table_count" "$column_count" "$constraint_count" "$fk_count" "$index_count"
}

read -r TABLE_COUNT COLUMN_COUNT CONSTRAINT_COUNT FK_COUNT INDEX_COUNT < <(read_shape)
echo "PROFILE_PASSPORT_TABLES_BEFORE=$TABLE_COUNT"
echo "PROFILE_PASSPORT_COLUMNS_BEFORE=$COLUMN_COUNT"
echo "PROFILE_PASSPORT_NAMED_CONSTRAINTS_BEFORE=$CONSTRAINT_COUNT"
echo "PROFILE_PASSPORT_PROFILE_FKS_BEFORE=$FK_COUNT"
echo "PROFILE_PASSPORT_ORDER_INDEXES_BEFORE=$INDEX_COUNT"

if [[ "$TABLE_COUNT" == "2" && "$COLUMN_COUNT" == "30" && "$CONSTRAINT_COUNT" == "18" && "$FK_COUNT" == "2" && "$INDEX_COUNT" == "2" ]]; then
  echo "PROFILE_PASSPORT_MIGRATION_ALREADY_APPLIED=true"
  exit 0
fi

[[ "$TABLE_COUNT" == "0" && "$COLUMN_COUNT" == "0" && "$CONSTRAINT_COUNT" == "0" && "$FK_COUNT" == "0" && "$INDEX_COUNT" == "0" ]] || {
  echo "Partial or unexpected Maritime Passport schema detected; refusing automatic migration." >&2
  exit 1
}

echo "PROFILE_PASSPORT_MIGRATION_PLAN_VERIFIED=CREATE_TWO_OWNER_LINKED_TABLES_AND_INDEXES"
if [[ "$ACTION" == "plan" ]]; then
  echo "PROFILE_PASSPORT_MIGRATION_PLAN_ONLY_NO_APPLY"
  exit 0
fi

[[ "$(git ls-remote origin refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$PROFILE_PASSPORT_MIGRATION_EXPECTED_SHA" ]]

mapfile -t STATEMENT_B64 < <(python3 - "$MIGRATION_FILE" <<'PY'
import base64, re, sys
sql=open(sys.argv[1], encoding='utf-8').read().strip()
parts=[part.strip() for part in re.split(r'^\s*-- statement-breakpoint\s*$', sql, flags=re.M) if part.strip()]
for part in parts:
    print(base64.b64encode(part.encode()).decode())
PY
)
[[ "${#STATEMENT_B64[@]}" == "4" ]]

TX_ID="$(aws rds-data begin-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" \
  --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" --query transactionId --output text)"
[[ -n "$TX_ID" ]]
committed=false
cleanup() {
  if [[ "$committed" != true && -n "${TX_ID:-}" ]]; then
    aws rds-data rollback-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" \
      --secret-arn "$SECRET_ARN" --transaction-id "$TX_ID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

for encoded in "${STATEMENT_B64[@]}"; do
  SQL="$(printf '%s' "$encoded" | base64 --decode)"
  aws rds-data execute-statement --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" \
    --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" --transaction-id "$TX_ID" --sql "$SQL" >/dev/null
done

aws rds-data commit-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" \
  --secret-arn "$SECRET_ARN" --transaction-id "$TX_ID" >/dev/null
committed=true

read -r TABLE_COUNT_AFTER COLUMN_COUNT_AFTER CONSTRAINT_COUNT_AFTER FK_COUNT_AFTER INDEX_COUNT_AFTER < <(read_shape)
echo "PROFILE_PASSPORT_TABLES_AFTER=$TABLE_COUNT_AFTER"
echo "PROFILE_PASSPORT_COLUMNS_AFTER=$COLUMN_COUNT_AFTER"
echo "PROFILE_PASSPORT_NAMED_CONSTRAINTS_AFTER=$CONSTRAINT_COUNT_AFTER"
echo "PROFILE_PASSPORT_PROFILE_FKS_AFTER=$FK_COUNT_AFTER"
echo "PROFILE_PASSPORT_ORDER_INDEXES_AFTER=$INDEX_COUNT_AFTER"
[[ "$TABLE_COUNT_AFTER" == "2" ]]
[[ "$COLUMN_COUNT_AFTER" == "30" ]]
[[ "$CONSTRAINT_COUNT_AFTER" == "18" ]]
[[ "$FK_COUNT_AFTER" == "2" ]]
[[ "$INDEX_COUNT_AFTER" == "2" ]]
echo "PROFILE_PASSPORT_MIGRATION_APPLY_VERIFIED=true"
