#!/usr/bin/env bash
# Applies the learning round A migrations (0069-0070) to the staging Aurora cluster through the RDS Data API.
# Each file is split on "-- statement-breakpoint", guarded against destructive SQL, and applied in its own
# transaction under an advisory lock. Every file is idempotent; a ledger row records each applied file.
# Every run (plan or apply) also prints the SIRE 2.0 course's quiz attempt settings and any attempt wording in
# its content, read-only, so the owner can correct the course text in Studio.
set -euo pipefail
umask 077
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
CLUSTER_ID="sea-n-shore-staging-aurora"
DATABASE_NAME="sea_n_shore"
ACTION_FILE="scripts/aws/learning-round-a-migration-action.txt"
SIRE_COURSE_SLUG="sire-2-0-practical-vessel-inspection-readiness"
MIGRATIONS=(
  "infra/aws/database/migrations/0069_learning_round_a_notification_types.sql"
  "infra/aws/database/migrations/0070_learning_round_a.sql"
)

[[ "${LEARNING_ROUND_A_MIGRATION_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "LEARNING_ROUND_A_MIGRATION_EXPECTED_SHA must be an exact commit SHA." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$LEARNING_ROUND_A_MIGRATION_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- "${MIGRATIONS[@]}" "$0" "$ACTION_FILE"
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]

ACTION="$(cut -d' ' -f1 < "$ACTION_FILE" | tr -d '[:space:]')"
# A manual "migrate-once" dispatch (already checked by the workflow: exact SHA + confirmation phrase)
# overrides the committed plan switch, so no execute/rearm commits are needed.
if [[ -n "${LEARNING_ROUND_A_MIGRATION_ACTION:-}" ]]; then
  ACTION="$(tr -d '[:space:]' <<<"$LEARNING_ROUND_A_MIGRATION_ACTION")"
fi
case "$ACTION" in
  plan|migrate-once) ;;
  *) echo "Unsupported learning round A migration action: $ACTION" >&2; exit 1 ;;
esac

validate_sql() {
  python3 - "$1" <<'PY'
import re, sys
path = sys.argv[1]
sql = open(path, encoding='utf-8').read().strip()
parts = [p.strip() for p in re.split(r'^\s*-- statement-breakpoint\s*$', sql, flags=re.M) if p.strip()]
if not parts:
    raise SystemExit(f'no statements in {path}')
for index, statement in enumerate(parts):
    code = '\n'.join(line for line in statement.splitlines() if not line.lstrip().startswith('--')).strip()
    if not code:
        continue
    if re.search(r'\b(drop\s+(table|column|type|schema|index)|truncate|delete\s+from|update\s+public\.)\b', code, re.I):
        raise SystemExit(f'learning round A migration {path} statement {index + 1} contains forbidden destructive SQL')
    if re.search(r'\bsecurity\s+definer\b', code, re.I):
        raise SystemExit(f'learning round A migration {path} statement {index + 1} uses SECURITY DEFINER')
    if not code.rstrip().endswith(';'):
        raise SystemExit(f'learning round A migration {path} statement {index + 1} is missing a semicolon')
print(f'LEARNING_ROUND_A_SQL_GUARD=ADDITIVE file={path} statements={len(parts)}')
PY
}

for migration in "${MIGRATIONS[@]}"; do
  [[ -f "$migration" ]] || { echo "Missing migration $migration" >&2; exit 1; }
  validate_sql "$migration"
  echo "LEARNING_ROUND_A_MIGRATION_SHA256 $(basename "$migration")=$(sha256sum "$migration" | cut -d' ' -f1)"
done

CLUSTER_JSON="$(aws rds describe-db-clusters --region "$AWS_REGION" --db-cluster-identifier "$CLUSTER_ID" --output json)"
CLUSTER_ARN="$(jq -r '.DBClusters[0].DBClusterArn // empty' <<<"$CLUSTER_JSON")"
SECRET_ARN="$(jq -r '.DBClusters[0].MasterUserSecret.SecretArn // empty' <<<"$CLUSTER_JSON")"
[[ "$(jq -r '.DBClusters[0].Status // empty' <<<"$CLUSTER_JSON")" == "available" ]]
[[ "$(jq -r '.DBClusters[0].HttpEndpointEnabled // false' <<<"$CLUSTER_JSON")" == "true" ]]
[[ "$CLUSTER_ARN" == "arn:aws:rds:ap-south-1:310356785722:cluster:sea-n-shore-staging-aurora" ]]
[[ "$SECRET_ARN" == arn:aws:secretsmanager:ap-south-1:310356785722:secret:rds\!cluster-* ]]

