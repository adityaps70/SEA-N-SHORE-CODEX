#!/usr/bin/env bash
set -euo pipefail
umask 077
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
CLUSTER_ID="sea-n-shore-staging-aurora"
DATABASE_NAME="sea_n_shore"
MIGRATION_FILE="infra/aws/database/migrations/0004_profile_media.sql"
ACTION_FILE="scripts/aws/profile-media-migration-action.txt"

[[ "${PROFILE_MEDIA_MIGRATION_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "PROFILE_MEDIA_MIGRATION_EXPECTED_SHA must be an exact commit SHA." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$PROFILE_MEDIA_MIGRATION_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- "$MIGRATION_FILE" "$0" "$ACTION_FILE"
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]

ACTION="$(tr -d '[:space:]' < "$ACTION_FILE")"
case "$ACTION" in plan|apply-once) ;; *) echo "Unsupported profile media migration action." >&2; exit 1 ;; esac

python3 - "$MIGRATION_FILE" <<'PY'
import re, sys
sql=open(sys.argv[1], encoding='utf-8').read().strip()
if re.search(r'\b(drop|delete|truncate|update|insert)\b', sql, re.I):
    raise SystemExit('Migration contains destructive or data-changing SQL')
normalized=' '.join(sql.rstrip(';').split()).lower()
expected='alter table public.profiles add column if not exists cover_path text'
if normalized != expected:
    raise SystemExit('Profile media migration is not the single approved additive column change')
print('PROFILE_MEDIA_MIGRATION_SQL_GUARD=ADDITIVE_ONLY')
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

COLUMN_COUNT="$(execute_read "SELECT count(*)::bigint FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name='cover_path'" | jq -r '.records[0][0].longValue')"
echo "PROFILE_MEDIA_COVER_COLUMN_COUNT_BEFORE=$COLUMN_COUNT"

if [[ "$COLUMN_COUNT" == "1" ]]; then
  echo "PROFILE_MEDIA_MIGRATION_ALREADY_APPLIED=true"
  exit 0
fi
[[ "$COLUMN_COUNT" == "0" ]] || { echo "Unexpected cover_path column count." >&2; exit 1; }

echo "PROFILE_MEDIA_MIGRATION_PLAN_VERIFIED=ADD_COLUMN_ONLY"
if [[ "$ACTION" == "plan" ]]; then
  echo "PROFILE_MEDIA_MIGRATION_PLAN_ONLY_NO_APPLY"
  exit 0
fi

[[ "$(git ls-remote origin refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$PROFILE_MEDIA_MIGRATION_EXPECTED_SHA" ]]
SQL="$(cat "$MIGRATION_FILE")"
aws rds-data execute-statement --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" \
  --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" --sql "$SQL" >/dev/null

COLUMN_COUNT_AFTER="$(execute_read "SELECT count(*)::bigint FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name='cover_path'" | jq -r '.records[0][0].longValue')"
[[ "$COLUMN_COUNT_AFTER" == "1" ]]
echo "PROFILE_MEDIA_MIGRATION_APPLY_VERIFIED=true"
