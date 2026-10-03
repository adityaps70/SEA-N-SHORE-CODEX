#!/usr/bin/env bash
set -euo pipefail
umask 077
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
CLUSTER_ID="sea-n-shore-staging-aurora"
DATABASE_NAME="sea_n_shore"
MIGRATION_FILE="infra/aws/database/migrations/0010_jobs_intelligence.sql"
ACTION_FILE="scripts/aws/jobs-intelligence-migration-action.txt"
EXPECTED_STATEMENTS=24

[[ "${JOBS_INTELLIGENCE_MIGRATION_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "JOBS_INTELLIGENCE_MIGRATION_EXPECTED_SHA must be an exact commit SHA." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$JOBS_INTELLIGENCE_MIGRATION_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- "$MIGRATION_FILE" "$0" "$ACTION_FILE"
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]

ACTION="$(tr -d '[:space:]' < "$ACTION_FILE")"
case "$ACTION" in plan|apply-once) ;; *) echo "Unsupported jobs intelligence migration action." >&2; exit 1 ;; esac

python3 - "$MIGRATION_FILE" "$EXPECTED_STATEMENTS" <<'PY'
import re, sys
path, expected = sys.argv[1], int(sys.argv[2])
sql = open(path, encoding='utf-8').read().strip()
if re.search(r'\b(drop|truncate)\b|\bdelete\s+from\b', sql, re.I):
    raise SystemExit('Jobs intelligence migration contains destructive SQL')
parts = [p.strip() for p in re.split(r'^\s*-- statement-breakpoint\s*$', sql, flags=re.M) if p.strip()]
if len(parts) != expected:
    raise SystemExit(f'Jobs intelligence migration must contain {expected} statements; found {len(parts)}')

def code(part: str) -> str:
    lines = part.splitlines()
    while lines and (not lines[0].strip() or lines[0].lstrip().startswith('--')):
        lines.pop(0)
    return '\n'.join(lines).strip()

starts = [
    r'^alter\s+table\s+public\.jobs\b',
    r'^update\s+public\.jobs\b',
    r'^alter\s+table\s+public\.companies\b',
    r'^alter\s+table\s+public\.company_members\b',
    r'^create\s+table\s+if\s+not\s+exists\s+public\.job_certificate_requirements\b',
    r'^create\s+table\s+if\s+not\s+exists\s+public\.job_visa_requirements\b',
    r'^create\s+table\s+if\s+not\s+exists\s+public\.profile_visas\b',
    r'^create\s+table\s+if\s+not\s+exists\s+public\.job_saves\b',
    r'^create\s+table\s+if\s+not\s+exists\s+public\.job_alerts\b',
    r'^create\s+table\s+if\s+not\s+exists\s+public\.job_application_events\b',
    r'^insert\s+into\s+public\.job_application_events\b',
    r'^create\s+table\s+if\s+not\s+exists\s+public\.job_recruiter_notes\b',
    r'^create\s+table\s+if\s+not\s+exists\s+public\.job_reports\b',
    r'^create\s+index\s+if\s+not\s+exists\s+jobs_discovery_idx\b',
    r'^create\s+index\s+if\s+not\s+exists\s+jobs_search_idx\b',
    r'^create\s+index\s+if\s+not\s+exists\s+jobs_company_idx\b',
    r'^create\s+index\s+if\s+not\s+exists\s+jobs_rank_idx\b',
    r'^create\s+index\s+if\s+not\s+exists\s+jobs_vessel_types_idx\b',
    r'^create\s+index\s+if\s+not\s+exists\s+jobs_sailing_regions_idx\b',
    r'^create\s+index\s+if\s+not\s+exists\s+job_saves_user_idx\b',
    r'^create\s+index\s+if\s+not\s+exists\s+job_alerts_user_idx\b',
    r'^create\s+index\s+if\s+not\s+exists\s+job_application_events_application_idx\b',
    r'^create\s+index\s+if\s+not\s+exists\s+job_applications_job_status_idx\b',
    r'^create\s+index\s+if\s+not\s+exists\s+job_reports_status_idx\b',
]
for part, pattern in zip(parts, starts):
    statement = code(part)
    if not re.match(pattern, statement, re.I):
        raise SystemExit('Jobs intelligence migration statement order or scope changed')
    if not statement.endswith(';'):
        raise SystemExit('Every jobs intelligence migration statement must end with a semicolon')

