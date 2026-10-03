#!/usr/bin/env bash
set -euo pipefail
umask 077
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
CLUSTER_ID="sea-n-shore-staging-aurora"
DATABASE_NAME="sea_n_shore"
MIGRATION="infra/aws/database/migrations/0023_profile_username.sql"
ACTION_FILE="scripts/aws/profile-username-migration-action.txt"

[[ "${PROFILE_USERNAME_MIGRATION_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || { echo "PROFILE_USERNAME_MIGRATION_EXPECTED_SHA must be an exact commit SHA." >&2; exit 1; }
[[ "$(git rev-parse HEAD)" == "$PROFILE_USERNAME_MIGRATION_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- "$MIGRATION" "$0" "$ACTION_FILE"
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]

ACTION="$(tr -d '[:space:]' < "$ACTION_FILE")"
case "$ACTION" in plan|migrate-once) ;; *) echo "Unsupported profile username migration action: $ACTION" >&2; exit 1 ;; esac

python3 - "$MIGRATION" <<'PY'
import re, sys
sql=open(sys.argv[1], encoding='utf-8').read().strip()
parts=[p.strip() for p in re.split(r'^\s*-- statement-breakpoint\s*$', sql, flags=re.M) if p.strip()]
if len(parts) != 3:
    raise SystemExit(f'expected exactly three profile username statements; found {len(parts)}')
for statement in parts:
    code='\n'.join(line for line in statement.splitlines() if not line.lstrip().startswith('--')).strip()
    if not re.match(r'^alter\s+table\s+public\.profiles\b', code, re.I):
        raise SystemExit('profile username migration may only alter public.profiles')
    if re.search(r'\b(drop\s+table|drop\s+column|truncate|delete\s+from|update\s+|insert\s+into|cascade)\b', code, re.I):
        raise SystemExit('profile username migration contains forbidden destructive/data-changing SQL')
    dropped=set(re.findall(r'drop\s+constraint\s+if\s+exists\s+([a-z0-9_]+)', code, re.I))
    if not dropped.issubset({'profiles_username_change_count_check','profiles_slug_check'}):
        raise SystemExit(f'unexpected constraint replacement: {sorted(dropped)}')
    if not code.endswith(';'):
        raise SystemExit('profile username migration statement missing semicolon')
print(f'PROFILE_USERNAME_SQL_GUARD=PROFILE_ONLY_COMPATIBILITY statements={len(parts)}')
PY

echo "PROFILE_USERNAME_MIGRATION_SHA256=$(sha256sum "$MIGRATION" | cut -d' ' -f1)"
CLUSTER_JSON="$(aws rds describe-db-clusters --region "$AWS_REGION" --db-cluster-identifier "$CLUSTER_ID" --output json)"
CLUSTER_ARN="$(jq -r '.DBClusters[0].DBClusterArn // empty' <<<"$CLUSTER_JSON")"
SECRET_ARN="$(jq -r '.DBClusters[0].MasterUserSecret.SecretArn // empty' <<<"$CLUSTER_JSON")"
[[ "$(jq -r '.DBClusters[0].Status // empty' <<<"$CLUSTER_JSON")" == "available" ]]
[[ "$(jq -r '.DBClusters[0].HttpEndpointEnabled // false' <<<"$CLUSTER_JSON")" == "true" ]]
[[ "$CLUSTER_ARN" == "arn:aws:rds:ap-south-1:310356785722:cluster:sea-n-shore-staging-aurora" ]]
[[ "$SECRET_ARN" == arn:aws:secretsmanager:ap-south-1:310356785722:secret:rds\!cluster-* ]]

execute_read() { aws rds-data execute-statement --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" --sql "$1" --output json; }
read_count() { execute_read "$1" | jq -r '.records[0][0].longValue'; }

FOUNDATION_COUNT="$(read_count "SELECT count(*)::bigint FROM information_schema.tables WHERE table_schema='public' AND table_name='profiles'")"
[[ "$FOUNDATION_COUNT" == "1" ]] || { echo "Profiles table is missing; refusing profile username migration." >&2; exit 1; }

shape() {
  local column_count count_check slug_check
  column_count="$(read_count "SELECT count(*)::bigint FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name='username_change_count' AND data_type='smallint' AND is_nullable='NO'")"
  count_check="$(read_count "SELECT count(*)::bigint FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND t.relname='profiles' AND c.conname='profiles_username_change_count_check' AND c.contype='c' AND position('username_change_count' in pg_get_constraintdef(c.oid)) > 0")"
  slug_check="$(read_count "SELECT count(*)::bigint FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND t.relname='profiles' AND c.conname='profiles_slug_check' AND c.contype='c' AND position('._-' in pg_get_constraintdef(c.oid)) > 0 AND position('lower(btrim(slug))' in pg_get_constraintdef(c.oid)) > 0")"
  printf '%s/%s/%s\n' "$column_count" "$count_check" "$slug_check"
}

BEFORE="$(shape)"
echo "PROFILE_USERNAME_SHAPE_BEFORE=$BEFORE"
if [[ "$BEFORE" == "1/1/1" ]]; then
  echo "PROFILE_USERNAME_MIGRATION_ALREADY_APPLIED=true"
  exit 0
fi
[[ "$BEFORE" == "0/0/0" ]] || { echo "Partial profile username schema detected; refusing automatic migration." >&2; exit 1; }

echo "PROFILE_USERNAME_MIGRATION_PLAN_VERIFIED=true"
if [[ "$ACTION" == "plan" ]]; then
  echo "PROFILE_USERNAME_MIGRATION_PLAN_ONLY_NO_APPLY"
  exit 0
fi
[[ "$(git ls-remote origin refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$PROFILE_USERNAME_MIGRATION_EXPECTED_SHA" ]]

mapfile -t STATEMENT_B64 < <(python3 - "$MIGRATION" <<'PY'
import base64, re, sys
sql=open(sys.argv[1], encoding='utf-8').read().strip()
for part in [p.strip() for p in re.split(r'^\s*-- statement-breakpoint\s*$', sql, flags=re.M) if p.strip()]:
    print(base64.b64encode(part.encode()).decode())
PY
)
TX_ID="$(aws rds-data begin-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" --query transactionId --output text)"
[[ -n "$TX_ID" ]]
committed=false
cleanup() { if [[ "$committed" != true && -n "${TX_ID:-}" ]]; then aws rds-data rollback-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --transaction-id "$TX_ID" >/dev/null 2>&1 || true; fi; }
trap cleanup EXIT
aws rds-data execute-statement --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" --transaction-id "$TX_ID" --sql "SELECT pg_advisory_xact_lock(hashtext('sea-n-shore-profile-username-0023')::bigint)" >/dev/null
for encoded in "${STATEMENT_B64[@]}"; do
  SQL="$(printf '%s' "$encoded" | base64 --decode)"
  aws rds-data execute-statement --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" --transaction-id "$TX_ID" --sql "$SQL" >/dev/null
done
aws rds-data commit-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --transaction-id "$TX_ID" >/dev/null
committed=true
AFTER="$(shape)"
echo "PROFILE_USERNAME_SHAPE_AFTER=$AFTER"
[[ "$AFTER" == "1/1/1" ]]
echo "PROFILE_USERNAME_MIGRATION_APPLY_VERIFIED=true"
