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
ACTION_FILE="scripts/aws/realtime-infra-action.txt"
PLAN_CLASSIFIER="scripts/aws/realtime-infra-plan-classifier.mjs"

[[ "${REALTIME_INFRA_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "REALTIME_INFRA_EXPECTED_SHA must be an exact commit SHA." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$REALTIME_INFRA_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- \
  infra/aws/app/realtime.tf \
  infra/aws/app/main.tf \
  infra/aws/app/lambda/realtime-authorizer.mjs \
  infra/aws/app/lambda/realtime-connection.mjs \
  infra/aws/app/lambda/realtime-fanout.mjs \
  scripts/aws/realtime-infra.sh \
  scripts/aws/realtime-infra-action.txt \
  scripts/aws/realtime-infra-plan-classifier.mjs \
  scripts/aws/realtime-messaging-terraform.test.mjs \
  .github/workflows/aws-realtime-infra.yml
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]

ACTION="$(tr -d '[:space:]' < "$ACTION_FILE")"
case "$ACTION" in plan|apply-once) ;; *) echo "Unsupported realtime infrastructure action." >&2; exit 1 ;; esac

WORK_DIR="$(mktemp -d "$PWD/.realtime-infra.XXXXXXXX")"
trap 'rm -rf -- "$WORK_DIR"' EXIT

aws s3api get-object \
  --bucket "$STATE_BUCKET" \
  --key "$STATE_KEY" \
  --region "$AWS_REGION" \
  "$WORK_DIR/state.json" > "$WORK_DIR/object.json"
jq -e '.lineage == "197a6fae-9997-636e-e52b-c3ac6da85d90"' "$WORK_DIR/state.json" >/dev/null

SERVICE_TASK_BEFORE="$(aws ecs describe-services \
  --region "$AWS_REGION" \
  --cluster sea-n-shore-staging \
  --services sea-n-shore-staging-web \
  --query 'services[0].taskDefinition' \
  --output text)"
[[ "$SERVICE_TASK_BEFORE" == arn:aws:ecs:ap-south-1:310356785722:task-definition/sea-n-shore-staging-web:* ]]

python3 - "$WORK_DIR/state.json" "$WORK_DIR/variables.json" <<'PY'
import json, sys
state_path, output_path = sys.argv[1:]
with open(state_path) as f:
    state = json.load(f)
resources = state['resources']

def attrs(kind, name=None):
    matches = [
        resource for resource in resources
        if resource['type'] == kind
        and resource['mode'] == 'managed'
        and (name is None or resource['name'] == name)
    ]
    assert len(matches) == 1, f'Expected exactly one {kind} {name or ""}'.strip()
    return matches[0]['instances'][0]['attributes']

web_task = attrs('aws_ecs_task_definition', 'web')
containers = json.loads(web_task['container_definitions'])
web = next(container for container in containers if container['name'] == 'web')
site_url = next(item['value'] for item in web['environment'] if item['name'] == 'NEXT_PUBLIC_SITE_URL')
image = web['image']
assert ':' in image.rsplit('/', 1)[-1], f'Expected tag-qualified web image, got {image}'
image_tag = image.rsplit(':', 1)[1]
assert image_tag and '@' not in image_tag
values = {
    'image_tag': image_tag,
    'site_url': site_url,
    'aurora_engine_version': attrs('aws_rds_cluster', 'aurora')['engine_version'],
    'social_worker_desired_count': 1,
}
with open(output_path, 'w') as f:
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
echo "REALTIME_PROVIDER_LOCK_VERIFIED=true"

TARGETS=()
while IFS= read -r target; do
  [[ -n "$target" ]] && TARGETS+=("$target")
done < <(node --input-type=module -e "import('./$PLAN_CLASSIFIER').then((m) => console.log([...m.REALTIME_INFRA_CREATE_RESOURCES, m.REALTIME_WEB_TASK_RESOURCE].join('\\n')))" )
[[ "${#TARGETS[@]}" -gt 1 ]]
PLAN_ARGS=()
for target in "${TARGETS[@]}"; do
  PLAN_ARGS+=("-target=$target")
