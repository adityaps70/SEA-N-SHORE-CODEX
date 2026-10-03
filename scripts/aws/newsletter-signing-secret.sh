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
ACTION_FILE="scripts/aws/newsletter-signing-secret-action.txt"
SECRET_NAME="sea-n-shore-staging/newsletter-token-signing"
EXECUTION_ROLE="sea-n-shore-staging-ecs-execution"
POLICY_NAME="sea-n-shore-staging-newsletter-token-secret"
WEB_TASK_FAMILY="sea-n-shore-staging-web"
WEB_CONTAINER="web"
OUTBOX_TASK_FAMILY="sea-n-shore-staging-outbox-worker"
OUTBOX_CONTAINER="outbox-worker"
RESOURCES=(
  "random_password.newsletter_token"
  "aws_secretsmanager_secret.newsletter_token"
  "aws_secretsmanager_secret_version.newsletter_token"
  "aws_iam_role_policy.ecs_execution_newsletter_token_secret"
)

[[ "${NEWSLETTER_SIGNING_SECRET_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "NEWSLETTER_SIGNING_SECRET_EXPECTED_SHA must be an exact commit SHA." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$NEWSLETTER_SIGNING_SECRET_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- \
  infra/aws/app/newsletter-email.tf \
  infra/aws/app/main.tf \
  scripts/aws/newsletter-signing-secret.sh \
  scripts/aws/newsletter-signing-secret-action.txt \
  scripts/aws/newsletter-signing-secret-release.test.mjs \
  .github/workflows/aws-newsletter-signing-secret.yml
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]

ACTION="$(tr -d '[:space:]' < "$ACTION_FILE")"
case "$ACTION" in plan|apply-once) ;; *) echo "Unsupported newsletter signing secret action." >&2; exit 1 ;; esac

WORK_DIR="$(mktemp -d "$PWD/.newsletter-signing-secret.XXXXXXXX")"
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

PLAN_ARGS=()
for resource in "${RESOURCES[@]}"; do PLAN_ARGS+=("-target=$resource"); done

terraform -chdir="$APP_DIR" plan -input=false -no-color -lock-timeout=60s \
  "${PLAN_ARGS[@]}" \
  -var-file="$WORK_DIR/variables.json" \
  -out="$WORK_DIR/before.tfplan" > "$WORK_DIR/plan-before.log"
terraform -chdir="$APP_DIR" show -json "$WORK_DIR/before.tfplan" > "$WORK_DIR/plan-before.json"

jq -e '
  def allowed:
    . == ["create"]
    or . == ["update"]
    or . == ["delete","create"]
    or . == ["create","delete"];
  ([.resource_changes[]?
    | select(.mode != "data")
    | select(.change.actions != ["no-op"])]) as $changes |
  all($changes[];
    (
      .address == "random_password.newsletter_token"
      or .address == "aws_secretsmanager_secret.newsletter_token"
      or .address == "aws_secretsmanager_secret_version.newsletter_token"
      or .address == "aws_iam_role_policy.ecs_execution_newsletter_token_secret"
    )
    and (.change.actions | allowed)
  )
' "$WORK_DIR/plan-before.json" >/dev/null || {
  echo "Newsletter signing secret plan contains unexpected changes." >&2
  jq '[.resource_changes[]? | select(.mode != "data") | select(.change.actions != ["no-op"]) | {address, actions:.change.actions}]' "$WORK_DIR/plan-before.json" >&2
  exit 1
}

CHANGE_COUNT="$(jq '[.resource_changes[]? | select(.mode != "data") | select(.change.actions != ["no-op"])] | length' "$WORK_DIR/plan-before.json")"
echo "NEWSLETTER_SIGNING_SECRET_ACTION=$ACTION"
echo "NEWSLETTER_SIGNING_SECRET_CHANGE_COUNT=$CHANGE_COUNT"
echo "NEWSLETTER_SIGNING_SECRET_PLAN_VERIFIED=true"

