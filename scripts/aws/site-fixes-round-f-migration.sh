#!/usr/bin/env bash
# Applies the site fixes round F migrations (0081-0082) to the staging Aurora cluster through the RDS Data API.
# Each file is split on "-- statement-breakpoint", checked against the additive-only rules (plus any statement listed
# word for word in APPROVED below), and applied in its own transaction under an advisory lock. Every file is
# idempotent; a ledger row records each applied file.
#
# A plan run previews the pending files in a transaction that is always rolled back.
# Evidence lines (the workflow reads only the last line of each path):
#   nothing pending  -> SITE_FIXES_ROUND_F_MIGRATION_ALREADY_APPLIED=true
#   plan             -> SITE_FIXES_ROUND_F_MIGRATION_PLAN_VERIFIED=true, then SITE_FIXES_ROUND_F_MIGRATION_PLAN_ONLY_NO_APPLY
#   migrate-once     -> SITE_FIXES_ROUND_F_MIGRATION_APPLY_VERIFIED=true
set -euo pipefail
umask 077
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
CLUSTER_ID="sea-n-shore-staging-aurora"
DATABASE_NAME="sea_n_shore"
ACTION_FILE="scripts/aws/site-fixes-round-f-migration-action.txt"
MIGRATIONS=(
  "infra/aws/database/migrations/0081_site_fixes_round_f_types.sql"
  "infra/aws/database/migrations/0082_site_fixes_round_f.sql"
)
# Files the plan run previews in a rolled-back transaction. Leave out a file whose new enum values a later file in
# the same preview uses (Postgres refuses a new enum value inside the transaction that added it).
PREVIEW_MIGRATIONS=(
  "infra/aws/database/migrations/0082_site_fixes_round_f.sql"
)

[[ "${SITE_FIXES_ROUND_F_MIGRATION_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "SITE_FIXES_ROUND_F_MIGRATION_EXPECTED_SHA must be an exact commit SHA." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$SITE_FIXES_ROUND_F_MIGRATION_EXPECTED_SHA" ]] || { echo "Checkout is not the expected commit; refusing migration." >&2; exit 1; }
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]] || { echo "Checkout is not the Sea N Shore repository; refusing migration." >&2; exit 1; }
git diff --quiet HEAD -- "${MIGRATIONS[@]}" "$0" "$ACTION_FILE" || { echo "Migration files differ from the commit; refusing migration." >&2; exit 1; }
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]] || { echo "Unexpected AWS account; refusing migration." >&2; exit 1; }

ACTION="$(cut -d' ' -f1 < "$ACTION_FILE" | tr -d '[:space:]')"
# A manual "migrate-once" dispatch (already checked by the workflow: exact SHA + confirmation phrase)
# overrides the committed plan switch, so no execute/rearm commits are needed.
if [[ -n "${SITE_FIXES_ROUND_F_MIGRATION_ACTION:-}" ]]; then
  ACTION="$(tr -d '[:space:]' <<<"$SITE_FIXES_ROUND_F_MIGRATION_ACTION")"
fi
case "$ACTION" in
  plan|migrate-once) ;;
  *) echo "Unsupported site fixes round F migration action: $ACTION" >&2; exit 1 ;;
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
]}
for index, statement in enumerate(parts):
    code = '\n'.join(line for line in statement.splitlines() if not line.lstrip().startswith('--')).strip()
    if not code:
        continue
    if norm(code) in ALLOWED:
        continue
    if re.search(r'\b(drop\s+(table|column|type|schema|index|function|trigger|constraint)|drop\s+not\s+null|truncate|delete\s+from|update\s+public\.|alter\s+column\s+\w+\s+type)\b', code, re.I):
        raise SystemExit(f'site fixes round F migration {path} statement {index + 1} contains forbidden destructive SQL')
    if re.search(r'\bsecurity\s+definer\b', code, re.I):
        raise SystemExit(f'site fixes round F migration {path} statement {index + 1} uses SECURITY DEFINER')
    if re.search(r'\bconcurrently\b', code, re.I):
        raise SystemExit(f'site fixes round F migration {path} statement {index + 1} is not transaction-safe')
    if not code.rstrip().endswith(';'):
        raise SystemExit(f'site fixes round F migration {path} statement {index + 1} is missing a semicolon')
