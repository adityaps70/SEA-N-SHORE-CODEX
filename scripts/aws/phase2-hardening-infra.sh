#!/usr/bin/env bash
# Round 14 Phase 2 guarded infrastructure (2.1, 2.14): media bucket lifecycle (noncurrent versions
# after 30 days, abandoned multipart uploads after 1 day), an ALB access-log bucket (90 days), ALB
# deletion protection + invalid-header dropping + access logs. (ECS Exec stays on: planning the web
# service also plans its task definition, which the deploy workflow manages.) Targeted plan; only
# these creates and exact in-place updates are accepted. The action file holds "plan" or
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
ACTION_FILE="scripts/aws/phase2-hardening-infra-action.txt"
MEDIA_BUCKET="sea-n-shore-staging-310356785722-media"
LOG_BUCKET="sea-n-shore-staging-310356785722-alb-logs"
PUBLIC_SITE_URL="$(tr -d '[:space:]' < scripts/aws/public-site-url.txt)"
[[ "$PUBLIC_SITE_URL" =~ ^https://[a-z0-9.-]+$ ]]
export PUBLIC_SITE_URL

[[ "${PHASE2_HARDENING_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "PHASE2_HARDENING_EXPECTED_SHA must be an exact commit SHA." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$PHASE2_HARDENING_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- \
  infra/aws/app/phase2-hardening.tf \
  infra/aws/app/storage.tf \
  infra/aws/app/main.tf \
  scripts/aws/phase2-hardening-infra.sh \
  scripts/aws/phase2-hardening-infra-action.txt \
  scripts/aws/phase2-hardening-infra.test.mjs \
  scripts/aws/public-site-url.txt \
  .github/workflows/aws-phase2-hardening-infra.yml
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]
source scripts/aws/bootstrap-terraform-lock.sh

ACTION="$(cut -d' ' -f1 < "$ACTION_FILE" | tr -d '[:space:]')"
case "$ACTION" in plan|apply-once) ;; *) echo "Unsupported phase 2 hardening action." >&2; exit 1 ;; esac

WORK_DIR="$(mktemp -d "$PWD/.phase2-hardening.XXXXXXXX")"
TF_TMPDIR="$(mktemp -d /var/tmp/sns-tf.XXXXXX)"
export TMPDIR="$TF_TMPDIR"
trap 'rm -rf -- "$WORK_DIR" "$TF_TMPDIR"' EXIT; trap 'exit 129' HUP; trap 'exit 130' INT; trap 'exit 143' TERM

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
  aws_s3_bucket_lifecycle_configuration.media
  aws_s3_bucket.alb_logs
  aws_s3_bucket_public_access_block.alb_logs
  aws_s3_bucket_server_side_encryption_configuration.alb_logs
  aws_s3_bucket_lifecycle_configuration.alb_logs
  aws_s3_bucket_policy.alb_logs
  aws_lb.app
)
PLAN_ARGS=()
for target in "${TARGETS[@]}"; do PLAN_ARGS+=("-target=$target"); done

terraform -chdir="$APP_DIR" plan -input=false -no-color -lock-timeout=60s \
  "${PLAN_ARGS[@]}" -var-file="$WORK_DIR/variables.json" -out="$WORK_DIR/phase2.tfplan" > "$WORK_DIR/plan.log"
terraform -chdir="$APP_DIR" show -json "$WORK_DIR/phase2.tfplan" > "$WORK_DIR/plan.json"

python3 - "$WORK_DIR/plan.json" <<'PY'
import json, sys
allowed = {
  'aws_s3_bucket_lifecycle_configuration.media': {('create',)},
  'aws_s3_bucket.alb_logs': {('create',)},
  'aws_s3_bucket_public_access_block.alb_logs': {('create',)},
  'aws_s3_bucket_server_side_encryption_configuration.alb_logs': {('create',)},
  'aws_s3_bucket_lifecycle_configuration.alb_logs': {('create',)},
  'aws_s3_bucket_policy.alb_logs': {('create',)},
  'aws_lb.app': {('update',)},
}
update_keys = {
  'aws_lb.app': {'enable_deletion_protection', 'drop_invalid_header_fields', 'access_logs'},
}
plan = json.load(open(sys.argv[1]))
changes = [r for r in plan.get('resource_changes', []) if r.get('mode') != 'data' and r['change']['actions'] != ['no-op']]
for r in changes:
    actions = tuple(r['change']['actions'])
    if r['address'] not in allowed or actions not in allowed[r['address']]:
        raise SystemExit(f"unexpected phase 2 hardening change refused: {r['address']} {list(actions)}")
