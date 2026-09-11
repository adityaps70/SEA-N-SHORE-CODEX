#!/usr/bin/env bash
set -euo pipefail
umask 077
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
CLUSTER_ID="sea-n-shore-staging-aurora"
DATABASE_NAME="sea_n_shore"
MIGRATION_FILE="infra/aws/database/migrations/0011_organization_hiring_approval.sql"
ACTION_FILE="scripts/aws/organization-hiring-approval-migration-action.txt"
EXPECTED_STATEMENTS=9
EXPECTED_ORGANIZATION_APPLICATION_COLUMNS=13
EXPECTED_ACCESS_REQUEST_COLUMNS=11
EXPECTED_NEW_INDEXES=6

[[ "${ORGANIZATION_HIRING_APPROVAL_MIGRATION_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "ORGANIZATION_HIRING_APPROVAL_MIGRATION_EXPECTED_SHA must be an exact commit SHA." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$ORGANIZATION_HIRING_APPROVAL_MIGRATION_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- "$MIGRATION_FILE" "$0" "$ACTION_FILE"
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]

ACTION="$(tr -d '[:space:]' < "$ACTION_FILE")"
case "$ACTION" in plan|apply-once) ;; *) echo "Unsupported organization hiring approval migration action." >&2; exit 1 ;; esac

python3 - "$MIGRATION_FILE" "$EXPECTED_STATEMENTS" <<'PY'
import re, sys
path, expected = sys.argv[1], int(sys.argv[2])
sql = open(path, encoding='utf-8').read().strip()
if re.search(r'\bdrop\b|\btruncate\b|\bdelete\s+from\b', sql, re.I):
    raise SystemExit('Organization hiring approval migration contains destructive SQL')
parts = [p.strip() for p in re.split(r'^\s*-- statement-breakpoint\s*$', sql, flags=re.M) if p.strip()]
if len(parts) != expected:
    raise SystemExit(f'Organization hiring approval migration must contain {expected} statements; found {len(parts)}')

def code(part: str) -> str:
    lines = part.splitlines()
    while lines and (not lines[0].strip() or lines[0].lstrip().startswith('--')):
        lines.pop(0)
    return '\n'.join(lines).strip()

starts = [
    r'^create\s+table\s+if\s+not\s+exists\s+public\.organization_applications\b',
    r'^create\s+table\s+if\s+not\s+exists\s+public\.company_access_requests\b',
    r'^create\s+unique\s+index\s+if\s+not\s+exists\s+company_access_requests_pending_unique\b',
    r'^create\s+index\s+if\s+not\s+exists\s+organization_applications_admin_queue_idx\b',
    r'^create\s+index\s+if\s+not\s+exists\s+organization_applications_user_idx\b',
    r'^create\s+index\s+if\s+not\s+exists\s+company_access_requests_admin_queue_idx\b',
    r'^create\s+index\s+if\s+not\s+exists\s+company_access_requests_user_idx\b',
    r'^create\s+index\s+if\s+not\s+exists\s+company_access_requests_company_idx\b',
    r'^update\s+public\.companies\s+c\b',
]
for part, pattern in zip(parts, starts):
    statement = code(part)
    if not re.match(pattern, statement, re.I):
        raise SystemExit('Organization hiring approval migration statement order or scope changed')
    if not statement.endswith(';'):
        raise SystemExit('Every organization hiring approval migration statement must end with a semicolon')

normalized = ' '.join(sql.split()).lower()
required = [
    'create table if not exists public.organization_applications',
    'create table if not exists public.company_access_requests',
    'create unique index if not exists company_access_requests_pending_unique',
    'create index if not exists organization_applications_admin_queue_idx',
    'create index if not exists organization_applications_user_idx',
    'create index if not exists company_access_requests_admin_queue_idx',
    'create index if not exists company_access_requests_user_idx',
    'create index if not exists company_access_requests_company_idx',
    'update public.companies c set is_verified = true',
    'from public.company_members cm',
    'cm.approved_at is not null',
    "cm.role::text in ('owner', 'administrator', 'recruiter')",
    'and c.is_verified = false',
]
for token in required:
    if token not in normalized:
        raise SystemExit('Organization hiring approval migration is missing approved token: ' + token)