done

terraform -chdir="$APP_DIR" plan -input=false -no-color -lock-timeout=60s \
  "${PLAN_ARGS[@]}" \
  -var-file="$WORK_DIR/variables.json" \
  -out="$WORK_DIR/realtime.tfplan" > "$WORK_DIR/plan.log"
terraform -chdir="$APP_DIR" show -json "$WORK_DIR/realtime.tfplan" > "$WORK_DIR/plan.json"

CLASSIFICATION="$(node "$PLAN_CLASSIFIER" "$WORK_DIR/plan.json" "$ACTION")"
PLAN_MODE="$(jq -r '.mode' <<<"$CLASSIFICATION")"
CREATE_COUNT="$(jq -r '.createCount' <<<"$CLASSIFICATION")"
REPLACE_COUNT="$(jq -r '.replaceCount' <<<"$CLASSIFICATION")"
STATE_SERIAL_BEFORE="$(jq -r '.serial' "$WORK_DIR/state.json")"

echo "REALTIME_INFRA_ACTION=$ACTION"
echo "REALTIME_INFRA_PLAN_MODE=$PLAN_MODE"
echo "REALTIME_INFRA_CREATE_COUNT=$CREATE_COUNT"
echo "REALTIME_INFRA_REPLACE_COUNT=$REPLACE_COUNT"
echo "STATE_SERIAL_BEFORE=$STATE_SERIAL_BEFORE"

if [[ "$PLAN_MODE" == "steady" ]]; then
  jq '[.resource_changes[]? | select(.mode != "data") | select(.change.actions != ["no-op"]) | {address, actions: .change.actions}]' "$WORK_DIR/plan.json"
  echo "REALTIME_INFRA_STEADY_STATE=true"
  echo "REALTIME_INFRA_PLAN_VERIFIED=NO_CHANGES"
  echo "REALTIME_INFRA_PLAN_ONLY_NO_APPLY"
  exit 0
fi

echo "REALTIME_INFRA_PLAN_GUARD=CREATE_ONLY_REALTIME_PLUS_WEB_TASK_REPLACEMENT"
jq '[.resource_changes[]? | select(.mode != "data") | select(.change.actions != ["no-op"]) | {address, actions: .change.actions}]' "$WORK_DIR/plan.json"
echo "PLAN_SHA256=$(sha256sum "$WORK_DIR/realtime.tfplan" | cut -d' ' -f1)"
echo "REALTIME_INFRA_PLAN_VERIFIED=BOUNDED_INITIAL_CUTOVER"

if [[ "$ACTION" == "plan" ]]; then
  echo "REALTIME_INFRA_PLAN_ONLY_NO_APPLY"
  exit 0
fi

[[ "$(git ls-remote origin refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$REALTIME_INFRA_EXPECTED_SHA" ]]
[[ "$(aws s3api get-bucket-versioning --bucket "$STATE_BUCKET" --query Status --output text)" == Enabled ]]
STATE_BACKUP_VERSION="$(jq -r '.VersionId' "$WORK_DIR/object.json")"
[[ -n "$STATE_BACKUP_VERSION" && "$STATE_BACKUP_VERSION" != "null" ]]
echo "STATE_BACKUP_VERSION=$STATE_BACKUP_VERSION"

echo "APPLYING_SAVED_REALTIME_INFRA_PLAN"
terraform -chdir="$APP_DIR" apply -input=false -no-color "$WORK_DIR/realtime.tfplan" > "$WORK_DIR/apply.log"

SERVICE_TASK_AFTER="$(aws ecs describe-services \
  --region "$AWS_REGION" \
  --cluster sea-n-shore-staging \
  --services sea-n-shore-staging-web \
  --query 'services[0].taskDefinition' \
  --output text)"