print(f'SITE_FIXES_ROUND_F_MIGRATION_SQL_GUARD=ADDITIVE file={path} statements={len(parts)}')
PY
}

for migration in "${MIGRATIONS[@]}"; do
  [[ -f "$migration" ]] || { echo "Missing migration $migration" >&2; exit 1; }
  validate_sql "$migration"
  echo "SITE_FIXES_ROUND_F_MIGRATION_SHA256 $(basename "$migration")=$(sha256sum "$migration" | cut -d' ' -f1)"
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

# site fixes round F follows 0080_email_delivery_events_legacy_reminders.
LEDGER_EXISTS="$(read_count "SELECT count(*)::bigint FROM information_schema.tables WHERE table_schema='public' AND table_name='sea_n_shore_applied_migrations'")"
[[ "$LEDGER_EXISTS" == "1" ]] || { echo "The migration ledger is missing; refusing migration." >&2; exit 1; }
already_applied() { [[ "$(read_count "SELECT count(*)::bigint FROM public.sea_n_shore_applied_migrations WHERE name='$1'")" == "1" ]]; }
already_applied 0080_email_delivery_events_legacy_reminders || { echo "Migration 0080_email_delivery_events_legacy_reminders is not applied yet; refusing migration." >&2; exit 1; }

# F1 diagnostic (read only, every path): why the owner's tagged-photo notification (post 8da2f93d) led to a 404.
# Flags and counts only, never names, text or member ids.
TAGGED_POST="8da2f93d-54c1-4eec-a752-c494a1895317"
TAGGED_EXISTS="$(read_count "SELECT count(*)::bigint FROM public.posts WHERE id='$TAGGED_POST'")"
TAGGED_DELETED="$(read_count "SELECT count(*)::bigint FROM public.posts WHERE id='$TAGGED_POST' AND deleted_at IS NOT NULL")"
TAGGED_PRIVATE="$(read_count "SELECT count(*)::bigint FROM public.posts p JOIN public.community_groups g ON g.id = p.group_id WHERE p.id='$TAGGED_POST' AND (g.visibility <> 'public' OR g.archived_at IS NOT NULL)")"
TAGGED_AUTHOR_INACTIVE="$(read_count "SELECT count(*)::bigint FROM public.posts p JOIN public.profiles a ON a.id = p.author_id WHERE p.id='$TAGGED_POST' AND (a.account_status <> 'active' OR a.onboarding_completed_at IS NULL)")"
TAGGED_TAGS="$(read_count "SELECT count(*)::bigint FROM public.post_photo_tags WHERE post_id='$TAGGED_POST'")"
TAGGED_NOTIFICATIONS="$(read_count "SELECT count(*)::bigint FROM public.notifications WHERE post_id='$TAGGED_POST' AND notification_type='photo_tag'")"
echo "SITE_FIXES_ROUND_F_TAGGED_POST exists=$TAGGED_EXISTS deleted=$TAGGED_DELETED private_or_archived_community=$TAGGED_PRIVATE author_inactive=$TAGGED_AUTHOR_INACTIVE photo_tags=$TAGGED_TAGS tag_notifications=$TAGGED_NOTIFICATIONS"

PENDING=()
for migration in "${MIGRATIONS[@]}"; do
  name="$(basename "$migration" .sql)"
  if already_applied "$name"; then
    echo "SITE_FIXES_ROUND_F_MIGRATION_ALREADY_APPLIED $name"
  else
    echo "SITE_FIXES_ROUND_F_MIGRATION_PENDING $name"
    PENDING+=("$migration")
  fi