if len(re.findall(r'\bupdate\s+', sql, re.I)) != 1:
    raise SystemExit('Organization hiring approval migration may contain only the approved compatibility backfill update')
if re.search(r'\binsert\s+into\b', sql, re.I):
    raise SystemExit('Organization hiring approval migration may not insert data')
print('ORGANIZATION_HIRING_APPROVAL_MIGRATION_SQL_GUARD=ADDITIVE_WITH_ONE_APPROVED_COMPATIBILITY_BACKFILL')
PY

echo "MIGRATION_SHA256=$(sha256sum "$MIGRATION_FILE" | cut -d' ' -f1)"

CLUSTER_JSON="$(aws rds describe-db-clusters --region "$AWS_REGION" --db-cluster-identifier "$CLUSTER_ID" --output json)"
CLUSTER_ARN="$(jq -r '.DBClusters[0].DBClusterArn // empty' <<<"$CLUSTER_JSON")"
SECRET_ARN="$(jq -r '.DBClusters[0].MasterUserSecret.SecretArn // empty' <<<"$CLUSTER_JSON")"
[[ "$(jq -r '.DBClusters[0].Status // empty' <<<"$CLUSTER_JSON")" == "available" ]]
[[ "$(jq -r '.DBClusters[0].HttpEndpointEnabled // false' <<<"$CLUSTER_JSON")" == "true" ]]
[[ "$CLUSTER_ARN" == "arn:aws:rds:ap-south-1:310356785722:cluster:sea-n-shore-staging-aurora" ]]
[[ "$SECRET_ARN" == arn:aws:secretsmanager:ap-south-1:310356785722:secret:rds\!cluster-* ]]

execute_read() {
  aws rds-data execute-statement --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" \
    --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" --sql "$1" --output json
}
read_count() { execute_read "$1" | jq -r '.records[0][0].longValue'; }

read_shape() {
  local ORGANIZATION_APPLICATION_COLUMNS ACCESS_REQUEST_COLUMNS NEW_INDEXES COMPATIBILITY_DEBT
  ORGANIZATION_APPLICATION_COLUMNS="$(read_count "SELECT count(*)::bigint FROM information_schema.columns WHERE table_schema='public' AND table_name='organization_applications' AND column_name IN ('id','company_id','submitted_by','status','official_email','registration_reference','applicant_role','supporting_notes','submitted_at','updated_at','reviewed_by','reviewed_at','admin_review_note')")"
  ACCESS_REQUEST_COLUMNS="$(read_count "SELECT count(*)::bigint FROM information_schema.columns WHERE table_schema='public' AND table_name='company_access_requests' AND column_name IN ('id','company_id','user_id','requested_role','request_type','message','status','requested_at','reviewed_at','reviewed_by','reviewer_note')")"
  NEW_INDEXES="$(read_count "SELECT count(*)::bigint FROM pg_indexes WHERE schemaname='public' AND indexname IN ('company_access_requests_pending_unique','organization_applications_admin_queue_idx','organization_applications_user_idx','company_access_requests_admin_queue_idx','company_access_requests_user_idx','company_access_requests_company_idx')")"
  COMPATIBILITY_DEBT="$(read_count "SELECT count(DISTINCT c.id)::bigint FROM public.companies c JOIN public.company_members cm ON cm.company_id=c.id WHERE cm.approved_at IS NOT NULL AND cm.role::text IN ('owner','administrator','recruiter') AND c.is_verified=false")"
  printf '%s %s %s %s\n' "$ORGANIZATION_APPLICATION_COLUMNS" "$ACCESS_REQUEST_COLUMNS" "$NEW_INDEXES" "$COMPATIBILITY_DEBT"
}

