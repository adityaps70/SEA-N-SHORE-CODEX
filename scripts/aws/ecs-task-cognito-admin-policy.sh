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
RESOURCE="aws_iam_role_policy.ecs_task_cognito_admin"
ROLE_NAME="sea-n-shore-staging-ecs-task"
POLICY_NAME="sea-n-shore-staging-cognito-admin-runtime"
ACTION_FILE="scripts/aws/ecs-task-cognito-admin-policy-action.txt"

[[ "${ECS_TASK_COGNITO_ADMIN_POLICY_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "ECS_TASK_COGNITO_ADMIN_POLICY_EXPECTED_SHA must be an exact commit SHA." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$ECS_TASK_COGNITO_ADMIN_POLICY_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD --   infra/aws/app/auth.tf   scripts/aws/ecs-task-cognito-admin-policy.sh   scripts/aws/ecs-task-cognito-admin-policy-action.txt   scripts/aws/ecs-task-cognito-admin-policy-release.test.mjs   .github/workflows/aws-ecs-task-cognito-admin-policy.yml
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]

ACTION="$(tr -d '[:space:]' < "$ACTION_FILE")"
case "$ACTION" in plan|apply-once) ;; *) echo "Unsupported ECS task Cognito admin policy action." >&2; exit 1 ;; esac

WORK_DIR="$(mktemp -d "$PWD/.ecs-task-cognito-admin-policy.XXXXXXXX")"
trap 'rm -rf -- "$WORK_DIR"' EXIT

aws s3api get-object   --bucket "$STATE_BUCKET"   --key "$STATE_KEY"   --region "$AWS_REGION"   "$WORK_DIR/state.json" > "$WORK_DIR/object.json"
jq -e '.lineage == "197a6fae-9997-636e-e52b-c3ac6da85d90"' "$WORK_DIR/state.json" >/dev/null

STATE_COUNT="$(jq '[.resources[] | select(.mode=="managed" and .type=="aws_iam_role_policy" and .name=="ecs_task_cognito_admin")] | length' "$WORK_DIR/state.json")"
[[ "$STATE_COUNT" == "0" || "$STATE_COUNT" == "1" ]] || {
  echo "Unexpected ECS task Cognito admin policy state count: $STATE_COUNT" >&2
  exit 1
}

USER_POOL_ARN="$(jq -r '
  [.resources[]
   | select(.mode=="managed" and .type=="aws_cognito_user_pool" and .name=="app")
   | .instances[0].attributes.arn][0] // empty
