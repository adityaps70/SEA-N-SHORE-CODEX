#!/usr/bin/env bash
# Applies the algorithms round G release 1 migrations (0083) to the staging Aurora cluster through the RDS Data API.
# Each file is split on "-- statement-breakpoint", checked against the additive-only rules (plus any statement listed
# word for word in APPROVED below), and applied in its own transaction under an advisory lock. Every file is
# idempotent; a ledger row records each applied file.
#
# A plan run previews the pending files in a transaction that is always rolled back.
# Evidence lines (the workflow reads only the last line of each path):
#   nothing pending  -> ROUND_G_RELEASE_1_MIGRATION_ALREADY_APPLIED=true
#   plan             -> ROUND_G_RELEASE_1_MIGRATION_PLAN_VERIFIED=true, then ROUND_G_RELEASE_1_MIGRATION_PLAN_ONLY_NO_APPLY
#   migrate-once     -> ROUND_G_RELEASE_1_MIGRATION_APPLY_VERIFIED=true
set -euo pipefail
umask 077
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
CLUSTER_ID="sea-n-shore-staging-aurora"
DATABASE_NAME="sea_n_shore"
ACTION_FILE="scripts/aws/round-g-release-1-migration-action.txt"
MIGRATIONS=(
  "infra/aws/database/migrations/0083_algorithms_round_g.sql"
)
# Files the plan run previews in a rolled-back transaction. Leave out a file whose new enum values a later file in
# the same preview uses (Postgres refuses a new enum value inside the transaction that added it).
PREVIEW_MIGRATIONS=(
  "infra/aws/database/migrations/0083_algorithms_round_g.sql"
)

[[ "${ROUND_G_RELEASE_1_MIGRATION_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "ROUND_G_RELEASE_1_MIGRATION_EXPECTED_SHA must be an exact commit SHA." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$ROUND_G_RELEASE_1_MIGRATION_EXPECTED_SHA" ]] || { echo "Checkout is not the expected commit; refusing migration." >&2; exit 1; }
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]] || { echo "Checkout is not the Sea N Shore repository; refusing migration." >&2; exit 1; }
git diff --quiet HEAD -- "${MIGRATIONS[@]}" "$0" "$ACTION_FILE" || { echo "Migration files differ from the commit; refusing migration." >&2; exit 1; }
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]] || { echo "Unexpected AWS account; refusing migration." >&2; exit 1; }

ACTION="$(cut -d' ' -f1 < "$ACTION_FILE" | tr -d '[:space:]')"
# A manual "migrate-once" dispatch (already checked by the workflow: exact SHA + confirmation phrase)
# overrides the committed plan switch, so no execute/rearm commits are needed.
if [[ -n "${ROUND_G_RELEASE_1_MIGRATION_ACTION:-}" ]]; then
  ACTION="$(tr -d '[:space:]' <<<"$ROUND_G_RELEASE_1_MIGRATION_ACTION")"
fi
case "$ACTION" in
  plan|migrate-once) ;;
  *) echo "Unsupported algorithms round G release 1 migration action: $ACTION" >&2; exit 1 ;;
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
        raise SystemExit(f'algorithms round G release 1 migration {path} statement {index + 1} contains forbidden destructive SQL')
    if re.search(r'\bsecurity\s+definer\b', code, re.I):
        raise SystemExit(f'algorithms round G release 1 migration {path} statement {index + 1} uses SECURITY DEFINER')
    if re.search(r'\bconcurrently\b', code, re.I):
        raise SystemExit(f'algorithms round G release 1 migration {path} statement {index + 1} is not transaction-safe')
    if not code.rstrip().endswith(';'):
        raise SystemExit(f'algorithms round G release 1 migration {path} statement {index + 1} is missing a semicolon')
print(f'ROUND_G_RELEASE_1_MIGRATION_SQL_GUARD=ADDITIVE file={path} statements={len(parts)}')
PY
}

