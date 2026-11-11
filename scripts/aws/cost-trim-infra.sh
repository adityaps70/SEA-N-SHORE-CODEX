#!/usr/bin/env bash
# Round DB (cost, owner-approved 11 Nov) guarded infrastructure, in one apply:
# - Container Insights off on the ECS cluster (its custom metrics were most of the CloudWatch bill);
# - the web running-tasks alarm reads the ALB's HealthyHostCount (free) instead of Container Insights;
# - the web ephemeral storage alarm, which read Container Insights, is deleted;
# - the application ECR repository keeps the newest 10 images, and the newest 10 social-events worker images
#   (social-<sha>) on their own count, so the image the running workers use is never the one expired;
# - the /aws/apigateway/welcome log group keeps 14 days (it had no retention).
# Targeted Terraform plan for the three app resources; the two CLI changes are checked before and after. Anything
# else is refused. The action file holds "plan" or "apply-once".
set -euo pipefail
umask 077
export PATH="$HOME/bin:$PATH"
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
STATE_BUCKET="sea-n-shore-310356785722-ap-south-1-tfstate"
STATE_KEY="sea-n-shore/staging/terraform.tfstate"
APP_DIR="$PWD/infra/aws/app"
ACTION_FILE="scripts/aws/cost-trim-infra-action.txt"
CLUSTER="sea-n-shore-staging"
REPOSITORY="sea-n-shore"
WELCOME_LOG_GROUP="/aws/apigateway/welcome"
KEEP_IMAGES=10
PUBLIC_SITE_URL="$(tr -d '[:space:]' < scripts/aws/public-site-url.txt)"
[[ "$PUBLIC_SITE_URL" =~ ^https://[a-z0-9.-]+$ ]]
export PUBLIC_SITE_URL
# The reviewed lifecycle policy, the same rules as aws_ecr_lifecycle_policy.app in infra/aws/bootstrap/main.tf.
LIFECYCLE_POLICY='{"rules":[{"rulePriority":1,"description":"Keep the latest 10 social-events worker images","selection":{"tagStatus":"tagged","tagPrefixList":["social-"],"countType":"imageCountMoreThan","countNumber":10},"action":{"type":"expire"}},{"rulePriority":2,"description":"Keep the latest 10 application images","selection":{"tagStatus":"any","countType":"imageCountMoreThan","countNumber":10},"action":{"type":"expire"}}]}'

[[ "${COST_TRIM_INFRA_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "COST_TRIM_INFRA_EXPECTED_SHA must be an exact commit SHA." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$COST_TRIM_INFRA_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- \
  infra/aws/app/main.tf \
  infra/aws/app/web-resilience.tf \
  infra/aws/bootstrap/main.tf \
  scripts/aws/cost-trim-infra.sh \
  scripts/aws/check-cost-trim-plan.py \
  scripts/aws/cost-trim-infra-action.txt \
  scripts/aws/cost-trim-infra.test.mjs \
  scripts/aws/public-site-url.txt \
  .github/workflows/aws-cost-trim-infra.yml
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]
source scripts/aws/bootstrap-terraform-lock.sh

ACTION="$(cut -d' ' -f1 < "$ACTION_FILE" | tr -d '[:space:]')"
case "$ACTION" in plan|apply-once) ;; *) echo "Unsupported cost trim infrastructure action." >&2; exit 1 ;; esac

WORK_DIR="$(mktemp -d "$PWD/.cost-trim-infra.XXXXXXXX")"
trap 'rm -rf -- "$WORK_DIR"' EXIT; trap 'exit 129' HUP; trap 'exit 130' INT; trap 'exit 143' TERM

# ---------------------------------------------------------------- ECR: the images in use must stay within the kept 10
# Every image a service in the cluster runs, ranked by push time within its count (social-* or the rest). The policy
# keeps the newest 10 of each; a running image at rank 11 or later would be expired, so the run refuses.
ecr_check() {
  aws ecr describe-images --region "$AWS_REGION" --repository-name "$REPOSITORY" --output json > "$WORK_DIR/images.json"
  : > "$WORK_DIR/in-use.txt"
  for service in $(aws ecs list-services --region "$AWS_REGION" --cluster "$CLUSTER" --query 'serviceArns' --output text); do
    definition="$(aws ecs describe-services --region "$AWS_REGION" --cluster "$CLUSTER" --services "$service" --query 'services[0].taskDefinition' --output text)"
    aws ecs describe-task-definition --region "$AWS_REGION" --task-definition "$definition" \
      --query 'taskDefinition.containerDefinitions[].image' --output text | tr '\t' '\n' >> "$WORK_DIR/in-use.txt"
  done
  python3 - "$WORK_DIR/images.json" "$WORK_DIR/in-use.txt" "$REPOSITORY" "$KEEP_IMAGES" <<'PY'
import json, sys
images_path, in_use_path, repository, keep = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
images = json.load(open(images_path)).get('imageDetails', [])
def group(image):
    return 'social' if any(t.startswith('social-') for t in image.get('imageTags') or []) else 'application'
ranked = {}
for name in ('social', 'application'):
    members = sorted((i for i in images if group(i) == name), key=lambda i: i.get('imagePushedAt', 0), reverse=True)
    ranked[name] = {i['imageDigest']: n + 1 for n, i in enumerate(members)}
    print('COST_TRIM_ECR_IMAGES group=%s count=%d kept=%d expired_by_policy=%d' % (name, len(members), min(len(members), keep), max(0, len(members) - keep)))
by_tag = {t: i for i in images for t in (i.get('imageTags') or [])}
by_digest = {i['imageDigest']: i for i in images}
refuse = False
for line in sorted({l.strip() for l in open(in_use_path) if l.strip()}):
    if '/' + repository + ':' not in line and '/' + repository + '@' not in line:
        continue  # another repository (the node base image never runs in a service)
    ref = line.split('/' + repository, 1)[1]
    image = by_digest.get(ref[1:]) if ref.startswith('@') else by_tag.get(ref[1:])
    if image is None:
        print('COST_TRIM_ECR_IN_USE_MISSING'); refuse = True; continue
    rank = ranked[group(image)][image['imageDigest']]
    print('COST_TRIM_ECR_IN_USE group=%s rank=%d' % (group(image), rank))
    if rank > keep:
        refuse = True
if refuse:
    raise SystemExit('An image a service runs would not be among the kept images; refusing.')
print('COST_TRIM_ECR_IN_USE_KEPT=true')
PY
}

echo "== ECR lifecycle =="
CURRENT_POLICY="$(aws ecr get-lifecycle-policy --region "$AWS_REGION" --repository-name "$REPOSITORY" --query lifecyclePolicyText --output text)"
echo "COST_TRIM_ECR_POLICY_BEFORE rules=$(jq '.rules | length' <<<"$CURRENT_POLICY") keep=$(jq -c '[.rules[].selection.countNumber]' <<<"$CURRENT_POLICY")"
ecr_check

echo "== API Gateway welcome log group =="
aws logs describe-log-groups --region "$AWS_REGION" --log-group-name-prefix "$WELCOME_LOG_GROUP" --output json > "$WORK_DIR/log-groups.json"
[[ "$(jq --arg name "$WELCOME_LOG_GROUP" '[.logGroups[] | select(.logGroupName == $name)] | length' "$WORK_DIR/log-groups.json")" == "1" ]] || {
  echo "Expected exactly one $WELCOME_LOG_GROUP log group; refusing." >&2
  exit 1
}
jq -r --arg name "$WELCOME_LOG_GROUP" '.logGroups[] | select(.logGroupName == $name) | "COST_TRIM_WELCOME_LOG_GROUP retention_days=\(.retentionInDays // "never") stored_bytes=\(.storedBytes // 0)"' "$WORK_DIR/log-groups.json"

# ---------------------------------------------------------------- Terraform: the cluster setting and the two alarms
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
  aws_ecs_cluster.app
  aws_cloudwatch_metric_alarm.web_running_tasks_low
  aws_cloudwatch_metric_alarm.web_ephemeral_storage_high
)
PLAN_ARGS=()
for target in "${TARGETS[@]}"; do PLAN_ARGS+=("-target=$target"); done

