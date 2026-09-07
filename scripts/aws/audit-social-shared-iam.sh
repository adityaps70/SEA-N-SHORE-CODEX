#!/usr/bin/env bash
set -euo pipefail
umask 077
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
STATE_BUCKET="sea-n-shore-310356785722-ap-south-1-tfstate"
STATE_KEY="sea-n-shore/staging/terraform.tfstate"
ROLE_NAME="sea-n-shore-staging-ecs-execution"
POLICY_NAME="sea-n-shore-staging-aurora-secret"
CLUSTER_ID="sea-n-shore-staging-aurora"

[[ "${SOCIAL_IAM_AUDIT_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "SOCIAL_IAM_AUDIT_EXPECTED_SHA must be an exact commit SHA." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$SOCIAL_IAM_AUDIT_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- scripts/aws/audit-social-shared-iam.sh infra/aws/app/ecs-database-runtime.tf
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]

WORK_DIR="$(mktemp -d /tmp/sea-n-shore-social-iam-audit.XXXXXXXX)"
trap 'rm -rf -- "$WORK_DIR"' EXIT
aws s3api get-object --bucket "$STATE_BUCKET" --key "$STATE_KEY" --region "$AWS_REGION" "$WORK_DIR/state.json" >/dev/null
jq -e '.lineage == "197a6fae-9997-636e-e52b-c3ac6da85d90"' "$WORK_DIR/state.json" >/dev/null

STATE_COUNT="$(jq '[.resources[] | select(.mode=="managed" and .type=="aws_iam_role_policy" and .name=="ecs_execution_aurora_secret")] | length' "$WORK_DIR/state.json")"
echo "SOCIAL_SHARED_IAM_STATE_COUNT=$STATE_COUNT"

CLUSTER_JSON="$(aws rds describe-db-clusters --region "$AWS_REGION" --db-cluster-identifier "$CLUSTER_ID" --output json)"
SECRET_ARN="$(jq -r '.DBClusters[0].MasterUserSecret.SecretArn // empty' <<<"$CLUSTER_JSON")"
[[ "$SECRET_ARN" == arn:aws:secretsmanager:ap-south-1:310356785722:secret:rds\!cluster-* ]]

if aws iam get-role-policy --role-name "$ROLE_NAME" --policy-name "$POLICY_NAME" --output json > "$WORK_DIR/live-policy.json" 2>"$WORK_DIR/iam.err"; then
  echo "SOCIAL_SHARED_IAM_LIVE_EXISTS=true"
  jq -e --arg secret "$SECRET_ARN" '
    def as_array: if type == "array" then . else [.] end;
    .RoleName == "sea-n-shore-staging-ecs-execution" and
    .PolicyName == "sea-n-shore-staging-aurora-secret" and
    (.PolicyDocument.Statement | length) == 1 and
    .PolicyDocument.Statement[0].Effect == "Allow" and
    ((.PolicyDocument.Statement[0].Action | as_array) == ["secretsmanager:GetSecretValue"]) and
    ((.PolicyDocument.Statement[0].Resource | as_array) == [$secret])
  ' "$WORK_DIR/live-policy.json" >/dev/null || {
    echo "SOCIAL_SHARED_IAM_LIVE_POLICY_MATCHES_DESIRED=false" >&2
    jq '{RoleName,PolicyName,PolicyDocument}' "$WORK_DIR/live-policy.json" >&2
    exit 1
  }
  echo "SOCIAL_SHARED_IAM_LIVE_POLICY_MATCHES_DESIRED=true"
else
  if grep -q 'NoSuchEntity' "$WORK_DIR/iam.err"; then
    echo "SOCIAL_SHARED_IAM_LIVE_EXISTS=false"
  else
    cat "$WORK_DIR/iam.err" >&2
    exit 1
  fi
fi

echo "SOCIAL_SHARED_IAM_AUDIT_READ_ONLY=true"