done

if [[ "${#PENDING[@]}" -eq 0 ]]; then
  echo "SITE_FIXES_ROUND_F_MIGRATION_ALREADY_APPLIED=true"
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
  echo "SITE_FIXES_ROUND_F_MIGRATION_PREVIEW statements=${#PREVIEW_B64[@]} (rolled back)"
  echo "SITE_FIXES_ROUND_F_MIGRATION_PLAN_VERIFIED=true"
  echo "SITE_FIXES_ROUND_F_MIGRATION_PLAN_ONLY_NO_APPLY"
  exit 0
fi

[[ "$(bash scripts/aws/branch-head.sh refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$SITE_FIXES_ROUND_F_MIGRATION_EXPECTED_SHA" ]] || { echo "The feature branch has moved past the approved commit; refusing migration." >&2; exit 1; }

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

  data_api --transaction-id "$tx_id" --sql "SELECT pg_advisory_xact_lock(hashtext('sea-n-shore-site-fixes-round-f-$name')::bigint)" >/dev/null
  for encoded in "${STATEMENT_B64[@]}"; do
    SQL="$(printf '%s' "$encoded" | base64 --decode)"
    data_api --transaction-id "$tx_id" --sql "$SQL" >/dev/null
  done
  data_api --transaction-id "$tx_id" --sql "INSERT INTO public.sea_n_shore_applied_migrations (name, sha256, git_sha) VALUES ('$name', '$digest', '$SITE_FIXES_ROUND_F_MIGRATION_EXPECTED_SHA') ON CONFLICT (name) DO NOTHING" >/dev/null

  aws rds-data commit-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --transaction-id "$tx_id" >/dev/null
  committed=true
  trap - RETURN
  echo "SITE_FIXES_ROUND_F_MIGRATION_APPLIED $name"
}

for migration in "${PENDING[@]}"; do
  apply_migration_file "$migration"
done

for migration in "${MIGRATIONS[@]}"; do
  name="$(basename "$migration" .sql)"
  already_applied "$name" || { echo "Ledger is missing $name after apply." >&2; exit 1; }
done

# Round F checks after apply. They read schema and counts only, never member rows.
LEFT_TYPE="$(read_count "SELECT count(*)::bigint FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname='network_notification_type' AND e.enumlabel='organization_member_left'")"
[[ "$LEFT_TYPE" == "1" ]] || { echo "The organization_member_left notification type is missing after apply." >&2; exit 1; }
AUDIENCE_COLUMN="$(read_count "SELECT count(*)::bigint FROM information_schema.columns WHERE table_schema='public' AND table_name='posts' AND column_name='audience' AND is_nullable='NO' AND column_default LIKE '%members%'")"
[[ "$AUDIENCE_COLUMN" == "1" ]] || { echo "posts.audience is missing or not members-only by default after apply." >&2; exit 1; }
AUDIENCE_CHECK="$(read_count "SELECT count(*)::bigint FROM pg_constraint WHERE conname='posts_audience_check' AND conrelid='public.posts'::regclass")"
[[ "$AUDIENCE_CHECK" == "1" ]] || { echo "posts_audience_check is missing after apply." >&2; exit 1; }
PUBLIC_POSTS="$(read_count "SELECT count(*)::bigint FROM public.posts WHERE audience <> 'members'")"
[[ "$PUBLIC_POSTS" == "0" ]] || { echo "Existing posts were made visible to anyone by the apply ($PUBLIC_POSTS)." >&2; exit 1; }
echo "SITE_FIXES_ROUND_F_MIGRATION_SCHEMA notification_type=$LEFT_TYPE audience_column=$AUDIENCE_COLUMN audience_check=$AUDIENCE_CHECK public_posts=$PUBLIC_POSTS"

echo "SITE_FIXES_ROUND_F_MIGRATION_APPLY_VERIFIED=true"
