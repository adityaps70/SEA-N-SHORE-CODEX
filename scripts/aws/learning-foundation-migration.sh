#!/usr/bin/env bash
set -euo pipefail
umask 077
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
CLUSTER_ID="sea-n-shore-staging-aurora"
DATABASE_NAME="sea_n_shore"
MIGRATION_FILE="infra/aws/database/migrations/0016_learning_foundation.sql"
ACTION_FILE="scripts/aws/learning-foundation-migration-action.txt"
EXPECTED_STATEMENTS=17
EXPECTED_TABLES=7
EXPECTED_REQUIRED_COLUMNS=92
EXPECTED_CHECK_CONSTRAINTS=43
EXPECTED_INDEXES=10

[[ "${LEARNING_FOUNDATION_MIGRATION_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "LEARNING_FOUNDATION_MIGRATION_EXPECTED_SHA must be an exact commit SHA." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$LEARNING_FOUNDATION_MIGRATION_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- "$MIGRATION_FILE" "$0" "$ACTION_FILE"
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]

ACTION="$(tr -d '[:space:]' < "$ACTION_FILE")"
case "$ACTION" in plan|apply-once) ;; *) echo "Unsupported learning foundation migration action." >&2; exit 1 ;; esac

python3 - "$MIGRATION_FILE" "$EXPECTED_STATEMENTS" <<'PY'
import re, sys
path, expected = sys.argv[1], int(sys.argv[2])
sql = open(path, encoding='utf-8').read().strip()
if re.search(r'\bdrop\b|\balter\b|\btruncate\b|\bdelete\s+from\b|\bupdate\s+|\binsert\s+into\b', sql, re.I):
    raise SystemExit('Learning foundation migration must remain create-only and additive')
parts = [p.strip() for p in re.split(r'^\s*-- statement-breakpoint\s*$', sql, flags=re.M) if p.strip()]
if len(parts) != expected:
    raise SystemExit(f'Learning foundation migration must contain {expected} statements; found {len(parts)}')

def code(part: str) -> str:
    lines = part.splitlines()
    while lines and (not lines[0].strip() or lines[0].lstrip().startswith('--')):
        lines.pop(0)
    return '\n'.join(lines).strip()

starts = [
    r'^create\s+table\s+if\s+not\s+exists\s+public\.learning_mentor_applications\b',
    r'^create\s+unique\s+index\s+if\s+not\s+exists\s+learning_mentor_applications_user_uq\b',
    r'^create\s+index\s+if\s+not\s+exists\s+learning_mentor_applications_admin_queue_idx\b',
    r'^create\s+table\s+if\s+not\s+exists\s+public\.learning_mentors\b',
    r'^create\s+table\s+if\s+not\s+exists\s+public\.learning_courses\b',
    r'^create\s+index\s+if\s+not\s+exists\s+learning_courses_marketplace_idx\b',
    r'^create\s+index\s+if\s+not\s+exists\s+learning_courses_mentor_idx\b',
    r'^create\s+table\s+if\s+not\s+exists\s+public\.learning_course_sections\b',
    r'^create\s+unique\s+index\s+if\s+not\s+exists\s+learning_sections_course_position_uq\b',
    r'^create\s+table\s+if\s+not\s+exists\s+public\.learning_lessons\b',
    r'^create\s+unique\s+index\s+if\s+not\s+exists\s+learning_lessons_section_position_uq\b',
    r'^create\s+table\s+if\s+not\s+exists\s+public\.learning_enrollments\b',
    r'^create\s+unique\s+index\s+if\s+not\s+exists\s+learning_enrollments_course_learner_uq\b',
    r'^create\s+index\s+if\s+not\s+exists\s+learning_enrollments_learner_idx\b',
    r'^create\s+table\s+if\s+not\s+exists\s+public\.learning_progress\b',
    r'^create\s+unique\s+index\s+if\s+not\s+exists\s+learning_progress_enrollment_lesson_uq\b',
    r'^create\s+index\s+if\s+not\s+exists\s+learning_progress_enrollment_idx\b',
]
for part, pattern in zip(parts, starts):
    statement = code(part)
    if not re.match(pattern, statement, re.I):
        raise SystemExit('Learning foundation migration statement order or scope changed')
    if not statement.endswith(';'):
        raise SystemExit('Every learning foundation migration statement must end with a semicolon')
print('LEARNING_FOUNDATION_MIGRATION_SQL_GUARD=CREATE_ONLY_ADDITIVE')
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

