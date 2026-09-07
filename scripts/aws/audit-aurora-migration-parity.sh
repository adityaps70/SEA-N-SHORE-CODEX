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

# Hashed stable-key sets prove source containment without exposing raw UUIDs or user data.
echo "AURORA_KEYS_PROFILES=$(sql_scalar "SELECT coalesce(json_agg(key_hash ORDER BY key_hash)::text, '[]') FROM (SELECT md5(id::text) AS key_hash FROM public.profiles) q")"
echo "AURORA_KEYS_COMPANIES=$(sql_scalar "SELECT coalesce(json_agg(key_hash ORDER BY key_hash)::text, '[]') FROM (SELECT md5(id::text) AS key_hash FROM public.companies) q")"
echo "AURORA_KEYS_COMPANY_MEMBERS=$(sql_scalar "SELECT coalesce(json_agg(key_hash ORDER BY key_hash)::text, '[]') FROM (SELECT md5(company_id::text || ':' || user_id::text) AS key_hash FROM public.company_members) q")"
echo "AURORA_KEYS_MARITIME_PROFILES=$(sql_scalar "SELECT coalesce(json_agg(key_hash ORDER BY key_hash)::text, '[]') FROM (SELECT md5(user_id::text) AS key_hash FROM public.maritime_profiles) q")"
echo "AURORA_KEYS_PROFILE_SKILLS=$(sql_scalar "SELECT coalesce(json_agg(key_hash ORDER BY key_hash)::text, '[]') FROM (SELECT md5(user_id::text || ':' || skill::text) AS key_hash FROM public.profile_skills) q")"
echo "AURORA_KEYS_POSTS=$(sql_scalar "SELECT coalesce(json_agg(key_hash ORDER BY key_hash)::text, '[]') FROM (SELECT md5(id::text) AS key_hash FROM public.posts) q")"
echo "AURORA_KEYS_POST_REACTIONS=$(sql_scalar "SELECT coalesce(json_agg(key_hash ORDER BY key_hash)::text, '[]') FROM (SELECT md5(post_id::text || ':' || user_id::text) AS key_hash FROM public.post_reactions) q")"
echo "AURORA_KEYS_POST_COMMENTS=$(sql_scalar "SELECT coalesce(json_agg(key_hash ORDER BY key_hash)::text, '[]') FROM (SELECT md5(id::text) AS key_hash FROM public.post_comments) q")"
echo "AURORA_KEYS_SAVED_POSTS=$(sql_scalar "SELECT coalesce(json_agg(key_hash ORDER BY key_hash)::text, '[]') FROM (SELECT md5(post_id::text || ':' || user_id::text) AS key_hash FROM public.saved_posts) q")"
echo "AURORA_KEYS_POST_MEDIA=$(sql_scalar "SELECT coalesce(json_agg(key_hash ORDER BY key_hash)::text, '[]') FROM (SELECT md5(id::text) AS key_hash FROM public.post_media) q")"
echo "AURORA_KEYS_POST_POLLS=$(sql_scalar "SELECT coalesce(json_agg(key_hash ORDER BY key_hash)::text, '[]') FROM (SELECT md5(post_id::text) AS key_hash FROM public.post_polls) q")"
echo "AURORA_KEYS_POST_POLL_OPTIONS=$(sql_scalar "SELECT coalesce(json_agg(key_hash ORDER BY key_hash)::text, '[]') FROM (SELECT md5(id::text) AS key_hash FROM public.post_poll_options) q")"
echo "AURORA_KEYS_POST_POLL_VOTES=$(sql_scalar "SELECT coalesce(json_agg(key_hash ORDER BY key_hash)::text, '[]') FROM (SELECT md5(post_id::text || ':' || user_id::text) AS key_hash FROM public.post_poll_votes) q")"
echo "AURORA_KEYS_FOLLOWS=$(sql_scalar "SELECT coalesce(json_agg(key_hash ORDER BY key_hash)::text, '[]') FROM (SELECT md5(follower_id::text || ':' || following_id::text) AS key_hash FROM public.follows) q")"
echo "AURORA_KEYS_CONNECTIONS=$(sql_scalar "SELECT coalesce(json_agg(key_hash ORDER BY key_hash)::text, '[]') FROM (SELECT md5(id::text) AS key_hash FROM public.connections) q")"
echo "AURORA_KEYS_USER_BLOCKS=$(sql_scalar "SELECT coalesce(json_agg(key_hash ORDER BY key_hash)::text, '[]') FROM (SELECT md5(blocker_id::text || ':' || blocked_id::text) AS key_hash FROM public.user_blocks) q")"
echo "AURORA_KEYS_NOTIFICATIONS=$(sql_scalar "SELECT coalesce(json_agg(key_hash ORDER BY key_hash)::text, '[]') FROM (SELECT md5(id::text) AS key_hash FROM public.notifications) q")"

# PII-safe semantic tokens distinguish genuine migration loss from rows recreated under a new UUID.
echo "AURORA_CONNECTION_SEMANTICS=$(sql_scalar "SELECT coalesce(json_agg(json_build_object('id_hash', md5(id::text), 'low_hash', md5(user_low_id::text), 'high_hash', md5(user_high_id::text), 'requested_hash', md5(requested_by::text), 'status', status::text, 'responded', responded_at IS NOT NULL) ORDER BY id)::text, '[]') FROM public.connections")"
echo "AURORA_NOTIFICATION_SEMANTICS=$(sql_scalar "SELECT coalesce(json_agg(json_build_object('id_hash', md5(id::text), 'recipient_hash', md5(recipient_id::text), 'actor_hash', CASE WHEN actor_id IS NULL THEN NULL ELSE md5(actor_id::text) END, 'type', notification_type::text, 'connection_hash', CASE WHEN connection_id IS NULL THEN NULL ELSE md5(connection_id::text) END, 'read', read_at IS NOT NULL) ORDER BY id)::text, '[]') FROM public.notifications")"

echo "AURORA_MIGRATION_PARITY_AUDIT_COMPLETE=true"
