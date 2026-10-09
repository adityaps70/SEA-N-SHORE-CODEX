#!/usr/bin/env bash
# Applies the learning round B migrations (0072-0073) to the staging Aurora cluster through the RDS Data API.
# Each file is split on "-- statement-breakpoint", checked against an allowlist (additive SQL plus exactly the three
# approved relaxations, the widened email kind check and the bank backfill), and applied in its own transaction under
# an advisory lock. Every file is idempotent; a ledger row records each applied file.
#
# A plan run also previews 0073 in a transaction that is always rolled back and prints the bank backfill counts.
# Reports read course content only (questions and options), never learner rows.
set -euo pipefail
umask 077
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
CLUSTER_ID="sea-n-shore-staging-aurora"
DATABASE_NAME="sea_n_shore"
ACTION_FILE="scripts/aws/learning-round-b-migration-action.txt"
MIGRATIONS=(
  "infra/aws/database/migrations/0072_learning_round_b_notification_types.sql"
  "infra/aws/database/migrations/0073_learning_round_b.sql"
)
SCHEMA_MIGRATION="infra/aws/database/migrations/0073_learning_round_b.sql"

[[ "${LEARNING_ROUND_B_MIGRATION_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "LEARNING_ROUND_B_MIGRATION_EXPECTED_SHA must be an exact commit SHA." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$LEARNING_ROUND_B_MIGRATION_EXPECTED_SHA" ]] || { echo "Checkout is not the expected commit; refusing migration." >&2; exit 1; }
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]] || { echo "Checkout is not the Sea N Shore repository; refusing migration." >&2; exit 1; }
git diff --quiet HEAD -- "${MIGRATIONS[@]}" "$0" "$ACTION_FILE" || { echo "Migration files differ from the commit; refusing migration." >&2; exit 1; }
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]] || { echo "Unexpected AWS account; refusing migration." >&2; exit 1; }

ACTION="$(cut -d' ' -f1 < "$ACTION_FILE" | tr -d '[:space:]')"
# A manual "migrate-once" dispatch (already checked by the workflow: exact SHA + confirmation phrase)
# overrides the committed plan switch, so no execute/rearm commits are needed.
if [[ -n "${LEARNING_ROUND_B_MIGRATION_ACTION:-}" ]]; then
  ACTION="$(tr -d '[:space:]' <<<"$LEARNING_ROUND_B_MIGRATION_ACTION")"
fi
case "$ACTION" in
  plan|migrate-once) ;;
  *) echo "Unsupported learning round B migration action: $ACTION" >&2; exit 1 ;;
esac

validate_sql() {
  python3 - "$1" <<'PY'
import re, sys
path = sys.argv[1]
sql = open(path, encoding='utf-8').read().strip()
parts = [p.strip() for p in re.split(r'^\s*-- statement-breakpoint\s*$', sql, flags=re.M) if p.strip()]
if not parts:
    raise SystemExit(f'no statements in {path}')
def norm(text):
    return ' '.join(text.split())
# The only statements allowed to relax a rule or rewrite rows, word for word.
ALLOWED = {norm(s) for s in [
    'alter table public.learning_quiz_questions alter column quiz_id drop not null;',
    'drop index if exists public.learning_quiz_options_single_correct_uq;',
    'alter table public.learning_quiz_attempt_answers alter column selected_option_id drop not null, alter column correct_option_id drop not null;',
    'update public.learning_quiz_questions question set source_question_id = copy.id from public.learning_quiz_questions copy where copy.imported_from_question_id = question.id and question.source_question_id is null;',
    'update public.learning_quiz_questions question set source_question_id = live.source_question_id from public.learning_quiz_questions live where question.revision_source_id = live.id and question.source_question_id is null and live.source_question_id is not null;',
]}
KIND_CHECK = norm('alter table public.learning_notification_emails drop constraint if exists learning_notification_emails_kind_check, add constraint learning_notification_emails_kind_check check (')
KINDS = ['enrolled', 'lessons_released', 'assignment_graded', 'certificate_issued', 'course_approved', 'course_changes_requested', 'submissions_to_grade']
for index, statement in enumerate(parts):
    code = '\n'.join(line for line in statement.splitlines() if not line.lstrip().startswith('--')).strip()
    if not code:
        continue
    flat = norm(code)
    if flat in ALLOWED:
        continue
    if flat.startswith(KIND_CHECK):
        # The email kind check may only widen: every round A kind stays allowed, and nothing else is changed.
        missing = [kind for kind in KINDS if f"'{kind}'" not in flat]
        if missing or flat.count(';') != 1 or re.search(r'\b(update|delete|insert|drop\s+(table|column|type|schema|index|function|trigger))\b', flat, re.I):
            raise SystemExit(f'learning round B migration {path} statement {index + 1} narrows or changes more than the email kind check')
        continue
    if re.search(r'\b(drop\s+(table|column|type|schema|index|function|trigger|constraint)|drop\s+not\s+null|truncate|delete\s+from|update\s+public\.|alter\s+column\s+\w+\s+type)\b', code, re.I):
        raise SystemExit(f'learning round B migration {path} statement {index + 1} contains forbidden destructive SQL')
    if re.search(r'\bsecurity\s+definer\b', code, re.I):
        raise SystemExit(f'learning round B migration {path} statement {index + 1} uses SECURITY DEFINER')
    if re.search(r'\bconcurrently\b', code, re.I):
        raise SystemExit(f'learning round B migration {path} statement {index + 1} is not transaction-safe')
    if not code.rstrip().endswith(';'):
        raise SystemExit(f'learning round B migration {path} statement {index + 1} is missing a semicolon')
print(f'LEARNING_ROUND_B_SQL_GUARD=ADDITIVE_PLUS_APPROVED file={path} statements={len(parts)}')
PY
}

