#!/usr/bin/env bash
set -euo pipefail

AWS_REGION="${AWS_REGION:-ap-south-1}"
ROLE_NAME="${GITHUB_DEPLOY_ROLE_NAME:-sea-n-shore-staging-github-deploy}"
POLICY_NAME="${GITHUB_DEPLOY_POLICY_NAME:-sea-n-shore-staging-github-deploy}"

command -v aws >/dev/null 2>&1 || { echo "AWS CLI is required." >&2; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "jq is required." >&2; exit 1; }

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
[[ -n "$ACCOUNT_ID" && "$ACCOUNT_ID" != "None" ]] || { echo "Unable to resolve AWS account." >&2; exit 1; }

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT INT TERM

aws iam get-role-policy \
  --role-name "$ROLE_NAME" \
  --policy-name "$POLICY_NAME" \
  --query PolicyDocument \
  --output json > "$TMP_DIR/current-policy.json"

jq \
  --arg region "$AWS_REGION" \
  --arg account "$ACCOUNT_ID" \
  '
  .Statement = (
    [.Statement[] | select(
      .Sid != "DiscoverBootstrapInstance"
      and .Sid != "SsmRunShellDocument"
      and .Sid != "SsmSendToBootstrap"
      and .Sid != "SsmReadCommandResult"
    )]
    + [
      {
        Sid: "DiscoverBootstrapInstance",
        Effect: "Allow",
        Action: ["ec2:DescribeInstances"],
        Resource: "*"
      },
      {
        Sid: "SsmRunShellDocument",
        Effect: "Allow",
        Action: ["ssm:SendCommand"],
        Resource: ("arn:aws:ssm:" + $region + "::document/AWS-RunShellScript")
      },
      {
        Sid: "SsmSendToBootstrap",
        Effect: "Allow",
        Action: ["ssm:SendCommand"],
        Resource: ("arn:aws:ec2:" + $region + ":" + $account + ":instance/*"),
        Condition: {
          StringEquals: {
            "ssm:resourceTag/Name": "sea-n-shore-bootstrap"
          }
        }
      },
      {
        Sid: "SsmReadCommandResult",
        Effect: "Allow",
        Action: ["ssm:GetCommandInvocation", "ssm:ListCommandInvocations"],
        Resource: "*"
      }
    ]
  )
  ' "$TMP_DIR/current-policy.json" > "$TMP_DIR/updated-policy.json"

aws iam put-role-policy \
  --role-name "$ROLE_NAME" \
  --policy-name "$POLICY_NAME" \
  --policy-document "file://$TMP_DIR/updated-policy.json"

VERIFY_COUNT="$(aws iam get-role-policy \
  --role-name "$ROLE_NAME" \
  --policy-name "$POLICY_NAME" \
  --query 'length(PolicyDocument.Statement[?Sid==`DiscoverBootstrapInstance` || Sid==`SsmRunShellDocument` || Sid==`SsmSendToBootstrap` || Sid==`SsmReadCommandResult`])' \
  --output text)"

[[ "$VERIFY_COUNT" == "4" ]] || { echo "Remote execution IAM verification failed." >&2; exit 1; }

echo "REMOTE EXECUTION IAM BOOTSTRAP COMPLETE"
