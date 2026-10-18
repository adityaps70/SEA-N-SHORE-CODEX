#!/usr/bin/env bash
# Applies the site fixes round H release 3 migrations (0089) to the staging Aurora cluster through the RDS Data API.
# Each file is split on "-- statement-breakpoint", checked against the additive-only rules (plus any statement listed
# word for word in APPROVED below), and applied in its own transaction under an advisory lock. Every file is
# idempotent; a ledger row records each applied file.
#
# A plan run previews the pending files in a transaction that is always rolled back.
# Evidence lines (the workflow reads only the last line of each path):
#   nothing pending  -> SITE_FIXES_ROUND_H_RELEASE_3_MIGRATION_ALREADY_APPLIED=true
#   plan             -> SITE_FIXES_ROUND_H_RELEASE_3_MIGRATION_PLAN_VERIFIED=true, then SITE_FIXES_ROUND_H_RELEASE_3_MIGRATION_PLAN_ONLY_NO_APPLY
#   migrate-once     -> SITE_FIXES_ROUND_H_RELEASE_3_MIGRATION_APPLY_VERIFIED=true
set -euo pipefail
umask 077
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
CLUSTER_ID="sea-n-shore-staging-aurora"
DATABASE_NAME="sea_n_shore"
ACTION_FILE="scripts/aws/site-fixes-round-h-release-3-migration-action.txt"
MIGRATIONS=(
  "infra/aws/database/migrations/0089_site_fixes_round_h_release_3.sql"
)
# Files the plan run previews in a rolled-back transaction. Leave out a file whose new enum values a later file in
# the same preview uses (Postgres refuses a new enum value inside the transaction that added it).
PREVIEW_MIGRATIONS=(
  "infra/aws/database/migrations/0089_site_fixes_round_h_release_3.sql"
)

[[ "${SITE_FIXES_ROUND_H_RELEASE_3_MIGRATION_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "SITE_FIXES_ROUND_H_RELEASE_3_MIGRATION_EXPECTED_SHA must be an exact commit SHA." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$SITE_FIXES_ROUND_H_RELEASE_3_MIGRATION_EXPECTED_SHA" ]] || { echo "Checkout is not the expected commit; refusing migration." >&2; exit 1; }
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]] || { echo "Checkout is not the Sea N Shore repository; refusing migration." >&2; exit 1; }
git diff --quiet HEAD -- "${MIGRATIONS[@]}" "$0" "$ACTION_FILE" || { echo "Migration files differ from the commit; refusing migration." >&2; exit 1; }
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]] || { echo "Unexpected AWS account; refusing migration." >&2; exit 1; }

ACTION="$(cut -d' ' -f1 < "$ACTION_FILE" | tr -d '[:space:]')"
# A manual "migrate-once" dispatch (already checked by the workflow: exact SHA + confirmation phrase)
# overrides the committed plan switch, so no execute/rearm commits are needed.
if [[ -n "${SITE_FIXES_ROUND_H_RELEASE_3_MIGRATION_ACTION:-}" ]]; then
  ACTION="$(tr -d '[:space:]' <<<"$SITE_FIXES_ROUND_H_RELEASE_3_MIGRATION_ACTION")"
fi
case "$ACTION" in
  plan|migrate-once) ;;
  *) echo "Unsupported site fixes round H release 3 migration action: $ACTION" >&2; exit 1 ;;
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
    # Round H release 3 (H7), approved by the owner in the round H brief: jobs already marked urgent start their
    # 14-day urgent window from their publish date (or creation date). Idempotent.
    "update public.jobs set urgent_since = coalesce(published_at, created_at) where urgent and urgent_since is null;",
]}
for index, statement in enumerate(parts):
    code = '\n'.join(line for line in statement.splitlines() if not line.lstrip().startswith('--')).strip()
    if not code:
        continue
    if norm(code) in ALLOWED:
        continue
    if re.search(r'\b(drop\s+(table|column|type|schema|index|function|trigger|constraint)|drop\s+not\s+null|truncate|delete\s+from|update\s+public\.|alter\s+column\s+\w+\s+type)\b', code, re.I):
        raise SystemExit(f'site fixes round H release 3 migration {path} statement {index + 1} contains forbidden destructive SQL')
    if re.search(r'\bsecurity\s+definer\b', code, re.I):
        raise SystemExit(f'site fixes round H release 3 migration {path} statement {index + 1} uses SECURITY DEFINER')
    if re.search(r'\bconcurrently\b', code, re.I):
        raise SystemExit(f'site fixes round H release 3 migration {path} statement {index + 1} is not transaction-safe')
    if not code.rstrip().endswith(';'):
        raise SystemExit(f'site fixes round H release 3 migration {path} statement {index + 1} is missing a semicolon')
print(f'SITE_FIXES_ROUND_H_RELEASE_3_MIGRATION_SQL_GUARD=ADDITIVE file={path} statements={len(parts)}')
PY
}

for migration in "${MIGRATIONS[@]}"; do
  [[ -f "$migration" ]] || { echo "Missing migration $migration" >&2; exit 1; }
  validate_sql "$migration"
  echo "SITE_FIXES_ROUND_H_RELEASE_3_MIGRATION_SHA256 $(basename "$migration")=$(sha256sum "$migration" | cut -d' ' -f1)"
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