terraform -chdir="$APP_DIR" plan -input=false -no-color -lock-timeout=60s \
  "${PLAN_ARGS[@]}" -var-file="$WORK_DIR/variables.json" -out="$WORK_DIR/cost-trim.tfplan" > "$WORK_DIR/plan.log"
terraform -chdir="$APP_DIR" show -json "$WORK_DIR/cost-trim.tfplan" > "$WORK_DIR/plan.json"

python3 scripts/aws/check-cost-trim-plan.py "$WORK_DIR/plan.json"

echo "STATE_SERIAL_BEFORE=$(jq -r '.serial' "$WORK_DIR/state.json")"
echo "COST_TRIM_ACTION=$ACTION"
echo "COST_TRIM_PLAN_VERIFIED=true"
echo "PLAN_SHA256=$(sha256sum "$WORK_DIR/cost-trim.tfplan" | cut -d' ' -f1)"

if [[ "$ACTION" == "plan" ]]; then
  echo "COST_TRIM_PLAN_ONLY_NO_APPLY"
  exit 0
fi

[[ "$(bash scripts/aws/branch-head.sh refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$COST_TRIM_INFRA_EXPECTED_SHA" ]]
[[ "$(aws s3api get-bucket-versioning --bucket "$STATE_BUCKET" --query Status --output text)" == Enabled ]]
STATE_BACKUP_VERSION="$(jq -r '.VersionId // empty' "$WORK_DIR/object.json")"
[[ -n "$STATE_BACKUP_VERSION" ]]
echo "STATE_BACKUP_VERSION=$STATE_BACKUP_VERSION"

