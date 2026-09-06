#!/usr/bin/env bash
set -euo pipefail

AWS_REGION="${AWS_REGION:-ap-south-1}"
EXPECTED_ACCOUNT_ID="${EXPECTED_ACCOUNT_ID:-310356785722}"
SES_DOMAIN="${SES_DOMAIN:-seaandshore.in}"
SES_FROM_ADDRESS="${SES_FROM_ADDRESS:-no-reply@seaandshore.in}"
SES_FROM_DISPLAY_NAME="${SES_FROM_DISPLAY_NAME:-Sea N Shore}"
SES_FROM="${SES_FROM_DISPLAY_NAME} <${SES_FROM_ADDRESS}>"
APPROVED_SES_FROM="Sea N Shore <no-reply@seaandshore.in>"
COGNITO_EMAIL_TARGET="EmailSendingAccount=DEVELOPER"
SES_CONFIGURATION_SET="${SES_CONFIGURATION_SET:-sea-n-shore-staging-transactional}"
SES_POLICY_NAME="${SES_POLICY_NAME:-sea-n-shore-staging-cognito-sender}"
COGNITO_USER_POOL_NAME="${COGNITO_USER_POOL_NAME:-sea-n-shore-staging-users}"
ECS_CLUSTER_NAME="${ECS_CLUSTER_NAME:-sea-n-shore-staging}"
ECS_SERVICE_NAME="${ECS_SERVICE_NAME:-sea-n-shore-staging-web}"
READINESS_SCRIPT="${READINESS_SCRIPT:-scripts/aws/phase5b-ses-readiness.sh}"
BEFORE_POOL_FILE="${PHASE5B_BEFORE_POOL_FILE:-/tmp/phase5b-user-pool-before.json}"
BEFORE_EMAIL_FILE="${PHASE5B_BEFORE_EMAIL_FILE:-/tmp/phase5b-email-before.json}"
UPDATE_SKELETON_FILE="/tmp/phase5b-update-user-pool-skeleton.json"
UPDATE_REQUEST_FILE="/tmp/phase5b-update-user-pool.json"
POLICY_FILE="/tmp/phase5b-cognito-ses-policy.json"
IDENTITY_FILE="/tmp/phase5b-ses-identity.json"

usage() {
  echo "usage: $0 {discover|ensure-identity|request-production-access|verify-ready|cutover|verify-cutover|rollback-cognito}" >&2
}

require_tools() {
  command -v aws >/dev/null
  command -v jq >/dev/null
}

account_id() {
  aws sts get-caller-identity --query Account --output text
}

ses_production_access() {
  aws sesv2 get-account \
    --region "$AWS_REGION" \
    --query 'ProductionAccessEnabled' \
    --output text
}

verify_account() {
  local actual
  actual="$(account_id)"
  if [[ "$actual" != "$EXPECTED_ACCOUNT_ID" ]]; then
    echo "PHASE5B_WRONG_ACCOUNT=$actual" >&2
    exit 1
  fi
  if [[ "$SES_FROM" != "$APPROVED_SES_FROM" ]]; then
    echo "PHASE5B_UNAPPROVED_SENDER" >&2
    exit 1
  fi
}

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

resolve_pool_id() {
  if [[ -n "${COGNITO_USER_POOL_ID:-}" ]]; then
    printf '%s\n' "$COGNITO_USER_POOL_ID"
    return
  fi

  resolve_pool_id_from_ecs
}

identity_arn() {
  printf 'arn:aws:ses:%s:%s:identity/%s\n' "$AWS_REGION" "$EXPECTED_ACCOUNT_ID" "$SES_DOMAIN"
}

user_pool_arn() {
  local pool_id="$1"
  printf 'arn:aws:cognito-idp:%s:%s:userpool/%s\n' "$AWS_REGION" "$EXPECTED_ACCOUNT_ID" "$pool_id"
}

ensure_configuration_set() {
  if aws sesv2 get-configuration-set \
    --region "$AWS_REGION" \
    --configuration-set-name "$SES_CONFIGURATION_SET" >/dev/null 2>&1; then
    return
  fi

  aws sesv2 create-configuration-set \
    --region "$AWS_REGION" \
    --configuration-set-name "$SES_CONFIGURATION_SET" \
    --sending-options SendingEnabled=true \
    --reputation-options ReputationMetricsEnabled=true \
    --suppression-options SuppressedReasons=BOUNCE,COMPLAINT >/dev/null
}