for migration in "${MIGRATIONS[@]}"; do
  [[ -f "$migration" ]] || { echo "Missing migration $migration" >&2; exit 1; }
  validate_sql "$migration"
  echo "ROUND_G_RELEASE_1_MIGRATION_SHA256 $(basename "$migration")=$(sha256sum "$migration" | cut -d' ' -f1)"
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

# algorithms round G release 1 follows 0082_site_fixes_round_f.
LEDGER_EXISTS="$(read_count "SELECT count(*)::bigint FROM information_schema.tables WHERE table_schema='public' AND table_name='sea_n_shore_applied_migrations'")"
[[ "$LEDGER_EXISTS" == "1" ]] || { echo "The migration ledger is missing; refusing migration." >&2; exit 1; }
already_applied() { [[ "$(read_count "SELECT count(*)::bigint FROM public.sea_n_shore_applied_migrations WHERE name='$1'")" == "1" ]]; }
already_applied 0082_site_fixes_round_f || { echo "Migration 0082_site_fixes_round_f is not applied yet; refusing migration." >&2; exit 1; }

# Round G sizing (read only, every path): counts only, never names, ids or text.
SIZING_MEMBERS="$(read_count "SELECT count(*)::bigint FROM public.profiles WHERE account_status='active' AND onboarding_completed_at IS NOT NULL")"
SIZING_POSTS="$(read_count "SELECT count(*)::bigint FROM public.posts WHERE deleted_at IS NULL")"
SIZING_POSTS_30D="$(read_count "SELECT count(*)::bigint FROM public.posts WHERE deleted_at IS NULL AND created_at > now() - interval '30 days'")"
SIZING_JOBS="$(read_count "SELECT count(*)::bigint FROM public.jobs WHERE deleted_at IS NULL")"
SIZING_OPEN_JOBS="$(read_count "SELECT count(*)::bigint FROM public.jobs WHERE deleted_at IS NULL AND status::text='published' AND (apply_until IS NULL OR apply_until >= current_date)")"
SIZING_CONNECTIONS="$(read_count "SELECT count(*)::bigint FROM public.connections WHERE status='accepted'")"
SIZING_REACTIONS="$(read_count "SELECT count(*)::bigint FROM public.post_reactions")"
SIZING_COMMENTS="$(read_count "SELECT count(*)::bigint FROM public.post_comments WHERE deleted_at IS NULL")"
echo "ROUND_G_SIZING members=$SIZING_MEMBERS posts=$SIZING_POSTS posts_30d=$SIZING_POSTS_30D jobs=$SIZING_JOBS open_jobs=$SIZING_OPEN_JOBS connections=$SIZING_CONNECTIONS reactions=$SIZING_REACTIONS comments=$SIZING_COMMENTS"

