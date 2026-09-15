#!/usr/bin/env bash
set -euo pipefail
umask 077
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
CLUSTER_ID="sea-n-shore-staging-aurora"
DATABASE_NAME="sea_n_shore"
MIGRATION="infra/aws/database/migrations/0019_learning_lms_phase_1.sql"
ACTION_FILE="scripts/aws/learning-lms-phase-1-migration-action.txt"

[[ "${LEARNING_LMS_PHASE_1_MIGRATION_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || { echo "LEARNING_LMS_PHASE_1_MIGRATION_EXPECTED_SHA must be an exact commit SHA." >&2; exit 1; }
[[ "$(git rev-parse HEAD)" == "$LEARNING_LMS_PHASE_1_MIGRATION_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- "$MIGRATION" "$0" "$ACTION_FILE"
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]

ACTION="$(tr -d '[:space:]' < "$ACTION_FILE")"
case "$ACTION" in plan|migrate-once) ;; *) echo "Unsupported LMS Phase 1 migration action: $ACTION" >&2; exit 1 ;; esac

python3 - "$MIGRATION" <<'PY'
import re, sys
path=sys.argv[1]
sql=open(path, encoding='utf-8').read().strip()
parts=[p.strip() for p in re.split(r'^\s*-- statement-breakpoint\s*$', sql, flags=re.M) if p.strip()]
if len(parts) < 15:
    raise SystemExit(f'expected a substantial additive LMS migration; found {len(parts)} statements')
for statement in parts:
    code='\n'.join(line for line in statement.splitlines() if not line.lstrip().startswith('--')).strip()
    if not re.match(r'^(alter\s+table|create\s+(table|unique\s+index|index)\s+if\s+not\s+exists|update\s+public\.learning_lessons)\b', code, re.I):
        raise SystemExit('migration contains an unexpected statement family')
    if re.search(r'\btruncate\b|\bdelete\s+from\b|\bdrop\s+table\b|\bdrop\s+column\b', code, re.I):
        raise SystemExit('migration contains destructive DDL/DML')
    if not code.endswith(';'):
        raise SystemExit('migration statement missing semicolon')
print(f'LEARNING_LMS_PHASE_1_SQL_GUARD=ADDITIVE_OR_CONSTRAINT_RECONCILIATION statements={len(parts)}')
PY

echo "LEARNING_LMS_PHASE_1_MIGRATION_SHA256=$(sha256sum "$MIGRATION" | cut -d' ' -f1)"

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

FOUNDATION_COUNT="$(read_count "SELECT count(*)::bigint FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('learning_courses','learning_course_sections','learning_lessons','learning_enrollments','learning_progress','learning_quizzes')")"
[[ "$FOUNDATION_COUNT" == "6" ]] || { echo "Learning launch schema is incomplete; refusing LMS Phase 1 migration." >&2; exit 1; }

shape() {
  local course_cols lesson_cols progress_cols domain_tables
  course_cols="$(read_count "SELECT count(*)::bigint FROM information_schema.columns WHERE table_schema='public' AND table_name='learning_courses' AND column_name='navigation_mode'")"
  lesson_cols="$(read_count "SELECT count(*)::bigint FROM information_schema.columns WHERE table_schema='public' AND table_name='learning_lessons' AND column_name IN ('is_published','release_mode','release_at','drip_delay_days','prerequisite_lesson_id','completion_rule','completion_threshold','max_attempts','embed_kind')")"
  progress_cols="$(read_count "SELECT count(*)::bigint FROM information_schema.columns WHERE table_schema='public' AND table_name='learning_progress' AND column_name IN ('viewed_at','media_percent','attempts_used')")"
  domain_tables="$(read_count "SELECT count(*)::bigint FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('learning_assignments','learning_assignment_attempts','learning_scorm_packages','learning_scorm_attempts')")"
  printf '%s/%s/%s/%s\n' "$course_cols" "$lesson_cols" "$progress_cols" "$domain_tables"
}

BEFORE="$(shape)"
echo "LEARNING_LMS_PHASE_1_SHAPE_BEFORE=$BEFORE"
if [[ "$BEFORE" == "1/9/3/4" ]]; then
  echo "LEARNING_LMS_PHASE_1_MIGRATION_ALREADY_APPLIED=true"
  exit 0
fi
[[ "$BEFORE" == "0/0/0/0" ]] || { echo "Partial LMS Phase 1 schema detected; refusing automatic migration." >&2; exit 1; }

echo "LEARNING_LMS_PHASE_1_MIGRATION_PLAN_VERIFIED=true"
if [[ "$ACTION" == "plan" ]]; then
  echo "LEARNING_LMS_PHASE_1_MIGRATION_PLAN_ONLY_NO_APPLY"
  exit 0
fi

[[ "$(git ls-remote origin refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$LEARNING_LMS_PHASE_1_MIGRATION_EXPECTED_SHA" ]]

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
cleanup() {
  if [[ "$committed" != true && -n "${TX_ID:-}" ]]; then
    aws rds-data rollback-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --transaction-id "$TX_ID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

aws rds-data execute-statement --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" --transaction-id "$TX_ID" --sql "SELECT pg_advisory_xact_lock(hashtext('sea-n-shore-learning-lms-phase-1-0019')::bigint)" >/dev/null

for encoded in "${STATEMENT_B64[@]}"; do
  SQL="$(printf '%s' "$encoded" | base64 --decode)"
  aws rds-data execute-statement --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" --transaction-id "$TX_ID" --sql "$SQL" >/dev/null
done

aws rds-data commit-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --transaction-id "$TX_ID" >/dev/null
committed=true

AFTER="$(shape)"
echo "LEARNING_LMS_PHASE_1_SHAPE_AFTER=$AFTER"
[[ "$AFTER" == "1/9/3/4" ]]
echo "LEARNING_LMS_PHASE_1_MIGRATION_APPLY_VERIFIED=true"