for migration in "${MIGRATIONS[@]}"; do
  [[ -f "$migration" ]] || { echo "Missing migration $migration" >&2; exit 1; }
  validate_sql "$migration"
  echo "LEARNING_ROUND_B_MIGRATION_SHA256 $(basename "$migration")=$(sha256sum "$migration" | cut -d' ' -f1)"
done

CLUSTER_JSON="$(aws rds describe-db-clusters --region "$AWS_REGION" --db-cluster-identifier "$CLUSTER_ID" --output json)"
CLUSTER_ARN="$(jq -r '.DBClusters[0].DBClusterArn // empty' <<<"$CLUSTER_JSON")"
SECRET_ARN="$(jq -r '.DBClusters[0].MasterUserSecret.SecretArn // empty' <<<"$CLUSTER_JSON")"
# Each refusal names its reason (no ARNs or secrets are printed).
CLUSTER_STATUS="$(jq -r '.DBClusters[0].Status // empty' <<<"$CLUSTER_JSON")"
[[ "$CLUSTER_STATUS" == "available" ]] || { echo "Aurora cluster status is '$CLUSTER_STATUS', not available; refusing migration." >&2; exit 1; }
[[ "$(jq -r '.DBClusters[0].HttpEndpointEnabled // false' <<<"$CLUSTER_JSON")" == "true" ]] || { echo "Aurora Data API is not enabled; refusing migration." >&2; exit 1; }
[[ "$CLUSTER_ARN" == "arn:aws:rds:ap-south-1:310356785722:cluster:sea-n-shore-staging-aurora" ]] || { echo "Unexpected Aurora cluster; refusing migration." >&2; exit 1; }
[[ "$SECRET_ARN" == arn:aws:secretsmanager:ap-south-1:310356785722:secret:rds\!cluster-* ]] || { echo "Aurora master secret is not the managed rds!cluster secret; refusing migration." >&2; exit 1; }

