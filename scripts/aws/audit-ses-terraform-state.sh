#!/usr/bin/env bash
set -euo pipefail
umask 077
export AWS_PAGER=""

# Triggered only to refresh read-only SES Terraform-state evidence after exact-head CI.
EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
STATE_BUCKET="sea-n-shore-310356785722-ap-south-1-tfstate"
STATE_KEY="sea-n-shore/staging/terraform.tfstate"
SES_CONFIGURATION_SET="sea-n-shore-staging-transactional"
SES_DOMAIN="seaandshore.in"
SES_IDENTITY_ARN="arn:aws:ses:ap-south-1:310356785722:identity/seaandshore.in"
SES_IDENTITY_POLICY_NAME="sea-n-shore-staging-cognito-sender"
COGNITO_USER_POOL_ARN="arn:aws:cognito-idp:ap-south-1:310356785722:userpool/ap-south-1_FKyi5lJsY"

[[ "${SES_TERRAFORM_STATE_AUDIT_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "SES_TERRAFORM_STATE_AUDIT_EXPECTED_SHA must be an exact commit SHA." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$SES_TERRAFORM_STATE_AUDIT_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- scripts/aws/audit-ses-terraform-state.sh infra/aws/app/email.tf
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]

WORK_DIR="$(mktemp -d /tmp/sea-n-shore-ses-state-audit.XXXXXXXX)"
trap 'rm -rf -- "$WORK_DIR"' EXIT

aws s3api get-object \
  --bucket "$STATE_BUCKET" \
  --key "$STATE_KEY" \
  --region "$AWS_REGION" \
  "$WORK_DIR/state.json" >/dev/null
jq -e '.lineage == "197a6fae-9997-636e-e52b-c3ac6da85d90"' "$WORK_DIR/state.json" >/dev/null

STATE_SERIAL="$(jq -r '.serial' "$WORK_DIR/state.json")"
CONFIGURATION_SET_STATE_COUNT="$(jq '[.resources[] | select(.mode=="managed" and .type=="aws_sesv2_configuration_set" and .name=="transactional")] | length' "$WORK_DIR/state.json")"
IDENTITY_STATE_COUNT="$(jq '[.resources[] | select(.mode=="managed" and .type=="aws_sesv2_email_identity" and .name=="transactional_domain")] | length' "$WORK_DIR/state.json")"
IDENTITY_POLICY_STATE_COUNT="$(jq '[.resources[] | select(.mode=="managed" and .type=="aws_ses_identity_policy" and .name=="cognito_sender")] | length' "$WORK_DIR/state.json")"

echo "SES_TERRAFORM_STATE_SERIAL=$STATE_SERIAL"
echo "SES_CONFIGURATION_SET_STATE_COUNT=$CONFIGURATION_SET_STATE_COUNT"
echo "SES_IDENTITY_STATE_COUNT=$IDENTITY_STATE_COUNT"
echo "SES_IDENTITY_POLICY_STATE_COUNT=$IDENTITY_POLICY_STATE_COUNT"

if aws sesv2 get-configuration-set \
  --region "$AWS_REGION" \
  --configuration-set-name "$SES_CONFIGURATION_SET" \
  --output json > "$WORK_DIR/configuration-set.json" 2>"$WORK_DIR/configuration-set.err"; then
  echo "SES_CONFIGURATION_SET_LIVE_EXISTS=true"
  echo "SES_CONFIGURATION_SET_SENDING_ENABLED=$(jq -r '.SendingOptions.SendingEnabled // false' "$WORK_DIR/configuration-set.json")"
  echo "SES_CONFIGURATION_SET_SUPPRESSION_REASONS=$(jq -r '(.SuppressionOptions.SuppressedReasons // []) | if length == 0 then "NONE" else join(",") end' "$WORK_DIR/configuration-set.json")"
  echo "SES_CONFIGURATION_SET_REPUTATION_METRICS_ENABLED=$(jq -r '.ReputationOptions.ReputationMetricsEnabled // false' "$WORK_DIR/configuration-set.json")"
else
  if grep -Eq 'NotFoundException|not found' "$WORK_DIR/configuration-set.err"; then
    echo "SES_CONFIGURATION_SET_LIVE_EXISTS=false"
  else
    cat "$WORK_DIR/configuration-set.err" >&2
    exit 1
  fi
fi

if aws sesv2 get-email-identity \
  --region "$AWS_REGION" \
  --email-identity "$SES_DOMAIN" \
  --output json > "$WORK_DIR/identity.json" 2>"$WORK_DIR/identity.err"; then
  echo "SES_IDENTITY_LIVE_EXISTS=true"
  echo "SES_IDENTITY_CONFIGURATION_SET=$(jq -r '.ConfigurationSetName // ""' "$WORK_DIR/identity.json")"
  echo "SES_IDENTITY_VERIFIED_FOR_SENDING=$(jq -r '.VerifiedForSendingStatus // false' "$WORK_DIR/identity.json")"
  echo "SES_IDENTITY_DKIM_STATUS=$(jq -r '.DkimAttributes.Status // "UNKNOWN"' "$WORK_DIR/identity.json")"
  echo "SES_IDENTITY_CURRENT_SIGNING_KEY_LENGTH=$(jq -r '.DkimAttributes.CurrentSigningKeyLength // "UNKNOWN"' "$WORK_DIR/identity.json")"
  echo "SES_IDENTITY_NEXT_SIGNING_KEY_LENGTH=$(jq -r '.DkimAttributes.NextSigningKeyLength // "UNKNOWN"' "$WORK_DIR/identity.json")"
else
  if grep -Eq 'NotFoundException|not found' "$WORK_DIR/identity.err"; then
    echo "SES_IDENTITY_LIVE_EXISTS=false"
  else
    cat "$WORK_DIR/identity.err" >&2
    exit 1
  fi
fi

aws ses get-identity-policies \
  --region "$AWS_REGION" \
  --identity "$SES_DOMAIN" \
  --policy-names "$SES_IDENTITY_POLICY_NAME" \
  --output json > "$WORK_DIR/identity-policies.json"
LIVE_POLICY="$(jq -r --arg name "$SES_IDENTITY_POLICY_NAME" '.Policies[$name] // empty' "$WORK_DIR/identity-policies.json")"
if [[ -n "$LIVE_POLICY" ]]; then
  echo "SES_IDENTITY_POLICY_LIVE_EXISTS=true"
  printf '%s\n' "$LIVE_POLICY" | jq . > "$WORK_DIR/live-identity-policy.json"
  if jq -e \
    --arg account "$EXPECTED_ACCOUNT" \
    --arg source "$COGNITO_USER_POOL_ARN" \
    --arg identity "$SES_IDENTITY_ARN" '
      def as_array: if type == "array" then . else [.] end;
      (.Statement | as_array) as $statements |
      ($statements | length) == 1 and
      ($statements[0] as $s |
        $s.Sid == "AuthorizeSeaNShoreCognito" and
        $s.Effect == "Allow" and
        (($s.Action | as_array | sort) == (["SES:SendEmail", "SES:SendRawEmail"] | sort)) and
        (($s.Resource | as_array) == [$identity]) and
        (($s.Principal.Service | as_array) == ["email.cognito-idp.amazonaws.com"]) and
        (((($s.Condition.StringEquals["aws:SourceAccount"] // $s.Condition.StringEquals["AWS:SourceAccount"]) | as_array)) == [$account]) and
        (((($s.Condition.ArnLike["aws:SourceArn"] // $s.Condition.ArnLike["AWS:SourceArn"]) | as_array)) == [$source])
      )
    ' "$WORK_DIR/live-identity-policy.json" >/dev/null; then
    echo "SES_IDENTITY_POLICY_LIVE_MATCHES_DESIRED=true"
  else
    echo "SES_IDENTITY_POLICY_LIVE_MATCHES_DESIRED=false"
  fi
else
  echo "SES_IDENTITY_POLICY_LIVE_EXISTS=false"
  echo "SES_IDENTITY_POLICY_LIVE_MATCHES_DESIRED=false"
fi

echo "SES_TERRAFORM_STATE_AUDIT_READ_ONLY=true"
