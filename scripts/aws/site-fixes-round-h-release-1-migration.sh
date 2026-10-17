#!/usr/bin/env bash
# Applies the site fixes round H release 1 migrations (0087) to the staging Aurora cluster through the RDS Data API.
# Each file is split on "-- statement-breakpoint", checked against the additive-only rules (plus any statement listed
# word for word in APPROVED below), and applied in its own transaction under an advisory lock. Every file is
# idempotent; a ledger row records each applied file.
#
# A plan run previews the pending files in a transaction that is always rolled back.
# Evidence lines (the workflow reads only the last line of each path):
#   nothing pending  -> SITE_FIXES_ROUND_H_RELEASE_1_MIGRATION_ALREADY_APPLIED=true
#   plan             -> SITE_FIXES_ROUND_H_RELEASE_1_MIGRATION_PLAN_VERIFIED=true, then SITE_FIXES_ROUND_H_RELEASE_1_MIGRATION_PLAN_ONLY_NO_APPLY
#   migrate-once     -> SITE_FIXES_ROUND_H_RELEASE_1_MIGRATION_APPLY_VERIFIED=true
set -euo pipefail
umask 077
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
CLUSTER_ID="sea-n-shore-staging-aurora"
DATABASE_NAME="sea_n_shore"
ACTION_FILE="scripts/aws/site-fixes-round-h-release-1-migration-action.txt"
MIGRATIONS=(
  "infra/aws/database/migrations/0087_site_fixes_round_h_release_1.sql"
)
# Files the plan run previews in a rolled-back transaction. Leave out a file whose new enum values a later file in
# the same preview uses (Postgres refuses a new enum value inside the transaction that added it).
PREVIEW_MIGRATIONS=(
  "infra/aws/database/migrations/0087_site_fixes_round_h_release_1.sql"
)

[[ "${SITE_FIXES_ROUND_H_RELEASE_1_MIGRATION_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "SITE_FIXES_ROUND_H_RELEASE_1_MIGRATION_EXPECTED_SHA must be an exact commit SHA." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$SITE_FIXES_ROUND_H_RELEASE_1_MIGRATION_EXPECTED_SHA" ]] || { echo "Checkout is not the expected commit; refusing migration." >&2; exit 1; }
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]] || { echo "Checkout is not the Sea N Shore repository; refusing migration." >&2; exit 1; }
git diff --quiet HEAD -- "${MIGRATIONS[@]}" "$0" "$ACTION_FILE" || { echo "Migration files differ from the commit; refusing migration." >&2; exit 1; }
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]] || { echo "Unexpected AWS account; refusing migration." >&2; exit 1; }

ACTION="$(cut -d' ' -f1 < "$ACTION_FILE" | tr -d '[:space:]')"
# A manual "migrate-once" dispatch (already checked by the workflow: exact SHA + confirmation phrase)
# overrides the committed plan switch, so no execute/rearm commits are needed.
if [[ -n "${SITE_FIXES_ROUND_H_RELEASE_1_MIGRATION_ACTION:-}" ]]; then
  ACTION="$(tr -d '[:space:]' <<<"$SITE_FIXES_ROUND_H_RELEASE_1_MIGRATION_ACTION")"
