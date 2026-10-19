#!/usr/bin/env bash
# Round I (I2), read-only: how many communities use each category, before and after migration 0093.
# Counts only: never a community name, slug, member, email or id. Changes nothing (SELECT count(*) statements only).
set -euo pipefail
umask 077
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
DATABASE_NAME="sea_n_shore"
CLUSTER_ID="sea-n-shore-staging-aurora"

[[ "${COMMUNITY_CATEGORY_COUNTS_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "COMMUNITY_CATEGORY_COUNTS_EXPECTED_SHA must be an exact commit SHA." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$COMMUNITY_CATEGORY_COUNTS_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- scripts/aws/community-category-counts.sh .github/workflows/aws-community-category-counts.yml

[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]

CLUSTER_JSON="$(aws rds describe-db-clusters --region "$AWS_REGION" --db-cluster-identifier "$CLUSTER_ID" --output json)"
CLUSTER_ARN="$(jq -r '.DBClusters[0].DBClusterArn // empty' <<<"$CLUSTER_JSON")"
SECRET_ARN="$(jq -r '.DBClusters[0].MasterUserSecret.SecretArn // empty' <<<"$CLUSTER_JSON")"
[[ "$CLUSTER_ARN" == "arn:aws:rds:ap-south-1:310356785722:cluster:sea-n-shore-staging-aurora" ]]
[[ "$SECRET_ARN" == arn:aws:secretsmanager:ap-south-1:310356785722:secret:rds\!cluster-* ]]

read_count() {
  aws rds-data execute-statement --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" \
    --database "$DATABASE_NAME" --sql "$1" --output json | jq -r '.records[0][0].longValue'
}

# The old fixed values (the CHECK constraint of migration 0061); no category is counted as "none". 0093 never
# changes community_groups.category, so this line reads the same before and after the migration.
LEGACY_VALUES=(maritime_news technical_discussion vetting_sire_2_0 career_advice safety_lessons achievement learning industry_opinion)
# Not GROUPS: that is a read-only Bash variable (the user's group ids), so "FROM $GROUPS" became "FROM 1001".
ALL_GROUPS="public.community_groups g WHERE true"
LIVE_GROUPS="public.community_groups g WHERE g.archived_at IS NULL"

echo "COMMUNITY_CATEGORY_COUNTS_COMMUNITIES total=$(read_count "SELECT count(*)::bigint FROM $ALL_GROUPS") live=$(read_count "SELECT count(*)::bigint FROM $LIVE_GROUPS")"
line="COMMUNITY_CATEGORY_COUNTS_BEFORE"
for value in "${LEGACY_VALUES[@]}"; do
  line+=" $value=$(read_count "SELECT count(*)::bigint FROM $ALL_GROUPS AND g.category = '$value'")/$(read_count "SELECT count(*)::bigint FROM $LIVE_GROUPS AND g.category = '$value'")"
done
line+=" none=$(read_count "SELECT count(*)::bigint FROM $ALL_GROUPS AND g.category IS NULL")/$(read_count "SELECT count(*)::bigint FROM $LIVE_GROUPS AND g.category IS NULL")"
# Anything outside the fixed list (the CHECK constraint makes this 0; free text would show here).
line+=" other_text=$(read_count "SELECT count(*)::bigint FROM $ALL_GROUPS AND g.category IS NOT NULL AND g.category NOT IN ('maritime_news','technical_discussion','vetting_sire_2_0','career_advice','safety_lessons','achievement','learning','industry_opinion')")"
echo "$line (all/live)"

TABLE_PRESENT="$(read_count "SELECT count(*)::bigint FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'community_groups' AND column_name = 'category_id'")"
echo "COMMUNITY_CATEGORY_COUNTS_MIGRATION_0093_APPLIED=$([[ "$TABLE_PRESENT" == "1" ]] && echo true || echo false)"
if [[ "$TABLE_PRESENT" == "1" ]]; then
  echo "COMMUNITY_CATEGORY_COUNTS_CATEGORIES total=$(read_count "SELECT count(*)::bigint FROM public.community_categories c WHERE true") hidden=$(read_count "SELECT count(*)::bigint FROM public.community_categories c WHERE c.hidden_at IS NOT NULL") added_in_admin=$(read_count "SELECT count(*)::bigint FROM public.community_categories c WHERE c.legacy_key IS NULL")"
  line="COMMUNITY_CATEGORY_COUNTS_AFTER"
  for value in "${LEGACY_VALUES[@]}" other; do
    line+=" $value=$(read_count "SELECT count(*)::bigint FROM $ALL_GROUPS AND g.category_id = (SELECT c.id FROM public.community_categories c WHERE c.legacy_key = '$value')")/$(read_count "SELECT count(*)::bigint FROM $LIVE_GROUPS AND g.category_id = (SELECT c.id FROM public.community_categories c WHERE c.legacy_key = '$value')")"
  done
  line+=" admin_added=$(read_count "SELECT count(*)::bigint FROM $ALL_GROUPS AND g.category_id IN (SELECT c.id FROM public.community_categories c WHERE c.legacy_key IS NULL)")"
  line+=" unset=$(read_count "SELECT count(*)::bigint FROM $ALL_GROUPS AND g.category_id IS NULL")"
  echo "$line (all/live)"
fi
echo "COMMUNITY_CATEGORY_COUNTS_READ_ONLY_VERIFIED=true"