data_api() {
  aws rds-data execute-statement --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" "$@"
}
read_count() { data_api --sql "$1" --output json | jq -r '.records[0][0].longValue'; }
begin_transaction() { aws rds-data begin-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" --query transactionId --output text; }
rollback_transaction() { aws rds-data rollback-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --transaction-id "$1" >/dev/null 2>&1 || true; }

statements_b64() {
  python3 - "$1" <<'PY'
import base64, re, sys
sql = open(sys.argv[1], encoding='utf-8').read().strip()
for part in [p.strip() for p in re.split(r'^\s*-- statement-breakpoint\s*$', sql, flags=re.M) if p.strip()]:
    code = '\n'.join(line for line in part.splitlines() if not line.lstrip().startswith('--')).strip()
    if code:
        print(base64.b64encode(part.encode()).decode())
PY
}

# Round B follows the round A schema.
LEDGER_EXISTS="$(read_count "SELECT count(*)::bigint FROM information_schema.tables WHERE table_schema='public' AND table_name='sea_n_shore_applied_migrations'")"
[[ "$LEDGER_EXISTS" == "1" ]] || { echo "The migration ledger is missing; refusing migration." >&2; exit 1; }
already_applied() { [[ "$(read_count "SELECT count(*)::bigint FROM public.sea_n_shore_applied_migrations WHERE name='$1'")" == "1" ]]; }
already_applied 0070_learning_round_a || { echo "Migration 0070_learning_round_a is not applied yet; refusing migration." >&2; exit 1; }

# Read-only: how many live quiz questions the backfill will copy into banks. Course content only.
BANK_REPORT_SQL="SELECT (SELECT count(DISTINCT course.mentor_id) FROM public.learning_courses course WHERE course.revision_of_course_id IS NULL)::text, (SELECT count(*) FROM public.learning_quiz_questions question JOIN public.learning_quizzes quiz ON quiz.id = question.quiz_id JOIN public.learning_lessons lesson ON lesson.id = quiz.lesson_id JOIN public.learning_course_sections section ON section.id = lesson.section_id JOIN public.learning_courses course ON course.id = section.course_id WHERE course.revision_of_course_id IS NULL AND question.removed_at IS NULL)::text, (SELECT count(*) FROM public.learning_quiz_options)::text"
echo "LEARNING_ROUND_B_BANK_REPORT"
data_api --output json --sql "$BANK_REPORT_SQL" \
  | jq -r '.records[]? | "BANK_BACKFILL_SOURCE trainers=\(.[0].stringValue) live_quiz_questions=\(.[1].stringValue) options_before=\(.[2].stringValue)"' \
  || echo "LEARNING_ROUND_B_BANK_REPORT_UNAVAILABLE"
echo "LEARNING_ROUND_B_BANK_REPORT_DONE"

PENDING=()
for migration in "${MIGRATIONS[@]}"; do
  name="$(basename "$migration" .sql)"
  if already_applied "$name"; then
    echo "LEARNING_ROUND_B_MIGRATION_ALREADY_APPLIED $name"
  else
    echo "LEARNING_ROUND_B_MIGRATION_PENDING $name"
    PENDING+=("$migration")
  fi
done

if [[ "${#PENDING[@]}" -eq 0 ]]; then
  echo "LEARNING_ROUND_B_MIGRATION_ALREADY_APPLIED=true"
  exit 0
fi

# After 0073: banks, bank copies, and live quiz questions still without a bank copy (should be 0).
BACKFILL_RESULT_SQL="SELECT (SELECT count(*) FROM public.learning_question_banks)::text, (SELECT count(*) FROM public.learning_quiz_questions WHERE bank_id IS NOT NULL)::text, (SELECT count(*) FROM public.learning_quiz_questions question JOIN public.learning_quizzes quiz ON quiz.id = question.quiz_id JOIN public.learning_lessons lesson ON lesson.id = quiz.lesson_id JOIN public.learning_course_sections section ON section.id = lesson.section_id JOIN public.learning_courses course ON course.id = section.course_id WHERE course.revision_of_course_id IS NULL AND question.removed_at IS NULL AND question.source_question_id IS NULL)::text"
print_backfill() {
  jq -r '.records[]? | "BANK_BACKFILL banks=\(.[0].stringValue) bank_questions=\(.[1].stringValue) unlinked_live_questions=\(.[2].stringValue)"'
}

if [[ "$ACTION" == "plan" ]]; then
  # Preview 0073 against the real schema in a transaction that is always rolled back.
  mapfile -t PREVIEW_B64 < <(statements_b64 "$SCHEMA_MIGRATION")
  [[ "${#PREVIEW_B64[@]}" -ge 1 ]]
  PREVIEW_TX="$(begin_transaction)"
  [[ -n "$PREVIEW_TX" ]]
  trap 'rollback_transaction "$PREVIEW_TX"' EXIT; trap 'exit 129' HUP; trap 'exit 130' INT; trap 'exit 143' TERM
  for encoded in "${PREVIEW_B64[@]}"; do
    data_api --transaction-id "$PREVIEW_TX" --sql "$(printf '%s' "$encoded" | base64 --decode)" >/dev/null
  done
  data_api --transaction-id "$PREVIEW_TX" --output json --sql "$BACKFILL_RESULT_SQL" | print_backfill
  rollback_transaction "$PREVIEW_TX"
  trap - EXIT
  echo "LEARNING_ROUND_B_PREVIEW statements=${#PREVIEW_B64[@]} (rolled back)"
  echo "LEARNING_ROUND_B_MIGRATION_PLAN_VERIFIED=true"
  echo "LEARNING_ROUND_B_MIGRATION_PLAN_ONLY_NO_APPLY"
  exit 0
fi

[[ "$(bash scripts/aws/branch-head.sh refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$LEARNING_ROUND_B_MIGRATION_EXPECTED_SHA" ]] || { echo "The feature branch has moved past the approved commit; refusing migration." >&2; exit 1; }

apply_migration_file() {
  local migration="$1"
  local name digest tx_id committed
  name="$(basename "$migration" .sql)"
  digest="$(sha256sum "$migration" | cut -d' ' -f1)"
  mapfile -t STATEMENT_B64 < <(statements_b64 "$migration")
  [[ "${#STATEMENT_B64[@]}" -ge 1 ]]

  tx_id="$(begin_transaction)"
  [[ -n "$tx_id" ]]
  committed=false
  rollback_current_transaction() {
    if [[ "$committed" != true && -n "${tx_id:-}" ]]; then
      rollback_transaction "$tx_id"
    fi
  }
  trap rollback_current_transaction RETURN

  data_api --transaction-id "$tx_id" --sql "SELECT pg_advisory_xact_lock(hashtext('sea-n-shore-learning-round-b-$name')::bigint)" >/dev/null
  for encoded in "${STATEMENT_B64[@]}"; do
    SQL="$(printf '%s' "$encoded" | base64 --decode)"
    data_api --transaction-id "$tx_id" --sql "$SQL" >/dev/null
  done
  data_api --transaction-id "$tx_id" --sql "INSERT INTO public.sea_n_shore_applied_migrations (name, sha256, git_sha) VALUES ('$name', '$digest', '$LEARNING_ROUND_B_MIGRATION_EXPECTED_SHA') ON CONFLICT (name) DO NOTHING" >/dev/null

  aws rds-data commit-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --transaction-id "$tx_id" >/dev/null
  committed=true
  trap - RETURN
  echo "LEARNING_ROUND_B_MIGRATION_APPLIED $name"
}

for migration in "${PENDING[@]}"; do
  apply_migration_file "$migration"
done

for migration in "${MIGRATIONS[@]}"; do
  name="$(basename "$migration" .sql)"
  already_applied "$name" || { echo "Ledger is missing $name after apply." >&2; exit 1; }
done

# The new schema is in place.
NEW_COLUMNS="$(read_count "SELECT count(*)::bigint FROM information_schema.columns WHERE table_schema='public' AND ((table_name='learning_quiz_questions' AND column_name IN ('bank_id','question_type','marks','negative_marks','explanation','accepted_answers','source_question_id')) OR (table_name='learning_quizzes' AND column_name IN ('time_limit_minutes','shuffle_questions','shuffle_options','draw_count','answer_policy')) OR (table_name='learning_quiz_attempts' AND column_name IN ('session_id','status','score_points')) OR (table_name='learning_quiz_attempt_answers' AND column_name IN ('selected_option_ids','text_response','grading_status')) OR (table_name='learning_courses' AND column_name IN ('certificate_template','certificate_serial_prefix','certificate_validity_months','certificate_issue_trigger')) OR (table_name='learning_certificates' AND column_name IN ('template_key','serial_number','expires_at','hidden_from_profile')) OR (table_name='learning_lessons' AND column_name='certificate_final'))")"
[[ "$NEW_COLUMNS" == "27" ]] || { echo "Learning round B columns are incomplete after apply ($NEW_COLUMNS/27)." >&2; exit 1; }
NEW_TABLES="$(read_count "SELECT count(*)::bigint FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('learning_question_banks','learning_quiz_attempt_sessions')")"
[[ "$NEW_TABLES" == "2" ]] || { echo "Learning round B tables are incomplete after apply ($NEW_TABLES/2)." >&2; exit 1; }
OLD_INDEX="$(read_count "SELECT count(*)::bigint FROM pg_indexes WHERE schemaname='public' AND indexname='learning_quiz_options_single_correct_uq'")"
CHECK_TRIGGERS="$(read_count "SELECT count(*)::bigint FROM pg_trigger WHERE tgname IN ('learning_quiz_options_single_correct_check','learning_quiz_questions_single_correct_check')")"
[[ "$OLD_INDEX" == "0" && "$CHECK_TRIGGERS" == "2" ]] || { echo "The single-correct index was not replaced by its check (index=$OLD_INDEX triggers=$CHECK_TRIGGERS)." >&2; exit 1; }
BACKFILL="$(data_api --output json --sql "$BACKFILL_RESULT_SQL")"
print_backfill <<<"$BACKFILL"
[[ "$(jq -r '.records[0][2].stringValue' <<<"$BACKFILL")" == "0" ]] || { echo "Some live quiz questions have no bank copy after apply." >&2; exit 1; }
echo "LEARNING_ROUND_B_MIGRATION_APPLY_VERIFIED=true"