fi
case "$ACTION" in
  plan|migrate-once) ;;
  *) echo "Unsupported site fixes round H release 1 migration action: $ACTION" >&2; exit 1 ;;
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
# The only statements allowed to relax a rule or rewrite rows, word for word. Each needs the owner's approval and
# the same entry in the contract test's APPROVED list.
ALLOWED = {norm(s) for s in [
    # Round H release 1, approved by the owner in the round H brief (H2 self-issued certificates, H9 clean-up).
    """update public.learning_certificates certificate set issuer_relation = 'self_issued' from public.learning_courses course where course.id = certificate.course_id and certificate.issuer_relation = 'independent' and (exists (select 1 from public.learning_mentors own_mentor where own_mentor.id = course.mentor_id and own_mentor.user_id = certificate.learner_id) or exists (select 1 from public.company_members own_team where own_team.company_id = course.company_id and own_team.user_id = certificate.learner_id and own_team.approved_at is not null));""",
    """update public.learning_certificates certificate set hidden_from_profile = true from public.learning_courses course where course.id = certificate.course_id and lower(course.title) = 'iktyujdhrgsefawd' and certificate.hidden_from_profile = false;""",
    """update public.learning_courses set status = 'archived', removed_at = now(), updated_at = now() where removed_at is null and (lower(title) = 'iktyujdhrgsefawd' or revision_of_course_id in (select live.id from public.learning_courses live where lower(live.title) = 'iktyujdhrgsefawd'));""",
    """update public.events set removed_at = now(), updated_at = now() where lower(title) like 'sea n shore portal%brainstorming%market%' and status = 'cancelled' and removed_at is null;""",
]}
for index, statement in enumerate(parts):
    code = '\n'.join(line for line in statement.splitlines() if not line.lstrip().startswith('--')).strip()
    if not code:
        continue
    if norm(code) in ALLOWED:
        continue
    if re.search(r'\b(drop\s+(table|column|type|schema|index|function|trigger|constraint)|drop\s+not\s+null|truncate|delete\s+from|update\s+public\.|alter\s+column\s+\w+\s+type)\b', code, re.I):
        raise SystemExit(f'site fixes round H release 1 migration {path} statement {index + 1} contains forbidden destructive SQL')
    if re.search(r'\bsecurity\s+definer\b', code, re.I):
        raise SystemExit(f'site fixes round H release 1 migration {path} statement {index + 1} uses SECURITY DEFINER')
    if re.search(r'\bconcurrently\b', code, re.I):
        raise SystemExit(f'site fixes round H release 1 migration {path} statement {index + 1} is not transaction-safe')
    if not code.rstrip().endswith(';'):
        raise SystemExit(f'site fixes round H release 1 migration {path} statement {index + 1} is missing a semicolon')
print(f'SITE_FIXES_ROUND_H_RELEASE_1_MIGRATION_SQL_GUARD=ADDITIVE file={path} statements={len(parts)}')
PY
}

for migration in "${MIGRATIONS[@]}"; do
  [[ -f "$migration" ]] || { echo "Missing migration $migration" >&2; exit 1; }
  validate_sql "$migration"
  echo "SITE_FIXES_ROUND_H_RELEASE_1_MIGRATION_SHA256 $(basename "$migration")=$(sha256sum "$migration" | cut -d' ' -f1)"
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
read_text() { data_api --sql "$1" --output json | jq -r '.records[0][0].stringValue // ""'; }
read_rows() { data_api --sql "$1" --output json | jq -r '[.records[]? | map(.stringValue // (if .longValue == null then "" else (.longValue | tostring) end)) | join(":")] | join(" ")'; }

# Round H release 1: what the data step will change, and other likely test records for the owner to confirm.
# Ids, statuses and counts only: never a title, name or email.
SELF_ISSUED_PREDICATE="(EXISTS (SELECT 1 FROM public.learning_mentors own_mentor WHERE own_mentor.id = course.mentor_id AND own_mentor.user_id = certificate.learner_id) OR EXISTS (SELECT 1 FROM public.company_members own_team WHERE own_team.company_id = course.company_id AND own_team.user_id = certificate.learner_id AND own_team.approved_at IS NOT NULL))"
TEST_COURSE="lower(title) = 'iktyujdhrgsefawd'"
INTERNAL_EVENT="lower(title) LIKE 'sea n shore portal%brainstorming%market%'"
# Keyboard-mash or test-looking titles: one lower-case word of 10+ letters, or a test word on its own.
TEST_LOOKING="(title ~ '^[a-z]{10,}$' OR title ~* '(^|[^a-z])(test|testing|dummy|sample|asdf|qwerty|lorem|demo)([^a-z]|$)')"