# Hotfix check (read only, every path): how many members each platform administrator can be suggested under the
# hotfix rules (the same exclusions as getPeopleSuggestions). Administrators are numbered, never named.
ADMIN_ELIGIBLE_JSON="$(data_api --sql "SELECT coalesce(string_agg(eligible::text, ',' ORDER BY admin_order), '') FROM (SELECT row_number() OVER (ORDER BY ur.user_id) AS admin_order, (SELECT count(*) FROM public.profiles cp LEFT JOIN public.maritime_profiles cmp ON cmp.user_id = cp.id WHERE cp.id <> ur.user_id AND cp.account_status='active' AND cp.onboarding_completed_at IS NOT NULL AND cp.slug IS NOT NULL AND coalesce(cp.identity_root,'professional') <> 'organisation' AND cp.profile_type IS DISTINCT FROM 'company' AND NOT EXISTS (SELECT 1 FROM public.connections c WHERE (c.user_low_id = ur.user_id AND c.user_high_id = cp.id) OR (c.user_high_id = ur.user_id AND c.user_low_id = cp.id)) AND NOT EXISTS (SELECT 1 FROM public.follows f WHERE f.follower_id = ur.user_id AND f.following_id = cp.id) AND NOT EXISTS (SELECT 1 FROM public.user_blocks b WHERE (b.blocker_id = ur.user_id AND b.blocked_id = cp.id) OR (b.blocker_id = cp.id AND b.blocked_id = ur.user_id)) AND NOT EXISTS (SELECT 1 FROM public.social_action_events e WHERE e.profile_id = ur.user_id AND e.action='connection_request' AND e.target_profile_id = cp.id AND e.created_at > now() - interval '180 days') AND concat_ws(' ', cp.slug, cp.full_name, cp.headline, cp.summary, cmp.rank, cmp.current_company) !~* '\ye2e([-_[:space:]]|$)|\ysynthetic([-_[:space:]]|$)|\yfixture([-_[:space:]]|$)|\yseed(ed)?([-_[:space:]]|$)|\ytest[-_[:space:]]+(user|account|profile|course|mentor)\y|@[^[:space:]]+\.test\y|@example\.(test|invalid)\y') AS eligible FROM (SELECT DISTINCT user_id FROM public.user_roles WHERE role::text='administrator') ur) counted" --output json)"
echo "ROUND_G_HOTFIX_ADMIN_ELIGIBLE_SUGGESTIONS $(jq -r '.records[0][0].stringValue // ""' <<<"$ADMIN_ELIGIBLE_JSON")"

PENDING=()
for migration in "${MIGRATIONS[@]}"; do
  name="$(basename "$migration" .sql)"
  if already_applied "$name"; then
    echo "ROUND_G_RELEASE_1_MIGRATION_ALREADY_APPLIED $name"
  else
    echo "ROUND_G_RELEASE_1_MIGRATION_PENDING $name"
    PENDING+=("$migration")
  fi
done

if [[ "${#PENDING[@]}" -eq 0 ]]; then
  echo "ROUND_G_RELEASE_1_MIGRATION_ALREADY_APPLIED=true"
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
  echo "ROUND_G_RELEASE_1_MIGRATION_PREVIEW statements=${#PREVIEW_B64[@]} (rolled back)"
  echo "ROUND_G_RELEASE_1_MIGRATION_PLAN_VERIFIED=true"
  echo "ROUND_G_RELEASE_1_MIGRATION_PLAN_ONLY_NO_APPLY"
  exit 0
fi

[[ "$(bash scripts/aws/branch-head.sh refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$ROUND_G_RELEASE_1_MIGRATION_EXPECTED_SHA" ]] || { echo "The feature branch has moved past the approved commit; refusing migration." >&2; exit 1; }

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

  data_api --transaction-id "$tx_id" --sql "SELECT pg_advisory_xact_lock(hashtext('sea-n-shore-round-g-release-1-$name')::bigint)" >/dev/null
  for encoded in "${STATEMENT_B64[@]}"; do
    SQL="$(printf '%s' "$encoded" | base64 --decode)"
    data_api --transaction-id "$tx_id" --sql "$SQL" >/dev/null
  done
  data_api --transaction-id "$tx_id" --sql "INSERT INTO public.sea_n_shore_applied_migrations (name, sha256, git_sha) VALUES ('$name', '$digest', '$ROUND_G_RELEASE_1_MIGRATION_EXPECTED_SHA') ON CONFLICT (name) DO NOTHING" >/dev/null

  aws rds-data commit-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --transaction-id "$tx_id" >/dev/null
  committed=true
  trap - RETURN
  echo "ROUND_G_RELEASE_1_MIGRATION_APPLIED $name"
}

for migration in "${PENDING[@]}"; do
  apply_migration_file "$migration"
done

for migration in "${MIGRATIONS[@]}"; do
  name="$(basename "$migration" .sql)"
  already_applied "$name" || { echo "Ledger is missing $name after apply." >&2; exit 1; }
done