print_identity_state() {
  if ! aws sesv2 get-email-identity \
    --region "$AWS_REGION" \
    --email-identity "$SES_DOMAIN" \
    --output json > "$IDENTITY_FILE" 2>/dev/null; then
    echo "SES_IDENTITY_STATUS=NOT_CREATED"
    echo "SES_DKIM_STATUS=NOT_CREATED"
    return 1
  fi

  echo "SES_IDENTITY_STATUS=$(jq -r '.VerificationStatus // "UNKNOWN"' "$IDENTITY_FILE")"
  echo "SES_DKIM_STATUS=$(jq -r '.DkimAttributes.Status // "UNKNOWN"' "$IDENTITY_FILE")"
  echo "SES_DKIM_CURRENT_KEY_LENGTH=$(jq -r '.DkimAttributes.CurrentSigningKeyLength // "UNKNOWN"' "$IDENTITY_FILE")"
  echo "SES_DKIM_NEXT_KEY_LENGTH=$(jq -r '.DkimAttributes.NextSigningKeyLength // "UNKNOWN"' "$IDENTITY_FILE")"
  echo "SES_DKIM_RECORDS_BEGIN"
  while IFS= read -r token; do
    [[ -n "$token" ]] || continue
    echo "${token}._domainkey.${SES_DOMAIN} CNAME ${token}.dkim.amazonses.com"
  done < <(jq -r '.DkimAttributes.Tokens[]? // empty' "$IDENTITY_FILE")
  echo "SES_DKIM_RECORDS_END"
}

ensure_identity() {
  ensure_configuration_set

  if ! aws sesv2 get-email-identity \
    --region "$AWS_REGION" \
    --email-identity "$SES_DOMAIN" >/dev/null 2>&1; then
    aws sesv2 create-email-identity \
      --region "$AWS_REGION" \
      --email-identity "$SES_DOMAIN" \
      --configuration-set-name "$SES_CONFIGURATION_SET" \
      --dkim-signing-attributes NextSigningKeyLength=RSA_2048_BIT >/dev/null
  else
    aws sesv2 put-email-identity-configuration-set-attributes \
      --region "$AWS_REGION" \
      --email-identity "$SES_DOMAIN" \
      --configuration-set-name "$SES_CONFIGURATION_SET" >/dev/null

    aws sesv2 get-email-identity \
      --region "$AWS_REGION" \
      --email-identity "$SES_DOMAIN" \
      --output json > "$IDENTITY_FILE"

    current_key="$(jq -r '.DkimAttributes.CurrentSigningKeyLength // ""' "$IDENTITY_FILE")"
    next_key="$(jq -r '.DkimAttributes.NextSigningKeyLength // ""' "$IDENTITY_FILE")"
    if [[ "$current_key" != "RSA_2048_BIT" && "$next_key" != "RSA_2048_BIT" ]]; then
      aws sesv2 put-email-identity-dkim-signing-attributes \
        --region "$AWS_REGION" \
        --email-identity "$SES_DOMAIN" \
        --signing-attributes-origin AWS_SES \
        --signing-attributes NextSigningKeyLength=RSA_2048_BIT >/dev/null
    fi
  fi

  print_identity_state || true
  echo "PHASE5B_SES_IDENTITY_ENSURED"
}

request_production_access() {
  local current use_case
  current="$(ses_production_access)"
  if [[ "$current" == "True" || "$current" == "true" ]]; then
    echo "PHASE5B_SES_PRODUCTION_ACCESS_ALREADY_ENABLED"
    return
  fi

  use_case="Sea N Shore uses Amazon SES only for user-initiated transactional authentication emails from Amazon Cognito, including account signup verification and password reset codes. Emails are sent only when a user registers or requests password recovery; no purchased lists, cold outreach, or marketing campaigns are used. Bounces and complaints will be monitored through Amazon SES."

  aws sesv2 put-account-details \
    --region "$AWS_REGION" \
    --mail-type TRANSACTIONAL \
    --website-url "https://seaandshore.in" \
    --contact-language EN \
    --use-case-description "$use_case" \
    --production-access-enabled >/dev/null

  echo "PHASE5B_SES_PRODUCTION_ACCESS_REQUESTED"
}

