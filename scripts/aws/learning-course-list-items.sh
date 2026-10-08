#!/usr/bin/env bash
# Applies migration 0071 to the staging Aurora cluster through the RDS Data API: course lists (learning outcomes,
# requirements, target audience) that the old comma-splitting Studio editor broke apart are rejoined word for word,
# with every original list kept in learning_course_list_items_backup.
#
# Every run prints each course's lists (course content only; no learner data). A plan run also previews the repair:
# it runs the backup step inside a transaction that is always rolled back and prints each item the repair would
# produce. migrate-once applies the file in one transaction under an advisory lock and records it in the ledger.
set -euo pipefail
umask 077
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
CLUSTER_ID="sea-n-shore-staging-aurora"
DATABASE_NAME="sea_n_shore"
ACTION_FILE="scripts/aws/learning-course-list-items-action.txt"
MIGRATION="infra/aws/database/migrations/0071_learning_course_list_items.sql"
MIGRATION_NAME="$(basename "$MIGRATION" .sql)"

[[ "${LEARNING_COURSE_LIST_ITEMS_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "LEARNING_COURSE_LIST_ITEMS_EXPECTED_SHA must be an exact commit SHA." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$LEARNING_COURSE_LIST_ITEMS_EXPECTED_SHA" ]] || { echo "Checkout is not the expected commit; refusing migration." >&2; exit 1; }
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]] || { echo "Checkout is not the Sea N Shore repository; refusing migration." >&2; exit 1; }
git diff --quiet HEAD -- "$MIGRATION" "$0" "$ACTION_FILE" || { echo "Migration files differ from the commit; refusing migration." >&2; exit 1; }
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]] || { echo "Unexpected AWS account; refusing migration." >&2; exit 1; }

ACTION="$(cut -d' ' -f1 < "$ACTION_FILE" | tr -d '[:space:]')"
# A manual "migrate-once" dispatch (already checked by the workflow: exact SHA + confirmation phrase)
# overrides the committed plan switch, so no execute/rearm commits are needed.
if [[ -n "${LEARNING_COURSE_LIST_ITEMS_ACTION:-}" ]]; then
  ACTION="$(tr -d '[:space:]' <<<"$LEARNING_COURSE_LIST_ITEMS_ACTION")"
fi
case "$ACTION" in
  plan|migrate-once) ;;
  *) echo "Unsupported course list items action: $ACTION" >&2; exit 1 ;;
esac

# The file may create its backup table, insert backup rows, and rewrite only the three list columns of
# learning_courses from that backup. Nothing else that changes or removes data is allowed.
python3 - "$MIGRATION" <<'PY'
import re, sys
path = sys.argv[1]
sql = open(path, encoding='utf-8').read().strip()
parts = [p.strip() for p in re.split(r'^\s*-- statement-breakpoint\s*$', sql, flags=re.M) if p.strip()]
if len(parts) != 3:
    raise SystemExit(f'{path} must have exactly 3 statements, found {len(parts)}')
allowed_update = re.compile(
    r'^update public\.learning_courses course\s+'
    r'set learning_outcomes = backup\.repaired_learning_outcomes,\s*'
    r'requirements = backup\.repaired_requirements,\s*'
    r'target_audience = backup\.repaired_target_audience\s+'
    r'from public\.learning_course_list_items_backup backup\s+'
    r'where backup\.course_id = course\.id\s+'
    r'and course\.learning_outcomes = backup\.learning_outcomes\s+'
    r'and course\.requirements = backup\.requirements\s+'
    r'and course\.target_audience = backup\.target_audience;$',
    re.I,
)
for index, statement in enumerate(parts):
    code = '\n'.join(line for line in statement.splitlines() if not line.lstrip().startswith('--')).strip()
    if not code:
        continue
    if re.search(r'\b(drop\s+(table|column|type|schema|index|function)|truncate|delete\s+from|alter\s+table)\b', code, re.I):
        raise SystemExit(f'course list items migration statement {index + 1} contains forbidden destructive SQL')
    if re.search(r'\bsecurity\s+definer\b', code, re.I):
        raise SystemExit(f'course list items migration statement {index + 1} uses SECURITY DEFINER')
    if re.search(r'\bupdate\s+public\.', code, re.I) and not allowed_update.match(code):
        raise SystemExit(f'course list items migration statement {index + 1} updates more than the three course list columns')
    if not code.rstrip().endswith(';'):
        raise SystemExit(f'course list items migration statement {index + 1} is missing a semicolon')