read -r ORGANIZATION_APPLICATION_COLUMNS ACCESS_REQUEST_COLUMNS NEW_INDEXES COMPATIBILITY_DEBT < <(read_shape)
echo "ORGANIZATION_HIRING_APPROVAL_SHAPE_BEFORE=$ORGANIZATION_APPLICATION_COLUMNS/$ACCESS_REQUEST_COLUMNS/$NEW_INDEXES/$COMPATIBILITY_DEBT"

STRUCTURE="$ORGANIZATION_APPLICATION_COLUMNS/$ACCESS_REQUEST_COLUMNS/$NEW_INDEXES"
EXPECTED_STRUCTURE="$EXPECTED_ORGANIZATION_APPLICATION_COLUMNS/$EXPECTED_ACCESS_REQUEST_COLUMNS/$EXPECTED_NEW_INDEXES"
if [[ "$STRUCTURE" == "$EXPECTED_STRUCTURE" && "$COMPATIBILITY_DEBT" == "0" ]]; then
  echo "ORGANIZATION_HIRING_APPROVAL_MIGRATION_ALREADY_APPLIED=true"
  exit 0
fi

if [[ "$STRUCTURE" == "0/0/0" ]]; then
  echo "ORGANIZATION_HIRING_APPROVAL_MIGRATION_PLAN_VERIFIED=FULL_ADDITIVE_APPLY"
elif [[ "$STRUCTURE" == "$EXPECTED_STRUCTURE" ]]; then
  echo "ORGANIZATION_HIRING_APPROVAL_MIGRATION_PLAN_VERIFIED=IDEMPOTENT_COMPATIBILITY_REPAIR"
else
  echo "Partial or unexpected organization hiring approval schema detected; refusing automatic migration." >&2
  exit 1
fi

echo "ORGANIZATION_HIRING_APPROVAL_COMPATIBILITY_DEBT=$COMPATIBILITY_DEBT"
if [[ "$ACTION" == "plan" ]]; then
  echo "ORGANIZATION_HIRING_APPROVAL_MIGRATION_PLAN_ONLY_NO_APPLY"
  exit 0
fi

[[ "$(git ls-remote origin refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$ORGANIZATION_HIRING_APPROVAL_MIGRATION_EXPECTED_SHA" ]]

mapfile -t STATEMENT_B64 < <(python3 - "$MIGRATION_FILE" <<'PY'
import base64, re, sys
sql=open(sys.argv[1], encoding='utf-8').read().strip()
parts=[p.strip() for p in re.split(r'^\s*-- statement-breakpoint\s*$', sql, flags=re.M) if p.strip()]
for part in parts:
    print(base64.b64encode(part.encode()).decode())
PY
)
[[ "${#STATEMENT_B64[@]}" == "$EXPECTED_STATEMENTS" ]]

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

read -r ORGANIZATION_APPLICATION_COLUMNS ACCESS_REQUEST_COLUMNS NEW_INDEXES COMPATIBILITY_DEBT < <(read_shape)
echo "ORGANIZATION_HIRING_APPROVAL_SHAPE_AFTER=$ORGANIZATION_APPLICATION_COLUMNS/$ACCESS_REQUEST_COLUMNS/$NEW_INDEXES/$COMPATIBILITY_DEBT"
[[ "$ORGANIZATION_APPLICATION_COLUMNS" == "$EXPECTED_ORGANIZATION_APPLICATION_COLUMNS" ]]
[[ "$ACCESS_REQUEST_COLUMNS" == "$EXPECTED_ACCESS_REQUEST_COLUMNS" ]]
[[ "$NEW_INDEXES" == "$EXPECTED_NEW_INDEXES" ]]
[[ "$COMPATIBILITY_DEBT" == "0" ]]
echo "ORGANIZATION_HIRING_APPROVAL_MIGRATION_APPLY_VERIFIED=true"
