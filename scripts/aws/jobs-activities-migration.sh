#!/usr/bin/env bash
set -euo pipefail
umask 077
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
CLUSTER_ID="sea-n-shore-staging-aurora"
DATABASE_NAME="sea_n_shore"
MIGRATION_FILE="infra/aws/database/migrations/0007_jobs_activities.sql"
ACTION_FILE="scripts/aws/jobs-activities-migration-action.txt"

[[ "${JOBS_ACTIVITIES_MIGRATION_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "JOBS_ACTIVITIES_MIGRATION_EXPECTED_SHA must be an exact commit SHA." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$JOBS_ACTIVITIES_MIGRATION_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- "$MIGRATION_FILE" "$0" "$ACTION_FILE"
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]

ACTION="$(tr -d '[:space:]' < "$ACTION_FILE")"
case "$ACTION" in plan|apply-once) ;; *) echo "Unsupported jobs activities migration action." >&2; exit 1 ;; esac

python3 - "$MIGRATION_FILE" <<'PY'
import re, sys
sql=open(sys.argv[1], encoding='utf-8').read().strip()
if re.search(r'\b(drop|truncate|update|alter)\b|\bdelete\s+from\b', sql, re.I):
    raise SystemExit('Jobs activities migration contains destructive or data-changing SQL')
parts=[part.strip() for part in re.split(r'^\s*-- statement-breakpoint\s*$', sql, flags=re.M) if part.strip()]
if len(parts) != 7:
    raise SystemExit(f'Jobs activities migration must contain exactly seven statement-breakpoint bounded statements; found {len(parts)}')
starts=[
    r'^create\s+type\s+public\.job_listing_status\s+as\s+enum\b',
    r'^create\s+type\s+public\.job_application_status\s+as\s+enum\b',
    r'^create\s+table\s+if\s+not\s+exists\s+public\.jobs\b',
    r'^create\s+table\s+if\s+not\s+exists\s+public\.job_applications\b',
    r'^create\s+index\s+if\s+not\s+exists\s+jobs_published_created_idx\b',
    r'^create\s+index\s+if\s+not\s+exists\s+job_applications_applicant_applied_idx\b',
    r'^create\s+index\s+if\s+not\s+exists\s+post_comments_author_created_idx\b',
]
for part, pattern in zip(parts, starts):
    if not re.match(pattern, part, re.I):
        raise SystemExit('Jobs activities migration statement order or scope changed')
    if not part.endswith(';'):
        raise SystemExit('Every jobs activities migration statement must end with a semicolon')
normalized=' '.join(sql.split()).lower()
required=[
    "create type public.job_listing_status as enum ('draft', 'published', 'closed')",
    "'applied', 'under_review', 'shortlisted', 'interview', 'selected', 'rejected', 'withdrawn'",
    'job_id uuid not null references public.jobs(id) on delete cascade',
    'applicant_id uuid not null references public.profiles(id) on delete cascade',
    "status public.job_application_status not null default 'applied'",
    'unique (job_id, applicant_id)',
    'where deleted_at is null',
]
for token in required:
    if token not in normalized:
        raise SystemExit('Jobs activities migration is missing approved schema token: '+token)
print('JOBS_ACTIVITIES_MIGRATION_SQL_GUARD=ADDITIVE_JOBS_APPLICATIONS_AND_COMMENT_INDEX_ONLY')
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
  local enum_count table_count column_count fk_count unique_count index_count
  enum_count="$(read_count "SELECT count(*)::bigint FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typname IN ('job_listing_status','job_application_status')")"
  table_count="$(read_count "SELECT count(*)::bigint FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('jobs','job_applications')")"
  column_count="$(read_count "SELECT count(*)::bigint FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('jobs','job_applications')")"
  fk_count="$(read_count "SELECT count(*)::bigint FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='job_applications' AND c.contype='f'")"
  unique_count="$(read_count "SELECT count(*)::bigint FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='job_applications' AND c.contype='u'")"
  index_count="$(read_count "SELECT count(*)::bigint FROM pg_indexes WHERE schemaname='public' AND indexname IN ('jobs_published_created_idx','job_applications_applicant_applied_idx','post_comments_author_created_idx')")"
  printf '%s %s %s %s %s %s\n' "$enum_count" "$table_count" "$column_count" "$fk_count" "$unique_count" "$index_count"
}

