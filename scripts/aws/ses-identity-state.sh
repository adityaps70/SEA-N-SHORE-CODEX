#!/usr/bin/env bash
set -euo pipefail
umask 077
export PATH="$HOME/bin:$PATH"
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
STATE_BUCKET="sea-n-shore-310356785722-ap-south-1-tfstate"
STATE_KEY="sea-n-shore/staging/terraform.tfstate"
APP_DIR="$PWD/infra/aws/app"
RESOURCE="aws_sesv2_email_identity.transactional_domain"
IMPORT_ID="seanshore.in"
SES_IDENTITY_ARN="arn:aws:ses:ap-south-1:310356785722:identity/seanshore.in"
SES_CONFIGURATION_SET="sea-n-shore-staging-transactional"
ACTION_FILE="scripts/aws/ses-identity-state-action.txt"

[[ "${SES_IDENTITY_STATE_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "SES_IDENTITY_STATE_EXPECTED_SHA must be an exact commit SHA." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$SES_IDENTITY_STATE_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- \
  infra/aws/app/email.tf \
  scripts/aws/ses-identity-state.sh \
  scripts/aws/ses-identity-state-action.txt \
  scripts/aws/phase5b-ses-terraform.test.mjs \
  .github/workflows/aws-ses-identity-state.yml
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]

ACTION="$(tr -d '[:space:]' < "$ACTION_FILE")"
case "$ACTION" in plan|apply-once) ;; *) echo "Unsupported SES identity state action." >&2; exit 1 ;; esac

WORK_DIR="$(mktemp -d "$PWD/.ses-identity-state.XXXXXXXX")"
trap 'rm -rf -- "$WORK_DIR"' EXIT

aws s3api get-object \
  --bucket "$STATE_BUCKET" \
  --key "$STATE_KEY" \
  --region "$AWS_REGION" \
  "$WORK_DIR/state.json" > "$WORK_DIR/object.json"
jq -e '.lineage == "197a6fae-9997-636e-e52b-c3ac6da85d90"' "$WORK_DIR/state.json" >/dev/null

STATE_COUNT="$(jq '[.resources[] | select(.mode=="managed" and .type=="aws_sesv2_email_identity" and .name=="transactional_domain")] | length' "$WORK_DIR/state.json")"
if [[ "$STATE_COUNT" == "1" ]]; then
  echo "SES_IDENTITY_STATE_ALREADY_RECONCILED=true"
  exit 0
fi
[[ "$STATE_COUNT" == "0" ]] || {
  echo "Unexpected SES identity state count: $STATE_COUNT" >&2
  exit 1
}

verify_live_identity() {
  local identity_path="$1"
  local tags_path="$2"
  aws sesv2 get-email-identity \
    --region "$AWS_REGION" \
    --email-identity "$IMPORT_ID" \
    --output json > "$identity_path"
  jq -e --arg configuration_set "$SES_CONFIGURATION_SET" '
    .ConfigurationSetName == $configuration_set and
    .DkimAttributes.CurrentSigningKeyLength == "RSA_2048_BIT" and
    .DkimAttributes.NextSigningKeyLength == "RSA_2048_BIT"
  ' "$identity_path" >/dev/null

  aws sesv2 list-tags-for-resource \
    --region "$AWS_REGION" \
    --resource-arn "$SES_IDENTITY_ARN" \
    --output json > "$tags_path"
}

