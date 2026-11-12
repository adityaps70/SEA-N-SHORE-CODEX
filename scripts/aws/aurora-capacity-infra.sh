#!/usr/bin/env bash
# Round DB (owner-approved 12 Nov) guarded infrastructure, in one targeted apply:
# - Aurora Serverless v2 maximum 2 -> 4 ACU (floor unchanged at 0.5); a capacity range change takes effect at once,
#   with no reboot and no maintenance window;
# - the capacity-at-max alarm follows the new maximum (threshold 2 -> 4);
# - an hourly check (Lambda on an EventBridge schedule) emails the alerts topic once this month's capacity above 2 ACU
#   passes 39 ACU-hours (about ₹700), with an alarm if the check itself fails.
# Anything else in the plan is refused (scripts/aws/check-aurora-capacity-plan.py). The action file holds "plan" or
# "apply-once".
set -euo pipefail
umask 077
export PATH="$HOME/bin:$PATH"
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
STATE_BUCKET="sea-n-shore-310356785722-ap-south-1-tfstate"
STATE_KEY="sea-n-shore/staging/terraform.tfstate"
APP_DIR="$PWD/infra/aws/app"
ACTION_FILE="scripts/aws/aurora-capacity-infra-action.txt"
CLUSTER_ID="sea-n-shore-staging-aurora"
CHECK_FUNCTION="sea-n-shore-staging-aurora-extra-acu-check"
PUBLIC_SITE_URL="$(tr -d '[:space:]' < scripts/aws/public-site-url.txt)"
[[ "$PUBLIC_SITE_URL" =~ ^https://[a-z0-9.-]+$ ]]
export PUBLIC_SITE_URL

[[ "${AURORA_CAPACITY_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "AURORA_CAPACITY_EXPECTED_SHA must be an exact commit SHA." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$AURORA_CAPACITY_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- \
  infra/aws/app/aurora-capacity.tf \
  infra/aws/app/lambda/aurora-extra-acu-check.mjs \
  infra/aws/app/database.tf \
  infra/aws/app/security-hardening.tf \
  infra/aws/app/aws-native-variables.tf \
  scripts/aws/aurora-capacity-infra.sh \
  scripts/aws/check-aurora-capacity-plan.py \
  scripts/aws/aurora-capacity-infra-action.txt \
  scripts/aws/aurora-capacity-infra.test.mjs \
  scripts/aws/public-site-url.txt \
  .github/workflows/aws-aurora-capacity-infra.yml
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]
source scripts/aws/bootstrap-terraform-lock.sh

ACTION="$(cut -d' ' -f1 < "$ACTION_FILE" | tr -d '[:space:]')"
case "$ACTION" in plan|apply-once) ;; *) echo "Unsupported Aurora capacity infrastructure action." >&2; exit 1 ;; esac

WORK_DIR="$(mktemp -d "$PWD/.aurora-capacity-infra.XXXXXXXX")"
TF_TMPDIR="$(mktemp -d /var/tmp/sns-tf.XXXXXX)"
export TMPDIR="$TF_TMPDIR"
trap 'rm -rf -- "$WORK_DIR" "$TF_TMPDIR"' EXIT; trap 'exit 129' HUP; trap 'exit 130' INT; trap 'exit 143' TERM

aws rds describe-db-clusters --region "$AWS_REGION" --db-cluster-identifier "$CLUSTER_ID" --output json > "$WORK_DIR/cluster-before.json"
jq -r '.DBClusters[0] | "AURORA_CAPACITY_BEFORE min=\(.ServerlessV2ScalingConfiguration.MinCapacity) max=\(.ServerlessV2ScalingConfiguration.MaxCapacity) status=\(.Status)"' "$WORK_DIR/cluster-before.json"
[[ "$(jq -r '.DBClusters[0].Status' "$WORK_DIR/cluster-before.json")" == available ]] || {
  echo "Aurora is not available; refusing." >&2
  exit 1
}

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

terraform -chdir="$APP_DIR" init -input=false -no-color \
  -backend-config="bucket=$STATE_BUCKET" \
  -backend-config="key=$STATE_KEY" \
  -backend-config="region=$AWS_REGION" \
  -backend-config=use_lockfile=true > "$WORK_DIR/init.log"

TARGETS=(
  aws_rds_cluster.aurora
  aws_cloudwatch_metric_alarm.aurora_capacity_at_max
  aws_iam_role.aurora_extra_acu_check
  aws_iam_role_policy.aurora_extra_acu_check
  aws_cloudwatch_log_group.aurora_extra_acu_check
  aws_lambda_function.aurora_extra_acu_check
  aws_cloudwatch_event_rule.aurora_extra_acu_check
  aws_cloudwatch_event_target.aurora_extra_acu_check
  aws_lambda_permission.aurora_extra_acu_check
  aws_cloudwatch_metric_alarm.aurora_extra_acu_check_errors
)
PLAN_ARGS=()
for target in "${TARGETS[@]}"; do PLAN_ARGS+=("-target=$target"); done

terraform -chdir="$APP_DIR" plan -input=false -no-color -lock-timeout=60s \
  "${PLAN_ARGS[@]}" -var-file="$WORK_DIR/variables.json" -out="$WORK_DIR/aurora-capacity.tfplan" > "$WORK_DIR/plan.log"
terraform -chdir="$APP_DIR" show -json "$WORK_DIR/aurora-capacity.tfplan" > "$WORK_DIR/plan.json"

python3 scripts/aws/check-aurora-capacity-plan.py "$WORK_DIR/plan.json"

echo "STATE_SERIAL_BEFORE=$(jq -r '.serial' "$WORK_DIR/state.json")"
echo "AURORA_CAPACITY_ACTION=$ACTION"
echo "AURORA_CAPACITY_PLAN_VERIFIED=true"
echo "PLAN_SHA256=$(sha256sum "$WORK_DIR/aurora-capacity.tfplan" | cut -d' ' -f1)"

if [[ "$ACTION" == "plan" ]]; then
  echo "AURORA_CAPACITY_PLAN_ONLY_NO_APPLY"
  exit 0
fi

[[ "$(bash scripts/aws/branch-head.sh refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$AURORA_CAPACITY_EXPECTED_SHA" ]]
[[ "$(aws s3api get-bucket-versioning --bucket "$STATE_BUCKET" --query Status --output text)" == Enabled ]]
STATE_BACKUP_VERSION="$(jq -r '.VersionId // empty' "$WORK_DIR/object.json")"
[[ -n "$STATE_BACKUP_VERSION" ]]
echo "STATE_BACKUP_VERSION=$STATE_BACKUP_VERSION"

terraform -chdir="$APP_DIR" apply -input=false -no-color "$WORK_DIR/aurora-capacity.tfplan" > "$WORK_DIR/apply.log"

terraform -chdir="$APP_DIR" plan -input=false -no-color -lock-timeout=60s \
  "${PLAN_ARGS[@]}" -var-file="$WORK_DIR/variables.json" -out="$WORK_DIR/after.tfplan" > "$WORK_DIR/plan-after.log"
terraform -chdir="$APP_DIR" show -json "$WORK_DIR/after.tfplan" > "$WORK_DIR/plan-after.json"
[[ "$(jq '[.resource_changes[]? | select(.mode != "data") | select(.change.actions != ["no-op"])] | length' "$WORK_DIR/plan-after.json")" == "0" ]] || {
  echo "Aurora capacity resources still drift after apply." >&2
  exit 1
}

# The live cluster: the new range is in effect (not pending), the floor and deletion protection unchanged.
for attempt in $(seq 1 30); do
  aws rds describe-db-clusters --region "$AWS_REGION" --db-cluster-identifier "$CLUSTER_ID" --output json > "$WORK_DIR/cluster-after.json"
  [[ "$(jq -r '.DBClusters[0].Status' "$WORK_DIR/cluster-after.json")" == available ]] && break
  sleep 10
done
jq -e '.DBClusters[0] | .Status == "available" and .ServerlessV2ScalingConfiguration.MinCapacity == 0.5
  and .ServerlessV2ScalingConfiguration.MaxCapacity == 4 and .DeletionProtection == true
  and ((.PendingModifiedValues // {}) | has("ServerlessV2ScalingConfiguration") | not)' "$WORK_DIR/cluster-after.json" >/dev/null
echo "AURORA_CAPACITY_VERIFIED min=0.5 max=4"

aws cloudwatch describe-alarms --region "$AWS_REGION" --alarm-names sea-n-shore-staging-aurora-capacity-at-max "$CHECK_FUNCTION-errors" --output json > "$WORK_DIR/alarms.json"
jq -e '[.MetricAlarms[] | select(.AlarmName == "sea-n-shore-staging-aurora-capacity-at-max" and .Threshold == 4 and (.AlarmActions | length) == 1)] | length == 1' "$WORK_DIR/alarms.json" >/dev/null
jq -e --arg name "$CHECK_FUNCTION-errors" '[.MetricAlarms[] | select(.AlarmName == $name and .Namespace == "AWS/Lambda" and .MetricName == "Errors" and (.AlarmActions | length) == 1)] | length == 1' "$WORK_DIR/alarms.json" >/dev/null
echo "AURORA_CAPACITY_ALARMS_VERIFIED at_max_threshold=4 check_errors=present"

# One run of the check now: it reads the month so far (no email unless the allowance is already passed, which it
# cannot be while the maximum was 2 ACU) and must answer without an error.
aws lambda invoke --region "$AWS_REGION" --function-name "$CHECK_FUNCTION" --cli-binary-format raw-in-base64-out \
  --payload '{}' "$WORK_DIR/check.json" > "$WORK_DIR/invoke.json"
[[ "$(jq -r '.FunctionError // empty' "$WORK_DIR/invoke.json")" == "" ]] || {
  echo "The extra-capacity check failed on its first run." >&2
  exit 1
}
jq -e '(.extraAcuHours | type) == "number" and .allowanceAcuHours == 39 and .crossed == false' "$WORK_DIR/check.json" >/dev/null
jq -r '"AURORA_EXTRA_ACU_CHECK month=\(.month) extra_acu_hours=\(.extraAcuHours) allowance=\(.allowanceAcuHours) estimated_rupees=\(.estimatedRupees) crossed=\(.crossed)"' "$WORK_DIR/check.json"
[[ "$(aws events describe-rule --region "$AWS_REGION" --name "$CHECK_FUNCTION" --query State --output text)" == ENABLED ]]
echo "AURORA_EXTRA_ACU_SCHEDULE_VERIFIED=hourly"

[[ "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 30 "${PUBLIC_SITE_URL%/}/api/health/live")" == 200 ]]
echo "PUBLIC_SITE_LIVE_VERIFIED=true"
echo "AURORA_CAPACITY_APPLY_VERIFIED=true"
