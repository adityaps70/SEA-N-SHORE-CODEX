#!/usr/bin/env bash
set -euo pipefail
umask 077
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
SES_IDENTITY="seanshore.in"
SES_IDENTITY_ARN="arn:aws:ses:ap-south-1:310356785722:identity/seanshore.in"
BOOTSTRAP_ROLE_ARN="arn:aws:iam::310356785722:role/SeaNShore-Bootstrap-Role"
ACTION_FILE="scripts/aws/ses-identity-tags-action.txt"
DESIRED_TAGS='[{"Key":"Environment","Value":"staging"},{"Key":"ManagedBy","Value":"Terraform"},{"Key":"Project","Value":"Sea N Shore"}]'

[[ "${SES_IDENTITY_TAGS_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "SES_IDENTITY_TAGS_EXPECTED_SHA must be an exact commit SHA." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$SES_IDENTITY_TAGS_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- \
  scripts/aws/ses-identity-tags.sh \
  scripts/aws/ses-identity-tags-action.txt \
  scripts/aws/ses-identity-tags-permission.test.mjs \
  scripts/aws/phase5b-ses-terraform.test.mjs \
  .github/workflows/aws-ses-identity-tags.yml \
  .github/workflows/aws-infra-ci.yml

CALLER_JSON="$(aws sts get-caller-identity --output json)"
[[ "$(jq -r '.Account' <<<"$CALLER_JSON")" == "$EXPECTED_ACCOUNT" ]]
CALLER_ARN="$(jq -r '.Arn' <<<"$CALLER_JSON")"
[[ -n "$CALLER_ARN" && "$CALLER_ARN" != null ]]
[[ "$CALLER_ARN" == arn:aws:sts::310356785722:assumed-role/SeaNShore-Bootstrap-Role/* ]] || {
  echo "Unexpected SES identity tag execution principal: $CALLER_ARN" >&2
  exit 1
}
echo "SES_IDENTITY_TAGS_CALLER_ARN=$CALLER_ARN"

PERMISSION_JSON="$(aws iam simulate-principal-policy \
  --policy-source-arn "$BOOTSTRAP_ROLE_ARN" \
  --action-names ses:TagResource \
  --resource-arns "$SES_IDENTITY_ARN" \
  --output json)"
PERMISSION_DECISION="$(jq -r '.EvaluationResults[0].EvalDecision // empty' <<<"$PERMISSION_JSON")"
[[ -n "$PERMISSION_DECISION" ]]
echo "SES_IDENTITY_TAGS_PERMISSION_DECISION=$PERMISSION_DECISION"

ACTION="$(tr -d '[:space:]' < "$ACTION_FILE")"
case "$ACTION" in plan|apply-once) ;; *) echo "Unsupported SES identity tags action." >&2; exit 1 ;; esac

WORK_DIR="$(mktemp -d "$PWD/.ses-identity-tags.XXXXXXXX")"
trap 'rm -rf -- "$WORK_DIR"' EXIT

canonical_identity_shape() {
  local identity_path="$1"
  jq -cS '{
    ConfigurationSetName,
    VerifiedForSendingStatus,
    VerificationStatus,
    DkimAttributes: {
      Status: .DkimAttributes.Status,
      CurrentSigningKeyLength: .DkimAttributes.CurrentSigningKeyLength,
      NextSigningKeyLength: .DkimAttributes.NextSigningKeyLength,
      SigningAttributesOrigin: .DkimAttributes.SigningAttributesOrigin
    }
  }' "$identity_path"
}

read_identity() {
  local identity_path="$1"
  aws sesv2 get-email-identity \
    --region "$AWS_REGION" \
    --email-identity "$SES_IDENTITY" \
    --output json > "$identity_path"
}

read_tags() {
  local tags_path="$1"
  aws sesv2 list-tags-for-resource \
    --region "$AWS_REGION" \
    --resource-arn "$SES_IDENTITY_ARN" \
    --output json > "$tags_path"
  jq -cS '[.Tags[]? | {Key,Value}] | sort_by(.Key)' "$tags_path"
}

read_identity "$WORK_DIR/identity-before.json"
IDENTITY_SHAPE_BEFORE="$(canonical_identity_shape "$WORK_DIR/identity-before.json")"
LIVE_TAGS_BEFORE="$(read_tags "$WORK_DIR/tags-before.json")"
DESIRED_TAGS_SORTED="$(jq -cS 'sort_by(.Key)' <<<"$DESIRED_TAGS")"

echo "SES_IDENTITY_TAGS_ACTION=$ACTION"
echo "SES_IDENTITY_TAGS_LIVE_BEFORE=$LIVE_TAGS_BEFORE"
echo "SES_IDENTITY_TAGS_DESIRED=$DESIRED_TAGS_SORTED"
echo "SES_IDENTITY_TAGS_VERIFIED_FOR_SENDING=$(jq -r '.VerifiedForSendingStatus' "$WORK_DIR/identity-before.json")"
echo "SES_IDENTITY_TAGS_VERIFICATION_STATUS=$(jq -r '.VerificationStatus' "$WORK_DIR/identity-before.json")"
echo "SES_IDENTITY_TAGS_DKIM_STATUS=$(jq -r '.DkimAttributes.Status' "$WORK_DIR/identity-before.json")"
echo "SES_IDENTITY_TAGS_CURRENT_SIGNING_KEY_LENGTH=$(jq -r '.DkimAttributes.CurrentSigningKeyLength' "$WORK_DIR/identity-before.json")"
echo "SES_IDENTITY_TAGS_NEXT_SIGNING_KEY_LENGTH=$(jq -r '.DkimAttributes.NextSigningKeyLength' "$WORK_DIR/identity-before.json")"

if [[ "$LIVE_TAGS_BEFORE" == "$DESIRED_TAGS_SORTED" ]]; then
  echo "SES_IDENTITY_TAGS_ALREADY_RECONCILED=true"
  exit 0
fi

if [[ "$ACTION" == "plan" ]]; then
  if [[ "$LIVE_TAGS_BEFORE" == "[]" && "$PERMISSION_DECISION" == "allowed" ]]; then
    echo "SES_IDENTITY_TAGS_APPLY_ELIGIBLE=true"
  else
    echo "SES_IDENTITY_TAGS_APPLY_ELIGIBLE=false"
  fi
  echo "SES_IDENTITY_TAGS_PLAN_ONLY_NO_MUTATION"
  exit 0
fi

[[ "$PERMISSION_DECISION" == "allowed" ]] || {
  echo "Bootstrap role is not allowed to tag the exact SES identity; refusing mutation." >&2
  exit 1
}
[[ "$LIVE_TAGS_BEFORE" == "[]" ]] || {
  echo "Live SES identity tags are not the observed empty set; refusing bounded tag reconciliation." >&2
  exit 1
}
[[ "$(git ls-remote origin refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$SES_IDENTITY_TAGS_EXPECTED_SHA" ]] || {
  echo "Branch head moved before SES identity tag reconciliation." >&2
  exit 1
}

read_identity "$WORK_DIR/identity-pre-apply.json"
[[ "$(canonical_identity_shape "$WORK_DIR/identity-pre-apply.json")" == "$IDENTITY_SHAPE_BEFORE" ]] || {
  echo "SES identity operational shape changed before tagging." >&2
  exit 1
}
LIVE_TAGS_PRE_APPLY="$(read_tags "$WORK_DIR/tags-pre-apply.json")"
[[ "$LIVE_TAGS_PRE_APPLY" == "[]" ]] || {
  echo "SES identity tags changed before tagging." >&2
  exit 1
}

aws sesv2 tag-resource \
  --region "$AWS_REGION" \
  --resource-arn "$SES_IDENTITY_ARN" \
  --tags "$DESIRED_TAGS"

LIVE_TAGS_AFTER="$(read_tags "$WORK_DIR/tags-after.json")"
[[ "$LIVE_TAGS_AFTER" == "$DESIRED_TAGS_SORTED" ]] || {
  echo "SES identity tags do not exactly match the Terraform tag set after reconciliation." >&2
  exit 1
}
read_identity "$WORK_DIR/identity-after.json"
[[ "$(canonical_identity_shape "$WORK_DIR/identity-after.json")" == "$IDENTITY_SHAPE_BEFORE" ]] || {
  echo "SES identity operational shape changed while reconciling tags." >&2
  exit 1
}

echo "SES_IDENTITY_TAGS_LIVE_AFTER=$LIVE_TAGS_AFTER"
echo "SES_IDENTITY_TAGS_LIVE_SHAPE_UNCHANGED=true"
echo "SES_IDENTITY_TAGS_APPLY_VERIFIED=true"