data_api() {
  aws rds-data execute-statement --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" "$@"
}
read_count() { data_api --sql "$1" --output json | jq -r '.records[0][0].longValue'; }

# The tables these migrations extend must already exist.
PREREQUISITES="$(read_count "SELECT count(*)::bigint FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('profiles','notifications','learning_courses','learning_course_sections','learning_lessons','learning_quiz_questions','learning_quiz_options','learning_progress','learning_enrollments','learning_assignments','learning_assignment_attempts','learning_course_submissions')")"
[[ "$PREREQUISITES" == "12" ]] || {
  echo "Learning round A prerequisite tables are incomplete ($PREREQUISITES/12); refusing migration." >&2
  exit 1
}

# Read-only: the SIRE 2.0 quiz attempt settings (blank = unlimited) and where its content mentions attempts.
# Course content only; no learner data is read.
echo "SIRE_QUIZ_REPORT course=$SIRE_COURSE_SLUG"
data_api --output json --sql "SELECT lesson.title, coalesce(lesson.max_attempts::text, 'unlimited'), lesson.is_published::text, coalesce(quiz.pass_percentage::text, 'none') FROM public.learning_courses course JOIN public.learning_course_sections section ON section.course_id = course.id JOIN public.learning_lessons lesson ON lesson.section_id = section.id LEFT JOIN public.learning_quizzes quiz ON quiz.lesson_id = lesson.id WHERE course.slug = '$SIRE_COURSE_SLUG' AND lesson.lesson_type = 'quiz' ORDER BY section.position, lesson.position" \
  | jq -r '.records[]? | "SIRE_QUIZ title=\(.[0].stringValue) max_attempts=\(.[1].stringValue) published=\(.[2].stringValue) pass_percentage=\(.[3].stringValue)"'