normalized = ' '.join(sql.split()).lower()
required = [
    'add column if not exists company_id uuid references public.companies(id)',
    "add column if not exists job_domain text not null default 'sea'",
    'update public.jobs set published_at = created_at',
    'alter table public.companies',
    'alter table public.company_members',
    'create table if not exists public.job_certificate_requirements',
    'create table if not exists public.job_visa_requirements',
    'create table if not exists public.profile_visas',
    'create table if not exists public.job_saves',
    'create table if not exists public.job_alerts',
    'create table if not exists public.job_application_events',
    'insert into public.job_application_events',
    'create table if not exists public.job_recruiter_notes',
    'create table if not exists public.job_reports',
    'create index if not exists jobs_discovery_idx',
    'create index if not exists jobs_search_idx',
    'create index if not exists job_reports_status_idx',
]
for token in required:
    if token not in normalized:
        raise SystemExit('Jobs intelligence migration is missing approved token: ' + token)
if len(re.findall(r'\bupdate\s+', sql, re.I)) != 1:
    raise SystemExit('Jobs intelligence migration may contain only the approved published_at backfill update')
if len(re.findall(r'\binsert\s+into\s+', sql, re.I)) != 1:
    raise SystemExit('Jobs intelligence migration may contain only the approved application-event backfill insert')
print('JOBS_INTELLIGENCE_MIGRATION_SQL_GUARD=ADDITIVE_WITH_TWO_APPROVED_BACKFILLS')
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
  local JOBS_COLUMNS COMPANY_COLUMNS MEMBER_COLUMNS NEW_TABLES NEW_INDEXES
  local PUBLISHED_WITHOUT_TIMESTAMP APPLICATIONS_WITHOUT_EVENT
  JOBS_COLUMNS="$(read_count "SELECT count(*)::bigint FROM information_schema.columns WHERE table_schema='public' AND table_name='jobs' AND column_name IN ('company_id','created_by_user_id','job_domain','department','rank','vessel_types','experience_min_years','experience_max_years','joining_from','joining_until','salary_min','salary_max','salary_currency','salary_period','sailing_regions','urgent','easy_apply','published_at')")"
  COMPANY_COLUMNS="$(read_count "SELECT count(*)::bigint FROM information_schema.columns WHERE table_schema='public' AND table_name='companies' AND column_name IN ('is_verified','verified_at','verified_by')")"
  MEMBER_COLUMNS="$(read_count "SELECT count(*)::bigint FROM information_schema.columns WHERE table_schema='public' AND table_name='company_members' AND column_name IN ('is_verified','verified_at','verified_by')")"
  NEW_TABLES="$(read_count "SELECT count(*)::bigint FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('job_certificate_requirements','job_visa_requirements','profile_visas','job_saves','job_alerts','job_application_events','job_recruiter_notes','job_reports')")"
  NEW_INDEXES="$(read_count "SELECT count(*)::bigint FROM pg_indexes WHERE schemaname='public' AND indexname IN ('jobs_discovery_idx','jobs_search_idx','jobs_company_idx','jobs_rank_idx','jobs_vessel_types_idx','jobs_sailing_regions_idx','job_saves_user_idx','job_alerts_user_idx','job_application_events_application_idx','job_applications_job_status_idx','job_reports_status_idx')")"
  PUBLISHED_WITHOUT_TIMESTAMP=-1
  APPLICATIONS_WITHOUT_EVENT=-1
  if [[ "$JOBS_COLUMNS" == "18" ]]; then
    PUBLISHED_WITHOUT_TIMESTAMP="$(read_count "SELECT count(*)::bigint FROM public.jobs WHERE status='published' AND published_at IS NULL")"
  fi
  if [[ "$NEW_TABLES" == "8" ]]; then
    APPLICATIONS_WITHOUT_EVENT="$(read_count "SELECT count(*)::bigint FROM public.job_applications a WHERE NOT EXISTS (SELECT 1 FROM public.job_application_events e WHERE e.application_id=a.id)")"
  fi
  printf '%s %s %s %s %s %s %s\n' "$JOBS_COLUMNS" "$COMPANY_COLUMNS" "$MEMBER_COLUMNS" "$NEW_TABLES" "$NEW_INDEXES" "$PUBLISHED_WITHOUT_TIMESTAMP" "$APPLICATIONS_WITHOUT_EVENT"
}

