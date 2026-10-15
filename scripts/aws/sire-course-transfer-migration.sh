#!/usr/bin/env bash
# Applies the sire course transfer migrations (0086) to the staging Aurora cluster through the RDS Data API.
# Each file is split on "-- statement-breakpoint", checked against the additive-only rules (plus any statement listed
# word for word in APPROVED below), and applied in its own transaction under an advisory lock. Every file is
# idempotent; a ledger row records each applied file.
#
# A plan run previews the pending files in a transaction that is always rolled back.
# Evidence lines (the workflow reads only the last line of each path):
#   nothing pending  -> SIRE_COURSE_TRANSFER_MIGRATION_ALREADY_APPLIED=true
#   plan             -> SIRE_COURSE_TRANSFER_MIGRATION_PLAN_VERIFIED=true, then SIRE_COURSE_TRANSFER_MIGRATION_PLAN_ONLY_NO_APPLY
#   migrate-once     -> SIRE_COURSE_TRANSFER_MIGRATION_APPLY_VERIFIED=true
set -euo pipefail
umask 077
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
CLUSTER_ID="sea-n-shore-staging-aurora"
DATABASE_NAME="sea_n_shore"
ACTION_FILE="scripts/aws/sire-course-transfer-migration-action.txt"
MIGRATIONS=(
  "infra/aws/database/migrations/0086_sire_course_transfer.sql"
)
# Files the plan run previews in a rolled-back transaction. Leave out a file whose new enum values a later file in
# the same preview uses (Postgres refuses a new enum value inside the transaction that added it).
PREVIEW_MIGRATIONS=(
  "infra/aws/database/migrations/0086_sire_course_transfer.sql"
)

[[ "${SIRE_COURSE_TRANSFER_MIGRATION_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "SIRE_COURSE_TRANSFER_MIGRATION_EXPECTED_SHA must be an exact commit SHA." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$SIRE_COURSE_TRANSFER_MIGRATION_EXPECTED_SHA" ]] || { echo "Checkout is not the expected commit; refusing migration." >&2; exit 1; }
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]] || { echo "Checkout is not the Sea N Shore repository; refusing migration." >&2; exit 1; }
git diff --quiet HEAD -- "${MIGRATIONS[@]}" "$0" "$ACTION_FILE" || { echo "Migration files differ from the commit; refusing migration." >&2; exit 1; }
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]] || { echo "Unexpected AWS account; refusing migration." >&2; exit 1; }

ACTION="$(cut -d' ' -f1 < "$ACTION_FILE" | tr -d '[:space:]')"
# A manual "migrate-once" dispatch (already checked by the workflow: exact SHA + confirmation phrase)
# overrides the committed plan switch, so no execute/rearm commits are needed.
if [[ -n "${SIRE_COURSE_TRANSFER_MIGRATION_ACTION:-}" ]]; then
  ACTION="$(tr -d '[:space:]' <<<"$SIRE_COURSE_TRANSFER_MIGRATION_ACTION")"
fi
case "$ACTION" in
  plan|migrate-once) ;;
  *) echo "Unsupported sire course transfer migration action: $ACTION" >&2; exit 1 ;;
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
    # T1, approved by the owner in the T1 brief: the course and its draft copies, and this course's promo codes, move
    # to the organization.
    """update public.learning_promo_codes set company_id = '8283e58e-8fd6-4d3a-9271-a7e7abb3549f', mentor_id = null, updated_at = now() where course_id = 'f046e907-b42d-4a19-a47e-4e435ad582d2' and mentor_id is not null;""",
    """update public.learning_courses set company_id = '8283e58e-8fd6-4d3a-9271-a7e7abb3549f', mentor_id = null, updated_at = now() where (id = 'f046e907-b42d-4a19-a47e-4e435ad582d2' or revision_of_course_id = 'f046e907-b42d-4a19-a47e-4e435ad582d2') and (company_id is distinct from '8283e58e-8fd6-4d3a-9271-a7e7abb3549f' or mentor_id is not null);""",
]}
for index, statement in enumerate(parts):
    code = '\n'.join(line for line in statement.splitlines() if not line.lstrip().startswith('--')).strip()
    if not code:
        continue
    if norm(code) in ALLOWED:
        continue
    if re.search(r'\b(drop\s+(table|column|type|schema|index|function|trigger|constraint)|drop\s+not\s+null|truncate|delete\s+from|update\s+public\.|alter\s+column\s+\w+\s+type)\b', code, re.I):
        raise SystemExit(f'sire course transfer migration {path} statement {index + 1} contains forbidden destructive SQL')
    if re.search(r'\bsecurity\s+definer\b', code, re.I):
        raise SystemExit(f'sire course transfer migration {path} statement {index + 1} uses SECURITY DEFINER')
    if re.search(r'\bconcurrently\b', code, re.I):
        raise SystemExit(f'sire course transfer migration {path} statement {index + 1} is not transaction-safe')
    if not code.rstrip().endswith(';'):
        raise SystemExit(f'sire course transfer migration {path} statement {index + 1} is missing a semicolon')
