#!/usr/bin/env bash
set -euo pipefail
umask 077
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
CLUSTER_ID="sea-n-shore-staging-aurora"
DATABASE_NAME="sea_n_shore"
QUIZ_MIGRATION="infra/aws/database/migrations/0017_learning_quiz_assessments.sql"
CERTIFICATE_MIGRATION="infra/aws/database/migrations/0018_learning_certificates.sql"
ACTION_FILE="scripts/aws/learning-launch-migration-action.txt"
EXPECTED_QUIZ_STATEMENTS=11
EXPECTED_CERTIFICATE_STATEMENTS=3

[[ "${LEARNING_LAUNCH_MIGRATION_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || { echo "LEARNING_LAUNCH_MIGRATION_EXPECTED_SHA must be an exact commit SHA." >&2; exit 1; }
[[ "$(git rev-parse HEAD)" == "$LEARNING_LAUNCH_MIGRATION_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- "$QUIZ_MIGRATION" "$CERTIFICATE_MIGRATION" "$0" "$ACTION_FILE"
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]

ACTION="$(tr -d '[:space:]' < "$ACTION_FILE")"
case "$ACTION" in plan|apply-once) ;; *) echo "Unsupported learning launch migration action." >&2; exit 1 ;; esac

python3 - "$QUIZ_MIGRATION" "$EXPECTED_QUIZ_STATEMENTS" "$CERTIFICATE_MIGRATION" "$EXPECTED_CERTIFICATE_STATEMENTS" <<'PY'
import re, sys
pairs=[(sys.argv[1], int(sys.argv[2])), (sys.argv[3], int(sys.argv[4]))]
for path, expected in pairs:
    sql=open(path, encoding='utf-8').read().strip()
    if re.search(r'\bdrop\b|\balter\b|\btruncate\b|\bdelete\s+from\b|\bupdate\s+public\.|\binsert\s+into\b', sql, re.I):
        raise SystemExit(f'{path} must remain create-only and additive')
    parts=[p.strip() for p in re.split(r'^\s*-- statement-breakpoint\s*$', sql, flags=re.M) if p.strip()]
    if len(parts) != expected:
        raise SystemExit(f'{path} expected {expected} statements; found {len(parts)}')
    for statement in parts:
        code='\n'.join(line for line in statement.splitlines() if not line.lstrip().startswith('--')).strip()
        if not re.match(r'^create\s+(table|unique\s+index|index)\s+if\s+not\s+exists\b', code, re.I):
            raise SystemExit(f'{path} contains a non-create statement')
        if not code.endswith(';'):
            raise SystemExit(f'{path} contains a statement without a semicolon')
print('LEARNING_LAUNCH_MIGRATION_SQL_GUARD=CREATE_ONLY_ADDITIVE')
PY

echo "QUIZ_MIGRATION_SHA256=$(sha256sum "$QUIZ_MIGRATION" | cut -d' ' -f1)"
echo "CERTIFICATE_MIGRATION_SHA256=$(sha256sum "$CERTIFICATE_MIGRATION" | cut -d' ' -f1)"

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

FOUNDATION_COUNT="$(read_count "SELECT count(*)::bigint FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('learning_mentor_applications','learning_mentors','learning_courses','learning_course_sections','learning_lessons','learning_enrollments','learning_progress')")"
[[ "$FOUNDATION_COUNT" == "7" ]] || { echo "Learning foundation 0016 is not fully present; refusing launch migration." >&2; exit 1; }

QUIZ_TABLE_NAMES="'learning_quizzes','learning_quiz_questions','learning_quiz_options','learning_quiz_attempts','learning_quiz_attempt_answers'"
QUIZ_INDEX_NAMES="'learning_quiz_questions_quiz_position_uq','learning_quiz_options_question_position_uq','learning_quiz_options_single_correct_uq','learning_quiz_attempts_enrollment_idx','learning_quiz_attempts_learner_idx','learning_quiz_attempt_answers_attempt_question_uq'"
CERT_TABLE_NAMES="'learning_certificates'"
CERT_INDEX_NAMES="'learning_certificates_learner_idx','learning_certificates_verification_idx'"

read_shape() {
  local qt qi ct ci
  qt="$(read_count "SELECT count(*)::bigint FROM information_schema.tables WHERE table_schema='public' AND table_name IN ($QUIZ_TABLE_NAMES)")"
  qi="$(read_count "SELECT count(*)::bigint FROM pg_indexes WHERE schemaname='public' AND indexname IN ($QUIZ_INDEX_NAMES)")"
  ct="$(read_count "SELECT count(*)::bigint FROM information_schema.tables WHERE table_schema='public' AND table_name IN ($CERT_TABLE_NAMES)")"
  ci="$(read_count "SELECT count(*)::bigint FROM pg_indexes WHERE schemaname='public' AND indexname IN ($CERT_INDEX_NAMES)")"
  printf '%s %s %s %s\n' "$qt" "$qi" "$ct" "$ci"
}

read -r QUIZ_TABLES QUIZ_INDEXES CERT_TABLES CERT_INDEXES < <(read_shape)
SHAPE="$QUIZ_TABLES/$QUIZ_INDEXES/$CERT_TABLES/$CERT_INDEXES"
echo "LEARNING_LAUNCH_SHAPE_BEFORE=$SHAPE"

case "$SHAPE" in
  5/6/1/2)
    echo "LEARNING_LAUNCH_MIGRATION_ALREADY_APPLIED=true"
    exit 0
    ;;
  0/0/0/0)
    APPLY_QUIZ=true; APPLY_CERT=true
    echo "LEARNING_LAUNCH_MIGRATION_PLAN_VERIFIED=0017_AND_0018"
    ;;
  5/6/0/0)
    APPLY_QUIZ=false; APPLY_CERT=true
    echo "LEARNING_LAUNCH_MIGRATION_PLAN_VERIFIED=0018_ONLY"
    ;;
  *)
    echo "Partial or unexpected learning launch schema detected; refusing automatic migration." >&2
    exit 1
    ;;