# The two small CLI changes first: if either is refused, nothing else has changed.
aws ecr put-lifecycle-policy --region "$AWS_REGION" --repository-name "$REPOSITORY" --lifecycle-policy-text "$LIFECYCLE_POLICY" >/dev/null
[[ "$(aws ecr get-lifecycle-policy --region "$AWS_REGION" --repository-name "$REPOSITORY" --query lifecyclePolicyText --output text | jq -cS .)" == "$(jq -cS . <<<"$LIFECYCLE_POLICY")" ]]
echo "COST_TRIM_ECR_POLICY_VERIFIED social=10 application=10"
ecr_check
aws logs put-retention-policy --region "$AWS_REGION" --log-group-name "$WELCOME_LOG_GROUP" --retention-in-days 14
aws logs describe-log-groups --region "$AWS_REGION" --log-group-name-prefix "$WELCOME_LOG_GROUP" --output json \
  | jq -e --arg name "$WELCOME_LOG_GROUP" '[.logGroups[] | select(.logGroupName == $name and .retentionInDays == 14)] | length == 1' >/dev/null
echo "COST_TRIM_WELCOME_RETENTION_VERIFIED=14"

terraform -chdir="$APP_DIR" apply -input=false -no-color "$WORK_DIR/cost-trim.tfplan" > "$WORK_DIR/apply.log"

terraform -chdir="$APP_DIR" plan -input=false -no-color -lock-timeout=60s \
  "${PLAN_ARGS[@]}" -var-file="$WORK_DIR/variables.json" -out="$WORK_DIR/after.tfplan" > "$WORK_DIR/plan-after.log"
terraform -chdir="$APP_DIR" show -json "$WORK_DIR/after.tfplan" > "$WORK_DIR/plan-after.json"
[[ "$(jq '[.resource_changes[]? | select(.mode != "data") | select(.change.actions != ["no-op"])] | length' "$WORK_DIR/plan-after.json")" == "0" ]] || {
  echo "Cost trim resources still drift after apply." >&2
  exit 1
}

aws ecs describe-clusters --region "$AWS_REGION" --clusters "$CLUSTER" --include SETTINGS --output json \
  | jq -e '[.clusters[0].settings[] | select(.name == "containerInsights" and .value == "disabled")] | length == 1' >/dev/null
echo "COST_TRIM_CONTAINER_INSIGHTS_VERIFIED=disabled"
aws cloudwatch describe-alarms --region "$AWS_REGION" --alarm-name-prefix sea-n-shore-staging-web- --output json > "$WORK_DIR/alarms.json"
jq -e '[.MetricAlarms[] | select(.AlarmName == "sea-n-shore-staging-web-running-tasks-low")
  | select(.Namespace == "AWS/ApplicationELB" and .MetricName == "HealthyHostCount" and .Threshold == 2 and (.AlarmActions | length) == 1)
  | select(([.Dimensions[].Name] | sort) == ["LoadBalancer", "TargetGroup"])] | length == 1' "$WORK_DIR/alarms.json" >/dev/null
echo "COST_TRIM_RUNNING_TASKS_ALARM_VERIFIED=HealthyHostCount state=$(jq -r '.MetricAlarms[] | select(.AlarmName == "sea-n-shore-staging-web-running-tasks-low") | .StateValue' "$WORK_DIR/alarms.json")"
jq -e '[.MetricAlarms[] | select(.AlarmName == "sea-n-shore-staging-web-ephemeral-storage-high")] | length == 0' "$WORK_DIR/alarms.json" >/dev/null
echo "COST_TRIM_EPHEMERAL_ALARM_REMOVED=true"
echo "COST_TRIM_APPLY_VERIFIED=true"