print(f'SIRE_COURSE_TRANSFER_MIGRATION_SQL_GUARD=ADDITIVE file={path} statements={len(parts)}')
PY
}

for migration in "${MIGRATIONS[@]}"; do
  [[ -f "$migration" ]] || { echo "Missing migration $migration" >&2; exit 1; }
  validate_sql "$migration"
  echo "SIRE_COURSE_TRANSFER_MIGRATION_SHA256 $(basename "$migration")=$(sha256sum "$migration" | cut -d' ' -f1)"
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

# sire course transfer follows 0085_algorithms_round_g_release_2.
LEDGER_EXISTS="$(read_count "SELECT count(*)::bigint FROM information_schema.tables WHERE table_schema='public' AND table_name='sea_n_shore_applied_migrations'")"
[[ "$LEDGER_EXISTS" == "1" ]] || { echo "The migration ledger is missing; refusing migration." >&2; exit 1; }
already_applied() { [[ "$(read_count "SELECT count(*)::bigint FROM public.sea_n_shore_applied_migrations WHERE name='$1'")" == "1" ]]; }
already_applied 0085_algorithms_round_g_release_2 || { echo "Migration 0085_algorithms_round_g_release_2 is not applied yet; refusing migration." >&2; exit 1; }

PENDING=()
for migration in "${MIGRATIONS[@]}"; do
  name="$(basename "$migration" .sql)"
  if already_applied "$name"; then
    echo "SIRE_COURSE_TRANSFER_MIGRATION_ALREADY_APPLIED $name"
  else
    echo "SIRE_COURSE_TRANSFER_MIGRATION_PENDING $name"
    PENDING+=("$migration")
  fi
done

if [[ "${#PENDING[@]}" -eq 0 ]]; then
  echo "SIRE_COURSE_TRANSFER_MIGRATION_ALREADY_APPLIED=true"
  exit 0
fi

read_text() { data_api --sql "$1" --output json | jq -r '.records[0][0].stringValue // ""'; }

