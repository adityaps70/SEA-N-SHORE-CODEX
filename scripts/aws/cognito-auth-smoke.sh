#!/usr/bin/env bash
set -euo pipefail

AWS_REGION="${AWS_REGION:-ap-south-1}"
POOL_NAME="${POOL_NAME:-sea-n-shore-staging-users}"
CLIENT_NAME="${CLIENT_NAME:-sea-n-shore-staging-web}"
AURORA_CLUSTER_ID="${AURORA_CLUSTER_ID:-sea-n-shore-staging-aurora}"
AURORA_DATABASE="${AURORA_DATABASE:-sea_n_shore}"

EMAIL=""
PASSWORD=""
NEW_PASSWORD=""
CONFIRM_PASSWORD=""
AUTH_JSON=""
CHALLENGE_SESSION=""
ACCESS_TOKEN=""
SUBJECT=""
MAPPING_JSON=""

umask 077
TMP_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$TMP_DIR"
  unset EMAIL PASSWORD NEW_PASSWORD CONFIRM_PASSWORD AUTH_JSON CHALLENGE_SESSION ACCESS_TOKEN SUBJECT MAPPING_JSON
}
trap cleanup EXIT INT TERM

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

command -v aws >/dev/null 2>&1 || fail "AWS CLI is required."
command -v jq >/dev/null 2>&1 || fail "jq is required."

POOL_ID="$(aws cognito-idp list-user-pools \
  --region "$AWS_REGION" \
  --max-results 60 \
  --query "UserPools[?Name=='$POOL_NAME'].Id | [0]" \
  --output text)"

[[ -n "$POOL_ID" && "$POOL_ID" != "None" ]] || fail "Cognito user pool was not found."

CLIENT_ID="$(aws cognito-idp list-user-pool-clients \
  --region "$AWS_REGION" \
  --user-pool-id "$POOL_ID" \
  --max-results 60 \
  --query "UserPoolClients[?ClientName=='$CLIENT_NAME'].ClientId | [0]" \
  --output text)"

[[ -n "$CLIENT_ID" && "$CLIENT_ID" != "None" ]] || fail "Cognito app client was not found."

printf 'Cognito email: ' > /dev/tty
IFS= read -r EMAIL < /dev/tty
printf 'Password: ' > /dev/tty
IFS= read -r -s PASSWORD < /dev/tty
printf '\n' > /dev/tty

[[ -n "$EMAIL" && -n "$PASSWORD" ]] || fail "Email and password are required."

jq -n \
  --arg clientId "$CLIENT_ID" \
  --arg username "$EMAIL" \
  --arg password "$PASSWORD" \
  '{ClientId:$clientId,AuthFlow:"USER_PASSWORD_AUTH",AuthParameters:{USERNAME:$username,PASSWORD:$password}}' \
  > "$TMP_DIR/initiate-auth.json"

if ! AUTH_JSON="$(aws cognito-idp initiate-auth \
  --region "$AWS_REGION" \
  --cli-input-json "file://$TMP_DIR/initiate-auth.json" \
  --output json 2>"$TMP_DIR/initiate-auth.err")"; then
  fail "Cognito authentication failed."
fi

CHALLENGE_NAME="$(jq -r '.ChallengeName // empty' <<<"$AUTH_JSON")"

if [[ "$CHALLENGE_NAME" == "NEW_PASSWORD_REQUIRED" ]]; then
  CHALLENGE_SESSION="$(jq -r '.Session // empty' <<<"$AUTH_JSON")"
  [[ -n "$CHALLENGE_SESSION" ]] || fail "Cognito challenge session was missing."

  printf 'New password: ' > /dev/tty
  IFS= read -r -s NEW_PASSWORD < /dev/tty
  printf '\nConfirm new password: ' > /dev/tty
  IFS= read -r -s CONFIRM_PASSWORD < /dev/tty
  printf '\n' > /dev/tty

  [[ -n "$NEW_PASSWORD" ]] || fail "New password is required."
  [[ "$NEW_PASSWORD" == "$CONFIRM_PASSWORD" ]] || fail "New passwords do not match."

  jq -n \
    --arg clientId "$CLIENT_ID" \
    --arg session "$CHALLENGE_SESSION" \
    --arg username "$EMAIL" \
    --arg password "$NEW_PASSWORD" \
    '{ClientId:$clientId,ChallengeName:"NEW_PASSWORD_REQUIRED",Session:$session,ChallengeResponses:{USERNAME:$username,NEW_PASSWORD:$password}}' \
    > "$TMP_DIR/respond-challenge.json"

  if ! AUTH_JSON="$(aws cognito-idp respond-to-auth-challenge \
    --region "$AWS_REGION" \
    --cli-input-json "file://$TMP_DIR/respond-challenge.json" \
    --output json 2>"$TMP_DIR/respond-challenge.err")"; then
    fail "Cognito new-password challenge failed."
  fi
elif [[ -n "$CHALLENGE_NAME" ]]; then
  fail "Cognito returned an unsupported authentication challenge."
fi

ACCESS_TOKEN="$(jq -r '.AuthenticationResult.AccessToken // empty' <<<"$AUTH_JSON")"
[[ -n "$ACCESS_TOKEN" ]] || fail "Cognito did not return an access token."

jq -n --arg token "$ACCESS_TOKEN" '{AccessToken:$token}' > "$TMP_DIR/get-user.json"

if ! GET_USER_JSON="$(aws cognito-idp get-user \
  --region "$AWS_REGION" \
  --cli-input-json "file://$TMP_DIR/get-user.json" \
  --output json 2>"$TMP_DIR/get-user.err")"; then
  fail "Cognito GetUser verification failed."
fi

SUBJECT="$(jq -r '[.UserAttributes[]? | select(.Name=="sub") | .Value][0] // empty' <<<"$GET_USER_JSON")"
[[ -n "$SUBJECT" ]] || fail "Verified Cognito user did not contain a sub."

CLUSTER_ARN="$(aws rds describe-db-clusters \
  --region "$AWS_REGION" \
  --db-cluster-identifier "$AURORA_CLUSTER_ID" \
  --query 'DBClusters[0].DBClusterArn' \
  --output text)"

SECRET_ARN="$(aws rds describe-db-clusters \
  --region "$AWS_REGION" \
  --db-cluster-identifier "$AURORA_CLUSTER_ID" \
  --query 'DBClusters[0].MasterUserSecret.SecretArn' \
  --output text)"

[[ -n "$CLUSTER_ARN" && "$CLUSTER_ARN" != "None" ]] || fail "Aurora cluster ARN was not found."
[[ -n "$SECRET_ARN" && "$SECRET_ARN" != "None" ]] || fail "Aurora master secret ARN was not found."

if ! MAPPING_JSON="$(aws rds-data execute-statement \
  --region "$AWS_REGION" \
  --resource-arn "$CLUSTER_ARN" \
  --secret-arn "$SECRET_ARN" \
  --database "$AURORA_DATABASE" \
  --sql "select provider_subject from identity_accounts where provider = 'cognito'" \
  --output json 2>"$TMP_DIR/rds-data.err")"; then
  fail "Aurora identity mapping verification failed."
fi

MAPPING_COUNT="$(jq --arg subject "$SUBJECT" '[.records[]?[0].stringValue // empty | select(. == $subject)] | length' <<<"$MAPPING_JSON")"
[[ "$MAPPING_COUNT" == "1" ]] || fail "Cognito identity mapping was not exactly one row."

printf 'identity mapping: 1\n'
printf 'COGNITO AUTH SMOKE PASSED\n'
