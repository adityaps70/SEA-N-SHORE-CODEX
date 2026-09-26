#!/usr/bin/env bash
set -euo pipefail
umask 077

AWS_REGION="${AWS_REGION:-ap-south-1}"
EXPECTED_ACCOUNT="310356785722"
ROLE_NAME="sea-n-shore-staging-github-deploy"
POLICY_NAME="sea-n-shore-staging-github-deploy"
ACTION_FILE="scripts/aws/github-deploy-iam-action.txt"
EXPECTED_SHA="${GITHUB_DEPLOY_IAM_EXPECTED_SHA:-}"
MEDIA_BUCKET="sea-n-shore-staging-${EXPECTED_ACCOUNT}-media"
MEDIA_BUCKET_ARN="arn:aws:s3:::${MEDIA_BUCKET}"
ECS_EXECUTION_ROLE_ARN="arn:aws:iam::${EXPECTED_ACCOUNT}:role/sea-n-shore-staging-ecs-execution"
ECS_TASK_ROLE_ARN="arn:aws:iam::${EXPECTED_ACCOUNT}:role/sea-n-shore-staging-ecs-task"
OUTBOX_WORKER_ROLE_ARN="arn:aws:iam::${EXPECTED_ACCOUNT}:role/sea-n-shore-staging-outbox-worker"
NOTIFICATION_WORKER_ROLE_ARN="arn:aws:iam::${EXPECTED_ACCOUNT}:role/sea-n-shore-staging-notification-worker"
SES_IDENTITY_ARN="arn:aws:ses:${AWS_REGION}:${EXPECTED_ACCOUNT}:identity/seanshore.in"
SES_CONFIGURATION_SET_ARN="arn:aws:ses:${AWS_REGION}:${EXPECTED_ACCOUNT}:configuration-set/sea-n-shore-staging-transactional"

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
CURRENT_UNMANAGED="$TMP_DIR/current-unmanaged.json"
VERIFIED_UNMANAGED="$TMP_DIR/verified-unmanaged.json"

aws iam get-role-policy \
  --role-name "$ROLE_NAME" \
  --policy-name "$POLICY_NAME" \
  --query PolicyDocument \
  --output json > "$CURRENT"

COGNITO_POOL_ARN="$(jq -r '[.Statement[] | select(.Sid == "Phase5bCognitoRead")][0].Resource // empty' "$CURRENT")"
[[ "$COGNITO_POOL_ARN" =~ ^arn:aws:cognito-idp:${AWS_REGION}:${EXPECTED_ACCOUNT}:userpool/[A-Za-z0-9_-]+$ ]] || {
  echo "Unexpected or missing Phase5b Cognito pool ARN: $COGNITO_POOL_ARN" >&2
  exit 1
}

PASS_ROLE_RESOURCES="$(jq -nc \
  --arg execution "$ECS_EXECUTION_ROLE_ARN" \
  --arg task "$ECS_TASK_ROLE_ARN" \
  --arg outbox "$OUTBOX_WORKER_ROLE_ARN" \
  --arg notifications "$NOTIFICATION_WORKER_ROLE_ARN" \
  '[$execution,$task,$outbox,$notifications]')"

jq --arg resource "$MEDIA_BUCKET_ARN" \
  --argjson passRoles "$PASS_ROLE_RESOURCES" \
  --arg sesIdentity "$SES_IDENTITY_ARN" \
  --arg sesConfigurationSet "$SES_CONFIGURATION_SET_ARN" \
  --arg cognitoPool "$COGNITO_POOL_ARN" '
  .Statement = (
    [.Statement[] | select(.Sid != "ManageStagingMediaCors" and .Sid != "PassEcsRoles" and .Sid != "ReviewCognitoSignupCapacity" and .Sid != "Phase5bSesResourceRead" and .Sid != "Phase5bSesIdentityCreate" and .Sid != "Phase5bCognitoRead")]
    + [{
      Sid: "ManageStagingMediaCors",
      Effect: "Allow",
      Action: ["s3:PutBucketCORS", "s3:GetBucketCORS"],
      Resource: $resource
    }, {
      Sid: "PassEcsRoles",
      Effect: "Allow",
      Action: ["iam:PassRole"],
      Resource: $passRoles
    }, {
      Sid: "ReviewCognitoSignupCapacity",
      Effect: "Allow",
      Action: ["cognito-idp:GetProvisionedLimit", "cloudwatch:GetMetricStatistics"],
      Resource: "*"
    }, {
      Sid: "Phase5bCognitoRead",
      Effect: "Allow",
      Action: ["cognito-idp:DescribeUserPool", "cognito-idp:UpdateUserPool"],
      Resource: $cognitoPool
    }, {
      Sid: "Phase5bSesResourceRead",
      Effect: "Allow",
      Action: ["ses:GetEmailIdentity", "ses:GetConfigurationSet"],
      Resource: [$sesIdentity, $sesConfigurationSet]
    }, {
      Sid: "Phase5bSesIdentityCreate",
      Effect: "Allow",
      Action: ["ses:CreateEmailIdentity"],
      Resource: $sesIdentity
    }]
  )
' "$CURRENT" > "$DESIRED"

jq -S '.Statement |= map(select(.Sid != "ManageStagingMediaCors" and .Sid != "PassEcsRoles" and .Sid != "ReviewCognitoSignupCapacity" and .Sid != "Phase5bSesResourceRead" and .Sid != "Phase5bSesIdentityCreate" and .Sid != "Phase5bCognitoRead"))' "$CURRENT" > "$CURRENT_UNMANAGED"

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

