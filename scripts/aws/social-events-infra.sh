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
IMAGE_TAG_FILE="scripts/aws/social-events-image-tag.txt"
PLAN_CLASSIFIER="scripts/aws/social-events-plan-classifier.mjs"

[[ "${SOCIAL_EVENTS_INFRA_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "SOCIAL_EVENTS_INFRA_EXPECTED_SHA must be an exact commit SHA." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$SOCIAL_EVENTS_INFRA_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- infra/aws/app scripts/aws/social-events-infra.sh scripts/aws/social-events-infra-action.txt "$IMAGE_TAG_FILE" "$PLAN_CLASSIFIER"
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]

ACTION="$(tr -d '[:space:]' < scripts/aws/social-events-infra-action.txt)"
case "$ACTION" in plan|apply-once) ;; *) echo "Unsupported social event infrastructure action." >&2; exit 1 ;; esac

IMAGE_TAG="$(tr -d '[:space:]' < "$IMAGE_TAG_FILE")"
[[ "$IMAGE_TAG" =~ ^social-[0-9a-f]{40}$ ]] || {
  echo "Pinned social worker image tag must be social-<40 hex SHA>." >&2
  exit 1
}
IMAGE_SOURCE_SHA="${IMAGE_TAG#social-}"
git merge-base --is-ancestor "$IMAGE_SOURCE_SHA" HEAD || {
  echo "Pinned social worker image SHA is not an ancestor of the infrastructure commit." >&2
  exit 1
}

WORK_DIR="$(mktemp -d "$PWD/.social-events-infra.XXXXXXXX")"
trap 'rm -rf -- "$WORK_DIR"' EXIT

aws s3api get-object --bucket "$STATE_BUCKET" --key "$STATE_KEY" --region "$AWS_REGION" "$WORK_DIR/state.json" > "$WORK_DIR/object.json"
jq -e '.lineage == "197a6fae-9997-636e-e52b-c3ac6da85d90"' "$WORK_DIR/state.json" >/dev/null

python3 - "$WORK_DIR/state.json" "$WORK_DIR/variables.json" "$IMAGE_TAG" <<'PY'
import json, sys
state_path, output_path, image_tag = sys.argv[1:]
with open(state_path) as f:
    state=json.load(f)
resources=state['resources']
def attrs(kind, name=None):
    matches=[r for r in resources if r['type']==kind and r['mode']=='managed' and (name is None or r['name']==name)]
    assert len(matches)==1, f'Expected exactly one {kind} {name or ""}'.strip()
    return matches[0]['instances'][0]['attributes']
web_task=attrs('aws_ecs_task_definition','web')
containers=json.loads(web_task['container_definitions'])
web=next(c for c in containers if c['name']=='web')
site=next(e['value'] for e in web['environment'] if e['name']=='NEXT_PUBLIC_SITE_URL')
values={
  'image_tag':image_tag,
  'site_url':site,
  'aurora_engine_version':attrs('aws_rds_cluster','aurora')['engine_version'],
  'social_worker_desired_count':1,
}
with open(output_path,'w') as f:
    json.dump(values,f)
PY

PLUGIN_DIR="$HOME/SEA-N-SHORE-CODEX/infra/aws/app/.terraform/providers"
[[ -x "$PLUGIN_DIR/registry.terraform.io/hashicorp/aws/6.62.0/linux_amd64/terraform-provider-aws_v6.62.0_x5" ]]
terraform -chdir="$APP_DIR" init -input=false -no-color -lockfile=readonly -plugin-dir="$PLUGIN_DIR" \
  -backend-config="bucket=$STATE_BUCKET" -backend-config="key=$STATE_KEY" \
  -backend-config="region=$AWS_REGION" -backend-config=use_lockfile=true > "$WORK_DIR/init.log"

TARGETS=(
  aws_cloudwatch_event_bus.social
  aws_sqs_queue.notification_dlq
  aws_sqs_queue.notification_events
  aws_cloudwatch_event_rule.notification_events
  aws_cloudwatch_event_target.notification_queue
  aws_sqs_queue_policy.notification_events
  aws_iam_role.outbox_worker
  aws_iam_role_policy.outbox_worker
  aws_iam_role.notification_worker
  aws_iam_role_policy.notification_worker
  aws_cloudwatch_log_group.outbox_worker
  aws_cloudwatch_log_group.notification_worker
  aws_ecs_task_definition.outbox_worker
  aws_ecs_task_definition.notification_worker
  aws_ecs_service.outbox_worker
  aws_ecs_service.notification_worker
  aws_cloudwatch_metric_alarm.notification_dlq_depth
  aws_cloudwatch_metric_alarm.notification_queue_age
)
PLAN_ARGS=()
for target in "${TARGETS[@]}"; do PLAN_ARGS+=("-target=$target"); done

terraform -chdir="$APP_DIR" plan -input=false -no-color -lock-timeout=60s \
  "${PLAN_ARGS[@]}" \
  -var-file="$WORK_DIR/variables.json" -out="$WORK_DIR/social-events.tfplan" \
  > "$WORK_DIR/plan.log"
terraform -chdir="$APP_DIR" show -json "$WORK_DIR/social-events.tfplan" > "$WORK_DIR/plan.json"

CLASSIFICATION="$(node "$PLAN_CLASSIFIER" "$WORK_DIR/plan.json" "$ACTION")"
PLAN_MODE="$(jq -r '.mode' <<<"$CLASSIFICATION")"
CREATE_COUNT="$(jq -r '.createCount' <<<"$CLASSIFICATION")"

