#!/usr/bin/env bash
# Removes this run's eight disposable onboarding identities at the end of every E2E run: their
# profiles (and everything that cascades from them) and their Cognito users. Exact addresses
# only, each carrying this run's id; never a pattern delete.
set -euo pipefail
umask 077
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
CLUSTER_ID="sea-n-shore-staging-aurora"
DATABASE_NAME="sea_n_shore"
POOL_NAME="sea-n-shore-staging-users"
KEYS=(seafarer shore recruiter trainer student family enthusiast other)

[[ "${ONBOARDING_E2E_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || { echo "ONBOARDING_E2E_EXPECTED_SHA must be an exact commit SHA." >&2; exit 1; }
[[ "$(git rev-parse HEAD)" == "$ONBOARDING_E2E_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
[[ "${ONBOARDING_E2E_RUN_ID:-}" =~ ^[0-9]+$ ]] || { echo "ONBOARDING_E2E_RUN_ID must be the numeric run id." >&2; exit 1; }
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]

EMAILS=()
for key in "${KEYS[@]}"; do
  var="E2E_${key^^}_EMAIL"
  email="${!var:-}"
  [[ "$email" == "sea-n-shore-e2e-${ONBOARDING_E2E_RUN_ID}-${key}@example.com" ]] || {
    echo "Refusing: the $key identity is not this run's disposable address." >&2
    exit 1
  }
  EMAILS+=("$email")
done

POOL_ID="$(aws cognito-idp list-user-pools --region "$AWS_REGION" --max-results 60 --query "UserPools[?Name=='$POOL_NAME'].Id | [0]" --output text)"
[[ "$POOL_ID" == ap-south-1_* ]]
CLUSTER_JSON="$(aws rds describe-db-clusters --region "$AWS_REGION" --db-cluster-identifier "$CLUSTER_ID" --output json)"
CLUSTER_ARN="$(jq -r '.DBClusters[0].DBClusterArn // empty' <<<"$CLUSTER_JSON")"
SECRET_ARN="$(jq -r '.DBClusters[0].MasterUserSecret.SecretArn // empty' <<<"$CLUSTER_JSON")"
[[ "$CLUSTER_ARN" == "arn:aws:rds:ap-south-1:310356785722:cluster:sea-n-shore-staging-aurora" ]]
[[ -n "$SECRET_ARN" ]]

# The addresses are fixed-format and validated above, so they are safe inside the SQL literal list.
IN_LIST="$(printf "'%s'," "${EMAILS[@]}")"
IN_LIST="${IN_LIST%,}"
data() { aws rds-data execute-statement --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" --sql "$1" --output json; }

PROFILES_DELETED="$(data "DELETE FROM public.profiles WHERE id IN (SELECT profile_id FROM public.identity_accounts WHERE provider = 'cognito' AND email IN ($IN_LIST))" | jq -r '.numberOfRecordsUpdated // 0')"
echo "ONBOARDING_E2E_RUN_PROFILES_DELETED=$PROFILES_DELETED"
[[ "$(data "SELECT count(*)::text FROM public.identity_accounts WHERE provider = 'cognito' AND email IN ($IN_LIST)" | jq -r '.records[0][0].stringValue')" == "0" ]]

USERS_DELETED=0
for email in "${EMAILS[@]}"; do
  while IFS= read -r username; do
    [[ -n "$username" ]] || continue
    aws cognito-idp admin-delete-user --region "$AWS_REGION" --user-pool-id "$POOL_ID" --username "$username"
    USERS_DELETED=$((USERS_DELETED + 1))
  done < <(aws cognito-idp list-users --region "$AWS_REGION" --user-pool-id "$POOL_ID" --filter "email = \"$email\"" --query 'Users[].Username' --output text | tr '\t' '\n' | grep -v '^None$' || true)
done
echo "ONBOARDING_E2E_RUN_COGNITO_USERS_DELETED=$USERS_DELETED"

for email in "${EMAILS[@]}"; do
  LEFT="$(aws cognito-idp list-users --region "$AWS_REGION" --user-pool-id "$POOL_ID" --filter "email = \"$email\"" --query 'length(Users)' --output text)"
  [[ "$LEFT" == "0" ]] || { echo "A disposable Cognito user is still present after cleanup." >&2; exit 1; }
done
echo "ONBOARDING_E2E_RUN_USERS_REMOVED=true"
