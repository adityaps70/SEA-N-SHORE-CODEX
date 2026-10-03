#!/usr/bin/env bash
set -euo pipefail
umask 077
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
CLUSTER_ID="sea-n-shore-staging-aurora"
DATABASE_NAME="sea_n_shore"
FOUNDATION_MIGRATION="infra/aws/database/migrations/0032_membership_access_foundation.sql"
COMPLETION_MIGRATION="infra/aws/database/migrations/0033_membership_experience_completion.sql"
ACTION_FILE="scripts/aws/membership-access-migration-action.txt"

[[ "${MEMBERSHIP_ACCESS_MIGRATION_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "MEMBERSHIP_ACCESS_MIGRATION_EXPECTED_SHA must be an exact commit SHA." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$MEMBERSHIP_ACCESS_MIGRATION_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- "$FOUNDATION_MIGRATION" "$COMPLETION_MIGRATION" "$0" "$ACTION_FILE"
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]

ACTION="$(tr -d '[:space:]' < "$ACTION_FILE")"
case "$ACTION" in
  plan|migrate-once) ;;
  *) echo "Unsupported membership access migration action: $ACTION" >&2; exit 1 ;;
esac

validate_sql() {
  local migration="$1"
  local minimum_statements="$2"
  python3 - "$migration" "$minimum_statements" <<'PY'
import re, sys
path=sys.argv[1]
minimum=int(sys.argv[2])
sql=open(path, encoding='utf-8').read().strip()
parts=[p.strip() for p in re.split(r'^\s*-- statement-breakpoint\s*$', sql, flags=re.M) if p.strip()]
if len(parts) < minimum:
    raise SystemExit(f'expected at least {minimum} guarded membership statements in {path}; found {len(parts)}')
allowed = re.compile(
    r'^(alter\s+table\s+public\.(profiles|events|learning_courses|feature_verifications|company_access_requests)\b|'
    r'alter\s+type\s+public\.company_member_role\b|'
    r'create\s+table\s+if\s+not\s+exists\s+public\.|'
    r'create\s+(unique\s+)?index\s+if\s+not\s+exists\s+[a-z0-9_]+\s+on\s+public\.|'
    r'update\s+public\.(profiles|learning_courses|feature_verifications)\b|'
    r'insert\s+into\s+public\.)',
    re.I | re.S,
)
for index, statement in enumerate(parts):
    code='\n'.join(line for line in statement.splitlines() if not line.lstrip().startswith('--')).strip()
    if not allowed.match(code):
        raise SystemExit(f'unexpected membership statement {index + 1} in {path}: {code[:120]}')
    if re.search(r'\b(drop\s+(table|column|type)|truncate|delete\s+from)\b', code, re.I):
        raise SystemExit(f'membership migration {path} contains forbidden destructive SQL')
    if not code.endswith(';'):
        raise SystemExit(f'membership statement {index + 1} in {path} is missing a semicolon')
print(f'MEMBERSHIP_ACCESS_SQL_GUARD=ADDITIVE_COMPATIBILITY file={path} statements={len(parts)}')
PY
}

validate_sql "$FOUNDATION_MIGRATION" 20
validate_sql "$COMPLETION_MIGRATION" 8

echo "MEMBERSHIP_ACCESS_FOUNDATION_SHA256=$(sha256sum "$FOUNDATION_MIGRATION" | cut -d' ' -f1)"
echo "MEMBERSHIP_ACCESS_COMPLETION_SHA256=$(sha256sum "$COMPLETION_MIGRATION" | cut -d' ' -f1)"

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

FOUNDATION_COUNT="$(read_count "SELECT count(*)::bigint FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('profiles','companies','company_members','learning_mentors','events')")"
[[ "$FOUNDATION_COUNT" == "5" ]] || {
  echo "Membership access foundation tables are incomplete; refusing migration." >&2
  exit 1
}

foundation_shape() {
  local COLUMNS TABLES ROLES
  COLUMNS="$(read_count "SELECT count(*)::bigint FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name IN ('persona','profile_intents','community_relationship','institution_name','specialization')")"
  TABLES="$(read_count "SELECT count(*)::bigint FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('plan_entitlements','account_subscriptions','feature_verifications','entitlement_grants','legacy_organization_conversions')")"
  ROLES="$(read_count "SELECT count(*)::bigint FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typname='company_member_role' AND e.enumlabel IN ('lms_manager','event_manager','content_manager','analyst')")"
  printf '%s/%s/%s\n' "$COLUMNS" "$TABLES" "$ROLES"
}

completion_shape() {
  local FOLLOWS ROLE_ACCESS EXTENDED_ROLES CREATOR_MANAGE
  FOLLOWS="$(read_count "SELECT count(*)::bigint FROM information_schema.tables WHERE table_schema='public' AND table_name='organization_follows'")"
  ROLE_ACCESS="$(read_count "SELECT count(*)::bigint FROM pg_constraint WHERE conrelid='public.company_access_requests'::regclass AND conname IN ('company_access_requests_type_check','company_access_requests_type_role_check') AND pg_get_constraintdef(oid) ILIKE '%role_access%'")"
  EXTENDED_ROLES="$(read_count "SELECT count(*)::bigint FROM pg_constraint WHERE conrelid='public.company_access_requests'::regclass AND conname='company_access_requests_role_check' AND pg_get_constraintdef(oid) ILIKE '%lms_manager%' AND pg_get_constraintdef(oid) ILIKE '%event_manager%' AND pg_get_constraintdef(oid) ILIKE '%content_manager%' AND pg_get_constraintdef(oid) ILIKE '%analyst%'")"
  CREATOR_MANAGE="$(read_count "SELECT count(*)::bigint FROM public.plan_entitlements WHERE plan_code='creator_pro' AND capability IN ('job.manage_applicants','event.manage_attendees','course.manage_students')")"
  printf '%s/%s/%s/%s\n' "$FOLLOWS" "$ROLE_ACCESS" "$EXTENDED_ROLES" "$CREATOR_MANAGE"
}

