#!/usr/bin/env bash
# Round 13 guarded infrastructure: keep at least two web tasks, scale on memory as well as CPU,
# and alert the owner (SNS email) on web memory, running task count, ALB 5xx / connection errors,
# ephemeral storage and OOM task stops. Targeted plan; only creates and in-place updates of these
# resources are accepted. The action file holds "plan" or "apply-once".
set -euo pipefail
umask 077
export PATH="$HOME/bin:$PATH"
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
STATE_BUCKET="sea-n-shore-310356785722-ap-south-1-tfstate"
STATE_KEY="sea-n-shore/staging/terraform.tfstate"
APP_DIR="$PWD/infra/aws/app"
ACTION_FILE="scripts/aws/web-resilience-infra-action.txt"
CLUSTER="sea-n-shore-staging"
SERVICE="sea-n-shore-staging-web"
PUBLIC_SITE_URL="$(tr -d '[:space:]' < scripts/aws/public-site-url.txt)"
[[ "$PUBLIC_SITE_URL" =~ ^https://[a-z0-9.-]+$ ]]
export PUBLIC_SITE_URL

[[ "${WEB_RESILIENCE_INFRA_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "WEB_RESILIENCE_INFRA_EXPECTED_SHA must be an exact commit SHA." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$WEB_RESILIENCE_INFRA_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- \
  infra/aws/app/main.tf \
  infra/aws/app/web-resilience.tf \
  scripts/aws/web-resilience-infra.sh \
  scripts/aws/web-resilience-infra-action.txt \
  scripts/aws/web-resilience-infra.test.mjs \
  scripts/aws/public-site-url.txt \
  .github/workflows/aws-web-resilience-infra.yml
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]

ACTION="$(tr -d '[:space:]' < "$ACTION_FILE")"
case "$ACTION" in plan|apply-once) ;; *) echo "Unsupported web resilience infrastructure action." >&2; exit 1 ;; esac

WORK_DIR="$(mktemp -d "$PWD/.web-resilience-infra.XXXXXXXX")"
trap 'rm -rf -- "$WORK_DIR"' EXIT

aws s3api get-object --bucket "$STATE_BUCKET" --key "$STATE_KEY" --region "$AWS_REGION" \
  "$WORK_DIR/state.json" > "$WORK_DIR/object.json"
jq -e '.lineage == "197a6fae-9997-636e-e52b-c3ac6da85d90"' "$WORK_DIR/state.json" >/dev/null

python3 - "$WORK_DIR/state.json" "$WORK_DIR/variables.json" <<'PY'
import json, os, sys
state_path, output_path = sys.argv[1:]
resources = json.load(open(state_path))['resources']
def attrs(kind, name):
    matches = [r for r in resources if r.get('mode') == 'managed' and r.get('type') == kind and r.get('name') == name]
    assert len(matches) == 1 and len(matches[0].get('instances') or []) == 1, f'{kind}.{name}'
    return matches[0]['instances'][0]['attributes']
web = attrs('aws_ecs_task_definition', 'web')
image = next(c for c in json.loads(web['container_definitions']) if c['name'] == 'web')['image']
json.dump({
    'image_tag': image.rsplit(':', 1)[1],
    'site_url': os.environ['PUBLIC_SITE_URL'],
    'aurora_engine_version': attrs('aws_rds_cluster', 'aurora')['engine_version'],
}, open(output_path, 'w'))
PY

echo "== Live web service before =="
aws ecs describe-services --region "$AWS_REGION" --cluster "$CLUSTER" --services "$SERVICE" --output json \
  | jq -r '.services[0] | "WEB_BEFORE desired=\(.desiredCount) running=\(.runningCount) taskDefinition=\(.taskDefinition | split("/") | last)"'
aws application-autoscaling describe-scalable-targets --region "$AWS_REGION" --service-namespace ecs \
  --resource-ids "service/$CLUSTER/$SERVICE" --output json \
  | jq -r '.ScalableTargets[] | "SCALING_BEFORE min=\(.MinCapacity) max=\(.MaxCapacity)"'

terraform -chdir="$APP_DIR" init -input=false -no-color \
  -backend-config="bucket=$STATE_BUCKET" \
  -backend-config="key=$STATE_KEY" \
  -backend-config="region=$AWS_REGION" \
  -backend-config=use_lockfile=true > "$WORK_DIR/init.log"

TARGETS=(
  aws_appautoscaling_target.web
  aws_appautoscaling_policy.cpu
  aws_appautoscaling_policy.memory
  aws_sns_topic.alerts
  aws_sns_topic_subscription.alerts_email
  aws_sns_topic_policy.alerts
  aws_cloudwatch_metric_alarm.web_memory_high
  aws_cloudwatch_metric_alarm.web_running_tasks_low
  aws_cloudwatch_metric_alarm.alb_gateway_errors
  aws_cloudwatch_metric_alarm.alb_target_connection_errors
  aws_cloudwatch_metric_alarm.web_ephemeral_storage_high
  aws_cloudwatch_event_rule.ecs_out_of_memory
  aws_cloudwatch_event_target.ecs_out_of_memory
)
PLAN_ARGS=()
for target in "${TARGETS[@]}"; do PLAN_ARGS+=("-target=$target"); done

terraform -chdir="$APP_DIR" plan -input=false -no-color -lock-timeout=60s \
  "${PLAN_ARGS[@]}" -var-file="$WORK_DIR/variables.json" -out="$WORK_DIR/resilience.tfplan" > "$WORK_DIR/plan.log"
terraform -chdir="$APP_DIR" show -json "$WORK_DIR/resilience.tfplan" > "$WORK_DIR/plan.json"

python3 - "$WORK_DIR/plan.json" <<'PY'
import json, sys
allowed = {
  'aws_appautoscaling_target.web': {('update',)},
  'aws_appautoscaling_policy.cpu': {('update',)},
  'aws_appautoscaling_policy.memory': {('create',)},
  'aws_sns_topic.alerts': {('create',)},
  'aws_sns_topic_subscription.alerts_email': {('create',)},
  'aws_sns_topic_policy.alerts': {('create',)},
  'aws_cloudwatch_metric_alarm.web_memory_high': {('create',)},
  'aws_cloudwatch_metric_alarm.web_running_tasks_low': {('create',)},
  'aws_cloudwatch_metric_alarm.alb_gateway_errors': {('create',)},
  'aws_cloudwatch_metric_alarm.alb_target_connection_errors': {('create',)},
  'aws_cloudwatch_metric_alarm.web_ephemeral_storage_high': {('create',)},
  'aws_cloudwatch_event_rule.ecs_out_of_memory': {('create',)},
  'aws_cloudwatch_event_target.ecs_out_of_memory': {('create',)},
}
plan = json.load(open(sys.argv[1]))
changes = [r for r in plan.get('resource_changes', []) if r.get('mode') != 'data' and r['change']['actions'] != ['no-op']]
for r in changes:
    actions = tuple(r['change']['actions'])
    if r['address'] not in allowed or actions not in allowed[r['address']]:
        raise SystemExit(f"unexpected web resilience change refused: {r['address']} {list(actions)}")
print('WEB_RESILIENCE_PLAN_CHANGES=' + str(len(changes)))
for r in changes:
    print(f"WEB_RESILIENCE_CHANGE={r['address']}|{','.join(r['change']['actions'])}")
    if r['address'] == 'aws_appautoscaling_target.web':
        before, after = r['change']['before'] or {}, r['change']['after'] or {}
        print(f"WEB_SCALING_TARGET min {before.get('min_capacity')}->{after.get('min_capacity')} max {before.get('max_capacity')}->{after.get('max_capacity')}")
        changed = sorted(k for k in set(before) | set(after) if before.get(k) != after.get(k) and k not in ('tags', 'tags_all'))
        if set(changed) - {'min_capacity', 'max_capacity'}:
            raise SystemExit('scaling target change outside min/max refused: ' + ','.join(changed))
PY

echo "STATE_SERIAL_BEFORE=$(jq -r '.serial' "$WORK_DIR/state.json")"
echo "WEB_RESILIENCE_ACTION=$ACTION"
echo "WEB_RESILIENCE_PLAN_VERIFIED=true"
echo "PLAN_SHA256=$(sha256sum "$WORK_DIR/resilience.tfplan" | cut -d' ' -f1)"

if [[ "$ACTION" == "plan" ]]; then
  echo "WEB_RESILIENCE_PLAN_ONLY_NO_APPLY"
  exit 0
fi

[[ "$(git ls-remote origin refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$WEB_RESILIENCE_INFRA_EXPECTED_SHA" ]]
[[ "$(aws s3api get-bucket-versioning --bucket "$STATE_BUCKET" --query Status --output text)" == Enabled ]]
STATE_BACKUP_VERSION="$(jq -r '.VersionId // empty' "$WORK_DIR/object.json")"
[[ -n "$STATE_BACKUP_VERSION" ]]
echo "STATE_BACKUP_VERSION=$STATE_BACKUP_VERSION"

terraform -chdir="$APP_DIR" apply -input=false -no-color "$WORK_DIR/resilience.tfplan" > "$WORK_DIR/apply.log"

terraform -chdir="$APP_DIR" plan -input=false -no-color -lock-timeout=60s \
  "${PLAN_ARGS[@]}" -var-file="$WORK_DIR/variables.json" -out="$WORK_DIR/after.tfplan" > "$WORK_DIR/plan-after.log"
terraform -chdir="$APP_DIR" show -json "$WORK_DIR/after.tfplan" > "$WORK_DIR/plan-after.json"
[[ "$(jq '[.resource_changes[]? | select(.mode != "data") | select(.change.actions != ["no-op"])] | length' "$WORK_DIR/plan-after.json")" == "0" ]] || {
  echo "Web resilience resources still drift after apply." >&2
  exit 1
}

aws application-autoscaling describe-scalable-targets --region "$AWS_REGION" --service-namespace ecs \
  --resource-ids "service/$CLUSTER/$SERVICE" --output json > "$WORK_DIR/target.json"
jq -e '.ScalableTargets[0].MinCapacity == 2 and .ScalableTargets[0].MaxCapacity == 4' "$WORK_DIR/target.json" >/dev/null
aws application-autoscaling describe-scaling-policies --region "$AWS_REGION" --service-namespace ecs \
  --resource-id "service/$CLUSTER/$SERVICE" --output json > "$WORK_DIR/policies.json"
jq -e '[.ScalingPolicies[].TargetTrackingScalingPolicyConfiguration.PredefinedMetricSpecification.PredefinedMetricType] | (index("ECSServiceAverageCPUUtilization") != null) and (index("ECSServiceAverageMemoryUtilization") != null)' "$WORK_DIR/policies.json" >/dev/null
echo "WEB_SCALING_VERIFIED min=2 max=4 policies=cpu,memory"

TOPIC_ARN="arn:aws:sns:$AWS_REGION:$EXPECTED_ACCOUNT:sea-n-shore-staging-alerts"
aws sns list-subscriptions-by-topic --region "$AWS_REGION" --topic-arn "$TOPIC_ARN" --output json \
  | jq -r '.Subscriptions[] | "ALERT_SUBSCRIPTION protocol=\(.Protocol) status=\(if (.SubscriptionArn | startswith("arn:")) then "confirmed" else .SubscriptionArn end)"'
aws cloudwatch describe-alarms --region "$AWS_REGION" --alarm-name-prefix sea-n-shore-staging- --output json > "$WORK_DIR/alarms.json"
for alarm in web-memory-high web-running-tasks-low alb-502-503-504 alb-target-connection-errors web-ephemeral-storage-high; do
  jq -e --arg name "sea-n-shore-staging-$alarm" --arg topic "$TOPIC_ARN" \
    '[.MetricAlarms[] | select(.AlarmName == $name) | select(.AlarmActions | index($topic))] | length == 1' "$WORK_DIR/alarms.json" >/dev/null
  echo "ALARM_VERIFIED=sea-n-shore-staging-$alarm state=$(jq -r --arg name "sea-n-shore-staging-$alarm" '.MetricAlarms[] | select(.AlarmName == $name) | .StateValue' "$WORK_DIR/alarms.json")"
done
aws events list-targets-by-rule --region "$AWS_REGION" --rule sea-n-shore-staging-ecs-out-of-memory --output json \
  | jq -e --arg topic "$TOPIC_ARN" '[.Targets[] | select(.Arn == $topic)] | length == 1' >/dev/null
echo "OOM_EVENT_RULE_VERIFIED=true"

# Autoscaling min 2 raises the service if it was below; wait until two tasks are running.
SETTLED=false
for attempt in $(seq 1 60); do
  STATE="$(aws ecs describe-services --region "$AWS_REGION" --cluster "$CLUSTER" --services "$SERVICE" --output json)"
  if jq -e '.services[0].desiredCount >= 2 and .services[0].runningCount >= 2' <<<"$STATE" >/dev/null; then
    SETTLED=true
    break
  fi
  sleep 10
done
jq -r '.services[0] | "WEB_AFTER desired=\(.desiredCount) running=\(.runningCount) taskDefinition=\(.taskDefinition | split("/") | last)"' <<<"$STATE"
[[ "$SETTLED" == true ]]
echo "WEB_RESILIENCE_APPLY_VERIFIED=true"
