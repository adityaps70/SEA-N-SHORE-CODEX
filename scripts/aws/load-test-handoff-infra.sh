#!/usr/bin/env bash
# Round ARCH (signed-in load test): the S3 hand-off of the sealed load-test sessions (infra/aws/app/load-test-handoff.tf).
# Owner-approved at ₹88/month (the KMS key). The ONLY changes this runner may make are creating:
#   - the KMS key (rotation on, 7-day deletion window) with exactly the approved key policy, and its alias;
#   - the private bucket (not versioned) with public access blocked, owner-enforced objects, default SSE-KMS with the
#     key and a bucket key, a 1-day expiry, and a policy that refuses plain HTTP and any upload naming its own encryption;
#   - the web task role's one statement: s3:PutObject on sessions/* only.
# plan (read only): the targeted plan, checked. apply-once: applies exactly that plan, then verifies each piece live.
# Anything else in a plan refuses. Prints names, counts and true/false only.
set -euo pipefail
umask 077
export PATH="$HOME/bin:$PATH"
export AWS_PAGER=""
EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
STATE_BUCKET="sea-n-shore-310356785722-ap-south-1-tfstate"
STATE_KEY="sea-n-shore/staging/terraform.tfstate"
APP_DIR="$PWD/infra/aws/app"
ACTION_FILE="scripts/aws/load-test-handoff-infra-action.txt"
BUCKET="sea-n-shore-staging-310356785722-load-test-handoff"
KEY_ALIAS="alias/sea-n-shore-staging-load-test-handoff"
TASK_ROLE="sea-n-shore-staging-ecs-task"
TASK_POLICY_NAME="sea-n-shore-staging-load-test-handoff"
GITHUB_ROLE_ARN="arn:aws:iam::310356785722:role/sea-n-shore-staging-github-deploy"
RESOURCES=(
  "aws_kms_key.load_test_handoff"
  "aws_kms_alias.load_test_handoff"
  "aws_s3_bucket.load_test_handoff"
  "aws_s3_bucket_public_access_block.load_test_handoff"
  "aws_s3_bucket_ownership_controls.load_test_handoff"
  "aws_s3_bucket_server_side_encryption_configuration.load_test_handoff"
  "aws_s3_bucket_lifecycle_configuration.load_test_handoff"
  "aws_s3_bucket_policy.load_test_handoff"
  "aws_iam_role_policy.ecs_task_load_test_handoff"
)

[[ "${LOAD_TEST_HANDOFF_INFRA_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "LOAD_TEST_HANDOFF_INFRA_EXPECTED_SHA must be an exact commit SHA." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$LOAD_TEST_HANDOFF_INFRA_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- infra/aws/app scripts/aws/load-test-handoff-infra.sh scripts/aws/check-load-test-handoff-plan.py "$ACTION_FILE"
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]
source scripts/aws/bootstrap-terraform-lock.sh

ACTION="$(cut -d' ' -f1 < "$ACTION_FILE" | tr -d '[:space:]')"
case "$ACTION" in plan|apply-once) ;; *) echo "Unsupported load-test hand-off infra action." >&2; exit 1 ;; esac

WORK_DIR="$(mktemp -d "$PWD/.load-test-handoff-infra.XXXXXXXX")"
trap 'rm -rf -- "$WORK_DIR"' EXIT; trap 'exit 129' HUP; trap 'exit 130' INT; trap 'exit 143' TERM

aws s3api get-object --bucket "$STATE_BUCKET" --key "$STATE_KEY" --region "$AWS_REGION" "$WORK_DIR/state.json" > "$WORK_DIR/object.json"
jq -e '.lineage == "197a6fae-9997-636e-e52b-c3ac6da85d90"' "$WORK_DIR/state.json" >/dev/null
# The configuration needs its variables even for these targets; the same values as the media CDN runner.
python3 - "$WORK_DIR/state.json" "$WORK_DIR/variables.json" <<'PY'
import json, sys
with open(sys.argv[1]) as f:
    resources = json.load(f)['resources']