esac

if [[ "$ACTION" == "plan" ]]; then
  echo "LEARNING_LAUNCH_MIGRATION_PLAN_ONLY_NO_APPLY"
  exit 0
fi

[[ "$(git ls-remote origin refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$LEARNING_LAUNCH_MIGRATION_EXPECTED_SHA" ]]

FILES=()
[[ "$APPLY_QUIZ" == true ]] && FILES+=("$QUIZ_MIGRATION")
[[ "$APPLY_CERT" == true ]] && FILES+=("$CERTIFICATE_MIGRATION")

mapfile -t STATEMENT_B64 < <(python3 - "${FILES[@]}" <<'PY'
import base64, re, sys
for path in sys.argv[1:]:
    sql=open(path, encoding='utf-8').read().strip()
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

aws rds-data execute-statement --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" --transaction-id "$TX_ID" --sql "SELECT pg_advisory_xact_lock(hashtext('sea-n-shore-learning-launch-0017-0018')::bigint)" >/dev/null

for encoded in "${STATEMENT_B64[@]}"; do
  SQL="$(printf '%s' "$encoded" | base64 --decode)"
  aws rds-data execute-statement --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" --transaction-id "$TX_ID" --sql "$SQL" >/dev/null
done

aws rds-data commit-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --transaction-id "$TX_ID" >/dev/null
committed=true

read -r QUIZ_TABLES QUIZ_INDEXES CERT_TABLES CERT_INDEXES < <(read_shape)
echo "LEARNING_LAUNCH_SHAPE_AFTER=$QUIZ_TABLES/$QUIZ_INDEXES/$CERT_TABLES/$CERT_INDEXES"
[[ "$QUIZ_TABLES/$QUIZ_INDEXES/$CERT_TABLES/$CERT_INDEXES" == "5/6/1/2" ]]
echo "LEARNING_LAUNCH_MIGRATION_APPLY_VERIFIED=true"
