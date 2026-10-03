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
WEB_RESOURCE="aws_iam_role_policy.ecs_task_resend_secret"
OUTBOX_RESOURCE="aws_iam_role_policy.outbox_worker_resend_secret"
WEB_ROLE="sea-n-shore-staging-ecs-task"
OUTBOX_ROLE="sea-n-shore-staging-outbox-worker"
POLICY_NAME="sea-n-shore-staging-resend-secret-runtime"
SECRET_ARN_PATTERN="arn:aws:secretsmanager:ap-south-1:310356785722:secret:sea-n-shore/resend*"
ACTION_FILE="scripts/aws/ecs-resend-secret-policy-action.txt"

[[ "${ECS_RESEND_SECRET_POLICY_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "ECS_RESEND_SECRET_POLICY_EXPECTED_SHA must be an exact commit SHA." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$ECS_RESEND_SECRET_POLICY_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- \
  infra/aws/app/resend.tf \
  scripts/aws/ecs-resend-secret-policy.sh \
  scripts/aws/ecs-resend-secret-policy-action.txt \
  scripts/aws/ecs-resend-secret-policy-release.test.mjs \
  .github/workflows/aws-ecs-resend-secret-policy.yml
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]

ACTION="$(tr -d '[:space:]' < "$ACTION_FILE")"
case "$ACTION" in plan|apply-once) ;; *) echo "Unsupported ECS Resend secret policy action." >&2; exit 1 ;; esac

WORK_DIR="$(mktemp -d "$PWD/.ecs-resend-secret-policy.XXXXXXXX")"
trap 'rm -rf -- "$WORK_DIR"' EXIT

aws s3api get-object \
  --bucket "$STATE_BUCKET" \
  --key "$STATE_KEY" \
  --region "$AWS_REGION" \
  "$WORK_DIR/state.json" > "$WORK_DIR/object.json"
jq -e '.lineage == "197a6fae-9997-636e-e52b-c3ac6da85d90"' "$WORK_DIR/state.json" >/dev/null

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

terraform -chdir="$APP_DIR" plan -input=false -no-color -lock-timeout=60s \
  -target="$WEB_RESOURCE" \
  -target="$OUTBOX_RESOURCE" \
  -var-file="$WORK_DIR/variables.json" \
  -out="$WORK_DIR/before.tfplan" > "$WORK_DIR/plan-before.log"
terraform -chdir="$APP_DIR" show -json "$WORK_DIR/before.tfplan" > "$WORK_DIR/plan-before.json"

jq -e --arg web "$WEB_RESOURCE" --arg outbox "$OUTBOX_RESOURCE" '
  ([.resource_changes[]? | select(.mode != "data") | select(.change.actions != ["no-op"])]) as $changes |
  all($changes[];
    (.address == $web or .address == $outbox)
    and (.change.actions == ["create"] or .change.actions == ["update"])
  )
' "$WORK_DIR/plan-before.json" >/dev/null || {
  echo "Resend secret policy plan contains unexpected changes." >&2
  jq '[.resource_changes[]? | select(.mode != "data") | select(.change.actions != ["no-op"]) | {address, actions:.change.actions}]' "$WORK_DIR/plan-before.json" >&2
  exit 1
}

CHANGE_COUNT="$(jq '[.resource_changes[]? | select(.mode != "data") | select(.change.actions != ["no-op"])] | length' "$WORK_DIR/plan-before.json")"
[[ "$CHANGE_COUNT" -le 2 ]]
echo "RESEND_SECRET_POLICY_ACTION=$ACTION"
echo "RESEND_SECRET_POLICY_CHANGE_COUNT=$CHANGE_COUNT"
echo "RESEND_SECRET_POLICY_PLAN_VERIFIED=true"

if [[ "$ACTION" == "plan" ]]; then
  echo "RESEND_SECRET_POLICY_PLAN_ONLY_NO_APPLY"
  exit 0
fi

[[ "$(git ls-remote origin refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$ECS_RESEND_SECRET_POLICY_EXPECTED_SHA" ]]
[[ "$(aws s3api get-bucket-versioning --bucket "$STATE_BUCKET" --query Status --output text)" == Enabled ]]
STATE_BACKUP_VERSION="$(jq -r '.VersionId // empty' "$WORK_DIR/object.json")"
[[ -n "$STATE_BACKUP_VERSION" ]]
STATE_SERIAL_BEFORE="$(jq -r '.serial' "$WORK_DIR/state.json")"
echo "STATE_BACKUP_VERSION=$STATE_BACKUP_VERSION"
echo "STATE_SERIAL_BEFORE=$STATE_SERIAL_BEFORE"

if [[ "$CHANGE_COUNT" -gt 0 ]]; then
  terraform -chdir="$APP_DIR" apply -input=false -no-color "$WORK_DIR/before.tfplan" > "$WORK_DIR/apply.log"
fi

terraform -chdir="$APP_DIR" plan -input=false -no-color -lock-timeout=60s \
  -target="$WEB_RESOURCE" \
  -target="$OUTBOX_RESOURCE" \
  -var-file="$WORK_DIR/variables.json" \
  -out="$WORK_DIR/after.tfplan" > "$WORK_DIR/plan-after.log"
terraform -chdir="$APP_DIR" show -json "$WORK_DIR/after.tfplan" > "$WORK_DIR/plan-after.json"
ACTUAL_AFTER="$(jq '[.resource_changes[]? | select(.mode != "data") | select(.change.actions != ["no-op"])] | length' "$WORK_DIR/plan-after.json")"
[[ "$ACTUAL_AFTER" == "0" ]]

verify_live_policy() {
  local role_name="$1"
  local output_path="$2"
  aws iam get-role-policy --role-name "$role_name" --policy-name "$POLICY_NAME" --output json > "$output_path"
  jq -e --arg resource "$SECRET_ARN_PATTERN" --arg role "$role_name" --arg policy "$POLICY_NAME" '
    def as_array: if type == "array" then . else [.] end;
    .RoleName == $role and
    .PolicyName == $policy and
    (.PolicyDocument.Statement | length) == 1 and
    .PolicyDocument.Statement[0].Sid == "ReadResendApiKey" and
    .PolicyDocument.Statement[0].Effect == "Allow" and
    ((.PolicyDocument.Statement[0].Action | as_array) == ["secretsmanager:GetSecretValue"]) and
    ((.PolicyDocument.Statement[0].Resource | as_array) == [$resource])
  ' "$output_path" >/dev/null
}

verify_live_policy "$WEB_ROLE" "$WORK_DIR/web-policy.json"
verify_live_policy "$OUTBOX_ROLE" "$WORK_DIR/outbox-policy.json"

terraform -chdir="$APP_DIR" state pull > "$WORK_DIR/state-after.json"
for name in ecs_task_resend_secret outbox_worker_resend_secret; do
  COUNT="$(jq --arg name "$name" '[.resources[] | select(.mode=="managed" and .type=="aws_iam_role_policy" and .name==$name)] | length' "$WORK_DIR/state-after.json")"
  [[ "$COUNT" == "1" ]]
done
STATE_SERIAL_AFTER="$(jq -r '.serial' "$WORK_DIR/state-after.json")"
if [[ "$CHANGE_COUNT" -gt 0 ]]; then
  [[ "$STATE_SERIAL_AFTER" -gt "$STATE_SERIAL_BEFORE" ]]
fi
echo "STATE_SERIAL_AFTER=$STATE_SERIAL_AFTER"
echo "RESEND_SECRET_POLICY_LIVE_POLICIES_MATCH_DESIRED=true"
echo "RESEND_SECRET_POLICY_APPLY_VERIFIED=true"