def attrs(kind, name):
    matches = [r for r in resources if r['mode'] == 'managed' and r['type'] == kind and r['name'] == name]
    assert len(matches) == 1, f'Expected one {kind}.{name}'
    return matches[0]['instances'][0]['attributes']

web = next(c for c in json.loads(attrs('aws_ecs_task_definition', 'web')['container_definitions']) if c['name'] == 'web')
site_url = next(item['value'] for item in web['environment'] if item['name'] == 'NEXT_PUBLIC_SITE_URL')
image = web['image']
assert ':' in image.rsplit('/', 1)[-1], f'Expected tag-qualified web image, got {image}'
with open(sys.argv[2], 'w') as f:
    json.dump({'image_tag': image.rsplit(':', 1)[1], 'site_url': site_url, 'aurora_engine_version': attrs('aws_rds_cluster', 'aurora')['engine_version']}, f)
PY

terraform -chdir="$APP_DIR" init -input=false -no-color \
  -backend-config="bucket=$STATE_BUCKET" -backend-config="key=$STATE_KEY" \
  -backend-config="region=$AWS_REGION" -backend-config=use_lockfile=true > "$WORK_DIR/init.log"

PLAN_ARGS=()
for resource in "${RESOURCES[@]}"; do PLAN_ARGS+=("-target=$resource"); done
plan() {
  # Bounded like every host plan: interrupted and retried once if it hangs (scripts/aws/bootstrap-terraform-lock.sh).
  terraform_plan_bounded "$WORK_DIR/$1.log" -chdir="$APP_DIR" plan -input=false -no-color -lock-timeout=60s \
    "${PLAN_ARGS[@]}" -var-file="$WORK_DIR/variables.json" -out="$WORK_DIR/$1.tfplan"
  terraform -chdir="$APP_DIR" show -json "$WORK_DIR/$1.tfplan" > "$WORK_DIR/$1.json"
}
# Prints the classification; exits non-zero for anything but "no change" or exactly the approved creates.
classify() {
  python3 scripts/aws/check-load-test-handoff-plan.py "$1"
}

