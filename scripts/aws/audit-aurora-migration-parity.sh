#!/usr/bin/env bash
set -euo pipefail
umask 077
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
CLUSTER_ID="sea-n-shore-staging-aurora"
DATABASE_NAME="sea_n_shore"

[[ "${AURORA_PARITY_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "AURORA_PARITY_EXPECTED_SHA must be an exact 40-character commit SHA." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$AURORA_PARITY_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- scripts/aws/audit-aurora-migration-parity.sh scripts/migration/reconciliation-manifest.json
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]

echo "READ_ONLY_AUDIT=true"

CLUSTER_JSON="$(aws rds describe-db-clusters --region "$AWS_REGION" --db-cluster-identifier "$CLUSTER_ID" --output json)"
CLUSTER_ARN="$(jq -r '.DBClusters[0].DBClusterArn // empty' <<<"$CLUSTER_JSON")"
SECRET_ARN="$(jq -r '.DBClusters[0].MasterUserSecret.SecretArn // empty' <<<"$CLUSTER_JSON")"
[[ -n "$CLUSTER_ARN" && -n "$SECRET_ARN" ]]

sql_scalar() {
  local sql="$1"
  aws rds-data execute-statement \
    --region "$AWS_REGION" \
    --resource-arn "$CLUSTER_ARN" \
    --secret-arn "$SECRET_ARN" \
    --database "$DATABASE_NAME" \
    --sql "$sql" \
    --output json | jq -r '.records[0][0].longValue // .records[0][0].stringValue // ""'
}

count_table() {
  local table="$1"
  sql_scalar "SELECT count(*)::bigint FROM public.${table}"
}

for table in profiles companies company_members maritime_profiles profile_skills posts post_reactions post_comments saved_posts post_media post_polls post_poll_options post_poll_votes follows connections user_blocks notifications; do
  value="$(count_table "$table")"
  echo "AURORA_COUNT_${table^^}=$value"
done

# Deterministic digests intentionally mirror the read-only Supabase source audit.
echo "AURORA_DIGEST_PROFILES=$(sql_scalar "SELECT md5(coalesce(string_agg(id::text, ',' ORDER BY id), '')) FROM public.profiles")"
echo "AURORA_DIGEST_POSTS=$(sql_scalar "SELECT md5(coalesce(string_agg(id::text || ':' || author_id::text, ',' ORDER BY id), '')) FROM public.posts")"
echo "AURORA_DIGEST_FOLLOWS=$(sql_scalar "SELECT md5(coalesce(string_agg(follower_id::text || ':' || following_id::text, ',' ORDER BY follower_id, following_id), '')) FROM public.follows")"
echo "AURORA_DIGEST_CONNECTIONS=$(sql_scalar "SELECT md5(coalesce(string_agg(id::text || ':' || user_low_id::text || ':' || user_high_id::text || ':' || requested_by::text || ':' || status::text, ',' ORDER BY id), '')) FROM public.connections")"
echo "AURORA_DIGEST_NOTIFICATIONS=$(sql_scalar "SELECT md5(coalesce(string_agg(id::text || ':' || recipient_id::text || ':' || coalesce(actor_id::text, '') || ':' || notification_type::text, ',' ORDER BY id), '')) FROM public.notifications")"
echo "AURORA_DIGEST_POST_REACTIONS=$(sql_scalar "SELECT md5(coalesce(string_agg(post_id::text || ':' || user_id::text || ':' || reaction_type::text, ',' ORDER BY post_id, user_id), '')) FROM public.post_reactions")"

echo "AURORA_MIGRATION_PARITY_AUDIT_COMPLETE=true"