write_cognito_policy() {
  local pool_id="$1"
  local ses_arn pool_arn
  ses_arn="$(identity_arn)"
  pool_arn="$(user_pool_arn "$pool_id")"

  jq -n \
    --arg resource "$ses_arn" \
    --arg account "$EXPECTED_ACCOUNT_ID" \
    --arg sourceArn "$pool_arn" \
    '{
      Version: "2012-10-17",
      Statement: [{
        Sid: "AuthorizeSeaNShoreCognito",
        Effect: "Allow",
        Principal: {Service: ["email.cognito-idp.amazonaws.com"]},
        Action: ["SES:SendEmail", "SES:SendRawEmail"],
        Resource: $resource,
        Condition: {
          StringEquals: {"aws:SourceAccount": $account},
          ArnLike: {"aws:SourceArn": $sourceArn}
        }
      }]
    }' > "$POLICY_FILE"
}

ensure_cognito_policy() {
  local pool_id="$1"
  write_cognito_policy "$pool_id"
  aws sesv2 update-email-identity-policy \
    --region "$AWS_REGION" \
    --email-identity "$SES_DOMAIN" \
    --policy-name "$SES_POLICY_NAME" \
    --policy "file://${POLICY_FILE}" >/dev/null
}

verify_ready() {
  local pool_id="$1"
  local production_access
  production_access="$(ses_production_access)"
  if [[ "$production_access" != "True" && "$production_access" != "true" ]]; then
    echo "PHASE5B_NOT_READY=ProductionAccessEnabled" >&2
    exit 1
  fi

  "$READINESS_SCRIPT" --require-cutover-ready

  aws sesv2 get-configuration-set \
    --region "$AWS_REGION" \
    --configuration-set-name "$SES_CONFIGURATION_SET" >/dev/null

  aws sesv2 get-email-identity \
    --region "$AWS_REGION" \
    --email-identity "$SES_DOMAIN" \
    --output json > "$IDENTITY_FILE"

  local expected_arn actual_arn
  expected_arn="$(identity_arn)"
  actual_arn="arn:aws:ses:${AWS_REGION}:${EXPECTED_ACCOUNT_ID}:identity/${SES_DOMAIN}"
  [[ "$actual_arn" == "$expected_arn" ]] || {
    echo "PHASE5B_IDENTITY_ARN_MISMATCH" >&2
    exit 1
  }

  ensure_cognito_policy "$pool_id"
  echo "PHASE5B_CUTOVER_READY"
}

capture_user_pool() {
  local pool_id="$1"
  aws cognito-idp describe-user-pool \
    --region "$AWS_REGION" \
    --user-pool-id "$pool_id" \
    --query UserPool \
    --output json > "$BEFORE_POOL_FILE"

  jq '{
    UserPoolId: .Id,
    EmailConfiguration: (.EmailConfiguration // {EmailSendingAccount: "COGNITO_DEFAULT"})
  }' "$BEFORE_POOL_FILE" > "$BEFORE_EMAIL_FILE"

  echo "PHASE5B_ROLLBACK_CAPTURED=$BEFORE_EMAIL_FILE"
}

build_update_request() {
  local source_pool_file="$1"
  local email_file="$2"

  aws cognito-idp update-user-pool --generate-cli-skeleton input > "$UPDATE_SKELETON_FILE"

  jq \
    --slurpfile skeleton "$UPDATE_SKELETON_FILE" \
    --slurpfile email "$email_file" '
      . as $pool
      | with_entries(select(.key as $key | $skeleton[0] | has($key)))
      | .UserPoolId = $pool.Id
      | .PoolName = $pool.Name
      | .EmailConfiguration = $email[0].EmailConfiguration
    ' "$source_pool_file" > "$UPDATE_REQUEST_FILE"
}

write_developer_email_configuration() {
  local pool_id="$1"
  echo "COGNITO_TARGET=$COGNITO_EMAIL_TARGET"
  jq -n \
    --arg poolId "$pool_id" \
    --arg sourceArn "$(identity_arn)" \
    --arg from "$SES_FROM" \
    --arg replyTo "$SES_FROM_ADDRESS" \
    --arg configurationSet "$SES_CONFIGURATION_SET" \
    '{
      UserPoolId: $poolId,
      EmailConfiguration: {
        EmailSendingAccount: "DEVELOPER",
        SourceArn: $sourceArn,
        From: $from,
        ReplyToEmailAddress: $replyTo,
        ConfigurationSet: $configurationSet
      }
    }' > /tmp/phase5b-email-developer.json
}