apply_migration_file() {
  local migration="$1"
  local lock_name="$2"
  local minimum_statements="$3"
  local tx_id committed
  mapfile -t STATEMENT_B64 < <(python3 - "$migration" <<'PY'
import base64, re, sys
sql=open(sys.argv[1], encoding='utf-8').read().strip()
for part in [p.strip() for p in re.split(r'^\s*-- statement-breakpoint\s*$', sql, flags=re.M) if p.strip()]:
    print(base64.b64encode(part.encode()).decode())
PY
)
  [[ "${#STATEMENT_B64[@]}" -ge "$minimum_statements" ]]

  tx_id="$(aws rds-data begin-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" --query transactionId --output text)"
  [[ -n "$tx_id" ]]
  committed=false

  rollback_current_transaction() {
    if [[ "$committed" != true && -n "${tx_id:-}" ]]; then
      aws rds-data rollback-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --transaction-id "$tx_id" >/dev/null 2>&1 || true
    fi
  }
  trap rollback_current_transaction RETURN

  aws rds-data execute-statement --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" --transaction-id "$tx_id" --sql "SELECT pg_advisory_xact_lock(hashtext('$lock_name')::bigint)" >/dev/null

  for encoded in "${STATEMENT_B64[@]}"; do
    SQL="$(printf '%s' "$encoded" | base64 --decode)"
    aws rds-data execute-statement --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" --transaction-id "$tx_id" --sql "$SQL" >/dev/null
  done

  aws rds-data commit-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --transaction-id "$tx_id" >/dev/null
  committed=true
  trap - RETURN
}

FOUNDATION_BEFORE="$(foundation_shape)"
FOUNDATION_COMPLETE="5/5/4"
FOUNDATION_EMPTY="0/0/0"
echo "MEMBERSHIP_ACCESS_MIGRATION_SHAPE_BEFORE=$FOUNDATION_BEFORE"

if [[ "$FOUNDATION_BEFORE" != "$FOUNDATION_COMPLETE" && "$FOUNDATION_BEFORE" != "$FOUNDATION_EMPTY" ]]; then
  echo "Partial or unexpected membership access foundation schema detected; refusing automatic migration." >&2
  exit 1
fi

COMPLETION_BEFORE="0/0/0/0"
if [[ "$FOUNDATION_BEFORE" == "$FOUNDATION_COMPLETE" ]]; then
  COMPLETION_BEFORE="$(completion_shape)"
fi
COMPLETION_COMPLETE="1/2/1/3"
echo "MEMBERSHIP_ACCESS_COMPLETION_SHAPE_BEFORE=$COMPLETION_BEFORE"

if [[ "$FOUNDATION_BEFORE" == "$FOUNDATION_COMPLETE" && "$COMPLETION_BEFORE" == "$COMPLETION_COMPLETE" ]]; then
  echo "MEMBERSHIP_ACCESS_MIGRATION_ALREADY_APPLIED=true"
  echo "MEMBERSHIP_ACCESS_COMPLETION_ALREADY_APPLIED=true"
  exit 0
fi

echo "MEMBERSHIP_ACCESS_MIGRATION_PLAN_VERIFIED=true"
echo "MEMBERSHIP_ACCESS_COMPLETION_PLAN_VERIFIED=true"
if [[ "$ACTION" == "plan" ]]; then
  echo "MEMBERSHIP_ACCESS_MIGRATION_PLAN_ONLY_NO_APPLY"
  exit 0
fi

[[ "$(git ls-remote origin refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$MEMBERSHIP_ACCESS_MIGRATION_EXPECTED_SHA" ]]

if [[ "$FOUNDATION_BEFORE" == "$FOUNDATION_EMPTY" ]]; then
  apply_migration_file "$FOUNDATION_MIGRATION" "sea-n-shore-membership-access-0032" 20
  FOUNDATION_AFTER="$(foundation_shape)"
  echo "MEMBERSHIP_ACCESS_MIGRATION_SHAPE_AFTER=$FOUNDATION_AFTER"
  [[ "$FOUNDATION_AFTER" == "$FOUNDATION_COMPLETE" ]]
  echo "MEMBERSHIP_ACCESS_MIGRATION_APPLY_VERIFIED=true"
else
  echo "MEMBERSHIP_ACCESS_FOUNDATION_ALREADY_APPLIED=true"
fi

COMPLETION_MID="$(completion_shape)"
if [[ "$COMPLETION_MID" != "$COMPLETION_COMPLETE" ]]; then
  apply_migration_file "$COMPLETION_MIGRATION" "sea-n-shore-membership-access-0033" 8
fi

COMPLETION_AFTER="$(completion_shape)"
echo "MEMBERSHIP_ACCESS_COMPLETION_SHAPE_AFTER=$COMPLETION_AFTER"
[[ "$COMPLETION_AFTER" == "$COMPLETION_COMPLETE" ]]
echo "MEMBERSHIP_ACCESS_COMPLETION_APPLY_VERIFIED=true"
echo "MEMBERSHIP_ACCESS_MIGRATION_APPLY_VERIFIED=true"