read -r ENUM_COUNT TABLE_COUNT COLUMN_COUNT FK_COUNT UNIQUE_COUNT INDEX_COUNT < <(read_shape)
echo "JOBS_ACTIVITIES_ENUMS_BEFORE=$ENUM_COUNT"
echo "JOBS_ACTIVITIES_TABLES_BEFORE=$TABLE_COUNT"
echo "JOBS_ACTIVITIES_COLUMNS_BEFORE=$COLUMN_COUNT"
echo "JOBS_ACTIVITIES_FKS_BEFORE=$FK_COUNT"
echo "JOBS_ACTIVITIES_UNIQUES_BEFORE=$UNIQUE_COUNT"
echo "JOBS_ACTIVITIES_INDEXES_BEFORE=$INDEX_COUNT"

if [[ "$ENUM_COUNT" == "2" && "$TABLE_COUNT" == "2" && "$COLUMN_COUNT" == "17" && "$FK_COUNT" == "2" && "$UNIQUE_COUNT" == "1" && "$INDEX_COUNT" == "3" ]]; then
  echo "JOBS_ACTIVITIES_MIGRATION_ALREADY_APPLIED=true"
  exit 0
fi

[[ "$ENUM_COUNT" == "0" && "$TABLE_COUNT" == "0" && "$COLUMN_COUNT" == "0" && "$FK_COUNT" == "0" && "$UNIQUE_COUNT" == "0" && "$INDEX_COUNT" == "0" ]] || {
  echo "Partial or unexpected jobs activities schema detected; refusing automatic migration." >&2
  exit 1
}

echo "JOBS_ACTIVITIES_MIGRATION_PLAN_VERIFIED=CREATE_TWO_ENUMS_TWO_TABLES_AND_THREE_INDEXES"
if [[ "$ACTION" == "plan" ]]; then
  echo "JOBS_ACTIVITIES_MIGRATION_PLAN_ONLY_NO_APPLY"
  exit 0
fi

[[ "$(git ls-remote origin refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$JOBS_ACTIVITIES_MIGRATION_EXPECTED_SHA" ]]

mapfile -t STATEMENT_B64 < <(python3 - "$MIGRATION_FILE" <<'PY'
import base64, re, sys
sql=open(sys.argv[1], encoding='utf-8').read().strip()
parts=[part.strip() for part in re.split(r'^\s*-- statement-breakpoint\s*$', sql, flags=re.M) if part.strip()]
for part in parts:
    print(base64.b64encode(part.encode()).decode())
PY
)
[[ "${#STATEMENT_B64[@]}" == "7" ]]

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

read -r ENUM_COUNT_AFTER TABLE_COUNT_AFTER COLUMN_COUNT_AFTER FK_COUNT_AFTER UNIQUE_COUNT_AFTER INDEX_COUNT_AFTER < <(read_shape)
echo "JOBS_ACTIVITIES_ENUMS_AFTER=$ENUM_COUNT_AFTER"
echo "JOBS_ACTIVITIES_TABLES_AFTER=$TABLE_COUNT_AFTER"
echo "JOBS_ACTIVITIES_COLUMNS_AFTER=$COLUMN_COUNT_AFTER"
echo "JOBS_ACTIVITIES_FKS_AFTER=$FK_COUNT_AFTER"
echo "JOBS_ACTIVITIES_UNIQUES_AFTER=$UNIQUE_COUNT_AFTER"
echo "JOBS_ACTIVITIES_INDEXES_AFTER=$INDEX_COUNT_AFTER"
[[ "$ENUM_COUNT_AFTER" == "2" ]]
[[ "$TABLE_COUNT_AFTER" == "2" ]]
[[ "$COLUMN_COUNT_AFTER" == "17" ]]
[[ "$FK_COUNT_AFTER" == "2" ]]
[[ "$UNIQUE_COUNT_AFTER" == "1" ]]
[[ "$INDEX_COUNT_AFTER" == "3" ]]
echo "JOBS_ACTIVITIES_MIGRATION_APPLY_VERIFIED=true"