TABLE_NAMES="'learning_mentor_applications','learning_mentors','learning_courses','learning_course_sections','learning_lessons','learning_enrollments','learning_progress'"
INDEX_NAMES="'learning_mentor_applications_user_uq','learning_mentor_applications_admin_queue_idx','learning_courses_marketplace_idx','learning_courses_mentor_idx','learning_sections_course_position_uq','learning_lessons_section_position_uq','learning_enrollments_course_learner_uq','learning_enrollments_learner_idx','learning_progress_enrollment_lesson_uq','learning_progress_enrollment_idx'"

read_shape() {
  local TABLE_COUNT REQUIRED_COLUMNS CHECK_CONSTRAINTS INDEX_COUNT
  TABLE_COUNT="$(read_count "SELECT count(*)::bigint FROM information_schema.tables WHERE table_schema='public' AND table_name IN ($TABLE_NAMES)")"
  REQUIRED_COLUMNS="$(read_count "SELECT count(*)::bigint FROM information_schema.columns WHERE table_schema='public' AND table_name IN ($TABLE_NAMES)")"
  CHECK_CONSTRAINTS="$(read_count "SELECT count(*)::bigint FROM pg_constraint con JOIN pg_class rel ON rel.oid=con.conrelid JOIN pg_namespace ns ON ns.oid=rel.relnamespace WHERE ns.nspname='public' AND rel.relname IN ($TABLE_NAMES) AND con.contype='c' AND con.conname LIKE 'learning_%_check'")"
  INDEX_COUNT="$(read_count "SELECT count(*)::bigint FROM pg_indexes WHERE schemaname='public' AND indexname IN ($INDEX_NAMES)")"
  printf '%s %s %s %s\n' "$TABLE_COUNT" "$REQUIRED_COLUMNS" "$CHECK_CONSTRAINTS" "$INDEX_COUNT"
}

read -r TABLE_COUNT REQUIRED_COLUMNS CHECK_CONSTRAINTS INDEX_COUNT < <(read_shape)
echo "LEARNING_FOUNDATION_SHAPE_BEFORE=$TABLE_COUNT/$REQUIRED_COLUMNS/$CHECK_CONSTRAINTS/$INDEX_COUNT"

SHAPE="$TABLE_COUNT/$REQUIRED_COLUMNS/$CHECK_CONSTRAINTS/$INDEX_COUNT"
EXPECTED_SHAPE="$EXPECTED_TABLES/$EXPECTED_REQUIRED_COLUMNS/$EXPECTED_CHECK_CONSTRAINTS/$EXPECTED_INDEXES"
if [[ "$SHAPE" == "$EXPECTED_SHAPE" ]]; then
  echo "LEARNING_FOUNDATION_MIGRATION_ALREADY_APPLIED=true"
  exit 0
fi

if [[ "$SHAPE" == "0/0/0/0" ]]; then
  echo "LEARNING_FOUNDATION_MIGRATION_PLAN_VERIFIED=FULL_ADDITIVE_APPLY"
else
  echo "Partial or unexpected learning foundation schema detected; refusing automatic migration." >&2
  exit 1
fi

if [[ "$ACTION" == "plan" ]]; then
  echo "LEARNING_FOUNDATION_MIGRATION_PLAN_ONLY_NO_APPLY"
  exit 0
fi

[[ "$(git ls-remote origin refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$LEARNING_FOUNDATION_MIGRATION_EXPECTED_SHA" ]]

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

aws rds-data execute-statement --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" \
  --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" --transaction-id "$TX_ID" \
  --sql "SELECT pg_advisory_xact_lock(hashtext('sea-n-shore-learning-foundation-0016')::bigint)" >/dev/null

for encoded in "${STATEMENT_B64[@]}"; do
  SQL="$(printf '%s' "$encoded" | base64 --decode)"
  aws rds-data execute-statement --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" \
    --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" --transaction-id "$TX_ID" --sql "$SQL" >/dev/null
done

aws rds-data commit-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" \
  --secret-arn "$SECRET_ARN" --transaction-id "$TX_ID" >/dev/null
committed=true

read -r TABLE_COUNT REQUIRED_COLUMNS CHECK_CONSTRAINTS INDEX_COUNT < <(read_shape)
echo "LEARNING_FOUNDATION_SHAPE_AFTER=$TABLE_COUNT/$REQUIRED_COLUMNS/$CHECK_CONSTRAINTS/$INDEX_COUNT"
[[ "$TABLE_COUNT" == "$EXPECTED_TABLES" ]]
[[ "$REQUIRED_COLUMNS" == "$EXPECTED_REQUIRED_COLUMNS" ]]
[[ "$CHECK_CONSTRAINTS" == "$EXPECTED_CHECK_CONSTRAINTS" ]]
[[ "$INDEX_COUNT" == "$EXPECTED_INDEXES" ]]
echo "LEARNING_FOUNDATION_MIGRATION_APPLY_VERIFIED=true"