# T1: the course, its draft copies and the organization. Reports print ids, counts and yes/no values only, never a
# member's name or email.
T1_LIVE="f046e907-b42d-4a19-a47e-4e435ad582d2"
T1_ORG="8283e58e-8fd6-4d3a-9271-a7e7abb3549f"
T1_ORDERS="SELECT o.id::text FROM public.course_payment_orders o WHERE o.course_id = '$T1_LIVE'"
T1_ENROLMENTS="SELECT e.id FROM public.learning_enrollments e WHERE e.course_id = '$T1_LIVE'"
t1_course_rows() {
  read_text "SELECT coalesce(string_agg(c.id::text || ':' || CASE WHEN c.revision_of_course_id IS NULL THEN 'live' WHEN c.revision_closed_at IS NULL THEN 'open_draft' ELSE 'closed_draft' END || ':' || c.status::text || ':' || CASE WHEN c.company_id = '$T1_ORG' AND c.mentor_id IS NULL THEN 'organization' WHEN c.company_id IS NULL THEN 'personal' WHEN c.company_id = '$T1_ORG' THEN 'organization_and_trainer' ELSE 'other_organization' END, ' ' ORDER BY c.created_at, c.id), 'none') FROM public.learning_courses c WHERE c.id = '$T1_LIVE' OR c.revision_of_course_id = '$T1_LIVE'"
}
t1_counts() {
  read_text "SELECT concat_ws(' ',
    'enrolments=' || (SELECT count(*) FROM public.learning_enrollments WHERE course_id = '$T1_LIVE'),
    'enrolments_completed=' || (SELECT count(*) FROM public.learning_enrollments WHERE course_id = '$T1_LIVE' AND completed_at IS NOT NULL),
    'progress_rows=' || (SELECT count(*) FROM public.learning_progress WHERE enrollment_id IN ($T1_ENROLMENTS)),
    'paid_orders=' || (SELECT count(*) FROM public.course_payment_orders WHERE course_id = '$T1_LIVE' AND status = 'paid'),
    'refunded_orders=' || (SELECT count(*) FROM public.course_payment_orders WHERE course_id = '$T1_LIVE' AND status = 'refunded'),
    'certificates=' || (SELECT count(*) FROM public.learning_certificates WHERE course_id = '$T1_LIVE'),
    'quiz_attempts=' || (SELECT count(*) FROM public.learning_quiz_attempts WHERE enrollment_id IN ($T1_ENROLMENTS)),
    'scorm_attempts=' || (SELECT count(*) FROM public.learning_scorm_attempts WHERE enrollment_id IN ($T1_ENROLMENTS)),
    'assignment_attempts=' || (SELECT count(*) FROM public.learning_assignment_attempts WHERE enrollment_id IN ($T1_ENROLMENTS)),
    'reviews=' || (SELECT count(*) FROM public.learning_course_reviews WHERE course_id = '$T1_LIVE'),
    'announcements=' || (SELECT count(*) FROM public.learning_course_announcements WHERE course_id = '$T1_LIVE'),
    'training_seats=' || (SELECT count(*) FROM public.company_training_seats WHERE course_id = '$T1_LIVE'),
    'earnings_personal_seller=' || (SELECT count(*) FROM public.seller_earnings WHERE source_id IN ($T1_ORDERS) AND seller_profile_id IS NOT NULL),
    'earnings_organization_seller=' || (SELECT count(*) FROM public.seller_earnings WHERE source_id IN ($T1_ORDERS) AND seller_company_id IS NOT NULL))"
}
t1_report() {
  local label="$1"
  echo "T1_${label}_COURSE_ROWS $(t1_course_rows)"
  echo "T1_${label}_COUNTS $(t1_counts)"
}
t1_dry_run() {
  t1_report BEFORE
  echo "T1_ORGANIZATION $(read_text "SELECT concat_ws(' ',
    'exists=' || (SELECT count(*) FROM public.companies WHERE id = '$T1_ORG'),
    'slug_matches=' || (SELECT count(*) FROM public.companies WHERE id = '$T1_ORG' AND slug = 'beaufort-marine-services-llp-eddf5d86'),
    'claimed=' || (SELECT count(*) FROM public.companies WHERE id = '$T1_ORG' AND claim_status = 'claimed'),
    'verified=' || (SELECT count(*) FROM public.companies WHERE id = '$T1_ORG' AND is_verified),
    'plan_with_course_publish=' || (SELECT count(*) FROM public.account_subscriptions s JOIN public.plan_entitlements pe ON pe.plan_code = s.plan_code AND pe.capability = 'course.publish' WHERE s.company_id = '$T1_ORG' AND s.status IN ('trialing', 'active', 'past_due') AND (s.current_period_ends_at IS NULL OR s.current_period_ends_at > now())),
    'course_publish_grants=' || (SELECT count(*) FROM public.entitlement_grants g WHERE g.company_id = '$T1_ORG' AND g.capability = 'course.publish' AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > now())),
    'active_payout_accounts=' || (SELECT count(*) FROM public.payout_accounts WHERE seller_company_id = '$T1_ORG' AND status = 'active'),
    'payout_tax_profiles=' || (SELECT count(*) FROM public.payout_tax_profiles WHERE seller_company_id = '$T1_ORG'),
    'trainer_role=' || coalesce((SELECT string_agg(cm.role::text, ',') FROM public.learning_courses c JOIN public.learning_mentors m ON m.id = c.mentor_id JOIN public.company_members cm ON cm.user_id = m.user_id AND cm.company_id = '$T1_ORG' AND cm.approved_at IS NOT NULL WHERE c.id = '$T1_LIVE'), 'none'))")"
  echo "T1_PROMO_CODES $(read_text "SELECT concat_ws(' ',
    'to_move=' || (SELECT count(*) FROM public.learning_promo_codes WHERE course_id = '$T1_LIVE' AND mentor_id IS NOT NULL),
    'code_clashes=' || (SELECT count(*) FROM public.learning_promo_codes moving JOIN public.learning_promo_codes existing ON existing.company_id = '$T1_ORG' AND existing.code = moving.code WHERE moving.course_id = '$T1_LIVE' AND moving.mentor_id IS NOT NULL),
    'trainer_codes_for_all_courses=' || (SELECT count(*) FROM public.learning_promo_codes p JOIN public.learning_courses c ON c.mentor_id = p.mentor_id WHERE c.id = '$T1_LIVE' AND p.course_id IS NULL))")"
  echo "T1_COURSE_SETTINGS $(read_text "SELECT concat_ws(' ',
    'certificate_signatory_set=' || (certificate_signatory_name IS NOT NULL),
    'certificate_logo_set=' || (certificate_logo_path IS NOT NULL),
    'certificate_signature_set=' || (certificate_signature_path IS NOT NULL),
    'hidden_for_plan=' || (hidden_for_plan_at IS NOT NULL),
    'community_linked=' || (community_group_id IS NOT NULL),
    'open_orders=' || (SELECT count(*) FROM public.course_payment_orders WHERE course_id = '$T1_LIVE' AND status = 'created')) FROM public.learning_courses WHERE id = '$T1_LIVE'")"
}

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
  # The dry run: what will change (ids, counts and yes/no values only).
  t1_dry_run
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
  echo "SIRE_COURSE_TRANSFER_MIGRATION_PREVIEW statements=${#PREVIEW_B64[@]} (rolled back)"
  echo "SIRE_COURSE_TRANSFER_MIGRATION_PLAN_VERIFIED=true"
  echo "SIRE_COURSE_TRANSFER_MIGRATION_PLAN_ONLY_NO_APPLY"
  exit 0