h_dry_run() {
  echo "H_SELF_ISSUED_CERTIFICATES $(read_rows "SELECT certificate.id::text FROM public.learning_certificates certificate JOIN public.learning_courses course ON course.id = certificate.course_id WHERE $SELF_ISSUED_PREDICATE ORDER BY certificate.id")"
  echo "H_TEST_COURSES $(read_rows "SELECT id::text, status, (removed_at IS NOT NULL)::text FROM public.learning_courses WHERE $TEST_COURSE OR revision_of_course_id IN (SELECT id FROM public.learning_courses WHERE $TEST_COURSE) ORDER BY id")"
  echo "H_TEST_COURSE_CERTIFICATES count=$(read_count "SELECT count(*)::bigint FROM public.learning_certificates certificate JOIN public.learning_courses course ON course.id = certificate.course_id WHERE lower(course.title) = 'iktyujdhrgsefawd'") visible_on_profile=$(read_count "SELECT count(*)::bigint FROM public.learning_certificates certificate JOIN public.learning_courses course ON course.id = certificate.course_id WHERE lower(course.title) = 'iktyujdhrgsefawd' AND NOT certificate.hidden_from_profile")"
  echo "H_INTERNAL_EVENTS $(read_rows "SELECT id::text, status, (removed_at IS NOT NULL)::text FROM public.events WHERE $INTERNAL_EVENT ORDER BY id")"
  echo "H_CANDIDATE_TEST_COURSES $(read_rows "SELECT id::text, status FROM public.learning_courses WHERE removed_at IS NULL AND revision_of_course_id IS NULL AND $TEST_LOOKING AND NOT ($TEST_COURSE) ORDER BY id")"
  echo "H_CANDIDATE_TEST_EVENTS $(read_rows "SELECT id::text, status FROM public.events WHERE removed_at IS NULL AND $TEST_LOOKING AND NOT ($INTERNAL_EVENT) ORDER BY id")"
  echo "H_CANDIDATE_TEST_JOBS $(read_rows "SELECT id::text, status::text FROM public.jobs WHERE deleted_at IS NULL AND $TEST_LOOKING ORDER BY id")"
  echo "H_CANDIDATE_TEST_COMMUNITIES $(read_rows "SELECT id::text FROM public.community_groups WHERE $(sed 's/title/name/g' <<<"$TEST_LOOKING") ORDER BY id")"
  echo "H_CANDIDATE_TEST_ORGANIZATIONS $(read_rows "SELECT id::text FROM public.companies WHERE $(sed 's/title/name/g' <<<"$TEST_LOOKING") ORDER BY id")"
}
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

# site fixes round H release 1 follows 0086_sire_course_transfer.
LEDGER_EXISTS="$(read_count "SELECT count(*)::bigint FROM information_schema.tables WHERE table_schema='public' AND table_name='sea_n_shore_applied_migrations'")"
[[ "$LEDGER_EXISTS" == "1" ]] || { echo "The migration ledger is missing; refusing migration." >&2; exit 1; }
already_applied() { [[ "$(read_count "SELECT count(*)::bigint FROM public.sea_n_shore_applied_migrations WHERE name='$1'")" == "1" ]]; }
already_applied 0086_sire_course_transfer || { echo "Migration 0086_sire_course_transfer is not applied yet; refusing migration." >&2; exit 1; }

PENDING=()
for migration in "${MIGRATIONS[@]}"; do
  name="$(basename "$migration" .sql)"
  if already_applied "$name"; then
    echo "SITE_FIXES_ROUND_H_RELEASE_1_MIGRATION_ALREADY_APPLIED $name"
  else
    echo "SITE_FIXES_ROUND_H_RELEASE_1_MIGRATION_PENDING $name"
    PENDING+=("$migration")
  fi
done

if [[ "${#PENDING[@]}" -eq 0 ]]; then
  echo "SITE_FIXES_ROUND_H_RELEASE_1_MIGRATION_ALREADY_APPLIED=true"
  exit 0
fi

h_dry_run

if [[ "$ACTION" == "plan" ]]; then
  # Preview the pending files against the real schema in a transaction that is always rolled back.
  PREVIEW_B64=()
  for migration in "${PENDING[@]}"; do
    for preview in "${PREVIEW_MIGRATIONS[@]}"; do
      [[ "$migration" == "$preview" ]] || continue
      mapfile -t FILE_B64 < <(statements_b64 "$migration")
      PREVIEW_B64+=("${FILE_B64[@]}")
    done
  done
  if [[ "${#PREVIEW_B64[@]}" -ge 1 ]]; then
    PREVIEW_TX="$(begin_transaction)"
    [[ -n "$PREVIEW_TX" ]]
    trap 'rollback_transaction "$PREVIEW_TX"' EXIT; trap 'exit 129' HUP; trap 'exit 130' INT; trap 'exit 143' TERM
    for encoded in "${PREVIEW_B64[@]}"; do
      data_api --transaction-id "$PREVIEW_TX" --sql "$(printf '%s' "$encoded" | base64 --decode)" >/dev/null
    done
    rollback_transaction "$PREVIEW_TX"
    trap - EXIT
  fi
  echo "SITE_FIXES_ROUND_H_RELEASE_1_MIGRATION_PREVIEW statements=${#PREVIEW_B64[@]} (rolled back)"
  echo "SITE_FIXES_ROUND_H_RELEASE_1_MIGRATION_PLAN_VERIFIED=true"
  echo "SITE_FIXES_ROUND_H_RELEASE_1_MIGRATION_PLAN_ONLY_NO_APPLY"
  exit 0