[[ "$SERVICE_TASK_AFTER" == "$SERVICE_TASK_BEFORE" ]] || {
  echo "Realtime infrastructure apply unexpectedly changed the live ECS service task definition." >&2
  exit 1
}

echo "REALTIME_LIVE_ECS_SERVICE_UNCHANGED=$SERVICE_TASK_AFTER"

WEBSOCKET_URL="$(terraform -chdir="$APP_DIR" output -raw realtime_websocket_url)"
[[ "$WEBSOCKET_URL" =~ ^wss://[a-z0-9]+\.execute-api\.ap-south-1\.amazonaws\.com/staging$ ]]
API_HOST="${WEBSOCKET_URL#wss://}"
API_ID="${API_HOST%%.*}"
aws apigatewayv2 get-api --region "$AWS_REGION" --api-id "$API_ID" > "$WORK_DIR/realtime-api.json"
jq -e '.ProtocolType == "WEBSOCKET"' "$WORK_DIR/realtime-api.json" >/dev/null

CONNECTIONS_TABLE="$(terraform -chdir="$APP_DIR" output -raw realtime_connections_table)"
[[ "$CONNECTIONS_TABLE" == "sea-n-shore-staging-realtime-connections" ]]
aws dynamodb describe-table --region "$AWS_REGION" --table-name "$CONNECTIONS_TABLE" > "$WORK_DIR/realtime-table.json"
jq -e '.Table.TableStatus == "ACTIVE"' "$WORK_DIR/realtime-table.json" >/dev/null

QUEUE_URL="$(terraform -chdir="$APP_DIR" output -raw realtime_events_queue_url)"
LIVE_QUEUE_URL="$(aws sqs get-queue-url \
  --region "$AWS_REGION" \
  --queue-name sea-n-shore-staging-realtime-events \
  --query QueueUrl \
  --output text)"
[[ "$QUEUE_URL" == "$LIVE_QUEUE_URL" ]]

for function_name in \
  sea-n-shore-staging-realtime-authorizer \
  sea-n-shore-staging-realtime-connection \
  sea-n-shore-staging-realtime-fanout; do
  aws lambda get-function --region "$AWS_REGION" --function-name "$function_name" > "$WORK_DIR/${function_name}.json"
  jq -e '.Configuration.State == "Active"' "$WORK_DIR/${function_name}.json" >/dev/null
done

SECRET_ARN="$(terraform -chdir="$APP_DIR" output -raw realtime_ticket_secret_arn)"
[[ "$SECRET_ARN" == arn:aws:secretsmanager:ap-south-1:310356785722:secret:sea-n-shore-staging/realtime-ticket-signing-* ]]
aws secretsmanager describe-secret --region "$AWS_REGION" --secret-id "$SECRET_ARN" > "$WORK_DIR/realtime-secret.json"

aws ecs describe-task-definition \
  --region "$AWS_REGION" \
  --task-definition sea-n-shore-staging-web \
  --query taskDefinition \
  --output json > "$WORK_DIR/latest-web-task.json"
jq -e --arg websocket "$WEBSOCKET_URL" --arg secret "$SECRET_ARN" '
  .containerDefinitions
  | map(select(.name == "web"))[0]
  | (
      (.environment // []) | any(.name == "REALTIME_WEBSOCKET_URL" and .value == $websocket)
    )
    and (
      (.secrets // []) | any(.name == "REALTIME_TICKET_SECRET" and .valueFrom == $secret)
    )
' "$WORK_DIR/latest-web-task.json" >/dev/null

terraform -chdir="$APP_DIR" state pull > "$WORK_DIR/state-after.json"
STATE_SERIAL_AFTER="$(jq -r '.serial' "$WORK_DIR/state-after.json")"
[[ "$STATE_SERIAL_AFTER" -gt "$STATE_SERIAL_BEFORE" ]]
echo "STATE_SERIAL_AFTER=$STATE_SERIAL_AFTER"
echo "REALTIME_WEBSOCKET_URL=$WEBSOCKET_URL"
echo "REALTIME_INFRA_APPLY_VERIFIED=true"