verify_live() {
  local secret_arn
  secret_arn="$(aws secretsmanager describe-secret \
    --region "$AWS_REGION" \
    --secret-id "$SECRET_NAME" \
    --query ARN --output text)"
  [[ "$secret_arn" == arn:aws:secretsmanager:ap-south-1:310356785722:secret:sea-n-shore-staging/newsletter-token-signing-* ]]

  aws iam get-role-policy \
    --role-name "$EXECUTION_ROLE" \
    --policy-name "$POLICY_NAME" \
    --output json > "$WORK_DIR/policy.json"
  jq -e --arg secret "$secret_arn" '
    def as_array: if type == "array" then . else [.] end;
    (.PolicyDocument.Statement | length) == 1 and
    .PolicyDocument.Statement[0].Sid == "ReadNewsletterTokenSecret" and
    .PolicyDocument.Statement[0].Effect == "Allow" and
    ((.PolicyDocument.Statement[0].Action | as_array) == ["secretsmanager:GetSecretValue"]) and
    ((.PolicyDocument.Statement[0].Resource | as_array) == [$secret])
  ' "$WORK_DIR/policy.json" >/dev/null

  for pair in "$WEB_TASK_FAMILY:$WEB_CONTAINER" "$OUTBOX_TASK_FAMILY:$OUTBOX_CONTAINER"; do
    local family="${pair%%:*}"
    local container="${pair#*:}"
    aws ecs describe-task-definition \
      --region "$AWS_REGION" \
      --task-definition "$family" \
      --query taskDefinition --output json > "$WORK_DIR/${container}-verify.json"
    jq -e --arg name "$container" --arg secret "$secret_arn" '
      .containerDefinitions[]
      | select(.name == $name)
      | [(.secrets // [])[] | select(.name == "NEWSLETTER_TOKEN_SECRET" and .valueFrom == $secret)]
      | length == 1
    ' "$WORK_DIR/${container}-verify.json" >/dev/null
  done

  echo "NEWSLETTER_SIGNING_SECRET_LIVE_VERIFIED=true"
}

prepare_task_secret() {
  local family="$1"
  local container="$2"
  local secret_arn="$3"
  local current="$WORK_DIR/${container}-current.json"
  local next="$WORK_DIR/${container}-next.json"

  aws ecs describe-task-definition \
    --region "$AWS_REGION" \
    --task-definition "$family" \
    --query taskDefinition --output json > "$current"

  if jq -e --arg name "$container" --arg secret "$secret_arn" '
    .containerDefinitions[]
    | select(.name == $name)
    | [(.secrets // [])[] | select(.name == "NEWSLETTER_TOKEN_SECRET" and .valueFrom == $secret)]
    | length == 1
  ' "$current" >/dev/null; then
    echo "NEWSLETTER_TASK_SECRET_PREPARED=$family|already-current"
    return
  fi

  jq --arg name "$container" --arg secret "$secret_arn" '
    del(
      .taskDefinitionArn,
      .revision,
      .status,
      .requiresAttributes,
      .compatibilities,
      .registeredAt,
      .registeredBy
    )
    | .containerDefinitions |= map(
        if .name == $name then
          .secrets = (
            ((.secrets // []) | map(select(.name != "NEWSLETTER_TOKEN_SECRET")))
            + [{"name":"NEWSLETTER_TOKEN_SECRET","valueFrom":$secret}]
          )
        else . end
      )
  ' "$current" > "$next"

  local task_arn
  task_arn="$(aws ecs register-task-definition \
    --region "$AWS_REGION" \
    --cli-input-json "file://$next" \
    --query taskDefinition.taskDefinitionArn \
    --output text)"
  [[ "$task_arn" == arn:aws:ecs:ap-south-1:310356785722:task-definition/"$family":* ]]
  echo "NEWSLETTER_TASK_SECRET_PREPARED=$family|$task_arn"
}

if [[ "$ACTION" == "plan" ]]; then
  if [[ "$CHANGE_COUNT" -eq 0 ]]; then
    verify_live
  fi
  echo "NEWSLETTER_SIGNING_SECRET_PLAN_ONLY_NO_APPLY"
  exit 0
fi

[[ "$(git ls-remote origin refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$NEWSLETTER_SIGNING_SECRET_EXPECTED_SHA" ]]
[[ "$(aws s3api get-bucket-versioning --bucket "$STATE_BUCKET" --query Status --output text)" == Enabled ]]
STATE_BACKUP_VERSION="$(jq -r '.VersionId // empty' "$WORK_DIR/object.json")"
[[ -n "$STATE_BACKUP_VERSION" ]]
echo "STATE_BACKUP_VERSION=$STATE_BACKUP_VERSION"

if [[ "$CHANGE_COUNT" -gt 0 ]]; then
  terraform -chdir="$APP_DIR" apply -input=false -no-color "$WORK_DIR/before.tfplan" > "$WORK_DIR/apply.log"
fi

SECRET_ARN="$(aws secretsmanager describe-secret \
  --region "$AWS_REGION" \
  --secret-id "$SECRET_NAME" \
  --query ARN --output text)"
[[ "$SECRET_ARN" == arn:aws:secretsmanager:ap-south-1:310356785722:secret:sea-n-shore-staging/newsletter-token-signing-* ]]

prepare_task_secret "$WEB_TASK_FAMILY" "$WEB_CONTAINER" "$SECRET_ARN"
prepare_task_secret "$OUTBOX_TASK_FAMILY" "$OUTBOX_CONTAINER" "$SECRET_ARN"
verify_live

terraform -chdir="$APP_DIR" plan -input=false -no-color -lock-timeout=60s \
  "${PLAN_ARGS[@]}" \
  -var-file="$WORK_DIR/variables.json" \
  -out="$WORK_DIR/after.tfplan" > "$WORK_DIR/plan-after.log"
terraform -chdir="$APP_DIR" show -json "$WORK_DIR/after.tfplan" > "$WORK_DIR/plan-after.json"
ACTUAL_AFTER="$(jq '[.resource_changes[]? | select(.mode != "data") | select(.change.actions != ["no-op"])] | length' "$WORK_DIR/plan-after.json")"
[[ "$ACTUAL_AFTER" == "0" ]] || {
  echo "Newsletter signing secret Terraform drift remains after apply." >&2
  exit 1
}

echo "NEWSLETTER_SIGNING_SECRET_APPLY_VERIFIED=true"