fi

[[ "$(bash scripts/aws/branch-head.sh refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$SITE_FIXES_ROUND_H_RELEASE_1_MIGRATION_EXPECTED_SHA" ]] || { echo "The feature branch has moved past the approved commit; refusing migration." >&2; exit 1; }

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

  data_api --transaction-id "$tx_id" --sql "SELECT pg_advisory_xact_lock(hashtext('sea-n-shore-site-fixes-round-h-release-1-$name')::bigint)" >/dev/null
  for encoded in "${STATEMENT_B64[@]}"; do
    SQL="$(printf '%s' "$encoded" | base64 --decode)"
    data_api --transaction-id "$tx_id" --sql "$SQL" >/dev/null
  done
  data_api --transaction-id "$tx_id" --sql "INSERT INTO public.sea_n_shore_applied_migrations (name, sha256, git_sha) VALUES ('$name', '$digest', '$SITE_FIXES_ROUND_H_RELEASE_1_MIGRATION_EXPECTED_SHA') ON CONFLICT (name) DO NOTHING" >/dev/null

  aws rds-data commit-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --transaction-id "$tx_id" >/dev/null
  committed=true
  trap - RETURN
  echo "SITE_FIXES_ROUND_H_RELEASE_1_MIGRATION_APPLIED $name"
}

for migration in "${PENDING[@]}"; do
  apply_migration_file "$migration"
done

for migration in "${MIGRATIONS[@]}"; do
  name="$(basename "$migration" .sql)"
  already_applied "$name" || { echo "Ledger is missing $name after apply." >&2; exit 1; }
done

# Round H release 1 checks after apply. Ids and counts only.
[[ "$(read_count "SELECT count(*)::bigint FROM information_schema.columns WHERE table_schema = 'public' AND ((table_name = 'learning_certificates' AND column_name = 'issuer_relation') OR (table_name = 'member_preferences' AND column_name IN ('message_permission', 'connections_visibility')))")" == "3" ]] \
  || { echo "The round H columns are missing after apply." >&2; exit 1; }
[[ "$(read_count "SELECT count(*)::bigint FROM public.learning_certificates certificate JOIN public.learning_courses course ON course.id = certificate.course_id WHERE certificate.issuer_relation = 'independent' AND $SELF_ISSUED_PREDICATE")" == "0" ]] \
  || { echo "A certificate of the course's own mentor or team is still marked independent." >&2; exit 1; }
[[ "$(read_count "SELECT count(*)::bigint FROM public.learning_courses WHERE removed_at IS NULL AND ($TEST_COURSE OR revision_of_course_id IN (SELECT id FROM public.learning_courses WHERE $TEST_COURSE))")" == "0" ]] \
  || { echo "The test course is still listed after apply." >&2; exit 1; }
[[ "$(read_count "SELECT count(*)::bigint FROM public.events WHERE $INTERNAL_EVENT AND status = 'cancelled' AND removed_at IS NULL")" == "0" ]] \
  || { echo "The cancelled internal event is still listed after apply." >&2; exit 1; }
[[ "$(read_count "SELECT count(*)::bigint FROM public.audit_events WHERE action = 'site_fixes.round_h.release_1'")" -le "1" ]] \
  || { echo "More than one round H audit row." >&2; exit 1; }
echo "H_AFTER_SELF_ISSUED_CERTIFICATES count=$(read_count "SELECT count(*)::bigint FROM public.learning_certificates WHERE issuer_relation = 'self_issued'")"
echo "H_AFTER_AUDIT_ROWS count=$(read_count "SELECT count(*)::bigint FROM public.audit_events WHERE action = 'site_fixes.round_h.release_1'")"
echo "H_RELEASE_1_DATA_VERIFIED=true"

echo "SITE_FIXES_ROUND_H_RELEASE_1_MIGRATION_APPLY_VERIFIED=true"
