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
git diff --quiet HEAD -- scripts/aws scripts/migration infra/aws/database
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]

CLUSTER_JSON="$(aws rds describe-db-clusters \
  --region "$AWS_REGION" \
  --db-cluster-identifier "$CLUSTER_ID" \
  --output json)"

CLUSTER_ARN="$(jq -r '.DBClusters[0].DBClusterArn // empty' <<<"$CLUSTER_JSON")"
SECRET_ARN="$(jq -r '.DBClusters[0].MasterUserSecret.SecretArn // empty' <<<"$CLUSTER_JSON")"
HTTP_ENDPOINT="$(jq -r '.DBClusters[0].HttpEndpointEnabled // false' <<<"$CLUSTER_JSON")"
STATUS="$(jq -r '.DBClusters[0].Status // empty' <<<"$CLUSTER_JSON")"

[[ "$STATUS" == "available" ]] || { echo "Aurora is not available: $STATUS" >&2; exit 1; }
[[ "$HTTP_ENDPOINT" == "true" ]] || { echo "Aurora Data API is not enabled." >&2; exit 1; }
[[ "$CLUSTER_ARN" == arn:aws:rds:ap-south-1:310356785722:cluster:sea-n-shore-staging-aurora ]]
[[ "$SECRET_ARN" == arn:aws:secretsmanager:ap-south-1:310356785722:secret:rds\!cluster-* ]]

echo "AURORA_DATA_API_ENABLED=true"
echo "AURORA_STATUS=available"
echo "READ_ONLY_AUDIT=true"

# Fixed allowlist only. These are the new-website domain tables represented in
# the source reconciliation manifest plus the AWS-only Cognito mapping table.
TABLES=(
  profiles
  companies
  company_members
  maritime_profiles
  profile_skills
  posts
  post_reactions
  post_comments
  saved_posts
  post_media
  post_polls
  post_poll_options
  post_poll_votes
  follows
  connections
  user_blocks
  notifications
  identity_accounts
)

RESULTS='[]'
for table in "${TABLES[@]}"; do
  case "$table" in
    profiles|companies|company_members|maritime_profiles|profile_skills|posts|post_reactions|post_comments|saved_posts|post_media|post_polls|post_poll_options|post_poll_votes|follows|connections|user_blocks|notifications|identity_accounts) ;;
    *) echo "Unexpected table in fixed allowlist: $table" >&2; exit 1 ;;
  esac

  SQL="SELECT count(*)::bigint AS row_count FROM public.${table}"
  RESPONSE="$(aws rds-data execute-statement \
    --region "$AWS_REGION" \
    --resource-arn "$CLUSTER_ARN" \
    --secret-arn "$SECRET_ARN" \
    --database "$DATABASE_NAME" \
    --sql "$SQL" \
    --include-result-metadata \
    --output json)"

  COUNT="$(jq -er '.records[0][0].longValue' <<<"$RESPONSE")"
  [[ "$COUNT" =~ ^[0-9]+$ ]]
  echo "AURORA_TABLE_COUNT_${table^^}=$COUNT"
  RESULTS="$(jq --arg table "$table" --argjson count "$COUNT" '. + [{table:$table,row_count:$count}]' <<<"$RESULTS")"
done

printf '%s\n' "$RESULTS" | jq -S '.'

# Source-key parity is checked independently from row counts because AWS may
# legitimately contain additional rows created after the original Supabase
# migration. Hash only primary/composite keys; no profile content or PII is
# emitted. Expressions mirror reconciliation-manifest.json exactly.
declare -A KEY_EXPRESSIONS=(
  [profiles]='id::text'
  [companies]='id::text'
  [company_members]='company_id::text,user_id::text'
  [maritime_profiles]='user_id::text'
  [profile_skills]='user_id::text,skill::text'
  [posts]='id::text'
  [post_reactions]='post_id::text,user_id::text'
  [post_comments]='id::text'
  [saved_posts]='post_id::text,user_id::text'
  [post_media]='id::text'
  [post_polls]='post_id::text'
  [post_poll_options]='id::text'
  [post_poll_votes]='post_id::text,user_id::text'
  [follows]='follower_id::text,following_id::text'
  [connections]='id::text'
  [user_blocks]='blocker_id::text,blocked_id::text'
  [notifications]='id::text'
)

SOURCE_COMPATIBLE_TABLES=(
  profiles companies company_members maritime_profiles profile_skills posts
  post_reactions post_comments saved_posts post_media post_polls
  post_poll_options post_poll_votes follows connections user_blocks notifications
)

for table in "${SOURCE_COMPATIBLE_TABLES[@]}"; do
  expression="${KEY_EXPRESSIONS[$table]}"
  SQL="SELECT md5(array_to_string(array[${expression}], chr(31))) AS key_hash FROM public.${table} ORDER BY key_hash"
  RESPONSE="$(aws rds-data execute-statement \
    --region "$AWS_REGION" \
    --resource-arn "$CLUSTER_ARN" \
    --secret-arn "$SECRET_ARN" \
    --database "$DATABASE_NAME" \
    --sql "$SQL" \
    --output json)"

  while IFS= read -r key_hash; do
    [[ -z "$key_hash" ]] && continue
    [[ "$key_hash" =~ ^[0-9a-f]{32}$ ]] || { echo "Unexpected key hash format for $table" >&2; exit 1; }
    echo "AURORA_KEY_HASH_${table^^}=$key_hash"
  done < <(jq -r '.records[]?[0].stringValue // empty' <<<"$RESPONSE")
done

echo "AURORA_TARGET_KEY_INVENTORY_COMPLETE=true"
echo "AURORA_TARGET_INVENTORY_COMPLETE=true"
