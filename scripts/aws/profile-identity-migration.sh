#!/usr/bin/env bash
set -euo pipefail
umask 077
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
CLUSTER_ID="sea-n-shore-staging-aurora"
DATABASE_NAME="sea_n_shore"
MIGRATION_FILE="infra/aws/database/migrations/0005_profile_identity.sql"
ACTION_FILE="scripts/aws/profile-identity-migration-action.txt"

[[ "${PROFILE_IDENTITY_MIGRATION_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "PROFILE_IDENTITY_MIGRATION_EXPECTED_SHA must be an exact commit SHA." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$PROFILE_IDENTITY_MIGRATION_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- "$MIGRATION_FILE" "$0" "$ACTION_FILE"
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]

ACTION="$(tr -d '[:space:]' < "$ACTION_FILE")"
case "$ACTION" in plan|apply-once) ;; *) echo "Unsupported profile identity migration action." >&2; exit 1 ;; esac

python3 - "$MIGRATION_FILE" <<'PY'
import re, sys
sql=open(sys.argv[1], encoding='utf-8').read().strip()
if not re.match(r'^alter\s+table\s+public\.profiles\b', sql, re.I):
    raise SystemExit('Profile identity migration must alter only public.profiles')
if re.search(r'\bdrop\s+(?:table|column)\b|\b(?:truncate|delete|update|insert)\b', sql, re.I):
    raise SystemExit('Profile identity migration contains destructive or data-changing SQL')
if sql.count(';') != 1 or not sql.endswith(';'):
    raise SystemExit('Profile identity migration must remain one transactional ALTER TABLE statement')
required = [
    'add column if not exists identity_root text',
    'add column if not exists primary_identity text',
    'add column if not exists primary_identity_family text',
    "add column if not exists secondary_identities text[] not null default '{}'::text[]",
    'drop constraint if exists profiles_full_name_check',
    'add constraint profiles_full_name_check',
    'drop constraint if exists profiles_completed_identity_check',
    'add constraint profiles_completed_identity_check',
    'add constraint profiles_identity_root_check',
    'add constraint profiles_primary_identity_check',
    'add constraint profiles_primary_identity_family_check',
    'add constraint profiles_secondary_identities_check',
    'add constraint profiles_identity_shape_check',
]
normalized=' '.join(sql.split()).lower()
for token in required:
    if token.lower() not in normalized:
        raise SystemExit('Profile identity migration is missing approved schema token: '+token)
print('PROFILE_IDENTITY_MIGRATION_SQL_GUARD=BOUNDED_SCHEMA_ONLY')
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

IDENTITY_COLUMN_COUNT="$(read_count "SELECT count(*)::bigint FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name IN ('identity_root','primary_identity','primary_identity_family','secondary_identities')")"
IDENTITY_CONSTRAINT_COUNT="$(read_count "SELECT count(*)::bigint FROM pg_constraint WHERE conrelid='public.profiles'::regclass AND conname IN ('profiles_identity_root_check','profiles_primary_identity_check','profiles_primary_identity_family_check','profiles_secondary_identities_check','profiles_identity_shape_check')")"
BASE_CONSTRAINT_COUNT="$(read_count "SELECT count(*)::bigint FROM pg_constraint WHERE conrelid='public.profiles'::regclass AND conname IN ('profiles_full_name_check','profiles_completed_identity_check')")"
FULL_NAME_160_COUNT="$(read_count "SELECT count(*)::bigint FROM pg_constraint WHERE conrelid='public.profiles'::regclass AND conname='profiles_full_name_check' AND pg_get_constraintdef(oid) ILIKE '%160%'")"
COMPLETED_EXACT_COUNT="$(read_count "SELECT count(*)::bigint FROM pg_constraint WHERE conrelid='public.profiles'::regclass AND conname='profiles_completed_identity_check' AND pg_get_constraintdef(oid) ILIKE '%identity_root%' AND pg_get_constraintdef(oid) ILIKE '%summary%'")"