print(f'LEARNING_COURSE_LIST_ITEMS_SQL_GUARD=LIST_COLUMNS_ONLY file={path} statements={len(parts)}')
PY
echo "LEARNING_COURSE_LIST_ITEMS_SHA256 $(basename "$MIGRATION")=$(sha256sum "$MIGRATION" | cut -d' ' -f1)"

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

# 0071 follows the learning round A schema.
LEDGER_EXISTS="$(read_count "SELECT count(*)::bigint FROM information_schema.tables WHERE table_schema='public' AND table_name='sea_n_shore_applied_migrations'")"
[[ "$LEDGER_EXISTS" == "1" ]] || { echo "The migration ledger is missing; refusing migration." >&2; exit 1; }
applied() { [[ "$(read_count "SELECT count(*)::bigint FROM public.sea_n_shore_applied_migrations WHERE name='$1'")" == "1" ]]; }
applied 0070_learning_round_a || { echo "Migration 0070_learning_round_a is not applied yet; refusing migration." >&2; exit 1; }

mapfile -t STATEMENT_B64 < <(python3 - "$MIGRATION" <<'PY'
import base64, re, sys
sql = open(sys.argv[1], encoding='utf-8').read().strip()
for part in [p.strip() for p in re.split(r'^\s*-- statement-breakpoint\s*$', sql, flags=re.M) if p.strip()]:
    print(base64.b64encode(part.encode()).decode())
PY
)
[[ "${#STATEMENT_B64[@]}" -eq 3 ]]
statement() { printf '%s' "${STATEMENT_B64[$1]}" | base64 --decode; }

# Read-only: every course's lists as stored now (draft copies of a published course, "-draft-xxxxxxxx", are left out).
echo "LEARNING_COURSE_LISTS_REPORT"
data_api --output json --sql "SELECT course.slug, course.status, list.field, item.ord::text, item.value FROM public.learning_courses course CROSS JOIN LATERAL (VALUES ('learning_outcomes', course.learning_outcomes), ('requirements', course.requirements), ('target_audience', course.target_audience)) AS list(field, items) CROSS JOIN LATERAL unnest(list.items) WITH ORDINALITY AS item(value, ord) WHERE course.slug !~ '-draft-[0-9a-f]{8}\$' ORDER BY course.slug, list.field, item.ord" \
  | jq -r '.records[]? | "COURSE_LIST_ITEM course=\(.[0].stringValue) status=\(.[1].stringValue) field=\(.[2].stringValue) n=\(.[3].stringValue) text=\(.[4].stringValue)"' \
  || echo "LEARNING_COURSE_LISTS_REPORT_UNAVAILABLE"
echo "LEARNING_COURSE_LISTS_REPORT_DONE"

if applied "$MIGRATION_NAME"; then
  echo "LEARNING_COURSE_LIST_ITEMS_ALREADY_APPLIED=true"
  exit 0
fi
echo "LEARNING_COURSE_LIST_ITEMS_PENDING $MIGRATION_NAME"

# What the repair would write: the backup step runs in a transaction that is always rolled back.
REPAIR_REPORT_SQL="SELECT course.slug, course.status, list.field, cardinality(list.before)::text, cardinality(list.after)::text, item FROM public.learning_course_list_items_backup backup JOIN public.learning_courses course ON course.id = backup.course_id CROSS JOIN LATERAL (VALUES ('learning_outcomes', backup.learning_outcomes, backup.repaired_learning_outcomes), ('requirements', backup.requirements, backup.repaired_requirements), ('target_audience', backup.target_audience, backup.repaired_target_audience)) AS list(field, before, after) CROSS JOIN LATERAL unnest(list.after) AS item WHERE NOT (item = ANY(list.before)) ORDER BY course.slug, list.field"
print_repair() {
  jq -r '.records[]? | "LIST_REPAIR course=\(.[0].stringValue) status=\(.[1].stringValue) field=\(.[2].stringValue) items=\(.[3].stringValue)->\(.[4].stringValue) item=\(.[5].stringValue)"'
}