' "$WORK_DIR/state.json")"
[[ "$USER_POOL_ARN" == arn:aws:cognito-idp:ap-south-1:310356785722:userpool/* ]] || {
  echo "Unable to resolve the staging Cognito user pool ARN from Terraform state." >&2
  exit 1
}

verify_live_policy() {
  local output_path="$1"
  aws iam get-role-policy --role-name "$ROLE_NAME" --policy-name "$POLICY_NAME" --output json > "$output_path"
  jq -e --arg resource "$USER_POOL_ARN" '
    def as_array: if type == "array" then . else [.] end;
    .RoleName == "sea-n-shore-staging-ecs-task" and
    .PolicyName == "sea-n-shore-staging-cognito-admin-runtime" and
    (.PolicyDocument.Statement | length) == 1 and
    .PolicyDocument.Statement[0].Sid == "AdministerUserAccounts" and
    .PolicyDocument.Statement[0].Effect == "Allow" and
    ((.PolicyDocument.Statement[0].Action | as_array | sort) == ([
      "cognito-idp:AdminDeleteUser",
      "cognito-idp:AdminDisableUser",
      "cognito-idp:AdminEnableUser",
      "cognito-idp:AdminUserGlobalSignOut"
    ] | sort)) and
    ((.PolicyDocument.Statement[0].Resource | as_array) == [$resource])
  ' "$output_path" >/dev/null
}

if [[ "$STATE_COUNT" == "1" ]]; then
  verify_live_policy "$WORK_DIR/live-policy-existing.json"
  echo "ECS_TASK_COGNITO_ADMIN_POLICY_STATE_ALREADY_RECONCILED=true"
  echo "ECS_TASK_COGNITO_ADMIN_POLICY_LIVE_POLICY_MATCHES_DESIRED=true"
  exit 0
fi

LIVE_EXISTS=false
if aws iam get-role-policy --role-name "$ROLE_NAME" --policy-name "$POLICY_NAME" --output json > "$WORK_DIR/live-policy-before.json" 2>"$WORK_DIR/live-policy-before.err"; then
  LIVE_EXISTS=true
  verify_live_policy "$WORK_DIR/live-policy-before-verified.json"
  echo "ECS_TASK_COGNITO_ADMIN_POLICY_LIVE_POLICY_MATCHES_DESIRED_BEFORE=true"
elif ! grep -q 'NoSuchEntity' "$WORK_DIR/live-policy-before.err"; then
  cat "$WORK_DIR/live-policy-before.err" >&2
  exit 1
else
  echo "ECS_TASK_COGNITO_ADMIN_POLICY_LIVE_ABSENT_VERIFIED=true"
fi

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

terraform -chdir="$APP_DIR" init -input=false -no-color   -backend-config="bucket=$STATE_BUCKET"   -backend-config="key=$STATE_KEY"   -backend-config="region=$AWS_REGION"   -backend-config=use_lockfile=true > "$WORK_DIR/init.log"

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
echo "ECS_TASK_COGNITO_ADMIN_POLICY_PROVIDER_LOCK_VERIFIED=true"

terraform -chdir="$APP_DIR" plan -input=false -no-color -lock-timeout=60s   -target="$RESOURCE"   -var-file="$WORK_DIR/variables.json"   -out="$WORK_DIR/before.tfplan" > "$WORK_DIR/plan-before.log"
terraform -chdir="$APP_DIR" show -json "$WORK_DIR/before.tfplan" > "$WORK_DIR/plan-before.json"

jq -e --arg resource "$RESOURCE" '
  ([.resource_changes[]? | select(.mode != "data") | select(.change.actions != ["no-op"])]) as $changes |
  ($changes | length) == 1 and
  $changes[0].address == $resource and
  $changes[0].change.actions == ["create"]
' "$WORK_DIR/plan-before.json" >/dev/null || {
  echo "ECS task Cognito admin policy plan contains unexpected actual changes." >&2
  jq '[.resource_changes[]? | select(.mode != "data") | select(.change.actions != ["no-op"]) | {address, actions:.change.actions}]' "$WORK_DIR/plan-before.json" >&2
  exit 1
}

STATE_SERIAL_BEFORE="$(jq -r '.serial' "$WORK_DIR/state.json")"
echo "ECS_TASK_COGNITO_ADMIN_POLICY_ACTION=$ACTION"
echo "ECS_TASK_COGNITO_ADMIN_POLICY_STATE_COUNT_BEFORE=0"
echo "STATE_SERIAL_BEFORE=$STATE_SERIAL_BEFORE"
if [[ "$LIVE_EXISTS" == "true" ]]; then
  echo "ECS_TASK_COGNITO_ADMIN_POLICY_PLAN_VERIFIED=IMPORT_REQUIRED"
else
  echo "ECS_TASK_COGNITO_ADMIN_POLICY_PLAN_VERIFIED=CREATE_ONLY"
fi
echo "PLAN_SHA256=$(sha256sum "$WORK_DIR/before.tfplan" | cut -d' ' -f1)"

if [[ "$ACTION" == "plan" ]]; then
  echo "ECS_TASK_COGNITO_ADMIN_POLICY_PLAN_ONLY_NO_APPLY"
  exit 0
fi

[[ "$(git ls-remote origin refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$ECS_TASK_COGNITO_ADMIN_POLICY_EXPECTED_SHA" ]]
[[ "$(aws s3api get-bucket-versioning --bucket "$STATE_BUCKET" --query Status --output text)" == Enabled ]]
STATE_BACKUP_VERSION="$(jq -r '.VersionId // empty' "$WORK_DIR/object.json")"
[[ -n "$STATE_BACKUP_VERSION" ]]
echo "STATE_BACKUP_VERSION=$STATE_BACKUP_VERSION"

if [[ "$LIVE_EXISTS" == "true" ]]; then
  echo "IMPORTING_EXISTING_ECS_TASK_COGNITO_ADMIN_POLICY_INTO_TERRAFORM_STATE"
  terraform -chdir="$APP_DIR" import -input=false -no-color     -var-file="$WORK_DIR/variables.json"     "$RESOURCE" "$ROLE_NAME:$POLICY_NAME" > "$WORK_DIR/import.log"
else
  echo "APPLYING_SAVED_ECS_TASK_COGNITO_ADMIN_POLICY_PLAN"
  terraform -chdir="$APP_DIR" apply -input=false -no-color "$WORK_DIR/before.tfplan" > "$WORK_DIR/apply.log"
fi

terraform -chdir="$APP_DIR" plan -input=false -no-color -lock-timeout=60s   -target="$RESOURCE"   -var-file="$WORK_DIR/variables.json"   -out="$WORK_DIR/after.tfplan" > "$WORK_DIR/plan-after.log"
terraform -chdir="$APP_DIR" show -json "$WORK_DIR/after.tfplan" > "$WORK_DIR/plan-after.json"
ACTUAL_AFTER="$(jq '[.resource_changes[]? | select(.mode != "data") | select(.change.actions != ["no-op"])] | length' "$WORK_DIR/plan-after.json")"
[[ "$ACTUAL_AFTER" == "0" ]] || {
  echo "ECS task Cognito admin policy still has Terraform drift after reconciliation." >&2
  jq '[.resource_changes[]? | select(.mode != "data") | select(.change.actions != ["no-op"]) | {address, actions:.change.actions}]' "$WORK_DIR/plan-after.json" >&2
  exit 1
}

verify_live_policy "$WORK_DIR/live-policy-after.json"
terraform -chdir="$APP_DIR" state pull > "$WORK_DIR/state-after.json"
STATE_COUNT_AFTER="$(jq '[.resources[] | select(.mode=="managed" and .type=="aws_iam_role_policy" and .name=="ecs_task_cognito_admin")] | length' "$WORK_DIR/state-after.json")"
[[ "$STATE_COUNT_AFTER" == "1" ]]
STATE_SERIAL_AFTER="$(jq -r '.serial' "$WORK_DIR/state-after.json")"
[[ "$STATE_SERIAL_AFTER" -gt "$STATE_SERIAL_BEFORE" ]]
echo "STATE_SERIAL_AFTER=$STATE_SERIAL_AFTER"
echo "ECS_TASK_COGNITO_ADMIN_POLICY_STATE_COUNT_AFTER=1"
echo "ECS_TASK_COGNITO_ADMIN_POLICY_LIVE_POLICY_MATCHES_DESIRED=true"
echo "ECS_TASK_COGNITO_ADMIN_POLICY_APPLY_VERIFIED=true"