verify_pass_role_statement() {
  local file="$1"
  jq -e --argjson resources "$PASS_ROLE_RESOURCES" '
    [.Statement[] | select(.Sid == "PassEcsRoles")] as $matches
    | ($matches | length) == 1
    and $matches[0].Effect == "Allow"
    and (($matches[0].Action | sort) == (["iam:PassRole"] | sort))
    and (($matches[0].Resource | sort) == ($resources | sort))
  ' "$file" >/dev/null
}

verify_cognito_signup_capacity_statement() {
  local file="$1"
  jq -e '
    [.Statement[] | select(.Sid == "ReviewCognitoSignupCapacity")] as $matches
    | ($matches | length) == 1
    and $matches[0].Effect == "Allow"
    and (($matches[0].Action | sort) == (["cognito-idp:GetProvisionedLimit", "cloudwatch:GetMetricStatistics"] | sort))
    and $matches[0].Resource == "*"
  ' "$file" >/dev/null
}

verify_phase5b_cognito_pool_statement() {
  local file="$1"
  jq -e --arg resource "$COGNITO_POOL_ARN" '
    [.Statement[] | select(.Sid == "Phase5bCognitoRead")] as $matches
    | ($matches | length) == 1
    and $matches[0].Effect == "Allow"
    and (($matches[0].Action | sort) == (["cognito-idp:DescribeUserPool", "cognito-idp:UpdateUserPool"] | sort))
    and $matches[0].Resource == $resource
  ' "$file" >/dev/null
}

verify_phase5b_ses_resource_read_statement() {
  local file="$1"
  jq -e --arg identity "$SES_IDENTITY_ARN" --arg configurationSet "$SES_CONFIGURATION_SET_ARN" '
    [.Statement[] | select(.Sid == "Phase5bSesResourceRead")] as $matches
    | ($matches | length) == 1
    and $matches[0].Effect == "Allow"
    and (($matches[0].Action | sort) == (["ses:GetEmailIdentity", "ses:GetConfigurationSet"] | sort))
    and (($matches[0].Resource | sort) == ([$identity, $configurationSet] | sort))
  ' "$file" >/dev/null
}

verify_phase5b_ses_identity_create_statement() {
  local file="$1"
  jq -e --arg identity "$SES_IDENTITY_ARN" '
    [.Statement[] | select(.Sid == "Phase5bSesIdentityCreate")] as $matches
    | ($matches | length) == 1
    and $matches[0].Effect == "Allow"
    and $matches[0].Action == ["ses:CreateEmailIdentity"]
    and $matches[0].Resource == $identity
  ' "$file" >/dev/null
}

if cmp -s <(jq -S . "$CURRENT") <(jq -S . "$DESIRED"); then
  verify_cors_statement "$CURRENT"
  verify_pass_role_statement "$CURRENT"
  verify_cognito_signup_capacity_statement "$CURRENT"
  verify_phase5b_cognito_pool_statement "$CURRENT"
  verify_phase5b_ses_resource_read_statement "$CURRENT"
  verify_phase5b_ses_identity_create_statement "$CURRENT"
  echo "GITHUB_DEPLOY_IAM_ALREADY_RECONCILED"
  if [[ "$ACTION" == "plan" ]]; then
    echo "GITHUB_DEPLOY_IAM_PLAN_ONLY_NO_WRITE"
  fi
  exit 0
fi

if [[ "$ACTION" == "plan" ]]; then
  echo "GITHUB_DEPLOY_IAM_PLAN change_required=ManageStagingMediaCors,PassEcsRoles,ReviewCognitoSignupCapacity,Phase5bCognitoRead,Phase5bSesResourceRead,Phase5bSesIdentityCreate resource=${MEDIA_BUCKET_ARN} cognito_pool=${COGNITO_POOL_ARN}"
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
verify_pass_role_statement "$VERIFIED" || { echo "ECS worker PassRole IAM verification failed." >&2; exit 1; }
verify_cognito_signup_capacity_statement "$VERIFIED" || { echo "Cognito signup capacity read IAM verification failed." >&2; exit 1; }
verify_phase5b_cognito_pool_statement "$VERIFIED" || { echo "Phase 5B Cognito pool IAM verification failed." >&2; exit 1; }
verify_phase5b_ses_resource_read_statement "$VERIFIED" || { echo "Phase 5B SES read IAM verification failed." >&2; exit 1; }
verify_phase5b_ses_identity_create_statement "$VERIFIED" || { echo "Phase 5B SES identity-create IAM verification failed." >&2; exit 1; }
jq -S '.Statement |= map(select(.Sid != "ManageStagingMediaCors" and .Sid != "PassEcsRoles" and .Sid != "ReviewCognitoSignupCapacity" and .Sid != "Phase5bSesResourceRead" and .Sid != "Phase5bSesIdentityCreate" and .Sid != "Phase5bCognitoRead"))' "$VERIFIED" > "$VERIFIED_UNMANAGED"
cmp -s "$CURRENT_UNMANAGED" "$VERIFIED_UNMANAGED" || { echo "Unexpected unmanaged IAM policy drift detected." >&2; exit 1; }

echo "GITHUB_DEPLOY_IAM_APPLY_COMPLETE resource=${MEDIA_BUCKET_ARN}"
