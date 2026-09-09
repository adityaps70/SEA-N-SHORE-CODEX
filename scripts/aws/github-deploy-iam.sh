#!/usr/bin/env bash
set -euo pipefail
umask 077

AWS_REGION="${AWS_REGION:-ap-south-1}"
EXPECTED_ACCOUNT="992382634586"
ROLE_NAME="sea-n-shore-staging-github-deploy"
POLICY_NAME="sea-n-shore-staging-github-deploy"
ACTION_FILE="scripts/aws/github-deploy-iam-action.txt"
EXPECTED_SHA="${GITHUB_DEPLOY_IAM_EXPECTED_SHA:-}"
MEDIA_BUCKET="sea-n-shore-staging-${EXPECTED_ACCOUNT}-media"
MEDIA_BUCKET_ARN="arn:aws:s3:::${MEDIA_BUCKET}"

command -v aws >/dev/null 2>&1 || { echo "AWS CLI is required." >&2; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "jq is required." >&2; exit 1; }
command -v git >/dev/null 2>&1 || { echo "git is required." >&2; exit 1; }

[[ "$EXPECTED_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "GITHUB_DEPLOY_IAM_EXPECTED_SHA must be an exact commit SHA." >&2; exit 1; }
[[ "$(git rev-parse HEAD)" == "$EXPECTED_SHA" ]] || { echo "Detached checkout does not match expected SHA." >&2; exit 1; }
[[ -f "$ACTION_FILE" ]] || { echo "Missing IAM action guard." >&2; exit 1; }

ACTION="$(tr -d '[:space:]' < "$ACTION_FILE")"
case "$ACTION" in plan|apply-once) ;;
  *) echo "Unsupported deploy IAM action: $ACTION" >&2; exit 1 ;;
esac

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
[[ "$ACCOUNT_ID" == "$EXPECTED_ACCOUNT" ]] || { echo "Refusing unexpected AWS account: $ACCOUNT_ID" >&2; exit 1; }

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT INT TERM
CURRENT="$TMP_DIR/current-policy.json"
DESIRED="$TMP_DIR/desired-policy.json"
VERIFIED="$TMP_DIR/verified-policy.json"
CURRENT_NON_CORS="$TMP_DIR/current-non-cors.json"
VERIFIED_NON_CORS="$TMP_DIR/verified-non-cors.json"

aws iam get-role-policy \
  --role-name "$ROLE_NAME" \
  --policy-name "$POLICY_NAME" \
  --query PolicyDocument \
  --output json > "$CURRENT"

jq --arg resource "$MEDIA_BUCKET_ARN" '
  .Statement = (
    [.Statement[] | select(.Sid != "ManageStagingMediaCors")]
    + [{
      Sid: "ManageStagingMediaCors",
      Effect: "Allow",
      Action: ["s3:PutBucketCORS", "s3:GetBucketCORS"],
      Resource: $resource
    }]
  )
' "$CURRENT" > "$DESIRED"

jq -S '.Statement |= map(select(.Sid != "ManageStagingMediaCors"))' "$CURRENT" > "$CURRENT_NON_CORS"

verify_cors_statement() {
  local file="$1"
  jq -e --arg resource "$MEDIA_BUCKET_ARN" '
    [.Statement[] | select(.Sid == "ManageStagingMediaCors")] as $matches
    | ($matches | length) == 1
    and $matches[0].Effect == "Allow"
    and (($matches[0].Action | sort) == (["s3:PutBucketCORS", "s3:GetBucketCORS"] | sort))
    and $matches[0].Resource == $resource
  ' "$file" >/dev/null
}

if cmp -s <(jq -S . "$CURRENT") <(jq -S . "$DESIRED"); then
  verify_cors_statement "$CURRENT"
  echo "GITHUB_DEPLOY_IAM_ALREADY_RECONCILED"
  if [[ "$ACTION" == "plan" ]]; then
    echo "GITHUB_DEPLOY_IAM_PLAN_ONLY_NO_WRITE"
  fi
  exit 0
fi

if [[ "$ACTION" == "plan" ]]; then
  echo "GITHUB_DEPLOY_IAM_PLAN change_required=ManageStagingMediaCors resource=${MEDIA_BUCKET_ARN}"
  echo "GITHUB_DEPLOY_IAM_PLAN_ONLY_NO_WRITE"
  exit 0
fi

REMOTE_SHA="$(git ls-remote origin refs/heads/feat/aws-native-phase-0-1 | awk '{print $1}')"
[[ "$REMOTE_SHA" == "$EXPECTED_SHA" ]] || { echo "Feature branch moved; refusing IAM mutation." >&2; exit 1; }

aws iam put-role-policy \
  --role-name "$ROLE_NAME" \
  --policy-name "$POLICY_NAME" \
  --policy-document "file://$DESIRED"

aws iam get-role-policy \
  --role-name "$ROLE_NAME" \
  --policy-name "$POLICY_NAME" \
  --query PolicyDocument \
  --output json > "$VERIFIED"

verify_cors_statement "$VERIFIED" || { echo "Media CORS IAM verification failed." >&2; exit 1; }
jq -S '.Statement |= map(select(.Sid != "ManageStagingMediaCors"))' "$VERIFIED" > "$VERIFIED_NON_CORS"
cmp -s "$CURRENT_NON_CORS" "$VERIFIED_NON_CORS" || { echo "Unexpected non-CORS IAM policy drift detected." >&2; exit 1; }

echo "GITHUB_DEPLOY_IAM_APPLY_COMPLETE resource=${MEDIA_BUCKET_ARN}"
