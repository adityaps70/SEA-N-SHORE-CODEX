#!/usr/bin/env bash
# Round 14 Phase 1 guarded infrastructure: phone OTP limits (DynamoDB counters, Lambda limits and
# country list, topic-proof SNS policy), SMS spend cap + alarm, the ALB liveness health check, and
# alarms routed to the owner (SMS, OTP cap, Aurora, queues). Targeted plan; only the listed creates
# and in-place updates are accepted. The public user pool client is not targeted: Cognito rejected
# a phone-less write_attributes list, so any planned client change is refused.
# The action file holds "plan" or "apply-once".
set -euo pipefail
umask 077
export PATH="$HOME/bin:$PATH"
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
STATE_BUCKET="sea-n-shore-310356785722-ap-south-1-tfstate"
STATE_KEY="sea-n-shore/staging/terraform.tfstate"
APP_DIR="$PWD/infra/aws/app"
ACTION_FILE="scripts/aws/security-hardening-infra-action.txt"
PUBLIC_SITE_URL="$(tr -d '[:space:]' < scripts/aws/public-site-url.txt)"
[[ "$PUBLIC_SITE_URL" =~ ^https://[a-z0-9.-]+$ ]]
export PUBLIC_SITE_URL

[[ "${SECURITY_HARDENING_INFRA_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "SECURITY_HARDENING_INFRA_EXPECTED_SHA must be an exact commit SHA." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$SECURITY_HARDENING_INFRA_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- \
  infra/aws/app/auth.tf \
  infra/aws/app/main.tf \
  infra/aws/app/realtime.tf \
  infra/aws/app/social-events.tf \
  infra/aws/app/security-hardening.tf \
  infra/aws/app/lambda/cognito-create-auth-challenge.mjs \
  scripts/aws/security-hardening-infra.sh \
  scripts/aws/security-hardening-infra-action.txt \
  scripts/aws/security-hardening-infra.test.mjs \
  scripts/aws/public-site-url.txt \
  .github/workflows/aws-security-hardening-infra.yml
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]
source scripts/aws/bootstrap-terraform-lock.sh

ACTION="$(tr -d '[:space:]' < "$ACTION_FILE")"
case "$ACTION" in plan|apply-once) ;; *) echo "Unsupported security hardening infrastructure action." >&2; exit 1 ;; esac

WORK_DIR="$(mktemp -d "$PWD/.security-hardening-infra.XXXXXXXX")"
# Keep Terraform's provider temp files off a crowded /tmp (several runs may share the host).
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

echo "== Before =="
aws sns get-sms-attributes --region "$AWS_REGION" --attributes MonthlySpendLimit DefaultSMSType --output json \
  | jq -r '"SMS_BEFORE monthly_spend_limit=\(.attributes.MonthlySpendLimit // "unset") default_type=\(.attributes.DefaultSMSType // "unset")"'

terraform -chdir="$APP_DIR" init -input=false -no-color \
  -backend-config="bucket=$STATE_BUCKET" \
  -backend-config="key=$STATE_KEY" \
  -backend-config="region=$AWS_REGION" \
  -backend-config=use_lockfile=true > "$WORK_DIR/init.log"

TARGETS=(
  aws_dynamodb_table.otp_limits
  aws_iam_role_policy.cognito_auth_challenge_otp_limits
  aws_iam_role_policy.ecs_task_otp_limits
  aws_iam_role_policy.cognito_auth_challenge_sms
  aws_lambda_function.cognito_create_auth_challenge
  aws_lb_target_group.app
  aws_sns_sms_preferences.account
  aws_cloudwatch_metric_alarm.sms_spend_high
  aws_cloudwatch_log_metric_filter.otp_global_cap
  aws_cloudwatch_metric_alarm.otp_global_cap
  aws_cloudwatch_metric_alarm.aurora_cpu_high
  aws_cloudwatch_metric_alarm.aurora_capacity_at_max
  aws_cloudwatch_metric_alarm.aurora_connections_high
  aws_cloudwatch_metric_alarm.realtime_dlq_depth
  aws_cloudwatch_metric_alarm.realtime_queue_age
  aws_cloudwatch_metric_alarm.notification_dlq_depth
  aws_cloudwatch_metric_alarm.notification_queue_age
)
PLAN_ARGS=()
for target in "${TARGETS[@]}"; do PLAN_ARGS+=("-target=$target"); done

terraform -chdir="$APP_DIR" plan -input=false -no-color -lock-timeout=60s \
  "${PLAN_ARGS[@]}" -var-file="$WORK_DIR/variables.json" -out="$WORK_DIR/hardening.tfplan" > "$WORK_DIR/plan.log"
terraform -chdir="$APP_DIR" show -json "$WORK_DIR/hardening.tfplan" > "$WORK_DIR/plan.json"

python3 - "$WORK_DIR/plan.json" <<'PY'
import json, sys
allowed = {
  'aws_dynamodb_table.otp_limits': {('create',)},
  'aws_iam_role_policy.cognito_auth_challenge_otp_limits': {('create',)},
  'aws_iam_role_policy.ecs_task_otp_limits': {('create',)},
  'aws_iam_role_policy.cognito_auth_challenge_sms': {('update',)},
  'aws_lambda_function.cognito_create_auth_challenge': {('update',)},
  'aws_lb_target_group.app': {('update',)},
  'aws_sns_sms_preferences.account': {('create',)},
  'aws_cloudwatch_metric_alarm.sms_spend_high': {('create',)},
  'aws_cloudwatch_log_metric_filter.otp_global_cap': {('create',)},
  'aws_cloudwatch_metric_alarm.otp_global_cap': {('create',)},
  'aws_cloudwatch_metric_alarm.aurora_cpu_high': {('create',)},
  'aws_cloudwatch_metric_alarm.aurora_capacity_at_max': {('create',)},
  'aws_cloudwatch_metric_alarm.aurora_connections_high': {('create',)},
  'aws_cloudwatch_metric_alarm.realtime_dlq_depth': {('update',)},
  'aws_cloudwatch_metric_alarm.realtime_queue_age': {('update',)},
  'aws_cloudwatch_metric_alarm.notification_dlq_depth': {('update',)},
  'aws_cloudwatch_metric_alarm.notification_queue_age': {('update',)},
}
plan = json.load(open(sys.argv[1]))
changes = [r for r in plan.get('resource_changes', []) if r.get('mode') != 'data' and r['change']['actions'] != ['no-op']]
for r in changes:
    actions = tuple(r['change']['actions'])
    if r['address'] not in allowed or actions not in allowed[r['address']]:
        raise SystemExit(f"unexpected security hardening change refused: {r['address']} {list(actions)}")
print('SECURITY_HARDENING_PLAN_CHANGES=' + str(len(changes)))
def changed_keys(r):
    before, after = r['change']['before'] or {}, r['change']['after'] or {}
    return sorted(k for k in set(before) | set(after) if before.get(k) != after.get(k) and k not in ('tags', 'tags_all'))
for r in changes:
    print(f"SECURITY_HARDENING_CHANGE={r['address']}|{','.join(r['change']['actions'])}")
    if r['address'] == 'aws_lb_target_group.app':
        keys = changed_keys(r)
        if set(keys) - {'health_check'}:
            raise SystemExit('target group change outside health_check refused: ' + ','.join(keys))
        hc = (r['change']['after'].get('health_check') or [{}])[0]
        print(f"TARGET_GROUP_HEALTH_CHECK path={hc.get('path')} matcher={hc.get('matcher')}")
    if r['address'].startswith('aws_cloudwatch_metric_alarm.') and r['change']['actions'] == ['update']:
        keys = changed_keys(r)
        if set(keys) - {'alarm_actions', 'ok_actions'}:
            raise SystemExit(r['address'] + ' change outside alarm/ok actions refused: ' + ','.join(keys))
    if r['address'] == 'aws_lambda_function.cognito_create_auth_challenge':
        print('LAMBDA_CHANGED_KEYS=' + ','.join(changed_keys(r)))
PY

echo "STATE_SERIAL_BEFORE=$(jq -r '.serial' "$WORK_DIR/state.json")"
echo "SECURITY_HARDENING_ACTION=$ACTION"
echo "SECURITY_HARDENING_PLAN_VERIFIED=true"
echo "PLAN_SHA256=$(sha256sum "$WORK_DIR/hardening.tfplan" | cut -d' ' -f1)"

if [[ "$ACTION" == "plan" ]]; then
  echo "SECURITY_HARDENING_PLAN_ONLY_NO_APPLY"
  exit 0
fi

[[ "$(git ls-remote origin refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$SECURITY_HARDENING_INFRA_EXPECTED_SHA" ]]
[[ "$(aws s3api get-bucket-versioning --bucket "$STATE_BUCKET" --query Status --output text)" == Enabled ]]
STATE_BACKUP_VERSION="$(jq -r '.VersionId // empty' "$WORK_DIR/object.json")"
[[ -n "$STATE_BACKUP_VERSION" ]]
echo "STATE_BACKUP_VERSION=$STATE_BACKUP_VERSION"

terraform -chdir="$APP_DIR" apply -input=false -no-color "$WORK_DIR/hardening.tfplan" > "$WORK_DIR/apply.log"

terraform -chdir="$APP_DIR" plan -input=false -no-color -lock-timeout=60s \
  "${PLAN_ARGS[@]}" -var-file="$WORK_DIR/variables.json" -out="$WORK_DIR/after.tfplan" > "$WORK_DIR/plan-after.log"
terraform -chdir="$APP_DIR" show -json "$WORK_DIR/after.tfplan" > "$WORK_DIR/plan-after.json"
[[ "$(jq '[.resource_changes[]? | select(.mode != "data") | select(.change.actions != ["no-op"])] | length' "$WORK_DIR/plan-after.json")" == "0" ]] || {
  echo "Security hardening resources still drift after apply." >&2
  exit 1
}

aws dynamodb describe-time-to-live --region "$AWS_REGION" --table-name sea-n-shore-staging-otp-limits --output json \
  | jq -e '.TimeToLiveDescription.AttributeName == "expiresAt" and (.TimeToLiveDescription.TimeToLiveStatus | test("ENABL"))' >/dev/null
echo "OTP_LIMITS_TABLE_VERIFIED=true"
aws lambda get-function-configuration --region "$AWS_REGION" --function-name sea-n-shore-staging-cognito-create-auth-challenge --output json \
  | jq -e '.Environment.Variables.OTP_LIMITS_TABLE == "sea-n-shore-staging-otp-limits" and .Environment.Variables.ALLOWED_PHONE_CALLING_CODES == "91" and .State == "Active"' >/dev/null
echo "OTP_LAMBDA_VERIFIED=true"
aws elbv2 describe-target-groups --region "$AWS_REGION" --names sea-n-shore-staging-web --output json \
  | jq -e '.TargetGroups[0].HealthCheckPath == "/api/health/live"' >/dev/null
# Both targets must stay healthy on the new check.
HEALTHY=false
TG_ARN="$(aws elbv2 describe-target-groups --region "$AWS_REGION" --names sea-n-shore-staging-web --query 'TargetGroups[0].TargetGroupArn' --output text)"
for attempt in $(seq 1 30); do
  if aws elbv2 describe-target-health --region "$AWS_REGION" --target-group-arn "$TG_ARN" --output json \
    | jq -e '[.TargetHealthDescriptions[].TargetHealth.State] | length >= 2 and all(. == "healthy")' >/dev/null; then
    HEALTHY=true
    break
  fi
  sleep 10
done
[[ "$HEALTHY" == true ]] || { echo "Web targets are not healthy on /api/health/live." >&2; exit 1; }
echo "TARGET_GROUP_LIVENESS_VERIFIED=true"
aws sns get-sms-attributes --region "$AWS_REGION" --attributes MonthlySpendLimit DefaultSMSType --output json \
  | jq -r '"SMS_AFTER monthly_spend_limit=\(.attributes.MonthlySpendLimit // "unset") default_type=\(.attributes.DefaultSMSType // "unset")"'
echo "SECURITY_HARDENING_APPLY_VERIFIED=true"