read -r JOBS_COLUMNS COMPANY_COLUMNS MEMBER_COLUMNS NEW_TABLES NEW_INDEXES PUBLISHED_WITHOUT_TIMESTAMP APPLICATIONS_WITHOUT_EVENT < <(read_shape)
echo "JOBS_INTELLIGENCE_SHAPE_BEFORE=$JOBS_COLUMNS/$COMPANY_COLUMNS/$MEMBER_COLUMNS/$NEW_TABLES/$NEW_INDEXES/$PUBLISHED_WITHOUT_TIMESTAMP/$APPLICATIONS_WITHOUT_EVENT"

STRUCTURE="$JOBS_COLUMNS/$COMPANY_COLUMNS/$MEMBER_COLUMNS/$NEW_TABLES/$NEW_INDEXES"
if [[ "$STRUCTURE" == "18/3/3/8/11" && "$PUBLISHED_WITHOUT_TIMESTAMP" == "0" && "$APPLICATIONS_WITHOUT_EVENT" == "0" ]]; then
  echo "JOBS_INTELLIGENCE_MIGRATION_ALREADY_APPLIED=true"
  exit 0
fi

if [[ "$STRUCTURE" == "0/0/0/0/0" ]]; then
  echo "JOBS_INTELLIGENCE_MIGRATION_PLAN_VERIFIED=FULL_ADDITIVE_APPLY"
elif [[ "$STRUCTURE" == "18/3/3/8/11" ]]; then
  echo "JOBS_INTELLIGENCE_MIGRATION_PLAN_VERIFIED=IDEMPOTENT_BACKFILL_REPAIR"
else
  echo "Partial or unexpected jobs intelligence schema detected; refusing automatic migration." >&2
  exit 1
fi

if [[ "$ACTION" == "plan" ]]; then
  echo "JOBS_INTELLIGENCE_MIGRATION_PLAN_ONLY_NO_APPLY"
  exit 0
fi

[[ "$(git ls-remote origin refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$JOBS_INTELLIGENCE_MIGRATION_EXPECTED_SHA" ]]

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

read -r JOBS_COLUMNS COMPANY_COLUMNS MEMBER_COLUMNS NEW_TABLES NEW_INDEXES PUBLISHED_WITHOUT_TIMESTAMP APPLICATIONS_WITHOUT_EVENT < <(read_shape)
echo "JOBS_INTELLIGENCE_SHAPE_AFTER=$JOBS_COLUMNS/$COMPANY_COLUMNS/$MEMBER_COLUMNS/$NEW_TABLES/$NEW_INDEXES/$PUBLISHED_WITHOUT_TIMESTAMP/$APPLICATIONS_WITHOUT_EVENT"
[[ "$JOBS_COLUMNS/$COMPANY_COLUMNS/$MEMBER_COLUMNS/$NEW_TABLES/$NEW_INDEXES" == "18/3/3/8/11" ]]
[[ "$PUBLISHED_WITHOUT_TIMESTAMP" == "0" ]]
[[ "$APPLICATIONS_WITHOUT_EVENT" == "0" ]]
echo "JOBS_INTELLIGENCE_MIGRATION_APPLY_VERIFIED=true"
