#!/usr/bin/env bash
set -euo pipefail
umask 077
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
CLUSTER_ID="sea-n-shore-staging-aurora"
DATABASE_NAME="sea_n_shore"
POOL_NAME="sea-n-shore-staging-users"
EMAIL_REGEX='^sea-n-shore-e2e-[0-9]+-(seafarer|shore|recruiter|trainer|student|family|enthusiast|other)@example[.]com$'

[[ "${ONBOARDING_E2E_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "ONBOARDING_E2E_EXPECTED_SHA must be an exact commit SHA." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$ONBOARDING_E2E_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]

POOL_ID="$(aws cognito-idp list-user-pools --region "$AWS_REGION" --max-results 60 --query "UserPools[?Name=='$POOL_NAME'].Id | [0]" --output text)"
[[ -n "$POOL_ID" && "$POOL_ID" != "None" ]]

CLUSTER_JSON="$(aws rds describe-db-clusters --region "$AWS_REGION" --db-cluster-identifier "$CLUSTER_ID" --output json)"
CLUSTER_ARN="$(jq -r '.DBClusters[0].DBClusterArn // empty' <<<"$CLUSTER_JSON")"
SECRET_ARN="$(jq -r '.DBClusters[0].MasterUserSecret.SecretArn // empty' <<<"$CLUSTER_JSON")"
[[ "$CLUSTER_ARN" == "arn:aws:rds:ap-south-1:310356785722:cluster:sea-n-shore-staging-aurora" ]]
[[ -n "$SECRET_ARN" ]]

DELETE_SQL="DELETE FROM public.profiles WHERE id IN (
  SELECT profile_id
  FROM public.identity_accounts
  WHERE provider='cognito'
    AND email ~ '$EMAIL_REGEX'
)"
aws rds-data execute-statement   --region "$AWS_REGION"   --resource-arn "$CLUSTER_ARN"   --secret-arn "$SECRET_ARN"   --database "$DATABASE_NAME"   --sql "$DELETE_SQL" >/dev/null

COUNT_SQL="SELECT count(*)::text FROM public.identity_accounts WHERE provider='cognito' AND email ~ '$EMAIL_REGEX'"
LEFT_COUNT="$(aws rds-data execute-statement   --region "$AWS_REGION"   --resource-arn "$CLUSTER_ARN"   --secret-arn "$SECRET_ARN"   --database "$DATABASE_NAME"   --sql "$COUNT_SQL"   --output json | jq -r '.records[0][0].stringValue')"
[[ "$LEFT_COUNT" == "0" ]]

USERS_JSON="$(aws cognito-idp list-users --region "$AWS_REGION" --user-pool-id "$POOL_ID" --output json)"
mapfile -t STALE_USERS < <(
  jq -r '
    .Users[]?
    | . as $user
    | ($user.Attributes // [] | map(select(.Name == "email")) | .[0].Value // "") as $email
    | select($email | test("^sea-n-shore-e2e-[0-9]+-(seafarer|shore|recruiter|trainer|student|family|enthusiast|other)@example[.]com$"))
    | $user.Username
  ' <<<"$USERS_JSON"
)

[[ "${#STALE_USERS[@]}" -le 60 ]]
for USERNAME in "${STALE_USERS[@]}"; do
  [[ -n "$USERNAME" ]]
  aws cognito-idp admin-delete-user     --region "$AWS_REGION"     --user-pool-id "$POOL_ID"     --username "$USERNAME"
done

VERIFY_USERS="$(aws cognito-idp list-users --region "$AWS_REGION" --user-pool-id "$POOL_ID" --output json)"
REMAINING="$(
  jq -r '
    .Users[]?
    | (.Attributes // [] | map(select(.Name == "email")) | .[0].Value // "")
    | select(test("^sea-n-shore-e2e-[0-9]+-(seafarer|shore|recruiter|trainer|student|family|enthusiast|other)@example[.]com$"))
  ' <<<"$VERIFY_USERS"
)"
[[ -z "$REMAINING" ]]

echo "ONBOARDING_E2E_STALE_CLEANUP_VERIFIED=true"