canonical_live_shape() {
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

live_tags_match_desired() {
  local tags_path="$1"
  jq -e '
    ([.Tags[]? | {Key,Value}] | sort_by(.Key)) ==
    ([
      {Key:"Environment",Value:"staging"},
      {Key:"ManagedBy",Value:"Terraform"},
      {Key:"Project",Value:"Sea N Shore"}
    ] | sort_by(.Key))
  ' "$tags_path" >/dev/null
}

verify_live_identity "$WORK_DIR/live-before.json" "$WORK_DIR/tags-before.json"
LIVE_SHAPE_BEFORE="$(canonical_live_shape "$WORK_DIR/live-before.json")"
echo "SES_IDENTITY_STATE_LIVE_CONFIGURATION_SET=$(jq -r '.ConfigurationSetName' "$WORK_DIR/live-before.json")"
echo "SES_IDENTITY_STATE_LIVE_VERIFIED_FOR_SENDING=$(jq -r '.VerifiedForSendingStatus' "$WORK_DIR/live-before.json")"
echo "SES_IDENTITY_STATE_LIVE_VERIFICATION_STATUS=$(jq -r '.VerificationStatus' "$WORK_DIR/live-before.json")"
echo "SES_IDENTITY_STATE_LIVE_DKIM_STATUS=$(jq -r '.DkimAttributes.Status' "$WORK_DIR/live-before.json")"
echo "SES_IDENTITY_STATE_LIVE_CURRENT_SIGNING_KEY_LENGTH=$(jq -r '.DkimAttributes.CurrentSigningKeyLength' "$WORK_DIR/live-before.json")"
echo "SES_IDENTITY_STATE_LIVE_NEXT_SIGNING_KEY_LENGTH=$(jq -r '.DkimAttributes.NextSigningKeyLength' "$WORK_DIR/live-before.json")"
echo "SES_IDENTITY_STATE_LIVE_TAGS=$(jq -cS '[.Tags[]? | {Key,Value}] | sort_by(.Key)' "$WORK_DIR/tags-before.json")"
if live_tags_match_desired "$WORK_DIR/tags-before.json"; then
  TAGS_MATCH=true
else
  TAGS_MATCH=false
fi
echo "SES_IDENTITY_STATE_LIVE_TAGS_MATCH_DESIRED=$TAGS_MATCH"

python3 - "$WORK_DIR/state.json" "$WORK_DIR/variables.json" <<'PY'
import json, sys
with open(sys.argv[1]) as f:
    state = json.load(f)
resources = state['resources']

def attrs(kind, name=None):
    matches = [
        resource for resource in resources
        if resource['mode'] == 'managed'
        and resource['type'] == kind
        and (name is None or resource['name'] == name)
    ]
    assert len(matches) == 1, f'Expected one {kind} {name or ""}'.strip()
    return matches[0]['instances'][0]['attributes']

web_task = attrs('aws_ecs_task_definition', 'web')
containers = json.loads(web_task['container_definitions'])
web = next(container for container in containers if container['name'] == 'web')
site_url = next(item['value'] for item in web['environment'] if item['name'] == 'NEXT_PUBLIC_SITE_URL')
image = web['image']
assert ':' in image.rsplit('/', 1)[-1], f'Expected tag-qualified web image, got {image}'
values = {
    'image_tag': image.rsplit(':', 1)[1],
    'site_url': site_url,
    'aurora_engine_version': attrs('aws_rds_cluster', 'aurora')['engine_version'],
}
with open(sys.argv[2], 'w') as f:
    json.dump(values, f)
PY

terraform -chdir="$APP_DIR" init -input=false -no-color \
  -backend-config="bucket=$STATE_BUCKET" \
  -backend-config="key=$STATE_KEY" \
  -backend-config="region=$AWS_REGION" \
  -backend-config=use_lockfile=true > "$WORK_DIR/init.log"

python3 - "$APP_DIR/.terraform.lock.hcl" <<'PY'
import re, sys
lock_path = sys.argv[1]
with open(lock_path) as f:
    text = f.read()
expected = {
    'registry.terraform.io/hashicorp/aws': '6.62.0',
    'registry.terraform.io/hashicorp/archive': '2.8.1',
    'registry.terraform.io/hashicorp/random': '3.9.1',
}
for source, expected_version in expected.items():
    match = re.search(
        rf'provider\s+"{re.escape(source)}"\s*\{{(?P<body>.*?)\n\}}',
        text,
        re.S,
    )
    if not match:
        raise SystemExit(f'Missing provider lock for {source}')
    version_match = re.search(r'version\s*=\s*"([^"]+)"', match.group('body'))
    if not version_match:
        raise SystemExit(f'Missing locked version for {source}')
    actual_version = version_match.group(1)
    if actual_version != expected_version:
        raise SystemExit(
            f'Unexpected provider version for {source}: {actual_version}; expected {expected_version}'
        )
PY
echo "SES_IDENTITY_STATE_PROVIDER_LOCK_VERIFIED=true"

terraform -chdir="$APP_DIR" plan -input=false -no-color -lock-timeout=60s \
  -target="$RESOURCE" \
  -var-file="$WORK_DIR/variables.json" \
  -out="$WORK_DIR/before.tfplan" > "$WORK_DIR/plan-before.log"
terraform -chdir="$APP_DIR" show -json "$WORK_DIR/before.tfplan" > "$WORK_DIR/plan-before.json"

jq -e --arg resource "$RESOURCE" '
  ([.resource_changes[]? | select(.mode != "data") | select(.change.actions != ["no-op"])]) as $changes |
  ($changes | length) == 1 and
  $changes[0].address == $resource and
  $changes[0].change.actions == ["create"]
' "$WORK_DIR/plan-before.json" >/dev/null || {
  echo "SES identity pre-import plan contains unexpected actual changes." >&2
  jq '[.resource_changes[]? | select(.mode != "data") | select(.change.actions != ["no-op"]) | {address, actions:.change.actions}]' "$WORK_DIR/plan-before.json" >&2
  exit 1
}