if [[ "$ACTION" == "plan" ]]; then
  PREVIEW_TX="$(begin_transaction)"
  [[ -n "$PREVIEW_TX" ]]
  trap 'rollback_transaction "$PREVIEW_TX"' EXIT; trap 'exit 129' HUP; trap 'exit 130' INT; trap 'exit 143' TERM
  data_api --transaction-id "$PREVIEW_TX" --sql "$(statement 0)" >/dev/null
  data_api --transaction-id "$PREVIEW_TX" --sql "$(statement 1)" >/dev/null
  PREVIEW_COURSES="$(data_api --transaction-id "$PREVIEW_TX" --sql "SELECT count(*)::bigint FROM public.learning_course_list_items_backup" --output json | jq -r '.records[0][0].longValue')"
  data_api --transaction-id "$PREVIEW_TX" --output json --sql "$REPAIR_REPORT_SQL" | print_repair
  rollback_transaction "$PREVIEW_TX"
  trap - EXIT
  echo "LIST_REPAIR_PREVIEW courses=$PREVIEW_COURSES (rolled back)"
  echo "LEARNING_COURSE_LIST_ITEMS_PLAN_VERIFIED=true"
  echo "LEARNING_COURSE_LIST_ITEMS_PLAN_ONLY_NO_APPLY"
  exit 0
fi

[[ "$(bash scripts/aws/branch-head.sh refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$LEARNING_COURSE_LIST_ITEMS_EXPECTED_SHA" ]] || { echo "The feature branch has moved past the approved commit; refusing migration." >&2; exit 1; }

DIGEST="$(sha256sum "$MIGRATION" | cut -d' ' -f1)"
TX_ID="$(begin_transaction)"
[[ -n "$TX_ID" ]]
COMMITTED=false
trap '[[ "$COMMITTED" == true ]] || rollback_transaction "$TX_ID"' EXIT; trap 'exit 129' HUP; trap 'exit 130' INT; trap 'exit 143' TERM
data_api --transaction-id "$TX_ID" --sql "SELECT pg_advisory_xact_lock(hashtext('sea-n-shore-learning-course-list-items-$MIGRATION_NAME')::bigint)" >/dev/null
for index in 0 1 2; do
  data_api --transaction-id "$TX_ID" --sql "$(statement "$index")" >/dev/null
done
data_api --transaction-id "$TX_ID" --output json --sql "$REPAIR_REPORT_SQL" | print_repair
data_api --transaction-id "$TX_ID" --sql "INSERT INTO public.sea_n_shore_applied_migrations (name, sha256, git_sha) VALUES ('$MIGRATION_NAME', '$DIGEST', '$LEARNING_COURSE_LIST_ITEMS_EXPECTED_SHA') ON CONFLICT (name) DO NOTHING" >/dev/null
aws rds-data commit-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --transaction-id "$TX_ID" >/dev/null
COMMITTED=true
trap - EXIT
echo "LEARNING_COURSE_LIST_ITEMS_APPLIED $MIGRATION_NAME"

applied "$MIGRATION_NAME" || { echo "Ledger is missing $MIGRATION_NAME after apply." >&2; exit 1; }
BACKED_UP="$(read_count "SELECT count(*)::bigint FROM public.learning_course_list_items_backup")"
# Every backed-up course now holds its repaired lists (or lists its trainer saved since).
UNREPAIRED="$(read_count "SELECT count(*)::bigint FROM public.learning_course_list_items_backup backup JOIN public.learning_courses course ON course.id = backup.course_id WHERE course.learning_outcomes = backup.learning_outcomes AND course.requirements = backup.requirements AND course.target_audience = backup.target_audience")"
[[ "$UNREPAIRED" == "0" ]] || { echo "$UNREPAIRED backed-up courses still hold their split lists after apply." >&2; exit 1; }
echo "LIST_REPAIR_APPLIED courses=$BACKED_UP"
echo "LEARNING_COURSE_LIST_ITEMS_APPLY_VERIFIED=true"