print('PHASE2_HARDENING_PLAN_CHANGES=' + str(len(changes)))
for r in changes:
    print(f"PHASE2_HARDENING_CHANGE={r['address']}|{','.join(r['change']['actions'])}")
    if r['address'] in update_keys:
        before, after = r['change']['before'] or {}, r['change']['after'] or {}
        keys = sorted(k for k in set(before) | set(after) if before.get(k) != after.get(k) and k not in ('tags', 'tags_all'))
        if set(keys) - update_keys[r['address']]:
            raise SystemExit(r['address'] + ' change outside its intended attributes refused: ' + ','.join(keys))
        print(f"PHASE2_HARDENING_KEYS={r['address']}|{','.join(keys)}")
    if r['address'] == 'aws_lb.app':
        after = r['change']['after']
        if after.get('enable_deletion_protection') is not True or after.get('drop_invalid_header_fields') is not True:
            raise SystemExit('ALB must end with deletion protection and invalid-header dropping on')
PY

echo "STATE_SERIAL_BEFORE=$(jq -r '.serial' "$WORK_DIR/state.json")"
echo "PHASE2_HARDENING_ACTION=$ACTION"
echo "PHASE2_HARDENING_PLAN_VERIFIED=true"
echo "PLAN_SHA256=$(sha256sum "$WORK_DIR/phase2.tfplan" | cut -d' ' -f1)"

if [[ "$ACTION" == "plan" ]]; then
  echo "PHASE2_HARDENING_PLAN_ONLY_NO_APPLY"
  exit 0
fi

[[ "$(bash scripts/aws/branch-head.sh refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$PHASE2_HARDENING_EXPECTED_SHA" ]]
[[ "$(aws s3api get-bucket-versioning --bucket "$STATE_BUCKET" --query Status --output text)" == Enabled ]]
STATE_BACKUP_VERSION="$(jq -r '.VersionId // empty' "$WORK_DIR/object.json")"
[[ -n "$STATE_BACKUP_VERSION" ]]
echo "STATE_BACKUP_VERSION=$STATE_BACKUP_VERSION"

terraform -chdir="$APP_DIR" apply -input=false -no-color "$WORK_DIR/phase2.tfplan" > "$WORK_DIR/apply.log"

terraform -chdir="$APP_DIR" plan -input=false -no-color -lock-timeout=60s \
  "${PLAN_ARGS[@]}" -var-file="$WORK_DIR/variables.json" -out="$WORK_DIR/after.tfplan" > "$WORK_DIR/plan-after.log"
terraform -chdir="$APP_DIR" show -json "$WORK_DIR/after.tfplan" > "$WORK_DIR/plan-after.json"
[[ "$(jq '[.resource_changes[]? | select(.mode != "data") | select(.change.actions != ["no-op"])] | length' "$WORK_DIR/plan-after.json")" == "0" ]] || {
  echo "Phase 2 hardening resources still drift after apply." >&2
  exit 1
}

aws s3api get-bucket-lifecycle-configuration --bucket "$MEDIA_BUCKET" --output json \
  | jq -e '[.Rules[] | select(.Status == "Enabled")] | (map(.NoncurrentVersionExpiration.NoncurrentDays) | index(30)) != null and (map(.AbortIncompleteMultipartUpload.DaysAfterInitiation) | index(1)) != null' >/dev/null
echo "MEDIA_LIFECYCLE_VERIFIED=true"
ALB_ARN="$(aws elbv2 describe-load-balancers --region "$AWS_REGION" --names sea-n-shore-staging-alb --query 'LoadBalancers[0].LoadBalancerArn' --output text)"
aws elbv2 describe-load-balancer-attributes --region "$AWS_REGION" --load-balancer-arn "$ALB_ARN" --output json \
  | jq -e '(.Attributes | from_entries) as $a | $a["deletion_protection.enabled"] == "true" and $a["routing.http.drop_invalid_header_fields.enabled"] == "true" and $a["access_logs.s3.enabled"] == "true" and $a["access_logs.s3.bucket"] == "'"$LOG_BUCKET"'"' >/dev/null
echo "ALB_ATTRIBUTES_VERIFIED=true"
aws s3api head-object --bucket "$LOG_BUCKET" --key "alb/AWSLogs/$EXPECTED_ACCOUNT/ELBAccessLogTestFile" >/dev/null
echo "ALB_ACCESS_LOG_DELIVERY_VERIFIED=true"
aws ecs describe-services --region "$AWS_REGION" --cluster sea-n-shore-staging --services sea-n-shore-staging-web --output json \
  | jq -e '.services[0] | .runningCount == .desiredCount and .desiredCount >= 2' >/dev/null
echo "ECS_SERVICE_STEADY=true"
[[ "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 30 "${PUBLIC_SITE_URL%/}/api/health/live")" == 200 ]]
echo "PUBLIC_SITE_LIVE_VERIFIED=true"
echo "PHASE2_HARDENING_APPLY_VERIFIED=true"