STATE_SERIAL_BEFORE="$(jq -r '.serial' "$WORK_DIR/state.json")"
echo "SES_IDENTITY_STATE_ACTION=$ACTION"
echo "SES_IDENTITY_STATE_COUNT_BEFORE=0"
echo "STATE_SERIAL_BEFORE=$STATE_SERIAL_BEFORE"
echo "SES_IDENTITY_STATE_PLAN_VERIFIED=IMPORT_ONLY"
echo "PLAN_SHA256=$(sha256sum "$WORK_DIR/before.tfplan" | cut -d' ' -f1)"

if [[ "$ACTION" == "plan" ]]; then
  if [[ "$TAGS_MATCH" == true ]]; then
    echo "SES_IDENTITY_STATE_IMPORT_ELIGIBLE=true"
  else
    echo "SES_IDENTITY_STATE_IMPORT_ELIGIBLE=false"
  fi
  echo "SES_IDENTITY_STATE_PLAN_ONLY_NO_IMPORT"
  exit 0
fi

[[ "$TAGS_MATCH" == true ]] || {
  echo "Live SES identity tags do not match Terraform; refusing state-only import." >&2
  exit 1
}
[[ "$(git ls-remote origin refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$SES_IDENTITY_STATE_EXPECTED_SHA" ]]
[[ "$(aws s3api get-bucket-versioning --bucket "$STATE_BUCKET" --query Status --output text)" == Enabled ]]
STATE_BACKUP_VERSION="$(jq -r '.VersionId // empty' "$WORK_DIR/object.json")"
[[ -n "$STATE_BACKUP_VERSION" ]]
echo "STATE_BACKUP_VERSION=$STATE_BACKUP_VERSION"

verify_live_identity "$WORK_DIR/live-pre-import.json" "$WORK_DIR/tags-pre-import.json"
[[ "$(canonical_live_shape "$WORK_DIR/live-pre-import.json")" == "$LIVE_SHAPE_BEFORE" ]]
live_tags_match_desired "$WORK_DIR/tags-pre-import.json"

echo "IMPORTING_EXISTING_SES_IDENTITY_INTO_TERRAFORM_STATE"
terraform -chdir="$APP_DIR" import -input=false -no-color -var-file="$WORK_DIR/variables.json" "$RESOURCE" "$IMPORT_ID" > "$WORK_DIR/import.log"

terraform -chdir="$APP_DIR" plan -input=false -no-color -lock-timeout=60s \
  -target="$RESOURCE" \
  -var-file="$WORK_DIR/variables.json" \
  -out="$WORK_DIR/after.tfplan" > "$WORK_DIR/plan-after.log"
terraform -chdir="$APP_DIR" show -json "$WORK_DIR/after.tfplan" > "$WORK_DIR/plan-after.json"
ACTUAL_AFTER="$(jq '[.resource_changes[]? | select(.mode != "data") | select(.change.actions != ["no-op"])] | length' "$WORK_DIR/plan-after.json")"
[[ "$ACTUAL_AFTER" == "0" ]] || {
  echo "Imported SES identity still has Terraform drift; refusing success." >&2
  jq '[.resource_changes[]? | select(.mode != "data") | select(.change.actions != ["no-op"]) | {address, actions:.change.actions}]' "$WORK_DIR/plan-after.json" >&2
  exit 1
}

verify_live_identity "$WORK_DIR/live-after.json" "$WORK_DIR/tags-after.json"
[[ "$(canonical_live_shape "$WORK_DIR/live-after.json")" == "$LIVE_SHAPE_BEFORE" ]]
live_tags_match_desired "$WORK_DIR/tags-after.json"
terraform -chdir="$APP_DIR" state pull > "$WORK_DIR/state-after.json"
STATE_COUNT_AFTER="$(jq '[.resources[] | select(.mode=="managed" and .type=="aws_sesv2_email_identity" and .name=="transactional_domain")] | length' "$WORK_DIR/state-after.json")"
[[ "$STATE_COUNT_AFTER" == "1" ]]
STATE_SERIAL_AFTER="$(jq -r '.serial' "$WORK_DIR/state-after.json")"
[[ "$STATE_SERIAL_AFTER" -gt "$STATE_SERIAL_BEFORE" ]]
echo "STATE_SERIAL_AFTER=$STATE_SERIAL_AFTER"
echo "SES_IDENTITY_STATE_COUNT_AFTER=1"
echo "SES_IDENTITY_STATE_LIVE_SHAPE_UNCHANGED=true"
echo "SES_IDENTITY_STATE_IMPORT_VERIFIED=true"
