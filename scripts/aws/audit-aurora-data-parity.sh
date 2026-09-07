#!/usr/bin/env bash
set -euo pipefail
umask 077
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
CLUSTER_ID="sea-n-shore-staging-aurora"
DATABASE_NAME="sea_n_shore"
COGNITO_POOL_ID="ap-south-1_FKyi5lJsY"

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

TABLES=(
  profiles companies company_members maritime_profiles profile_skills posts
  post_reactions post_comments saved_posts post_media post_polls
  post_poll_options post_poll_votes follows connections user_blocks notifications
  identity_accounts
)

RESULTS='[]'
for table in "${TABLES[@]}"; do
  case "$table" in
    profiles|companies|company_members|maritime_profiles|profile_skills|posts|post_reactions|post_comments|saved_posts|post_media|post_polls|post_poll_options|post_poll_votes|follows|connections|user_blocks|notifications|identity_accounts) ;;
    *) echo "Unexpected table in fixed allowlist: $table" >&2; exit 1 ;;
  esac
  SQL="SELECT count(*)::bigint AS row_count FROM public.${table}"
  RESPONSE="$(aws rds-data execute-statement --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" --sql "$SQL" --include-result-metadata --output json)"
  COUNT="$(jq -er '.records[0][0].longValue' <<<"$RESPONSE")"
  [[ "$COUNT" =~ ^[0-9]+$ ]]
  echo "AURORA_TABLE_COUNT_${table^^}=$COUNT"
  RESULTS="$(jq --arg table "$table" --argjson count "$COUNT" '. + [{table:$table,row_count:$count}]' <<<"$RESULTS")"
done
printf '%s\n' "$RESULTS" | jq -S '.'

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
  RESPONSE="$(aws rds-data execute-statement --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" --sql "$SQL" --output json)"
  while IFS= read -r key_hash; do
    [[ -z "$key_hash" ]] && continue
    [[ "$key_hash" =~ ^[0-9a-f]{32}$ ]] || { echo "Unexpected key hash format for $table" >&2; exit 1; }
    echo "AURORA_KEY_HASH_${table^^}=$key_hash"
  done < <(jq -r '.records[]?[0].stringValue // empty' <<<"$RESPONSE")
done
echo "AURORA_TARGET_KEY_INVENTORY_COMPLETE=true"

# Semantic parity for generated-ID records. These hashes intentionally exclude
# generated IDs so a source row can be proven preserved even when migration or
# AWS-native writes regenerated the primary key. PII is not emitted.
CONNECTION_SEMANTIC_SQL="SELECT md5(array_to_string(array[user_low_id::text,user_high_id::text,requested_by::text,status::text,created_at::text], chr(31))) AS semantic_hash FROM public.connections ORDER BY semantic_hash"
RESPONSE="$(aws rds-data execute-statement --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" --sql "$CONNECTION_SEMANTIC_SQL" --output json)"
while IFS= read -r semantic_hash; do
  [[ -z "$semantic_hash" ]] && continue
  [[ "$semantic_hash" =~ ^[0-9a-f]{32}$ ]] || { echo "Unexpected connection semantic hash" >&2; exit 1; }
  echo "AURORA_CONNECTION_SEMANTIC_HASH=$semantic_hash"
done < <(jq -r '.records[]?[0].stringValue // empty' <<<"$RESPONSE")

NOTIFICATION_SEMANTIC_SQL="SELECT md5(array_to_string(array[recipient_id::text,coalesce(actor_id::text,''),notification_type::text,created_at::text], chr(31))) AS semantic_hash FROM public.notifications ORDER BY semantic_hash"
RESPONSE="$(aws rds-data execute-statement --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" --sql "$NOTIFICATION_SEMANTIC_SQL" --output json)"
while IFS= read -r semantic_hash; do
  [[ -z "$semantic_hash" ]] && continue
  [[ "$semantic_hash" =~ ^[0-9a-f]{32}$ ]] || { echo "Unexpected notification semantic hash" >&2; exit 1; }
  echo "AURORA_NOTIFICATION_SEMANTIC_HASH=$semantic_hash"
done < <(jq -r '.records[]?[0].stringValue // empty' <<<"$RESPONSE")
echo "AURORA_SEMANTIC_INVENTORY_COMPLETE=true"

# PII-safe identity evidence. Raw emails are held only in temporary JSON files
# with umask 077 and are never printed. Output uses 16-char SHA-256 email tokens.
TMP_IDENTITY_DIR="$(mktemp -d)"
trap 'rm -rf -- "$TMP_IDENTITY_DIR"' EXIT
aws cognito-idp list-users --region "$AWS_REGION" --user-pool-id "$COGNITO_POOL_ID" --output json > "$TMP_IDENTITY_DIR/cognito.json"
IDENTITY_SQL="SELECT profile_id::text, provider_subject, coalesce(email, '') FROM public.identity_accounts WHERE provider = 'cognito' ORDER BY profile_id"
aws rds-data execute-statement --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" --sql "$IDENTITY_SQL" --output json > "$TMP_IDENTITY_DIR/accounts.json"
python3 - "$TMP_IDENTITY_DIR/cognito.json" "$TMP_IDENTITY_DIR/accounts.json" <<'PY'
import hashlib, json, re, sys

def token(value):
    value=(value or '').strip().lower()
    return hashlib.sha256(value.encode()).hexdigest()[:16] if value else ''

with open(sys.argv[1]) as f: cognito=json.load(f)
with open(sys.argv[2]) as f: accounts=json.load(f)

cognito_rows=[]
for user in cognito.get('Users', []):
    attrs={item.get('Name'): item.get('Value','') for item in user.get('Attributes', [])}
    subject=attrs.get('sub') or user.get('Username','')
    email=attrs.get('email','')
    if not subject or not email:
        raise SystemExit('Cognito user missing subject or email')
    cognito_rows.append((token(email), subject))

account_rows=[]
for row in accounts.get('records', []):
    profile=row[0].get('stringValue','')
    subject=row[1].get('stringValue','')
    email=row[2].get('stringValue','')
    if not profile or not subject or not email:
        raise SystemExit('Aurora identity row missing profile, subject, or email')
    account_rows.append((token(email), profile, subject))

if len({x[0] for x in cognito_rows}) != len(cognito_rows):
    raise SystemExit('Duplicate Cognito email token')
if len({x[0] for x in account_rows}) != len(account_rows):
    raise SystemExit('Duplicate Aurora identity email token')
if len({x[1] for x in account_rows}) != len(account_rows):
    raise SystemExit('Duplicate Aurora identity profile')

print(f'COGNITO_USER_COUNT={len(cognito_rows)}')
print(f'AURORA_IDENTITY_COUNT={len(account_rows)}')
for email_token, subject in sorted(cognito_rows):
    if not re.fullmatch(r'[0-9a-f]{16}', email_token): raise SystemExit('Bad Cognito token')
    print(f'COGNITO_EMAIL_TOKEN={email_token}|{subject}')
for email_token, profile, subject in sorted(account_rows):
    if not re.fullmatch(r'[0-9a-f]{16}', email_token): raise SystemExit('Bad Aurora token')
    print(f'AURORA_IDENTITY_TOKEN={email_token}|{profile}|{subject}')
PY

echo "AWS_IDENTITY_INVENTORY_COMPLETE=true"
echo "AURORA_TARGET_INVENTORY_COMPLETE=true"
