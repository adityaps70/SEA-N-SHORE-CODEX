#!/usr/bin/env bash
# Read-only count of "Who can message me" (member_preferences.message_permission) across active members.
# Counts only: never a name, username, email or id. Changes nothing (SELECT count(*) statements only).
set -euo pipefail
umask 077
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
DATABASE_NAME="sea_n_shore"
CLUSTER_ID="sea-n-shore-staging-aurora"

[[ "${MESSAGING_SETTINGS_COUNTS_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "MESSAGING_SETTINGS_COUNTS_EXPECTED_SHA must be an exact commit SHA." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$MESSAGING_SETTINGS_COUNTS_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- scripts/aws/messaging-settings-counts.sh .github/workflows/aws-messaging-settings-counts.yml

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

# Members: active accounts that finished onboarding. A member without a member_preferences row reads as the default,
# 'connections' (DEFAULT_MESSAGE_PERMISSION in src/features/profiles/privacy-choices.ts).
MEMBERS="public.profiles p LEFT JOIN public.member_preferences mp ON mp.profile_id = p.id
  WHERE p.account_status = 'active' AND p.onboarding_completed_at IS NOT NULL"
EFFECTIVE="coalesce(mp.message_permission, 'connections')"

echo "MESSAGING_SETTINGS_MEMBERS total=$(read_count "SELECT count(*)::bigint FROM $MEMBERS")"
echo "MESSAGING_SETTINGS_SAVED everyone=$(read_count "SELECT count(*)::bigint FROM $MEMBERS AND mp.message_permission = 'everyone'") connections=$(read_count "SELECT count(*)::bigint FROM $MEMBERS AND mp.message_permission = 'connections'") nobody=$(read_count "SELECT count(*)::bigint FROM $MEMBERS AND mp.message_permission = 'nobody'") no_preferences_row=$(read_count "SELECT count(*)::bigint FROM $MEMBERS AND mp.profile_id IS NULL")"
echo "MESSAGING_SETTINGS_EFFECTIVE everyone=$(read_count "SELECT count(*)::bigint FROM $MEMBERS AND $EFFECTIVE = 'everyone'") connections=$(read_count "SELECT count(*)::bigint FROM $MEMBERS AND $EFFECTIVE = 'connections'") nobody=$(read_count "SELECT count(*)::bigint FROM $MEMBERS AND $EFFECTIVE = 'nobody'")"
# Members who switched on "Let recruiters find me as open to work", by who can message them: the group a
# connections-only or nobody setting keeps recruiters from reaching.
echo "MESSAGING_SETTINGS_OPEN_TO_RECRUITERS total=$(read_count "SELECT count(*)::bigint FROM $MEMBERS AND mp.open_to_recruiters") everyone=$(read_count "SELECT count(*)::bigint FROM $MEMBERS AND mp.open_to_recruiters AND $EFFECTIVE = 'everyone'") connections=$(read_count "SELECT count(*)::bigint FROM $MEMBERS AND mp.open_to_recruiters AND $EFFECTIVE = 'connections'") nobody=$(read_count "SELECT count(*)::bigint FROM $MEMBERS AND mp.open_to_recruiters AND $EFFECTIVE = 'nobody'")"
echo "MESSAGING_SETTINGS_COUNTS_READ_ONLY_VERIFIED=true"