# Round G checks after apply. They read schema and counts only, never member rows.
NEW_TABLES="$(read_count "SELECT count(*)::bigint FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('maritime_ranks','vessel_types','certificate_types','post_impressions','suggestion_dismissals','user_mutes','feed_feedback','search_queries','post_stats','ranking_settings','member_preferences','feed_sessions','people_suggestions','ranking_metrics_daily')")"
[[ "$NEW_TABLES" == "14" ]] || { echo "Expected 14 new round G tables after apply, found $NEW_TABLES." >&2; exit 1; }
TAXONOMY="$(read_count "SELECT ((SELECT count(*) FROM public.maritime_ranks) * 10000 + (SELECT count(*) FROM public.vessel_types) * 100 + (SELECT count(*) FROM public.certificate_types))::bigint")"
[[ "$TAXONOMY" == "1002234" ]] || { echo "Taxonomy seed counts are wrong after apply ($TAXONOMY; expected 100 ranks, 22 vessel types, 34 certificates)." >&2; exit 1; }
TRIGGERS="$(read_count "SELECT count(*)::bigint FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('post_stats_reactions','post_stats_comments','post_stats_reposts','maritime_profiles_fill_codes','profile_experiences_fill_codes','profile_credentials_fill_codes','jobs_fill_codes','job_certificate_requirements_fill_codes')")"
[[ "$TRIGGERS" == "8" ]] || { echo "Expected 8 round G triggers after apply, found $TRIGGERS." >&2; exit 1; }
STATS_MISSING="$(read_count "SELECT count(*)::bigint FROM public.posts p WHERE NOT EXISTS (SELECT 1 FROM public.post_stats s WHERE s.post_id = p.id)")"
[[ "$STATS_MISSING" == "0" ]] || { echo "post_stats backfill missed $STATS_MISSING posts." >&2; exit 1; }
SWITCHES="$(read_count "SELECT count(*)::bigint FROM public.ranking_settings WHERE (key='feed' AND mode='admins') OR (key='people' AND mode='admins')")"
[[ "$SWITCHES" == "2" ]] || { echo "The feed and people switches are not set to admins after apply." >&2; exit 1; }
UNMAPPED_RANK="$(read_count "SELECT count(DISTINCT lower(btrim(v)))::bigint FROM (SELECT mp.rank AS v FROM public.maritime_profiles mp JOIN public.profiles p ON p.id = mp.user_id WHERE p.role_key IS NULL UNION ALL SELECT title FROM public.profile_experiences WHERE track='sea_service') x WHERE nullif(btrim(v),'') IS NOT NULL AND public.taxonomy_code('rank', v) IS NULL")"
UNMAPPED_VESSEL="$(read_count "SELECT count(DISTINCT lower(btrim(v)))::bigint FROM (SELECT vessel_type AS v FROM public.profile_experiences UNION ALL SELECT unnest(vessel_types) FROM public.maritime_profiles UNION ALL SELECT unnest(vessel_types) FROM public.jobs) x WHERE nullif(btrim(v),'') IS NOT NULL AND public.taxonomy_code('vessel', v) IS NULL")"
UNMAPPED_CERT="$(read_count "SELECT count(DISTINCT lower(btrim(v)))::bigint FROM (SELECT name AS v FROM public.profile_credentials UNION ALL SELECT certificate_name FROM public.job_certificate_requirements) x WHERE nullif(btrim(v),'') IS NOT NULL AND public.taxonomy_code('certificate', v) IS NULL")"
echo "ROUND_G_RELEASE_1_MIGRATION_SCHEMA tables=$NEW_TABLES taxonomy=$TAXONOMY triggers=$TRIGGERS post_stats_missing=$STATS_MISSING switches=$SWITCHES"
echo "ROUND_G_UNMAPPED_TAXONOMY_VALUES ranks=$UNMAPPED_RANK vessel_types=$UNMAPPED_VESSEL certificates=$UNMAPPED_CERT"

echo "ROUND_G_RELEASE_1_MIGRATION_APPLY_VERIFIED=true"