data_api --output json --sql "WITH content AS (
    SELECT 'course description' AS field, course.title AS item, course.description AS body FROM public.learning_courses course WHERE course.slug = '$SIRE_COURSE_SLUG'
    UNION ALL SELECT 'course subtitle', course.title, course.subtitle FROM public.learning_courses course WHERE course.slug = '$SIRE_COURSE_SLUG'
    UNION ALL SELECT 'material summary', lesson.title, lesson.summary FROM public.learning_courses course JOIN public.learning_course_sections section ON section.course_id = course.id JOIN public.learning_lessons lesson ON lesson.section_id = section.id WHERE course.slug = '$SIRE_COURSE_SLUG'
    UNION ALL SELECT 'article content', lesson.title, lesson.article_body FROM public.learning_courses course JOIN public.learning_course_sections section ON section.course_id = course.id JOIN public.learning_lessons lesson ON lesson.section_id = section.id WHERE course.slug = '$SIRE_COURSE_SLUG'
    UNION ALL SELECT 'quiz instructions', lesson.title, quiz.instructions FROM public.learning_courses course JOIN public.learning_course_sections section ON section.course_id = course.id JOIN public.learning_lessons lesson ON lesson.section_id = section.id JOIN public.learning_quizzes quiz ON quiz.lesson_id = lesson.id WHERE course.slug = '$SIRE_COURSE_SLUG'
  )
  SELECT field, item, substring(body FROM '(?i)(.{0,60}(unlimited|three|[0-9]+)\\s+(attempt|tr(y|ies)|retake)s?.{0,60})') FROM content WHERE body ~* '(unlimited|three|[0-9]+)\\s+(attempt|tr(y|ies)|retake)s?'" \
  | jq -r '.records[]? | "SIRE_ATTEMPT_WORDING field=\(.[0].stringValue) item=\(.[1].stringValue) text=\(.[2].stringValue // "")"'
echo "SIRE_QUIZ_REPORT_DONE"

LEDGER_EXISTS="$(read_count "SELECT count(*)::bigint FROM information_schema.tables WHERE table_schema='public' AND table_name='sea_n_shore_applied_migrations'")"
already_applied() {
  [[ "$LEDGER_EXISTS" == "1" ]] || return 1
  local name="$1"
  [[ "$(read_count "SELECT count(*)::bigint FROM public.sea_n_shore_applied_migrations WHERE name='$name'")" == "1" ]]
}

PENDING=()
for migration in "${MIGRATIONS[@]}"; do
  name="$(basename "$migration" .sql)"
  if already_applied "$name"; then
    echo "LEARNING_ROUND_A_MIGRATION_ALREADY_APPLIED $name"
  else
    echo "LEARNING_ROUND_A_MIGRATION_PENDING $name"
    PENDING+=("$migration")
  fi
done

if [[ "${#PENDING[@]}" -eq 0 ]]; then
  echo "LEARNING_ROUND_A_MIGRATION_ALREADY_APPLIED=true"
  exit 0
fi

echo "LEARNING_ROUND_A_MIGRATION_PLAN_VERIFIED=true"
if [[ "$ACTION" == "plan" ]]; then
  echo "LEARNING_ROUND_A_MIGRATION_PLAN_ONLY_NO_APPLY"
  exit 0
fi

[[ "$(bash scripts/aws/branch-head.sh refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$LEARNING_ROUND_A_MIGRATION_EXPECTED_SHA" ]]

data_api --sql "CREATE TABLE IF NOT EXISTS public.sea_n_shore_applied_migrations (name text PRIMARY KEY, sha256 text NOT NULL, git_sha text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())" >/dev/null

apply_migration_file() {
  local migration="$1"
  local name digest tx_id committed
  name="$(basename "$migration" .sql)"
  digest="$(sha256sum "$migration" | cut -d' ' -f1)"
  mapfile -t STATEMENT_B64 < <(python3 - "$migration" <<'PY'
import base64, re, sys
sql = open(sys.argv[1], encoding='utf-8').read().strip()
for part in [p.strip() for p in re.split(r'^\s*-- statement-breakpoint\s*$', sql, flags=re.M) if p.strip()]:
    code = '\n'.join(line for line in part.splitlines() if not line.lstrip().startswith('--')).strip()
    if code:
        print(base64.b64encode(part.encode()).decode())
PY
)
  [[ "${#STATEMENT_B64[@]}" -ge 1 ]]

  tx_id="$(aws rds-data begin-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" --query transactionId --output text)"
  [[ -n "$tx_id" ]]
  committed=false
  rollback_current_transaction() {
    if [[ "$committed" != true && -n "${tx_id:-}" ]]; then
      aws rds-data rollback-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --transaction-id "$tx_id" >/dev/null 2>&1 || true
    fi
  }
  trap rollback_current_transaction RETURN

  data_api --transaction-id "$tx_id" --sql "SELECT pg_advisory_xact_lock(hashtext('sea-n-shore-learning-round-a-$name')::bigint)" >/dev/null
  for encoded in "${STATEMENT_B64[@]}"; do
    SQL="$(printf '%s' "$encoded" | base64 --decode)"
    data_api --transaction-id "$tx_id" --sql "$SQL" >/dev/null
  done
  data_api --transaction-id "$tx_id" --sql "INSERT INTO public.sea_n_shore_applied_migrations (name, sha256, git_sha) VALUES ('$name', '$digest', '$LEARNING_ROUND_A_MIGRATION_EXPECTED_SHA') ON CONFLICT (name) DO NOTHING" >/dev/null

  aws rds-data commit-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --transaction-id "$tx_id" >/dev/null
  committed=true
  trap - RETURN
  echo "LEARNING_ROUND_A_MIGRATION_APPLIED $name"
}

LEDGER_EXISTS=1
for migration in "${PENDING[@]}"; do
  apply_migration_file "$migration"
done

for migration in "${MIGRATIONS[@]}"; do
  name="$(basename "$migration" .sql)"
  already_applied "$name" || { echo "Ledger is missing $name after apply." >&2; exit 1; }
done

# The new schema is in place.
NEW_COLUMNS="$(read_count "SELECT count(*)::bigint FROM information_schema.columns WHERE table_schema='public' AND ((table_name='learning_courses' AND column_name='revision_of_course_id') OR (table_name='learning_lessons' AND column_name IN ('removed_at','revision_source_id','article_format','caption_path')) OR (table_name='learning_assignments' AND column_name='max_files') OR (table_name='learning_progress' AND column_name='watched_seconds'))")"
[[ "$NEW_COLUMNS" == "7" ]] || { echo "Learning round A columns are incomplete after apply ($NEW_COLUMNS/7)." >&2; exit 1; }
NEW_TABLES="$(read_count "SELECT count(*)::bigint FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('learning_assignment_attachments','notification_email_preferences','learning_notification_emails','learning_release_notices')")"
[[ "$NEW_TABLES" == "4" ]] || { echo "Learning round A tables are incomplete after apply ($NEW_TABLES/4)." >&2; exit 1; }
echo "LEARNING_ROUND_A_MIGRATION_APPLY_VERIFIED=true"
