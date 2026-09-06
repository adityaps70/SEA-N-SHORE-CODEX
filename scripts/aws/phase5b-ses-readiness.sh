#!/usr/bin/env bash
set -euo pipefail

AWS_REGION="${AWS_REGION:-ap-south-1}"
SES_DOMAIN="${SES_DOMAIN:-seaandshore.in}"
COGNITO_USER_POOL_NAME="${COGNITO_USER_POOL_NAME:-sea-n-shore-staging-users}"
ECS_CLUSTER_NAME="${ECS_CLUSTER_NAME:-sea-n-shore-staging}"
ECS_SERVICE_NAME="${ECS_SERVICE_NAME:-sea-n-shore-staging-web}"
REQUIRE_READY=false

if [[ "${1:-}" == "--require-cutover-ready" ]]; then
  REQUIRE_READY=true
elif [[ -n "${1:-}" ]]; then
  echo "usage: $0 [--require-cutover-ready]" >&2
  exit 2
fi

resolve_pool_id_from_ecs() {
  local task_definition_arn
  task_definition_arn="$(aws ecs describe-services \
    --region "$AWS_REGION" \
    --cluster "$ECS_CLUSTER_NAME" \
    --services "$ECS_SERVICE_NAME" \
    --query 'services[0].taskDefinition' \
    --output text)"

  if [[ -z "$task_definition_arn" || "$task_definition_arn" == "None" ]]; then
    return 1
  fi

  aws ecs describe-task-definition \
    --region "$AWS_REGION" \
    --task-definition "$task_definition_arn" \
    --output json \
    | jq -r '[.taskDefinition.containerDefinitions[].environment[]? | select(.name == "AWS_COGNITO_USER_POOL_ID") | .value][0] // empty'
}

aws sts get-caller-identity >/dev/null

echo "AWS_REGION=$AWS_REGION"
echo "SES_DOMAIN=$SES_DOMAIN"

echo "AUTHORITATIVE_NS_BEGIN"
dig +short NS "$SES_DOMAIN" | sed 's/\.$//' | sort
echo "AUTHORITATIVE_NS_END"

production_access="$(aws sesv2 get-account \
  --region "$AWS_REGION" \
  --query 'ProductionAccessEnabled' \
  --output text)"
echo "SES_PRODUCTION_ACCESS=$production_access"

identity_status="NOT_CREATED"
dkim_status="NOT_CREATED"
identity_arn=""

if aws sesv2 get-email-identity \
  --region "$AWS_REGION" \
  --email-identity "$SES_DOMAIN" \
  --output json > /tmp/phase5b-ses-identity.json 2>/dev/null; then
  identity_status="$(jq -r '.VerificationStatus // "UNKNOWN"' /tmp/phase5b-ses-identity.json)"
  dkim_status="$(jq -r '.DkimAttributes.Status // "UNKNOWN"' /tmp/phase5b-ses-identity.json)"
  identity_arn="arn:aws:ses:${AWS_REGION}:$(aws sts get-caller-identity --query Account --output text):identity/${SES_DOMAIN}"
  echo "SES_IDENTITY_STATUS=$identity_status"
  echo "SES_DKIM_STATUS=$dkim_status"
  echo "SES_IDENTITY_ARN=$identity_arn"
  echo "SES_DKIM_TOKENS_BEGIN"
  jq -r '.DkimAttributes.Tokens[]? // empty' /tmp/phase5b-ses-identity.json
  echo "SES_DKIM_TOKENS_END"
else
  echo "SES_IDENTITY_STATUS=$identity_status"
  echo "SES_DKIM_STATUS=$dkim_status"
  echo "SES_DKIM_TOKENS_BEGIN"
  echo "SES_DKIM_TOKENS_END"
fi

pool_id="${COGNITO_USER_POOL_ID:-}"
if [[ -z "$pool_id" ]]; then
  pool_id="$(resolve_pool_id_from_ecs || true)"
fi

if [[ -z "$pool_id" || "$pool_id" == "None" ]]; then
  echo "COGNITO_USER_POOL_ID=NOT_FOUND"
  if [[ "$REQUIRE_READY" == true ]]; then
    exit 1
  fi
  exit 0
fi

echo "COGNITO_USER_POOL_ID=$pool_id"
aws cognito-idp describe-user-pool \
  --region "$AWS_REGION" \
  --user-pool-id "$pool_id" \
  --query 'UserPool.EmailConfiguration' \
  --output json > /tmp/phase5b-cognito-email.json

echo "COGNITO_EMAIL_SENDING_ACCOUNT=$(jq -r '.EmailSendingAccount // "COGNITO_DEFAULT"' /tmp/phase5b-cognito-email.json)"
echo "COGNITO_SOURCE_ARN=$(jq -r '.SourceArn // ""' /tmp/phase5b-cognito-email.json)"
echo "COGNITO_CONFIGURATION_SET=$(jq -r '.ConfigurationSet // ""' /tmp/phase5b-cognito-email.json)"

if [[ "$REQUIRE_READY" == true ]]; then
  if [[ "$production_access" != "True" && "$production_access" != "true" ]]; then
    echo "PHASE5B_NOT_READY=ProductionAccessEnabled" >&2
    exit 1
  fi
  if [[ "$identity_status" != "SUCCESS" ]]; then
    echo "PHASE5B_NOT_READY=VerificationStatus" >&2
    exit 1
  fi
  if [[ "$dkim_status" != "SUCCESS" ]]; then
    echo "PHASE5B_NOT_READY=DkimAttributes.Status" >&2
    exit 1
  fi
fi

echo "PHASE5B_SES_READY"