# Live state, true/false and counts only.
live_state() {
  local key_id
  key_id="$(aws kms describe-key --region "$AWS_REGION" --key-id "$KEY_ALIAS" --query KeyMetadata.KeyId --output text 2>/dev/null || true)"
  if [[ ! "$key_id" =~ ^[0-9a-f-]{36}$ ]]; then echo "key=missing"; return 0; fi
  local key_arn="arn:aws:kms:${AWS_REGION}:${EXPECTED_ACCOUNT}:key/${key_id}"
  local enabled rotation key_policy encryption versioning public lifecycle bucket_policy task_policy
  enabled="$(aws kms describe-key --region "$AWS_REGION" --key-id "$key_id" --query 'KeyMetadata.KeyState == `Enabled`' --output text)"
  rotation="$(aws kms get-key-rotation-status --region "$AWS_REGION" --key-id "$key_id" --query KeyRotationEnabled --output text)"
  key_policy="$(aws kms get-key-policy --region "$AWS_REGION" --key-id "$key_id" --policy-name default --query Policy --output text \
    | python3 scripts/aws/check-load-test-handoff-plan.py --key-policy "$GITHUB_ROLE_ARN")"
  encryption="$(aws s3api get-bucket-encryption --region "$AWS_REGION" --bucket "$BUCKET" --output json \
    | jq --arg key "$key_arn" '.ServerSideEncryptionConfiguration.Rules | length == 1 and .[0].ApplyServerSideEncryptionByDefault.SSEAlgorithm == "aws:kms" and .[0].ApplyServerSideEncryptionByDefault.KMSMasterKeyID == $key and .[0].BucketKeyEnabled == true')"
  versioning="$(aws s3api get-bucket-versioning --region "$AWS_REGION" --bucket "$BUCKET" --output json | jq -r '.Status // "never"')"
  public="$(aws s3api get-public-access-block --region "$AWS_REGION" --bucket "$BUCKET" --output json \
    | jq '.PublicAccessBlockConfiguration | [.BlockPublicAcls, .IgnorePublicAcls, .BlockPublicPolicy, .RestrictPublicBuckets] | all')"
  lifecycle="$(aws s3api get-bucket-lifecycle-configuration --region "$AWS_REGION" --bucket "$BUCKET" --output json \
    | jq '[.Rules[] | select(.Status == "Enabled" and .Expiration.Days == 1 and .AbortIncompleteMultipartUpload.DaysAfterInitiation == 1)] | length == 1')"
  bucket_policy="$(aws s3api get-bucket-policy --region "$AWS_REGION" --bucket "$BUCKET" --query Policy --output text \
    | jq '[.Statement[] | select(.Effect == "Deny") | .Sid] | sort == ["DenyCustomerKeys", "DenyInsecureTransport", "DenyOwnEncryptionHeaders"]')"
  task_policy="$(aws iam get-role-policy --role-name "$TASK_ROLE" --policy-name "$TASK_POLICY_NAME" --query PolicyDocument --output json \
    | jq --arg bucket "$BUCKET" '.Statement == [{"Sid": "WriteSealedLoadTestSessions", "Effect": "Allow", "Action": "s3:PutObject", "Resource": ("arn:aws:s3:::" + $bucket + "/sessions/*")}] or .Statement == [{"Sid": "WriteSealedLoadTestSessions", "Effect": "Allow", "Action": ["s3:PutObject"], "Resource": ("arn:aws:s3:::" + $bucket + "/sessions/*")}]')"
  local objects
  objects="$(aws s3api list-objects-v2 --region "$AWS_REGION" --bucket "$BUCKET" --query KeyCount --output text)"
  echo "key=enabled:$enabled rotation=$rotation key_policy=$key_policy encryption=$encryption versioning=$versioning public_blocked=$public lifecycle_1_day=$lifecycle bucket_policy=$bucket_policy task_put_only=$task_policy objects=$objects"
}

echo "LOAD_TEST_HANDOFF_LIVE_BEFORE $(live_state)"
plan before
CLASSIFICATION="$(classify "$WORK_DIR/before.json")"
echo "$CLASSIFICATION"

if grep -qx 'LOAD_TEST_HANDOFF_PLAN=NO_CHANGES' <<<"$CLASSIFICATION"; then
  echo "LOAD_TEST_HANDOFF_ALREADY_APPLIED=true"
  exit 0
fi
if [[ "$ACTION" == "plan" ]]; then
  echo "LOAD_TEST_HANDOFF_PLAN_ONLY_NO_APPLY"
  exit 0
fi

[[ "$(bash scripts/aws/branch-head.sh refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$LOAD_TEST_HANDOFF_INFRA_EXPECTED_SHA" ]] || {
  echo "Branch moved after the load-test hand-off run started; refusing stale execution." >&2
  exit 1
}
# Apply exactly the plan that was classified.
terraform -chdir="$APP_DIR" apply -input=false -no-color -lock-timeout=60s "$WORK_DIR/before.tfplan" > "$WORK_DIR/apply.log"

plan after
classify "$WORK_DIR/after.json" | grep -qx 'LOAD_TEST_HANDOFF_PLAN=NO_CHANGES' || { echo "The hand-off still differs after the apply." >&2; exit 1; }
LIVE_AFTER="$(live_state)"
echo "LOAD_TEST_HANDOFF_LIVE_AFTER $LIVE_AFTER"
[[ "$LIVE_AFTER" == "key=enabled:True rotation=True key_policy=true encryption=true versioning=never public_blocked=true lifecycle_1_day=true bucket_policy=true task_put_only=true objects=0" ]] || {
  echo "The live hand-off does not match the approved shape." >&2
  exit 1
}
echo "LOAD_TEST_HANDOFF_VERIFIED=true"
echo "LOAD_TEST_HANDOFF_APPLY_COMPLETE"