verify_cutover() {
  local pool_id="$1"
  local expected_arn
  expected_arn="$(identity_arn)"

  aws cognito-idp describe-user-pool \
    --region "$AWS_REGION" \
    --user-pool-id "$pool_id" \
    --query 'UserPool.EmailConfiguration' \
    --output json > /tmp/phase5b-email-live.json

  jq -e \
    --arg sourceArn "$expected_arn" \
    --arg from "$SES_FROM" \
    --arg replyTo "$SES_FROM_ADDRESS" \
    --arg configurationSet "$SES_CONFIGURATION_SET" '
      .EmailSendingAccount == "DEVELOPER"
      and .SourceArn == $sourceArn
      and .From == $from
      and .ReplyToEmailAddress == $replyTo
      and .ConfigurationSet == $configurationSet
    ' /tmp/phase5b-email-live.json >/dev/null

  echo "PHASE5B_COGNITO_CUTOVER_OK"
}

cutover() {
  local pool_id="$1"
  verify_ready "$pool_id"
  capture_user_pool "$pool_id"
  write_developer_email_configuration "$pool_id"
  build_update_request "$BEFORE_POOL_FILE" /tmp/phase5b-email-developer.json

  aws cognito-idp update-user-pool \
    --region "$AWS_REGION" \
    --cli-input-json "file://${UPDATE_REQUEST_FILE}" >/dev/null

  verify_cutover "$pool_id"
}

rollback_cognito() {
  local pool_id="$1"
  [[ -f "$BEFORE_POOL_FILE" && -f "$BEFORE_EMAIL_FILE" ]] || {
    echo "PHASE5B_ROLLBACK_CAPTURE_MISSING" >&2
    exit 1
  }

  captured_pool_id="$(jq -r '.Id' "$BEFORE_POOL_FILE")"
  captured_email_pool_id="$(jq -r '.UserPoolId' "$BEFORE_EMAIL_FILE")"
  if [[ "$captured_pool_id" != "$pool_id" || "$captured_email_pool_id" != "$pool_id" ]]; then
    echo "PHASE5B_ROLLBACK_POOL_MISMATCH" >&2
    exit 1
  fi

  build_update_request "$BEFORE_POOL_FILE" "$BEFORE_EMAIL_FILE"
  aws cognito-idp update-user-pool \
    --region "$AWS_REGION" \
    --cli-input-json "file://${UPDATE_REQUEST_FILE}" >/dev/null

  echo "PHASE5B_COGNITO_ROLLBACK_OK"
}

discover() {
  "$READINESS_SCRIPT"
  echo "SES_CONFIGURATION_SET=$SES_CONFIGURATION_SET"
  if aws sesv2 get-configuration-set \
    --region "$AWS_REGION" \
    --configuration-set-name "$SES_CONFIGURATION_SET" >/dev/null 2>&1; then
    echo "SES_CONFIGURATION_SET_STATUS=EXISTS"
  else
    echo "SES_CONFIGURATION_SET_STATUS=NOT_FOUND"
  fi
}

main() {
  require_tools
  verify_account

  local action="${1:-}"
  local pool_id
  pool_id="$(resolve_pool_id)"
  if [[ -z "$pool_id" || "$pool_id" == "None" ]]; then
    echo "PHASE5B_COGNITO_POOL_NOT_FOUND" >&2
    exit 1
  fi
  export COGNITO_USER_POOL_ID="$pool_id"

  case "$action" in
    discover)
      discover
      ;;
    ensure-identity)
      ensure_identity
      ;;
    request-production-access)
      request_production_access
      ;;
    verify-ready)
      verify_ready "$pool_id"
      ;;
    cutover)
      cutover "$pool_id"
      ;;
    verify-cutover)
      verify_cutover "$pool_id"
      ;;
    rollback-cognito)
      rollback_cognito "$pool_id"
      ;;
    *)
      usage
      exit 2
      ;;
  esac
}

main "$@"