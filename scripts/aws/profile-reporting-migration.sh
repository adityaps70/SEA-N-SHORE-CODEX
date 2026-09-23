#!/usr/bin/env bash
set -euo pipefail
umask 077
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
CLUSTER_ID="sea-n-shore-staging-aurora"
DATABASE_NAME="sea_n_shore"
MIGRATION="infra/aws/database/migrations/0029_profile_reporting.sql"
ACTION_FILE="scripts/aws/profile-reporting-migration-action.txt"

[[ "${PROFILE_REPORTING_MIGRATION_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "PROFILE_REPORTING_MIGRATION_EXPECTED_SHA must be an exact commit SHA." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$PROFILE_REPORTING_MIGRATION_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- "$MIGRATION" "$0" "$ACTION_FILE"
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]

ACTION="$(tr -d '[:space:]' < "$ACTION_FILE")"
case "$ACTION" in
  plan|migrate-once) ;;
  *) echo "Unsupported profile reporting migration action: $ACTION" >&2; exit 1 ;;
esac

python3 - "$MIGRATION" <<'PY'
import re, sys
sql=open(sys.argv[1], encoding='utf-8').read().strip()
parts=[p.strip() for p in re.split(r'^\s*-- statement-breakpoint\s*$', sql, flags=re.M) if p.strip()]
if len(parts) != 6:
    raise SystemExit(f'expected exactly six profile reporting statements; found {len(parts)}')
for index, statement in enumerate(parts):
    code='\n'.join(line for line in statement.splitlines() if not line.lstrip().startswith('--')).strip()
    if not re.match(r'^alter\s+table\s+public\.(content_reports|moderation_actions)\b', code, re.I | re.S):
        raise SystemExit(f'unexpected profile reporting statement {index + 1}')
    if re.search(r'\b(drop\s+table|drop\s+column|truncate|delete\s+from)\b', code, re.I):
        raise SystemExit('profile reporting migration contains forbidden destructive SQL')
    if not code.endswith(';'):
        raise SystemExit('profile reporting migration statement missing semicolon')
print(f'PROFILE_REPORTING_SQL_GUARD=EXPECTED_CONSTRAINT_UPDATE statements={len(parts)}')
PY

echo "PROFILE_REPORTING_MIGRATION_SHA256=$(sha256sum "$MIGRATION" | cut -d' ' -f1)"
CLUSTER_JSON="$(aws rds describe-db-clusters --region "$AWS_REGION" --db-cluster-identifier "$CLUSTER_ID" --output json)"
CLUSTER_ARN="$(jq -r '.DBClusters[0].DBClusterArn // empty' <<<"$CLUSTER_JSON")"
SECRET_ARN="$(jq -r '.DBClusters[0].MasterUserSecret.SecretArn // empty' <<<"$CLUSTER_JSON")"
[[ "$(jq -r '.DBClusters[0].Status // empty' <<<"$CLUSTER_JSON")" == "available" ]]
[[ "$(jq -r '.DBClusters[0].HttpEndpointEnabled // false' <<<"$CLUSTER_JSON")" == "true" ]]
[[ "$CLUSTER_ARN" == "arn:aws:rds:ap-south-1:310356785722:cluster:sea-n-shore-staging-aurora" ]]
[[ "$SECRET_ARN" == arn:aws:secretsmanager:ap-south-1:310356785722:secret:rds\!cluster-* ]]

execute_read() {
  aws rds-data execute-statement --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" --sql "$1" --output json
}
read_count() { execute_read "$1" | jq -r '.records[0][0].longValue'; }

FOUNDATION_COUNT="$(read_count "SELECT count(*)::bigint FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('content_reports','moderation_actions','profiles')")"
[[ "$FOUNDATION_COUNT" == "3" ]] || {
  echo "Profile reporting foundation tables are incomplete; refusing migration." >&2
  exit 1
}

EXPECTED_CONSTRAINTS="$(read_count "SELECT count(*)::bigint FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND ((t.relname='content_reports' AND c.conname IN ('content_reports_target_type_check','content_reports_reason_check')) OR (t.relname='moderation_actions' AND c.conname='moderation_actions_target_type_check'))")"
[[ "$EXPECTED_CONSTRAINTS" == "3" ]] || {
  echo "Expected moderation constraints are incomplete; refusing migration." >&2
  exit 1
}

shape() {
  local TARGETS REASONS
  TARGETS="$(read_count "SELECT count(*)::bigint FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND c.conname IN ('content_reports_target_type_check','moderation_actions_target_type_check') AND pg_get_constraintdef(c.oid) ILIKE '%profile%'")"
  REASONS="$(read_count "SELECT count(*)::bigint FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND t.relname='content_reports' AND c.conname='content_reports_reason_check' AND pg_get_constraintdef(c.oid) ILIKE '%impersonation%' AND pg_get_constraintdef(c.oid) ILIKE '%spam_or_scam%' AND pg_get_constraintdef(c.oid) ILIKE '%fake_profile%'")"
  printf '%s/%s\n' "$TARGETS" "$REASONS"
}

BEFORE="$(shape)"
COMPLETE="2/1"
EMPTY="0/0"
echo "PROFILE_REPORTING_MIGRATION_SHAPE_BEFORE=$BEFORE"

if [[ "$BEFORE" == "$COMPLETE" ]]; then
  echo "PROFILE_REPORTING_MIGRATION_ALREADY_APPLIED=true"
  exit 0
fi

[[ "$BEFORE" == "$EMPTY" ]] || {
  echo "Partial or unexpected profile reporting schema detected; refusing automatic migration." >&2
  exit 1
}

echo "PROFILE_REPORTING_MIGRATION_PLAN_VERIFIED=true"
if [[ "$ACTION" == "plan" ]]; then
  echo "PROFILE_REPORTING_MIGRATION_PLAN_ONLY_NO_APPLY"
  exit 0
fi

[[ "$(git ls-remote origin refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$PROFILE_REPORTING_MIGRATION_EXPECTED_SHA" ]]

mapfile -t STATEMENT_B64 < <(python3 - "$MIGRATION" <<'PY'
import base64, re, sys
sql=open(sys.argv[1], encoding='utf-8').read().strip()
for part in [p.strip() for p in re.split(r'^\s*-- statement-breakpoint\s*$', sql, flags=re.M) if p.strip()]:
    print(base64.b64encode(part.encode()).decode())
PY
)
[[ "${#STATEMENT_B64[@]}" == "6" ]]

TX_ID="$(aws rds-data begin-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" --query transactionId --output text)"
[[ -n "$TX_ID" ]]
committed=false
cleanup() {
  if [[ "$committed" != true && -n "${TX_ID:-}" ]]; then
    aws rds-data rollback-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --transaction-id "$TX_ID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

aws rds-data execute-statement --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" --transaction-id "$TX_ID" --sql "SELECT pg_advisory_xact_lock(hashtext('sea-n-shore-profile-reporting-0029')::bigint)" >/dev/null

for encoded in "${STATEMENT_B64[@]}"; do
  SQL="$(printf '%s' "$encoded" | base64 --decode)"
  aws rds-data execute-statement --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" --transaction-id "$TX_ID" --sql "$SQL" >/dev/null
done

aws rds-data commit-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --transaction-id "$TX_ID" >/dev/null
committed=true

AFTER="$(shape)"
echo "PROFILE_REPORTING_MIGRATION_SHAPE_AFTER=$AFTER"
[[ "$AFTER" == "$COMPLETE" ]]
echo "PROFILE_REPORTING_MIGRATION_APPLY_VERIFIED=true"
