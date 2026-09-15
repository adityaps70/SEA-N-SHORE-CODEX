#!/usr/bin/env bash
set -euo pipefail
umask 077
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
CLUSTER_ID="sea-n-shore-staging-aurora"
DATABASE_NAME="sea_n_shore"
MIGRATION="infra/aws/database/migrations/0021_learning_quiz_attempt_resilience.sql"
ACTION_FILE="scripts/aws/learning-quiz-resilience-migration-action.txt"

[[ "${LEARNING_QUIZ_RESILIENCE_MIGRATION_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || { echo "LEARNING_QUIZ_RESILIENCE_MIGRATION_EXPECTED_SHA must be an exact commit SHA." >&2; exit 1; }
[[ "$(git rev-parse HEAD)" == "$LEARNING_QUIZ_RESILIENCE_MIGRATION_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- "$MIGRATION" "$0" "$ACTION_FILE"
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]

ACTION="$(tr -d '[:space:]' < "$ACTION_FILE")"
case "$ACTION" in plan|migrate-once) ;; *) echo "Unsupported learning quiz resilience migration action: $ACTION" >&2; exit 1 ;; esac

python3 - "$MIGRATION" <<'PY'
import re, sys
sql=open(sys.argv[1], encoding='utf-8').read().strip()
parts=[p.strip() for p in re.split(r'^\s*-- statement-breakpoint\s*$', sql, flags=re.M) if p.strip()]
if len(parts) < 12:
    raise SystemExit(f'expected a substantial additive quiz resilience migration; found {len(parts)} statements')
allowed=re.compile(r'^(alter\s+table|update\s+public\.learning_quiz_attempts|update\s+public\.learning_quiz_attempt_answers|create\s+unique\s+index\s+if\s+not\s+exists|create\s+or\s+replace\s+function|create\s+or\s+replace\s+trigger)\b', re.I)
for statement in parts:
    code='\n'.join(line for line in statement.splitlines() if not line.lstrip().startswith('--')).strip()
    if not allowed.match(code):
        raise SystemExit(f'migration contains an unexpected statement family: {code.splitlines()[0][:100]}')
    if re.search(r'\btruncate\b|\bdelete\s+from\b|\bdrop\s+table\b|\bdrop\s+column\b', code, re.I):
        raise SystemExit('migration contains destructive DDL/DML')
    if not code.endswith(';'):
        raise SystemExit('migration statement missing semicolon')
print(f'LEARNING_QUIZ_RESILIENCE_SQL_GUARD=ADDITIVE_COMPATIBILITY statements={len(parts)}')
PY

echo "LEARNING_QUIZ_RESILIENCE_MIGRATION_SHA256=$(sha256sum "$MIGRATION" | cut -d' ' -f1)"
CLUSTER_JSON="$(aws rds describe-db-clusters --region "$AWS_REGION" --db-cluster-identifier "$CLUSTER_ID" --output json)"
CLUSTER_ARN="$(jq -r '.DBClusters[0].DBClusterArn // empty' <<<"$CLUSTER_JSON")"
SECRET_ARN="$(jq -r '.DBClusters[0].MasterUserSecret.SecretArn // empty' <<<"$CLUSTER_JSON")"
[[ "$(jq -r '.DBClusters[0].Status // empty' <<<"$CLUSTER_JSON")" == "available" ]]
[[ "$(jq -r '.DBClusters[0].HttpEndpointEnabled // false' <<<"$CLUSTER_JSON")" == "true" ]]
[[ "$CLUSTER_ARN" == "arn:aws:rds:ap-south-1:310356785722:cluster:sea-n-shore-staging-aurora" ]]
[[ "$SECRET_ARN" == arn:aws:secretsmanager:ap-south-1:310356785722:secret:rds\!cluster-* ]]

execute_read() { aws rds-data execute-statement --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" --sql "$1" --output json; }
read_count() { execute_read "$1" | jq -r '.records[0][0].longValue'; }

FOUNDATION_COUNT="$(read_count "SELECT count(*)::bigint FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('learning_quizzes','learning_quiz_attempts','learning_quiz_attempt_answers','learning_quiz_options')")"
[[ "$FOUNDATION_COUNT" == "4" ]] || { echo "Learning quiz foundation schema is incomplete; refusing resilience migration." >&2; exit 1; }

shape() {
  local attempt_cols answer_cols indexes attempt_checks triggers
  attempt_cols="$(read_count "SELECT count(*)::bigint FROM information_schema.columns WHERE table_schema='public' AND table_name='learning_quiz_attempts' AND column_name IN ('attempt_number','submission_key')")"
  answer_cols="$(read_count "SELECT count(*)::bigint FROM information_schema.columns WHERE table_schema='public' AND table_name='learning_quiz_attempt_answers' AND column_name='correct_option_id'")"
  indexes="$(read_count "SELECT count(*)::bigint FROM pg_indexes WHERE schemaname='public' AND indexname IN ('learning_quiz_attempts_enrollment_quiz_number_uq','learning_quiz_attempts_submission_key_uq')")"
  attempt_checks="$(read_count "SELECT count(*)::bigint FROM pg_constraint WHERE conname='learning_quiz_attempts_attempt_number_check' AND conrelid='public.learning_quiz_attempts'::regclass")"
  triggers="$(read_count "SELECT count(DISTINCT trigger_name)::bigint FROM information_schema.triggers WHERE trigger_schema='public' AND trigger_name IN ('learning_quiz_attempt_number_compat','learning_quiz_answer_snapshot_compat')")"
  printf '%s/%s/%s/%s/%s\n' "$attempt_cols" "$answer_cols" "$indexes" "$attempt_checks" "$triggers"
}

verify_data_shape() {
  local missing_numbers missing_snapshots invalid_numbers
  missing_numbers="$(read_count "SELECT count(*)::bigint FROM public.learning_quiz_attempts WHERE attempt_number IS NULL")"
  missing_snapshots="$(read_count "SELECT count(*)::bigint FROM public.learning_quiz_attempt_answers WHERE correct_option_id IS NULL")"
  invalid_numbers="$(read_count "SELECT count(*)::bigint FROM public.learning_quiz_attempts WHERE attempt_number <= 0")"
  echo "LEARNING_QUIZ_RESILIENCE_DATA_SHAPE=missing_numbers:${missing_numbers}/missing_snapshots:${missing_snapshots}/invalid_numbers:${invalid_numbers}"
  [[ "$missing_numbers" == "0" && "$missing_snapshots" == "0" && "$invalid_numbers" == "0" ]]
}

BEFORE="$(shape)"
echo "LEARNING_QUIZ_RESILIENCE_SHAPE_BEFORE=$BEFORE"
if [[ "$BEFORE" == "2/1/2/1/2" ]]; then
  verify_data_shape
  echo "LEARNING_QUIZ_RESILIENCE_MIGRATION_ALREADY_APPLIED=true"
  exit 0
fi
[[ "$BEFORE" == "0/0/0/0/0" ]] || { echo "Partial learning quiz resilience schema detected; refusing automatic migration." >&2; exit 1; }

echo "LEARNING_QUIZ_RESILIENCE_MIGRATION_PLAN_VERIFIED=true"
if [[ "$ACTION" == "plan" ]]; then
  echo "LEARNING_QUIZ_RESILIENCE_MIGRATION_PLAN_ONLY_NO_APPLY"
  exit 0
fi
[[ "$(git ls-remote origin refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$LEARNING_QUIZ_RESILIENCE_MIGRATION_EXPECTED_SHA" ]]

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
aws rds-data execute-statement --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" --transaction-id "$TX_ID" --sql "SELECT pg_advisory_xact_lock(hashtext('sea-n-shore-learning-quiz-resilience-0021')::bigint)" >/dev/null
for encoded in "${STATEMENT_B64[@]}"; do
  SQL="$(printf '%s' "$encoded" | base64 --decode)"
  aws rds-data execute-statement --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" --transaction-id "$TX_ID" --sql "$SQL" >/dev/null
done
aws rds-data commit-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --transaction-id "$TX_ID" >/dev/null
committed=true
AFTER="$(shape)"
echo "LEARNING_QUIZ_RESILIENCE_SHAPE_AFTER=$AFTER"
[[ "$AFTER" == "2/1/2/1/2" ]]
verify_data_shape
echo "LEARNING_QUIZ_RESILIENCE_MIGRATION_APPLY_VERIFIED=true"