if [[ "$PLAN_MODE" == "steady" ]]; then
  jq '[.resource_changes[]? | select(.change.actions != ["no-op"]) | {address, actions: .change.actions}]' "$WORK_DIR/plan.json"
  echo "STATE_SERIAL_BEFORE=$(jq -r '.serial' "$WORK_DIR/state.json")"
  echo "SOCIAL_EVENTS_IMAGE_TAG=$IMAGE_TAG"
  echo "SOCIAL_EVENTS_CREATE_COUNT=0"
  echo "SOCIAL_EVENTS_INFRA_STEADY_STATE=true"
  echo "SOCIAL_EVENTS_INFRA_PLAN_VERIFIED=NO_CHANGES"
  echo "SOCIAL_EVENTS_INFRA_PLAN_ONLY_NO_APPLY"
  exit 0
fi

python3 - "$WORK_DIR/plan.json" <<'PY'
import json, sys
with open(sys.argv[1]) as f: plan=json.load(f)
changes=[r for r in plan.get('resource_changes',[]) if r.get('change',{}).get('actions') != ['no-op']]
notification=next(r for r in changes if r['address']=='aws_ecs_task_definition.notification_worker')
change=notification['change']
container_defs=change.get('after',{}).get('container_definitions')
if container_defs is None:
    unknown=change.get('after_unknown',{}).get('container_definitions')
    if unknown is not True:
        raise SystemExit('Notification worker container definitions are absent without Terraform marking them unknown')
    print('SOCIAL_NOTIFICATION_SHADOW_PLAN_CHECK=DEFERRED_TO_STATIC_CONTRACT')
elif 'SOCIAL_NOTIFICATION_MODE' not in container_defs or 'shadow' not in container_defs:
    raise SystemExit('Notification worker task definition is not locked to shadow mode')
else:
    print('SOCIAL_NOTIFICATION_SHADOW_PLAN_CHECK=VERIFIED_IN_PLAN')
PY

echo "SOCIAL_EVENTS_PLAN_GUARD=CREATE_ONLY_ALLOWED_RESOURCES"
echo "SOCIAL_EVENTS_CREATE_COUNT=$CREATE_COUNT"
jq '[.resource_changes[] | select(.change.actions != ["no-op"]) | {address, actions: .change.actions}]' "$WORK_DIR/plan.json"
echo "PLAN_SHA256=$(sha256sum "$WORK_DIR/social-events.tfplan" | cut -d' ' -f1)"
echo "STATE_SERIAL_BEFORE=$(jq -r '.serial' "$WORK_DIR/state.json")"
echo "SOCIAL_EVENTS_IMAGE_TAG=$IMAGE_TAG"

echo "SOCIAL_EVENTS_INFRA_PLAN_VERIFIED=CREATE_ONLY"
if [[ "$ACTION" == "plan" ]]; then
  echo "SOCIAL_EVENTS_INFRA_PLAN_ONLY_NO_APPLY"
  exit 0
fi

[[ "$(git ls-remote origin refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$SOCIAL_EVENTS_INFRA_EXPECTED_SHA" ]]
[[ "$(aws s3api get-bucket-versioning --bucket "$STATE_BUCKET" --query Status --output text)" == Enabled ]]
aws ecr describe-images --region "$AWS_REGION" --repository-name sea-n-shore --image-ids "imageTag=$IMAGE_TAG" >/dev/null

echo "STATE_BACKUP_VERSION=$(jq -r '.VersionId' "$WORK_DIR/object.json")"
jq -e '.VersionId != null' "$WORK_DIR/object.json" >/dev/null

echo "APPLYING_SAVED_SOCIAL_EVENTS_CREATE_ONLY_PLAN"
terraform -chdir="$APP_DIR" apply -input=false -no-color "$WORK_DIR/social-events.tfplan" > "$WORK_DIR/apply.log"

aws ecs wait services-stable --region "$AWS_REGION" --cluster sea-n-shore-staging --services \
  sea-n-shore-staging-outbox-worker sea-n-shore-staging-notification-worker

for service in sea-n-shore-staging-outbox-worker sea-n-shore-staging-notification-worker; do
  COUNTS="$(aws ecs describe-services --region "$AWS_REGION" --cluster sea-n-shore-staging --services "$service" --query 'services[0].[desiredCount,runningCount,pendingCount]' --output text)"
  [[ "$COUNTS" == $'1\t1\t0' ]] || { echo "Unexpected ECS counts for $service: $COUNTS" >&2; exit 1; }
  echo "SOCIAL_EVENTS_SERVICE_STABLE=$service|$COUNTS"
done

QUEUE_URL="$(aws sqs get-queue-url --region "$AWS_REGION" --queue-name sea-n-shore-staging-notification-events --query QueueUrl --output text)"
DLQ_URL="$(aws sqs get-queue-url --region "$AWS_REGION" --queue-name sea-n-shore-staging-notification-events-dlq --query QueueUrl --output text)"
[[ -n "$QUEUE_URL" && -n "$DLQ_URL" ]]
aws events describe-event-bus --region "$AWS_REGION" --name sea-n-shore-staging-social-events >/dev/null

terraform -chdir="$APP_DIR" state pull > "$WORK_DIR/state-after.json"
echo "STATE_SERIAL_AFTER=$(jq -r '.serial' "$WORK_DIR/state-after.json")"
echo "SOCIAL_EVENTS_INFRA_APPLY_VERIFIED=true"