echo "PROFILE_IDENTITY_COLUMNS_BEFORE=$IDENTITY_COLUMN_COUNT"
echo "PROFILE_IDENTITY_CONSTRAINTS_BEFORE=$IDENTITY_CONSTRAINT_COUNT"

if [[ "$IDENTITY_COLUMN_COUNT" == "4" && "$IDENTITY_CONSTRAINT_COUNT" == "5" && "$BASE_CONSTRAINT_COUNT" == "2" && "$FULL_NAME_160_COUNT" == "1" && "$COMPLETED_EXACT_COUNT" == "1" ]]; then
  echo "PROFILE_IDENTITY_MIGRATION_ALREADY_APPLIED=true"
  exit 0
fi

[[ "$IDENTITY_COLUMN_COUNT" == "0" ]] || { echo "Partial exact-identity columns detected; refusing automatic migration." >&2; exit 1; }
[[ "$IDENTITY_CONSTRAINT_COUNT" == "0" ]] || { echo "Partial exact-identity constraints detected; refusing automatic migration." >&2; exit 1; }
[[ "$BASE_CONSTRAINT_COUNT" == "2" ]] || { echo "Expected legacy profile checks are missing; refusing automatic migration." >&2; exit 1; }
[[ "$FULL_NAME_160_COUNT" == "0" && "$COMPLETED_EXACT_COUNT" == "0" ]] || { echo "Unexpected profile constraint state detected; refusing automatic migration." >&2; exit 1; }

echo "PROFILE_IDENTITY_MIGRATION_PLAN_VERIFIED=BOUNDED_PROFILE_SCHEMA_CHANGE"
if [[ "$ACTION" == "plan" ]]; then
  echo "PROFILE_IDENTITY_MIGRATION_PLAN_ONLY_NO_APPLY"
  exit 0
fi

[[ "$(git ls-remote origin refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$PROFILE_IDENTITY_MIGRATION_EXPECTED_SHA" ]]

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

SQL="$(cat "$MIGRATION_FILE")"
aws rds-data execute-statement --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" \
  --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" --transaction-id "$TX_ID" --sql "$SQL" >/dev/null

aws rds-data commit-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" \
  --secret-arn "$SECRET_ARN" --transaction-id "$TX_ID" >/dev/null
committed=true

IDENTITY_COLUMN_COUNT_AFTER="$(read_count "SELECT count(*)::bigint FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name IN ('identity_root','primary_identity','primary_identity_family','secondary_identities')")"
IDENTITY_CONSTRAINT_COUNT_AFTER="$(read_count "SELECT count(*)::bigint FROM pg_constraint WHERE conrelid='public.profiles'::regclass AND conname IN ('profiles_identity_root_check','profiles_primary_identity_check','profiles_primary_identity_family_check','profiles_secondary_identities_check','profiles_identity_shape_check')")"
FULL_NAME_160_COUNT_AFTER="$(read_count "SELECT count(*)::bigint FROM pg_constraint WHERE conrelid='public.profiles'::regclass AND conname='profiles_full_name_check' AND pg_get_constraintdef(oid) ILIKE '%160%'")"
COMPLETED_EXACT_COUNT_AFTER="$(read_count "SELECT count(*)::bigint FROM pg_constraint WHERE conrelid='public.profiles'::regclass AND conname='profiles_completed_identity_check' AND pg_get_constraintdef(oid) ILIKE '%identity_root%' AND pg_get_constraintdef(oid) ILIKE '%summary%'")"
[[ "$IDENTITY_COLUMN_COUNT_AFTER" == "4" ]]
[[ "$IDENTITY_CONSTRAINT_COUNT_AFTER" == "5" ]]
[[ "$FULL_NAME_160_COUNT_AFTER" == "1" ]]
[[ "$COMPLETED_EXACT_COUNT_AFTER" == "1" ]]
echo "PROFILE_IDENTITY_MIGRATION_APPLY_VERIFIED=true"