# site fixes round H release 3 follows 0088_site_fixes_round_h_release_2_seo.
LEDGER_EXISTS="$(read_count "SELECT count(*)::bigint FROM information_schema.tables WHERE table_schema='public' AND table_name='sea_n_shore_applied_migrations'")"
[[ "$LEDGER_EXISTS" == "1" ]] || { echo "The migration ledger is missing; refusing migration." >&2; exit 1; }
already_applied() { [[ "$(read_count "SELECT count(*)::bigint FROM public.sea_n_shore_applied_migrations WHERE name='$1'")" == "1" ]]; }
already_applied 0088_site_fixes_round_h_release_2_seo || { echo "Migration 0088_site_fixes_round_h_release_2_seo is not applied yet; refusing migration." >&2; exit 1; }

PENDING=()
for migration in "${MIGRATIONS[@]}"; do
  name="$(basename "$migration" .sql)"
  if already_applied "$name"; then
    echo "SITE_FIXES_ROUND_H_RELEASE_3_MIGRATION_ALREADY_APPLIED $name"
  else
    echo "SITE_FIXES_ROUND_H_RELEASE_3_MIGRATION_PENDING $name"
    PENDING+=("$migration")
  fi
done

if [[ "${#PENDING[@]}" -eq 0 ]]; then
  echo "SITE_FIXES_ROUND_H_RELEASE_3_MIGRATION_ALREADY_APPLIED=true"
  exit 0
fi

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
  echo "SITE_FIXES_ROUND_H_RELEASE_3_MIGRATION_PREVIEW statements=${#PREVIEW_B64[@]} (rolled back)"
  echo "SITE_FIXES_ROUND_H_RELEASE_3_MIGRATION_PLAN_VERIFIED=true"
  echo "SITE_FIXES_ROUND_H_RELEASE_3_MIGRATION_PLAN_ONLY_NO_APPLY"
  exit 0
fi

[[ "$(bash scripts/aws/branch-head.sh refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$SITE_FIXES_ROUND_H_RELEASE_3_MIGRATION_EXPECTED_SHA" ]] || { echo "The feature branch has moved past the approved commit; refusing migration." >&2; exit 1; }

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

  data_api --transaction-id "$tx_id" --sql "SELECT pg_advisory_xact_lock(hashtext('sea-n-shore-site-fixes-round-h-release-3-$name')::bigint)" >/dev/null
  for encoded in "${STATEMENT_B64[@]}"; do
    SQL="$(printf '%s' "$encoded" | base64 --decode)"
    data_api --transaction-id "$tx_id" --sql "$SQL" >/dev/null
  done
  data_api --transaction-id "$tx_id" --sql "INSERT INTO public.sea_n_shore_applied_migrations (name, sha256, git_sha) VALUES ('$name', '$digest', '$SITE_FIXES_ROUND_H_RELEASE_3_MIGRATION_EXPECTED_SHA') ON CONFLICT (name) DO NOTHING" >/dev/null

  aws rds-data commit-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --transaction-id "$tx_id" >/dev/null
  committed=true
  trap - RETURN
  echo "SITE_FIXES_ROUND_H_RELEASE_3_MIGRATION_APPLIED $name"
}

for migration in "${PENDING[@]}"; do
  apply_migration_file "$migration"
done

for migration in "${MIGRATIONS[@]}"; do
  name="$(basename "$migration" .sql)"
  already_applied "$name" || { echo "Ledger is missing $name after apply." >&2; exit 1; }
done

# Round H release 3 checks after apply (schema, job counts and rank codes only; no ticket or review rows are read).
for table in site_settings support_tickets support_ticket_messages support_ticket_emails; do
  [[ "$(read_count "SELECT count(*)::bigint FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '$table'")" == "1" ]] \
    || { echo "public.$table is missing after apply." >&2; exit 1; }
done
[[ "$(read_count "SELECT count(*)::bigint FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'jobs' AND column_name = 'urgent_since'")" == "1" ]] \
  || { echo "jobs.urgent_since is missing after apply." >&2; exit 1; }
[[ "$(read_count "SELECT count(*)::bigint FROM public.jobs WHERE urgent AND urgent_since IS NULL")" == "0" ]] \
  || { echo "Some urgent jobs still have no urgent_since after apply." >&2; exit 1; }
[[ "$(read_count "SELECT count(*)::bigint FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'jobs_company_urgent_idx'")" == "1" ]] \
  || { echo "jobs_company_urgent_idx is missing after apply." >&2; exit 1; }
for column in owner_reply owner_replied_at owner_replied_by owner_reply_status; do
  [[ "$(read_count "SELECT count(*)::bigint FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'learning_course_reviews' AND column_name = '$column'")" == "1" ]] \
    || { echo "learning_course_reviews.$column is missing after apply." >&2; exit 1; }
done
[[ "$(read_count "SELECT count(*)::bigint FROM pg_constraint WHERE conrelid = 'public.learning_course_reviews'::regclass AND conname IN ('learning_course_reviews_owner_reply_check', 'learning_course_reviews_owner_reply_status_check', 'learning_course_reviews_owner_replied_at_check')")" == "3" ]] \
  || { echo "A learning_course_reviews owner reply check is missing after apply." >&2; exit 1; }
[[ "$(read_count "SELECT count(*)::bigint FROM public.maritime_ranks WHERE code IN ('operations_coordinator', 'ship_chandler', 'mooring_master', 'procurement_manager', 'business_development_manager')")" == "5" ]] \
  || { echo "A round H rank is missing from public.maritime_ranks after apply." >&2; exit 1; }
echo "H_RELEASE_3_SCHEMA_VERIFIED=true"

echo "SITE_FIXES_ROUND_H_RELEASE_3_MIGRATION_APPLY_VERIFIED=true"