fi

[[ "$(bash scripts/aws/branch-head.sh refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$SIRE_COURSE_TRANSFER_MIGRATION_EXPECTED_SHA" ]] || { echo "The feature branch has moved past the approved commit; refusing migration." >&2; exit 1; }

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

  data_api --transaction-id "$tx_id" --sql "SELECT pg_advisory_xact_lock(hashtext('sea-n-shore-sire-course-transfer-$name')::bigint)" >/dev/null
  for encoded in "${STATEMENT_B64[@]}"; do
    SQL="$(printf '%s' "$encoded" | base64 --decode)"
    data_api --transaction-id "$tx_id" --sql "$SQL" >/dev/null
  done
  data_api --transaction-id "$tx_id" --sql "INSERT INTO public.sea_n_shore_applied_migrations (name, sha256, git_sha) VALUES ('$name', '$digest', '$SIRE_COURSE_TRANSFER_MIGRATION_EXPECTED_SHA') ON CONFLICT (name) DO NOTHING" >/dev/null

  aws rds-data commit-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --transaction-id "$tx_id" >/dev/null
  committed=true
  trap - RETURN
  echo "SIRE_COURSE_TRANSFER_MIGRATION_APPLIED $name"
}

t1_dry_run
T1_COUNTS_BEFORE="$(t1_counts)"
for migration in "${PENDING[@]}"; do
  apply_migration_file "$migration"
done

for migration in "${MIGRATIONS[@]}"; do
  name="$(basename "$migration" .sql)"
  already_applied "$name" || { echo "Ledger is missing $name after apply." >&2; exit 1; }
done

# T1 checks after apply. Each exits non-zero with its reason.
t1_report AFTER
T1_LIVE_EXISTS="$(read_count "SELECT count(*)::bigint FROM public.learning_courses WHERE id = '$T1_LIVE'")"
if [[ "$T1_LIVE_EXISTS" == "1" ]]; then
  [[ "$(read_count "SELECT count(*)::bigint FROM public.learning_courses WHERE (id = '$T1_LIVE' OR revision_of_course_id = '$T1_LIVE') AND (company_id IS DISTINCT FROM '$T1_ORG' OR mentor_id IS NOT NULL)")" == "0" ]] || { echo "T1: a course row still has the old publisher after apply." >&2; exit 1; }
  [[ "$(read_count "SELECT count(*)::bigint FROM public.learning_promo_codes WHERE course_id = '$T1_LIVE' AND mentor_id IS NOT NULL")" == "0" ]] || { echo "T1: a promo code of the course is still the trainer's after apply." >&2; exit 1; }
  [[ "$(read_count "SELECT count(*)::bigint FROM public.audit_events WHERE action = 'learning.course.publisher_transferred' AND target_id = '$T1_LIVE'")" -ge 1 ]] || { echo "T1: the audit backup row is missing after apply." >&2; exit 1; }
  [[ "$(read_count "SELECT count(*)::bigint FROM public.search_documents WHERE kind = 'course' AND entity_id = '$T1_LIVE' AND org_id IS DISTINCT FROM '$T1_ORG'")" == "0" ]] || { echo "T1: the search entry still lists the old publisher after apply." >&2; exit 1; }
  [[ "$(t1_counts)" == "$T1_COUNTS_BEFORE" ]] || { echo "T1: learner, order or certificate counts changed during apply." >&2; exit 1; }
  echo "T1_TRANSFER_VERIFIED=true"
fi

echo "SIRE_COURSE_TRANSFER_MIGRATION_APPLY_VERIFIED=true"
