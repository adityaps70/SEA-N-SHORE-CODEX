#!/usr/bin/env bash
# Round 15 guarded infrastructure: retire phone/SMS sign-in and add the health check token.
# - The public web client drops ALLOW_CUSTOM_AUTH (in-place; nothing else on the client changes).
# - The user pool drops the define/create/verify auth challenge triggers (in-place; the pre-sign-up
#   trigger, the Resend email sender and its key stay exactly as they are).
# - The three challenge Lambdas, their permissions, role, policies (including sns:Publish) and log
#   groups, the OTP limits table and both policies on it, and the SMS spend / OTP cap alarms are
#   destroyed. The account SMS preferences are only forgotten (removed block), so the USD 1 SMS
#   spend limit stays on the account.
# - The health check token secret, its generated version and read access for the ECS execution role
#   (only that secret) are created. The value is never read or printed here.
# Targeted plan; anything outside this list is refused. The action file holds "plan" or "apply-once".
set -euo pipefail
umask 077
export PATH="$HOME/bin:$PATH"
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
STATE_BUCKET="sea-n-shore-310356785722-ap-south-1-tfstate"
STATE_KEY="sea-n-shore/staging/terraform.tfstate"
APP_DIR="$PWD/infra/aws/app"
ACTION_FILE="scripts/aws/sms-retirement-infra-action.txt"
OTP_TABLE="sea-n-shore-staging-otp-limits"
HEALTH_SECRET_NAME="sea-n-shore-staging/health-check-token"
EXECUTION_ROLE="sea-n-shore-staging-ecs-execution"
HEALTH_POLICY_NAME="sea-n-shore-staging-health-check-token-secret"
CHALLENGE_FUNCTIONS=(
  sea-n-shore-staging-cognito-define-auth-challenge
  sea-n-shore-staging-cognito-create-auth-challenge
  sea-n-shore-staging-cognito-verify-auth-challenge
)
PUBLIC_SITE_URL="$(tr -d '[:space:]' < scripts/aws/public-site-url.txt)"
[[ "$PUBLIC_SITE_URL" =~ ^https://[a-z0-9.-]+$ ]]
export PUBLIC_SITE_URL

[[ "${SMS_RETIREMENT_INFRA_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "SMS_RETIREMENT_INFRA_EXPECTED_SHA must be an exact commit SHA." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$SMS_RETIREMENT_INFRA_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- \
  infra/aws/app/auth.tf \
  infra/aws/app/security-hardening.tf \
  infra/aws/app/health-check-token.tf \
  infra/aws/app/main.tf \
  infra/aws/app/cognito-email-sender.tf \
  scripts/aws/sms-retirement-infra.sh \
  scripts/aws/sms-retirement-infra-action.txt \
  scripts/aws/sms-retirement-infra.test.mjs \
  scripts/aws/public-site-url.txt \
  .github/workflows/aws-sms-retirement-infra.yml
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]
source scripts/aws/bootstrap-terraform-lock.sh

ACTION="$(cut -d' ' -f1 < "$ACTION_FILE" | tr -d '[:space:]')"
case "$ACTION" in plan|apply-once) ;; *) echo "Unsupported SMS retirement infrastructure action." >&2; exit 1 ;; esac

WORK_DIR="$(mktemp -d "$PWD/.sms-retirement-infra.XXXXXXXX")"
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

USER_POOL_ID="$(jq -r '[.resources[] | select(.mode=="managed" and .type=="aws_cognito_user_pool" and .name=="app") | .instances[0].attributes.id][0] // empty' "$WORK_DIR/state.json")"
CLIENT_ID="$(jq -r '[.resources[] | select(.mode=="managed" and .type=="aws_cognito_user_pool_client" and .name=="web") | .instances[0].attributes.id][0] // empty' "$WORK_DIR/state.json")"
[[ "$USER_POOL_ID" =~ ^ap-south-1_[A-Za-z0-9]+$ ]]
[[ "$CLIENT_ID" =~ ^[a-z0-9]+$ ]]

echo "== Before =="
aws cognito-idp describe-user-pool-client --region "$AWS_REGION" --user-pool-id "$USER_POOL_ID" --client-id "$CLIENT_ID" --output json \
  | jq -r '"COGNITO_CLIENT_EXPLICIT_AUTH_FLOWS_BEFORE=" + (.UserPoolClient.ExplicitAuthFlows | sort | join(","))'
aws cognito-idp describe-user-pool --region "$AWS_REGION" --user-pool-id "$USER_POOL_ID" --output json \
  | jq -r '"COGNITO_LAMBDA_TRIGGERS_BEFORE=" + (.UserPool.LambdaConfig | keys | sort | join(","))'
aws sns get-sms-attributes --region "$AWS_REGION" --attributes MonthlySpendLimit --output json \
  | jq -r '"SMS_MONTHLY_SPEND_LIMIT_BEFORE=\(.attributes.MonthlySpendLimit // "unset")"'

# Read-only: phone-only Cognito users (a phone number and either no email or only the synthetic
# phone-login address). Only the count, sub, creation date, status and kind are printed: never a
# phone number or an email. The listing is piped straight into jq and never written to disk.
aws cognito-idp list-users --region "$AWS_REGION" --user-pool-id "$USER_POOL_ID" --output json \
  | jq -r '
      def attr($name): ([.Attributes[]? | select(.Name == $name) | .Value][0] // null);
      [.Users[]
        | select(attr("phone_number") != null)
        | (attr("email")) as $email
        | select($email == null or ($email | test("^phone-[0-9a-f]{32}@auth\\.seaandshore\\.in$"; "i")))
        | {sub: attr("sub"), created: .UserCreateDate, status: .UserStatus, enabled: .Enabled, kind: (if $email == null then "no_email" else "phone_login_email" end)}
      ] as $users
      | "PHONE_ONLY_USERS_COUNT=\($users | length)",
        ($users | sort_by(.created)[] | "PHONE_ONLY_USER=sub=\(.sub)|created=\(.created)|status=\(.status)|enabled=\(.enabled)|kind=\(.kind)")
    '

terraform -chdir="$APP_DIR" init -input=false -no-color \
  -backend-config="bucket=$STATE_BUCKET" \
  -backend-config="key=$STATE_KEY" \
  -backend-config="region=$AWS_REGION" \
  -backend-config=use_lockfile=true > "$WORK_DIR/init.log"

# Removed resources are targeted by their old addresses (a target that exists only in state plans
# its destroy); the SMS preferences are covered by the removed block (forget, never destroy).
TARGETS=(
  aws_cognito_user_pool.app
  aws_cognito_user_pool_client.web
  aws_lambda_function.cognito_define_auth_challenge
  aws_lambda_function.cognito_create_auth_challenge
  aws_lambda_function.cognito_verify_auth_challenge
  aws_lambda_permission.cognito_define_auth_challenge
  aws_lambda_permission.cognito_create_auth_challenge
  aws_lambda_permission.cognito_verify_auth_challenge
  aws_cloudwatch_log_group.cognito_define_auth_challenge
  aws_cloudwatch_log_group.cognito_create_auth_challenge
  aws_cloudwatch_log_group.cognito_verify_auth_challenge
  aws_iam_role.cognito_auth_challenge
  aws_iam_role_policy_attachment.cognito_auth_challenge_logs
  aws_iam_role_policy.cognito_auth_challenge_sms
  aws_iam_role_policy.cognito_auth_challenge_otp_limits
  aws_iam_role_policy.ecs_task_otp_limits
  aws_dynamodb_table.otp_limits
  aws_cloudwatch_metric_alarm.sms_spend_high
  aws_cloudwatch_log_metric_filter.otp_global_cap
  aws_cloudwatch_metric_alarm.otp_global_cap
  aws_sns_sms_preferences.account
  random_password.health_check_token
  aws_secretsmanager_secret.health_check_token
  aws_secretsmanager_secret_version.health_check_token
  aws_iam_role_policy.ecs_execution_health_check_token_secret
)
PLAN_ARGS=()
for target in "${TARGETS[@]}"; do PLAN_ARGS+=("-target=$target"); done

terraform_plan_bounded "$WORK_DIR/plan.log" -chdir="$APP_DIR" plan -input=false -no-color -lock-timeout=60s \
  "${PLAN_ARGS[@]}" -var-file="$WORK_DIR/variables.json" -out="$WORK_DIR/sms-retirement.tfplan"
terraform -chdir="$APP_DIR" show -json "$WORK_DIR/sms-retirement.tfplan" > "$WORK_DIR/plan.json"

cat > "$WORK_DIR/classify-plan.py" <<'PY'
import json, sys
# address -> (only accepted action, attribute that must name the expected object, expected value)
destroys = {
  'aws_lambda_function.cognito_define_auth_challenge': ('function_name', 'sea-n-shore-staging-cognito-define-auth-challenge'),
  'aws_lambda_function.cognito_create_auth_challenge': ('function_name', 'sea-n-shore-staging-cognito-create-auth-challenge'),
  'aws_lambda_function.cognito_verify_auth_challenge': ('function_name', 'sea-n-shore-staging-cognito-verify-auth-challenge'),
  'aws_lambda_permission.cognito_define_auth_challenge': ('function_name', 'sea-n-shore-staging-cognito-define-auth-challenge'),
  'aws_lambda_permission.cognito_create_auth_challenge': ('function_name', 'sea-n-shore-staging-cognito-create-auth-challenge'),
  'aws_lambda_permission.cognito_verify_auth_challenge': ('function_name', 'sea-n-shore-staging-cognito-verify-auth-challenge'),
  'aws_cloudwatch_log_group.cognito_define_auth_challenge': ('name', '/aws/lambda/sea-n-shore-staging-cognito-define-auth-challenge'),
  'aws_cloudwatch_log_group.cognito_create_auth_challenge': ('name', '/aws/lambda/sea-n-shore-staging-cognito-create-auth-challenge'),
  'aws_cloudwatch_log_group.cognito_verify_auth_challenge': ('name', '/aws/lambda/sea-n-shore-staging-cognito-verify-auth-challenge'),
  'aws_iam_role.cognito_auth_challenge': ('name', 'sea-n-shore-staging-cognito-auth-challenge'),
  'aws_iam_role_policy_attachment.cognito_auth_challenge_logs': ('role', 'sea-n-shore-staging-cognito-auth-challenge'),
  'aws_iam_role_policy.cognito_auth_challenge_sms': ('name', 'sea-n-shore-staging-cognito-auth-challenge-sms'),
  'aws_iam_role_policy.cognito_auth_challenge_otp_limits': ('name', 'sea-n-shore-staging-cognito-auth-challenge-otp-limits'),
  'aws_iam_role_policy.ecs_task_otp_limits': ('name', 'sea-n-shore-staging-otp-limits-runtime'),
  'aws_dynamodb_table.otp_limits': ('name', 'sea-n-shore-staging-otp-limits'),
  'aws_cloudwatch_metric_alarm.sms_spend_high': ('alarm_name', 'sea-n-shore-staging-sms-spend-high'),
  'aws_cloudwatch_log_metric_filter.otp_global_cap': ('name', 'sea-n-shore-staging-otp-global-cap'),
  'aws_cloudwatch_metric_alarm.otp_global_cap': ('alarm_name', 'sea-n-shore-staging-otp-global-cap-reached'),
}
forgets = {'aws_sns_sms_preferences.account'}
creates = {
  'random_password.health_check_token',
  'aws_secretsmanager_secret.health_check_token',
  'aws_secretsmanager_secret_version.health_check_token',
  'aws_iam_role_policy.ecs_execution_health_check_token_secret',
}
updates = {'aws_cognito_user_pool.app', 'aws_cognito_user_pool_client.web'}
custom_triggers = ('define_auth_challenge', 'create_auth_challenge', 'verify_auth_challenge_response')
web_flows_after = ['ALLOW_REFRESH_TOKEN_AUTH', 'ALLOW_USER_PASSWORD_AUTH', 'ALLOW_USER_SRP_AUTH']

def refuse(message):
    raise SystemExit('SMS retirement plan refused: ' + message)

def changed_keys(r):
    before, after = r['change']['before'] or {}, r['change']['after'] or {}
    unknown = r['change'].get('after_unknown') or {}
    keys = {k for k in set(before) | set(after) if before.get(k) != after.get(k) and k not in ('tags', 'tags_all')}
    keys |= {k for k, v in unknown.items() if v is True and k in before}
    return sorted(keys)

def first(value):
    return (value or [{}])[0] if isinstance(value, list) else (value or {})

plan = json.load(open(sys.argv[1]))
changes = [r for r in plan.get('resource_changes', []) if r.get('mode') != 'data' and r['change']['actions'] != ['no-op']]
seen = set()
for r in changes:
    address, actions = r['address'], r['change']['actions']
    before, after = r['change']['before'] or {}, r['change']['after'] or {}
    seen.add(address)
    print(f"SMS_RETIREMENT_CHANGE={address}|{','.join(actions)}")
    if address in destroys:
        if actions != ['delete']:
            refuse(f'{address} may only be destroyed, not {actions}')
        key, expected = destroys[address]
        if before.get(key) != expected:
            refuse(f'{address} is not the expected object ({key})')
    elif address in forgets:
        if actions != ['forget']:
            refuse(f'{address} may only be forgotten (the account SMS spend limit stays), not {actions}')
    elif address in creates:
        if actions != ['create']:
            refuse(f'{address} may only be created, not {actions}')
        if address == 'random_password.health_check_token' and (after.get('length') != 64 or after.get('special') is not False):
            refuse('the health check token must be 64 random alphanumeric characters')
        if address == 'aws_secretsmanager_secret.health_check_token' and after.get('name') != 'sea-n-shore-staging/health-check-token':
            refuse('unexpected health check token secret name')
        if address == 'aws_iam_role_policy.ecs_execution_health_check_token_secret':
            if after.get('role') != 'sea-n-shore-staging-ecs-execution' or after.get('name') != 'sea-n-shore-staging-health-check-token-secret':
                refuse('the health check token read policy must sit on the ECS execution role only')
    elif address in updates:
        if actions != ['update']:
            refuse(f'{address} may only be updated in place, not {actions}')
        keys = changed_keys(r)
        print(f"SMS_RETIREMENT_KEYS={address}|{','.join(keys)}")
        if address == 'aws_cognito_user_pool.app':
            # Computed bookkeeping the provider may recompute on any update; everything else is refused.
            if set(keys) - {'lambda_config', 'last_modified_date', 'estimated_number_of_users'}:
                refuse('user pool change outside lambda_config: ' + ','.join(keys))
            lb, la = first(before.get('lambda_config')), first(after.get('lambda_config'))
            if any(la.get(k) for k in custom_triggers):
                refuse('the custom auth triggers must be detached')
            other = sorted(k for k in set(lb) | set(la) if k not in custom_triggers and lb.get(k) != la.get(k))
            if other:
                refuse('user pool lambda_config change outside the custom auth triggers: ' + ','.join(other))
            unknown = first((r['change'].get('after_unknown') or {}).get('lambda_config'))
            if isinstance(unknown, dict) and any(v is True for v in unknown.values()):
                refuse('user pool lambda_config has unknown values after the change')
            print('COGNITO_LAMBDA_TRIGGERS_PLANNED_AFTER=' + ','.join(sorted(k for k, v in la.items() if v)))
        if address == 'aws_cognito_user_pool_client.web':
            if set(keys) - {'explicit_auth_flows'}:
                refuse('web client change outside explicit_auth_flows: ' + ','.join(keys))
            if 'ALLOW_CUSTOM_AUTH' not in (before.get('explicit_auth_flows') or []):
                refuse('the web client did not have ALLOW_CUSTOM_AUTH before')
            if sorted(after.get('explicit_auth_flows') or []) != web_flows_after:
                refuse('the web client must end with exactly password, SRP and refresh-token flows')
            print('COGNITO_CLIENT_EXPLICIT_AUTH_FLOWS_PLANNED_AFTER=' + ','.join(sorted(after['explicit_auth_flows'])))
    else:
        refuse(f'unexpected change {address} {actions}')

# The pool and client updates may already be live (multi-login-auth-infra also plans them); the
# post-apply checks read the live pool and client either way. Everything else must be in the plan.
expected = set(destroys) | forgets | creates
if not changes:
    # After the apply nothing is left to change; a partial plan is still refused below.
    print('SMS_RETIREMENT_ALREADY_APPLIED=true')
    print('SMS_RETIREMENT_PLAN_CHANGES=0')
    raise SystemExit(0)
missing = sorted(expected - seen)
if missing:
    refuse('expected changes are missing from the plan: ' + ','.join(missing))
print('SMS_RETIREMENT_PLAN_CHANGES=' + str(len(changes)))
PY
python3 "$WORK_DIR/classify-plan.py" "$WORK_DIR/plan.json" | tee "$WORK_DIR/classify.out"

echo "STATE_SERIAL_BEFORE=$(jq -r '.serial' "$WORK_DIR/state.json")"
echo "SMS_RETIREMENT_ACTION=$ACTION"
echo "SMS_RETIREMENT_PLAN_VERIFIED=true"
echo "PLAN_SHA256=$(sha256sum "$WORK_DIR/sms-retirement.tfplan" | cut -d' ' -f1)"

if [[ "$ACTION" == "plan" ]]; then
  echo "SMS_RETIREMENT_PLAN_ONLY_NO_APPLY"
  exit 0
fi
if grep -qx 'SMS_RETIREMENT_ALREADY_APPLIED=true' "$WORK_DIR/classify.out"; then
  echo "SMS retirement is already applied; nothing to apply." >&2
  exit 1
fi

[[ "$(bash scripts/aws/branch-head.sh refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$SMS_RETIREMENT_INFRA_EXPECTED_SHA" ]]
[[ "$(aws s3api get-bucket-versioning --bucket "$STATE_BUCKET" --query Status --output text)" == Enabled ]]
STATE_BACKUP_VERSION="$(jq -r '.VersionId // empty' "$WORK_DIR/object.json")"
[[ -n "$STATE_BACKUP_VERSION" ]]
echo "STATE_BACKUP_VERSION=$STATE_BACKUP_VERSION"

# Apply exactly the saved plan that was just checked.
terraform -chdir="$APP_DIR" apply -input=false -no-color "$WORK_DIR/sms-retirement.tfplan" > "$WORK_DIR/apply.log"

terraform_plan_bounded "$WORK_DIR/plan-after.log" -chdir="$APP_DIR" plan -input=false -no-color -lock-timeout=60s \
  "${PLAN_ARGS[@]}" -var-file="$WORK_DIR/variables.json" -out="$WORK_DIR/after.tfplan"
terraform -chdir="$APP_DIR" show -json "$WORK_DIR/after.tfplan" > "$WORK_DIR/plan-after.json"
[[ "$(jq '[.resource_changes[]? | select(.mode != "data") | select(.change.actions != ["no-op"])] | length' "$WORK_DIR/plan-after.json")" == "0" ]] || {
  echo "SMS retirement resources still drift after apply." >&2
  jq -c '[.resource_changes[]? | select(.mode != "data") | select(.change.actions != ["no-op"]) | {address, actions: .change.actions}]' "$WORK_DIR/plan-after.json" >&2
  exit 1
}
echo "SMS_RETIREMENT_DRIFT_FREE=true"

# The web client no longer offers custom auth, and the pool has no challenge triggers.
aws cognito-idp describe-user-pool-client --region "$AWS_REGION" --user-pool-id "$USER_POOL_ID" --client-id "$CLIENT_ID" --output json > "$WORK_DIR/client.json"
echo "COGNITO_CLIENT_EXPLICIT_AUTH_FLOWS=$(jq -r '.UserPoolClient.ExplicitAuthFlows | sort | join(",")' "$WORK_DIR/client.json")"
jq -e '(.UserPoolClient.ExplicitAuthFlows | index("ALLOW_CUSTOM_AUTH")) == null' "$WORK_DIR/client.json" >/dev/null || {
  echo "The web client still allows CUSTOM_AUTH." >&2
  exit 1
}
echo "CUSTOM_AUTH_FLOW_DISABLED=true"
aws cognito-idp describe-user-pool --region "$AWS_REGION" --user-pool-id "$USER_POOL_ID" --output json > "$WORK_DIR/user-pool.json"
echo "COGNITO_LAMBDA_TRIGGERS=$(jq -r '.UserPool.LambdaConfig | keys | sort | join(",")' "$WORK_DIR/user-pool.json")"
jq -e '
  (.UserPool.LambdaConfig.DefineAuthChallenge // null) == null
  and (.UserPool.LambdaConfig.CreateAuthChallenge // null) == null
  and (.UserPool.LambdaConfig.VerifyAuthChallengeResponse // null) == null
  and (.UserPool.LambdaConfig.PreSignUp | type == "string")
' "$WORK_DIR/user-pool.json" >/dev/null || {
  echo "The user pool still has custom auth triggers (or lost its pre-sign-up trigger)." >&2
  exit 1
}
echo "CUSTOM_AUTH_TRIGGERS_DETACHED=true"

# Cognito must now refuse the CUSTOM_AUTH flow on the web client. Only run once the flow and the
# triggers are confirmed gone (above), with a made-up username on a reserved domain, so no code can
# be sent to anybody. Cognito answers InvalidParameterException ("Auth flow not enabled for this
# client"); only the error code and message are printed.
PROBE_USERNAME="sms-retirement-probe-$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')@example.invalid"
if aws cognito-idp initiate-auth --region "$AWS_REGION" --client-id "$CLIENT_ID" --auth-flow CUSTOM_AUTH \
  --auth-parameters "USERNAME=$PROBE_USERNAME" --output json > "$WORK_DIR/custom-auth-probe.json" 2> "$WORK_DIR/custom-auth-probe.err"; then
  echo "Cognito accepted a CUSTOM_AUTH sign-in on the web client." >&2
  exit 1
fi
PROBE_ERROR="$(grep -oE '\((InvalidParameterException|NotAuthorizedException)\).*' "$WORK_DIR/custom-auth-probe.err" | head -n 1 || true)"
echo "CUSTOM_AUTH_INITIATE_ERROR=${PROBE_ERROR:-unrecognised}"
grep -Eq 'InvalidParameterException|NotAuthorizedException' <<<"$PROBE_ERROR" || {
  echo "CUSTOM_AUTH was refused, but not with the expected flow-disabled error." >&2
  exit 1
}
grep -Eqi 'not enabled|flow' <<<"$PROBE_ERROR" || {
  echo "CUSTOM_AUTH was refused for a reason other than the flow being disabled." >&2
  exit 1
}
echo "CUSTOM_AUTH_INITIATE_REJECTED=true"

for fn in "${CHALLENGE_FUNCTIONS[@]}"; do
  if aws lambda get-function --region "$AWS_REGION" --function-name "$fn" > /dev/null 2> "$WORK_DIR/lambda.err"; then
    echo "Lambda $fn still exists." >&2
    exit 1
  fi
  grep -q 'ResourceNotFoundException' "$WORK_DIR/lambda.err" || { echo "Could not confirm $fn is gone." >&2; exit 1; }
done
echo "CUSTOM_AUTH_LAMBDAS_ABSENT=true"

if aws dynamodb describe-table --region "$AWS_REGION" --table-name "$OTP_TABLE" > /dev/null 2> "$WORK_DIR/otp-table.err"; then
  echo "The OTP limits table still exists." >&2
  exit 1
fi
grep -q 'ResourceNotFoundException' "$WORK_DIR/otp-table.err" || { echo "Could not confirm the OTP limits table is gone." >&2; exit 1; }
echo "OTP_LIMITS_TABLE_ABSENT=true"

# The health check token exists (name and ARN only; the value is never read here).
aws secretsmanager describe-secret --region "$AWS_REGION" --secret-id "$HEALTH_SECRET_NAME" --output json > "$WORK_DIR/health-secret.json"
HEALTH_SECRET_ARN="$(jq -r '.ARN' "$WORK_DIR/health-secret.json")"
[[ "$HEALTH_SECRET_ARN" =~ ^arn:aws:secretsmanager:ap-south-1:310356785722:secret:sea-n-shore-staging/health-check-token-[A-Za-z0-9]{6}$ ]]
jq -e '(.DeletedDate // null) == null and ([.VersionIdsToStages[]? | index("AWSCURRENT")] | any)' "$WORK_DIR/health-secret.json" >/dev/null
echo "HEALTH_CHECK_TOKEN_SECRET_NAME=$HEALTH_SECRET_NAME"
echo "HEALTH_CHECK_TOKEN_SECRET_ARN=$HEALTH_SECRET_ARN"
echo "HEALTH_CHECK_TOKEN_SECRET_VERIFIED=true"
aws iam get-role-policy --role-name "$EXECUTION_ROLE" --policy-name "$HEALTH_POLICY_NAME" --output json > "$WORK_DIR/health-policy.json"
jq -e --arg secret "$HEALTH_SECRET_ARN" '
  def as_array: if type == "array" then . else [.] end;
  (.PolicyDocument.Statement | length) == 1
  and .PolicyDocument.Statement[0].Effect == "Allow"
  and ((.PolicyDocument.Statement[0].Action | as_array) == ["secretsmanager:GetSecretValue"])
  and ((.PolicyDocument.Statement[0].Resource | as_array) == [$secret])
' "$WORK_DIR/health-policy.json" >/dev/null
echo "HEALTH_CHECK_TOKEN_EXECUTION_POLICY_VERIFIED=true"

# SMS evidence: the spend limit stays on the account; month-to-date spend if CloudWatch has it.
aws sns get-sms-attributes --region "$AWS_REGION" --attributes MonthlySpendLimit --output json \
  | jq -r '"SMS_MONTHLY_SPEND_LIMIT_AFTER=\(.attributes.MonthlySpendLimit // "unset")"'
SMS_SPEND="$(aws cloudwatch get-metric-statistics --region "$AWS_REGION" --namespace AWS/SNS --metric-name SMSMonthToDateSpentUSD \
  --start-time "$(date -u -d '-2 days' +%Y-%m-%dT%H:%M:%SZ)" --end-time "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --period 86400 --statistics Maximum --output json 2>/dev/null \
  | jq -r '[.Datapoints[]?] | sort_by(.Timestamp) | last | .Maximum // empty' || true)"
echo "SMS_MONTH_TO_DATE_SPENT_USD=${SMS_SPEND:-unavailable}"

[[ "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 30 "${PUBLIC_SITE_URL%/}/api/health/live")" == 200 ]]
echo "PUBLIC_SITE_LIVE_VERIFIED=true"
echo "SMS_RETIREMENT_APPLY_VERIFIED=true"
