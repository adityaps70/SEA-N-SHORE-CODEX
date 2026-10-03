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
ACTION_FILE="scripts/aws/multi-login-auth-infra-action.txt"
GOOGLE_SECRET_ID="sea-n-shore-staging/google-oauth"
RESEND_SECRET_ID="sea-n-shore/resend"
RESEND_SENDER_FUNCTION="sea-n-shore-staging-cognito-resend-email-sender"
PUBLIC_SITE_URL="$(tr -d '[:space:]' < scripts/aws/public-site-url.txt)"
[[ "$PUBLIC_SITE_URL" =~ ^https://[a-z0-9.-]+$ ]]
export PUBLIC_SITE_URL

[[ "${MULTI_LOGIN_AUTH_INFRA_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "MULTI_LOGIN_AUTH_INFRA_EXPECTED_SHA must be an exact commit SHA." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$MULTI_LOGIN_AUTH_INFRA_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- \
  infra/aws/app/auth.tf \
  infra/aws/app/cognito-email-sender.tf \
  infra/aws/app/resend.tf \
  infra/aws/app/main.tf \
  infra/aws/app/aws-native-variables.tf \
  infra/aws/app/lambda/cognito-define-auth-challenge.mjs \
  infra/aws/app/lambda/cognito-create-auth-challenge.mjs \
  infra/aws/app/lambda/cognito-verify-auth-challenge.mjs \
  infra/aws/app/lambda/cognito-pre-sign-up-link.mjs \
  infra/aws/app/lambda/cognito-resend-email-sender.mjs \
  scripts/aws/multi-login-auth-infra.sh \
  scripts/aws/multi-login-auth-infra-action.txt \
  scripts/aws/multi-login-auth-infra.test.mjs \
  scripts/aws/public-site-url.txt \
  .github/workflows/aws-multi-login-auth-infra.yml
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]

ACTION="$(tr -d '[:space:]' < "$ACTION_FILE")"
case "$ACTION" in plan|apply-once) ;; *) echo "Unsupported multi-login auth infrastructure action." >&2; exit 1 ;; esac

WORK_DIR="$(mktemp -d "$PWD/.multi-login-auth-infra.XXXXXXXX")"
trap 'rm -rf -- "$WORK_DIR"' EXIT

aws s3api get-object \
  --bucket "$STATE_BUCKET" \
  --key "$STATE_KEY" \
  --region "$AWS_REGION" \
  "$WORK_DIR/state.json" > "$WORK_DIR/object.json"
jq -e '.lineage == "197a6fae-9997-636e-e52b-c3ac6da85d90"' "$WORK_DIR/state.json" >/dev/null

GOOGLE_OAUTH_CREDENTIALS_READY=false
if SECRET_JSON="$(aws secretsmanager get-secret-value \
  --region "$AWS_REGION" \
  --secret-id "$GOOGLE_SECRET_ID" \
  --query SecretString \
  --output text 2>/dev/null)"; then
  if jq -e '
    type == "object"
    and (.client_id | type == "string" and length >= 10)
    and (.client_secret | type == "string" and length >= 10)
  ' <<<"$SECRET_JSON" >/dev/null 2>&1; then
    GOOGLE_OAUTH_CREDENTIALS_READY=true
  fi
fi
unset SECRET_JSON || true
echo "GOOGLE_OAUTH_CREDENTIALS_READY=$GOOGLE_OAUTH_CREDENTIALS_READY"

# Cognito account emails go through Resend; the owner-managed secret must exist and, where this
# runner may read it, hold a plausible API key. The value is never printed.
RESEND_SECRET_EXISTS=false
if aws secretsmanager describe-secret --region "$AWS_REGION" --secret-id "$RESEND_SECRET_ID" > "$WORK_DIR/resend-secret.json" 2>/dev/null \
  && jq -e '(.DeletedDate // null) == null' "$WORK_DIR/resend-secret.json" >/dev/null; then
  RESEND_SECRET_EXISTS=true
fi
RESEND_SECRET_FORMAT=unreadable
if RESEND_SECRET_STRING="$(aws secretsmanager get-secret-value \
  --region "$AWS_REGION" \
  --secret-id "$RESEND_SECRET_ID" \
  --query SecretString \
  --output text 2>/dev/null)"; then
  if grep -Eq '^re_[A-Za-z0-9_-]{4,}$' <<<"$RESEND_SECRET_STRING" \
    || jq -e '((.RESEND_API_KEY // .api_key // .apiKey) | type == "string" and test("^re_[A-Za-z0-9_-]{4,}$"))' <<<"$RESEND_SECRET_STRING" >/dev/null 2>&1; then
    RESEND_SECRET_FORMAT=valid
  else
    RESEND_SECRET_FORMAT=invalid
  fi
fi
unset RESEND_SECRET_STRING || true
echo "RESEND_SECRET_EXISTS=$RESEND_SECRET_EXISTS"
echo "RESEND_SECRET_FORMAT=$RESEND_SECRET_FORMAT"
[[ "$RESEND_SECRET_FORMAT" != "invalid" ]] || { echo "The Resend secret does not hold a usable API key; refusing to route Cognito email through it." >&2; exit 1; }

python3 - "$WORK_DIR/state.json" "$WORK_DIR/variables.json" "$GOOGLE_OAUTH_CREDENTIALS_READY" <<'PY'
import json, sys
state_path, output_path, google_ready = sys.argv[1:]
with open(state_path) as f:
    state = json.load(f)
resources = state['resources']

def attrs(kind, name=None):
    matches = [
        r for r in resources
        if r.get('mode') == 'managed'
        and r.get('type') == kind
        and (name is None or r.get('name') == name)
    ]
    assert len(matches) == 1, f'Expected exactly one {kind} {name or ""}'.strip()
    instances = matches[0].get('instances') or []
    assert len(instances) == 1, f'Expected one instance for {kind} {name or ""}'.strip()
    return instances[0]['attributes']

web = attrs('aws_ecs_task_definition', 'web')
containers = json.loads(web['container_definitions'])
web_container = next(c for c in containers if c['name'] == 'web')
import os
site_url = os.environ['PUBLIC_SITE_URL']
image = web_container['image']
assert ':' in image.rsplit('/', 1)[-1]
values = {
    'image_tag': image.rsplit(':', 1)[1],
    'site_url': site_url,
    'aurora_engine_version': attrs('aws_rds_cluster', 'aurora')['engine_version'],
    'enable_google_identity_provider': google_ready == 'true',
}
with open(output_path, 'w') as f:
    json.dump(values, f)
PY

terraform -chdir="$APP_DIR" init -input=false -no-color \
  -backend-config="bucket=$STATE_BUCKET" \
  -backend-config="key=$STATE_KEY" \
  -backend-config="region=$AWS_REGION" \
  -backend-config=use_lockfile=true > "$WORK_DIR/init.log"

TARGETS=(
  aws_secretsmanager_secret.google_oauth
  aws_kms_key.cognito_email_sender
  aws_kms_alias.cognito_email_sender
  aws_iam_role.cognito_resend_email_sender
  aws_iam_role_policy_attachment.cognito_resend_email_sender_logs
  aws_iam_role_policy.cognito_resend_email_sender
  aws_cloudwatch_log_group.cognito_resend_email_sender
  aws_lambda_function.cognito_resend_email_sender
  aws_lambda_permission.cognito_resend_email_sender
  aws_iam_role.cognito_auth_challenge
  aws_iam_role_policy_attachment.cognito_auth_challenge_logs
  aws_iam_role_policy.cognito_auth_challenge_sms
  aws_iam_role.cognito_pre_sign_up_link
  aws_iam_role_policy_attachment.cognito_pre_sign_up_link_logs
  aws_iam_role_policy.cognito_pre_sign_up_link
  aws_cloudwatch_log_group.cognito_define_auth_challenge
  aws_cloudwatch_log_group.cognito_create_auth_challenge
  aws_cloudwatch_log_group.cognito_verify_auth_challenge
  aws_cloudwatch_log_group.cognito_pre_sign_up_link
  aws_lambda_function.cognito_define_auth_challenge
  aws_lambda_function.cognito_create_auth_challenge
  aws_lambda_function.cognito_verify_auth_challenge
  aws_lambda_function.cognito_pre_sign_up_link
  aws_lambda_permission.cognito_define_auth_challenge
  aws_lambda_permission.cognito_create_auth_challenge
  aws_lambda_permission.cognito_verify_auth_challenge
  aws_lambda_permission.cognito_pre_sign_up_link
  aws_cognito_user_pool.app
  aws_cognito_identity_provider.google
  aws_cognito_user_pool_client.web
)

PLAN_ARGS=()
for target in "${TARGETS[@]}"; do PLAN_ARGS+=("-target=$target"); done

terraform -chdir="$APP_DIR" plan -input=false -no-color -lock-timeout=60s \
  "${PLAN_ARGS[@]}" \
  -var-file="$WORK_DIR/variables.json" \
  -out="$WORK_DIR/auth.tfplan" > "$WORK_DIR/plan.log"
terraform -chdir="$APP_DIR" show -json "$WORK_DIR/auth.tfplan" > "$WORK_DIR/plan.json"

cat > "$WORK_DIR/classify-plan.py" <<'PY'
import json, sys
allowed = {
  'aws_secretsmanager_secret.google_oauth',
  'aws_kms_key.cognito_email_sender',
  'aws_kms_alias.cognito_email_sender',
  'aws_iam_role.cognito_resend_email_sender',
  'aws_iam_role_policy_attachment.cognito_resend_email_sender_logs',
  'aws_iam_role_policy.cognito_resend_email_sender',
  'aws_cloudwatch_log_group.cognito_resend_email_sender',
  'aws_lambda_function.cognito_resend_email_sender',
  'aws_lambda_permission.cognito_resend_email_sender',
  'aws_iam_role.cognito_auth_challenge',
  'aws_iam_role_policy_attachment.cognito_auth_challenge_logs',
  'aws_iam_role_policy.cognito_auth_challenge_sms',
  'aws_iam_role.cognito_pre_sign_up_link',
  'aws_iam_role_policy_attachment.cognito_pre_sign_up_link_logs',
  'aws_iam_role_policy.cognito_pre_sign_up_link',
  'aws_cloudwatch_log_group.cognito_define_auth_challenge',
  'aws_cloudwatch_log_group.cognito_create_auth_challenge',
  'aws_cloudwatch_log_group.cognito_verify_auth_challenge',
  'aws_cloudwatch_log_group.cognito_pre_sign_up_link',
  'aws_lambda_function.cognito_define_auth_challenge',
  'aws_lambda_function.cognito_create_auth_challenge',
  'aws_lambda_function.cognito_verify_auth_challenge',
  'aws_lambda_function.cognito_pre_sign_up_link',
  'aws_lambda_permission.cognito_define_auth_challenge',
  'aws_lambda_permission.cognito_create_auth_challenge',
  'aws_lambda_permission.cognito_verify_auth_challenge',
  'aws_lambda_permission.cognito_pre_sign_up_link',
  'aws_cognito_user_pool.app',
  'aws_cognito_identity_provider.google[0]',
  'aws_cognito_user_pool_client.web',
}
with open(sys.argv[1]) as f:
    plan=json.load(f)
changes=[
    r for r in plan.get('resource_changes', [])
    if r.get('mode') != 'data' and r.get('change',{}).get('actions') != ['no-op']
]
for r in changes:
    address=r['address']
    actions=r['change']['actions']
    if address not in allowed:
        raise SystemExit(f'unexpected auth infrastructure change: {address} {actions}')
    if actions not in (['create'], ['update']):
        raise SystemExit(f'destructive/replacement auth infrastructure change refused: {address} {actions}')
print('MULTI_LOGIN_AUTH_INFRA_PLAN_CHANGES=' + str(len(changes)))
for r in changes:
    print(f"MULTI_LOGIN_AUTH_INFRA_CHANGE={r['address']}|{','.join(r['change']['actions'])}")
    if r['address'] == 'aws_cognito_user_pool.app':
        def lambda_config(side):
            configs = ((r.get('change', {}).get(side) or {}).get('lambda_config') or [{}])
            config = configs[0] if configs else {}
            return {
                key: ('set' if value not in (None, '', []) else 'unset')
                for key, value in sorted(config.items())
                if key in ('custom_email_sender', 'kms_key_id', 'pre_sign_up', 'define_auth_challenge', 'create_auth_challenge', 'verify_auth_challenge_response')
            }
        print('COGNITO_LAMBDA_CONFIG_BEFORE=' + json.dumps(lambda_config('before'), sort_keys=True))
        print('COGNITO_LAMBDA_CONFIG_AFTER=' + json.dumps(lambda_config('after'), sort_keys=True))
    if r['address'] == 'aws_cognito_identity_provider.google[0]':
        before = (r.get('change', {}).get('before') or {})
        after = (r.get('change', {}).get('after') or {})
        before_details = before.get('provider_details') or {}
        after_details = after.get('provider_details') or {}
        sensitive = {'client_id', 'client_secret'}
        before_keys = sorted(k for k in before_details if k not in sensitive)
        after_keys = sorted(k for k in after_details if k not in sensitive)
        print('GOOGLE_IDP_DETAIL_KEYS_BEFORE=' + ','.join(before_keys))
        print('GOOGLE_IDP_DETAIL_KEYS_AFTER=' + ','.join(after_keys))
        for key in sorted(set(before_keys) | set(after_keys)):
            if before_details.get(key) != after_details.get(key):
                print('GOOGLE_IDP_DETAIL_DIFF=' + key + '|before=' + json.dumps(before_details.get(key)) + '|after=' + json.dumps(after_details.get(key)))
        print('GOOGLE_IDP_CLIENT_ID_CHANGED=' + str(before_details.get('client_id') != after_details.get('client_id')).lower())
        print('GOOGLE_IDP_CLIENT_SECRET_CHANGED=' + str(before_details.get('client_secret') != after_details.get('client_secret')).lower())
        before_mapping = before.get('attribute_mapping') or {}
        after_mapping = after.get('attribute_mapping') or {}
        if before_mapping != after_mapping:
            print('GOOGLE_IDP_ATTRIBUTE_MAPPING_BEFORE=' + json.dumps(before_mapping, sort_keys=True))
            print('GOOGLE_IDP_ATTRIBUTE_MAPPING_AFTER=' + json.dumps(after_mapping, sort_keys=True))
        before_ids = before.get('idp_identifiers') or []
        after_ids = after.get('idp_identifiers') or []
        if before_ids != after_ids:
            print('GOOGLE_IDP_IDENTIFIERS_BEFORE=' + json.dumps(before_ids))
            print('GOOGLE_IDP_IDENTIFIERS_AFTER=' + json.dumps(after_ids))
PY
python3 "$WORK_DIR/classify-plan.py" "$WORK_DIR/plan.json"

STATE_SERIAL_BEFORE="$(jq -r '.serial' "$WORK_DIR/state.json")"
echo "STATE_SERIAL_BEFORE=$STATE_SERIAL_BEFORE"
echo "MULTI_LOGIN_AUTH_INFRA_ACTION=$ACTION"
echo "MULTI_LOGIN_AUTH_INFRA_PLAN_VERIFIED=true"
echo "PLAN_SHA256=$(sha256sum "$WORK_DIR/auth.tfplan" | cut -d' ' -f1)"

if [[ "$ACTION" == "plan" ]]; then
  echo "MULTI_LOGIN_AUTH_INFRA_PLAN_ONLY_NO_APPLY"
  exit 0
fi

[[ "$(git ls-remote origin refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$MULTI_LOGIN_AUTH_INFRA_EXPECTED_SHA" ]]
[[ "$(aws s3api get-bucket-versioning --bucket "$STATE_BUCKET" --query Status --output text)" == Enabled ]]
STATE_BACKUP_VERSION="$(jq -r '.VersionId // empty' "$WORK_DIR/object.json")"
[[ -n "$STATE_BACKUP_VERSION" ]]
echo "STATE_BACKUP_VERSION=$STATE_BACKUP_VERSION"

[[ "$RESEND_SECRET_EXISTS" == "true" ]] || { echo "The Resend secret is missing; refusing to switch Cognito email to Resend." >&2; exit 1; }

# Phase 1: create the Resend sender (key, role, function) without touching the user pool, and
# prove the function loads in the Lambda runtime with a no-send invocation before Cognito uses it.
SENDER_TARGETS=(
  aws_kms_key.cognito_email_sender
  aws_kms_alias.cognito_email_sender
  aws_iam_role.cognito_resend_email_sender
  aws_iam_role_policy_attachment.cognito_resend_email_sender_logs
  aws_iam_role_policy.cognito_resend_email_sender
  aws_cloudwatch_log_group.cognito_resend_email_sender
  aws_lambda_function.cognito_resend_email_sender
  aws_lambda_permission.cognito_resend_email_sender
)
SENDER_ARGS=()
for target in "${SENDER_TARGETS[@]}"; do SENDER_ARGS+=("-target=$target"); done
terraform -chdir="$APP_DIR" plan -input=false -no-color -lock-timeout=60s \
  "${SENDER_ARGS[@]}" \
  -var-file="$WORK_DIR/variables.json" \
  -out="$WORK_DIR/sender.tfplan" > "$WORK_DIR/plan-sender.log"
terraform -chdir="$APP_DIR" show -json "$WORK_DIR/sender.tfplan" > "$WORK_DIR/plan-sender.json"
python3 "$WORK_DIR/classify-plan.py" "$WORK_DIR/plan-sender.json" > "$WORK_DIR/plan-sender-classified.txt"
if grep -q 'MULTI_LOGIN_AUTH_INFRA_CHANGE=aws_cognito_user_pool' "$WORK_DIR/plan-sender-classified.txt"; then
  echo "The sender-only plan would change the user pool; refusing." >&2
  exit 1
fi
cat "$WORK_DIR/plan-sender-classified.txt"
terraform -chdir="$APP_DIR" apply -input=false -no-color "$WORK_DIR/sender.tfplan" > "$WORK_DIR/apply-sender.log"

aws lambda wait function-active-v2 --region "$AWS_REGION" --function-name "$RESEND_SENDER_FUNCTION"
aws lambda get-function --region "$AWS_REGION" --function-name "$RESEND_SENDER_FUNCTION" > "$WORK_DIR/sender-function.json"
jq -e '.Configuration.State == "Active" and .Configuration.Runtime == "nodejs22.x" and .Configuration.Handler == "cognito-resend-email-sender.handler"' "$WORK_DIR/sender-function.json" >/dev/null
jq -e '.Configuration.Environment.Variables.EMAIL_FROM | test("@mail\\.seanshore\\.in>$")' "$WORK_DIR/sender-function.json" >/dev/null
# A takeover notice is the one trigger the sender skips, so this loads the code without decrypting or emailing.
aws lambda invoke --region "$AWS_REGION" \
  --function-name "$RESEND_SENDER_FUNCTION" \
  --cli-binary-format raw-in-base64-out \
  --payload '{"triggerSource":"CustomEmailSender_AccountTakeOverNotification","request":{}}' \
  "$WORK_DIR/sender-smoke.json" > "$WORK_DIR/sender-smoke-meta.json"
jq -e '(.FunctionError // null) == null and .StatusCode == 200' "$WORK_DIR/sender-smoke-meta.json" >/dev/null || {
  echo "The Resend email sender failed its no-send smoke invocation; Cognito was not switched." >&2
  exit 1
}
echo "COGNITO_RESEND_SENDER_SMOKE_VERIFIED=true"

# Phase 2: re-plan the full auth scope (the earlier plan is stale after phase 1) and apply it.
terraform -chdir="$APP_DIR" plan -input=false -no-color -lock-timeout=60s \
  "${PLAN_ARGS[@]}" \
  -var-file="$WORK_DIR/variables.json" \
  -out="$WORK_DIR/auth-final.tfplan" > "$WORK_DIR/plan-final.log"
terraform -chdir="$APP_DIR" show -json "$WORK_DIR/auth-final.tfplan" > "$WORK_DIR/plan-final.json"
python3 "$WORK_DIR/classify-plan.py" "$WORK_DIR/plan-final.json"
terraform -chdir="$APP_DIR" apply -input=false -no-color "$WORK_DIR/auth-final.tfplan" > "$WORK_DIR/apply.log"

terraform -chdir="$APP_DIR" plan -input=false -no-color -lock-timeout=60s \
  "${PLAN_ARGS[@]}" \
  -var-file="$WORK_DIR/variables.json" \
  -out="$WORK_DIR/after.tfplan" > "$WORK_DIR/plan-after.log"
terraform -chdir="$APP_DIR" show -json "$WORK_DIR/after.tfplan" > "$WORK_DIR/plan-after.json"
AFTER_CHANGES="$(jq '[.resource_changes[]? | select(.mode != "data") | select(.change.actions != ["no-op"])] | length' "$WORK_DIR/plan-after.json")"
[[ "$AFTER_CHANGES" == "0" ]] || {
  echo "Multi-login auth infrastructure still has targeted drift after apply." >&2
  jq '[.resource_changes[]? | select(.mode != "data") | select(.change.actions != ["no-op"]) | {address,actions:.change.actions}]' "$WORK_DIR/plan-after.json" >&2
  exit 1
}

for fn in \
  sea-n-shore-staging-cognito-define-auth-challenge \
  sea-n-shore-staging-cognito-create-auth-challenge \
  sea-n-shore-staging-cognito-verify-auth-challenge \
  sea-n-shore-staging-cognito-pre-sign-up-link; do
  aws lambda get-function --region "$AWS_REGION" --function-name "$fn" > "$WORK_DIR/$fn.json"
  jq -e '.Configuration.State == "Active" and .Configuration.Runtime == "nodejs22.x"' "$WORK_DIR/$fn.json" >/dev/null
done

USER_POOL_ID="$(jq -r '
  [.resources[]
   | select(.mode=="managed" and .type=="aws_cognito_user_pool" and .name=="app")
   | .instances[0].attributes.id][0] // empty
' "$WORK_DIR/state.json")"
[[ "$USER_POOL_ID" == ap-south-1_* ]]
aws cognito-idp describe-user-pool --region "$AWS_REGION" --user-pool-id "$USER_POOL_ID" > "$WORK_DIR/user-pool.json"
jq -e '
  (.UserPool.LambdaConfig.DefineAuthChallenge | type == "string")
  and (.UserPool.LambdaConfig.CreateAuthChallenge | type == "string")
  and (.UserPool.LambdaConfig.VerifyAuthChallengeResponse | type == "string")
  and (.UserPool.LambdaConfig.PreSignUp | type == "string")
' "$WORK_DIR/user-pool.json" >/dev/null

COGNITO_EMAIL_KEY_ARN="$(terraform -chdir="$APP_DIR" state pull | jq -r '
  [.resources[]
   | select(.mode=="managed" and .type=="aws_kms_key" and .name=="cognito_email_sender")
   | .instances[0].attributes.arn][0] // empty
')"
[[ "$COGNITO_EMAIL_KEY_ARN" == arn:aws:kms:"$AWS_REGION":"$EXPECTED_ACCOUNT":key/* ]]
jq -e --arg key "$COGNITO_EMAIL_KEY_ARN" --arg fn "$RESEND_SENDER_FUNCTION" '
  .UserPool.LambdaConfig.KMSKeyID == $key
  and (.UserPool.LambdaConfig.CustomEmailSender.LambdaArn | endswith(":function:" + $fn))
  and .UserPool.LambdaConfig.CustomEmailSender.LambdaVersion == "V1_0"
' "$WORK_DIR/user-pool.json" >/dev/null
aws kms describe-key --region "$AWS_REGION" --key-id "$COGNITO_EMAIL_KEY_ARN" > "$WORK_DIR/email-key.json"
jq -e '.KeyMetadata.Enabled == true and .KeyMetadata.KeyState == "Enabled"' "$WORK_DIR/email-key.json" >/dev/null
[[ "$(aws kms get-key-rotation-status --region "$AWS_REGION" --key-id "$COGNITO_EMAIL_KEY_ARN" --query KeyRotationEnabled --output text)" == "True" ]]
echo "COGNITO_RESEND_EMAIL_SENDER_VERIFIED=true"

CLIENT_ID="$(jq -r '
  [.resources[]
   | select(.mode=="managed" and .type=="aws_cognito_user_pool_client" and .name=="web")
   | .instances[0].attributes.id][0] // empty
' "$WORK_DIR/state.json")"
[[ -n "$CLIENT_ID" ]]
aws cognito-idp describe-user-pool-client --region "$AWS_REGION" --user-pool-id "$USER_POOL_ID" --client-id "$CLIENT_ID" > "$WORK_DIR/client.json"
jq -e '
  (.UserPoolClient.ExplicitAuthFlows | index("ALLOW_CUSTOM_AUTH")) != null
  and (.UserPoolClient.AllowedOAuthFlows | index("code")) != null
  and (.UserPoolClient.AllowedOAuthScopes | index("openid")) != null
  and (.UserPoolClient.AllowedOAuthScopes | index("email")) != null
  and (.UserPoolClient.AllowedOAuthScopes | index("profile")) != null
  and (.UserPoolClient.AllowedOAuthScopes | index("aws.cognito.signin.user.admin")) != null
' "$WORK_DIR/client.json" >/dev/null
echo "COGNITO_CLIENT_SELF_SERVICE_SCOPE_VERIFIED=true"

if [[ "$GOOGLE_OAUTH_CREDENTIALS_READY" == "true" ]]; then
  jq -e '(.UserPoolClient.SupportedIdentityProviders | index("Google")) != null' "$WORK_DIR/client.json" >/dev/null
  aws cognito-idp describe-identity-provider \
    --region "$AWS_REGION" \
    --user-pool-id "$USER_POOL_ID" \
    --provider-name Google > "$WORK_DIR/google-provider.json"
  jq -e '.IdentityProvider.ProviderType == "Google"' "$WORK_DIR/google-provider.json" >/dev/null
  jq -e '.IdentityProvider.AttributeMapping.email_verified == "email_verified"' "$WORK_DIR/google-provider.json" >/dev/null
  echo "GOOGLE_VERIFIED_EMAIL_MAPPING_VERIFIED=true"
  echo "GOOGLE_FEDERATION_VERIFIED=true"
else
  jq -e '(.UserPoolClient.SupportedIdentityProviders | index("Google")) == null' "$WORK_DIR/client.json" >/dev/null
  echo "GOOGLE_FEDERATION_VERIFIED=false"
fi

# Roll the Google availability flag into the running web task without changing
# the deployed image, secrets, roles, networking or any other container setting.
terraform -chdir="$APP_DIR" state pull > "$WORK_DIR/state-after.json"
# The branded custom domain (cognito_custom_domain.tf) is the hosted domain the app uses.
DESIRED_COGNITO_DOMAIN="$(jq -r '
  [.resources[]
   | select(.mode=="managed" and .type=="aws_cognito_user_pool_domain" and .name=="custom")
   | .instances[0].attributes.domain][0] // empty
' "$WORK_DIR/state-after.json")"
[[ "$DESIRED_COGNITO_DOMAIN" == "auth.seanshore.in" ]]
aws cognito-idp describe-user-pool-domain --region "$AWS_REGION" --domain "$DESIRED_COGNITO_DOMAIN" > "$WORK_DIR/custom-domain.json"
jq -e --arg pool "$USER_POOL_ID" '.DomainDescription.UserPoolId == $pool and .DomainDescription.Status == "ACTIVE"' "$WORK_DIR/custom-domain.json" >/dev/null
echo "COGNITO_CUSTOM_DOMAIN_ACTIVE=true"
CLUSTER_NAME="$(jq -r '
  [.resources[]
   | select(.mode=="managed" and .type=="aws_ecs_cluster" and .name=="app")
   | .instances[0].attributes.name][0] // empty
' "$WORK_DIR/state-after.json")"
SERVICE_NAME="$(jq -r '
  [.resources[]
   | select(.mode=="managed" and .type=="aws_ecs_service" and .name=="web")
   | .instances[0].attributes.name][0] // empty
' "$WORK_DIR/state-after.json")"
[[ "$CLUSTER_NAME" == "sea-n-shore-staging" ]]
[[ "$SERVICE_NAME" == "sea-n-shore-staging-web" ]]

aws ecs describe-services \
  --region "$AWS_REGION" \
  --cluster "$CLUSTER_NAME" \
  --services "$SERVICE_NAME" \
  --output json > "$WORK_DIR/service-before.json"
jq -e '.failures | length == 0' "$WORK_DIR/service-before.json" >/dev/null
CURRENT_TASK_ARN="$(jq -r '.services[0].taskDefinition // empty' "$WORK_DIR/service-before.json")"
[[ "$CURRENT_TASK_ARN" == arn:aws:ecs:*:"$EXPECTED_ACCOUNT":task-definition/sea-n-shore-staging-web:* ]]

aws ecs describe-task-definition \
  --region "$AWS_REGION" \
  --task-definition "$CURRENT_TASK_ARN" \
  --query taskDefinition \
  --output json > "$WORK_DIR/task-current.json"

DESIRED_GOOGLE_FLAG="$GOOGLE_OAUTH_CREDENTIALS_READY"
CURRENT_GOOGLE_FLAG="$(jq -r '
  [.containerDefinitions[]
   | select(.name=="web")
   | (.environment // [])[]
   | select(.name=="AWS_COGNITO_GOOGLE_ENABLED")
   | .value][0] // "false"
' "$WORK_DIR/task-current.json")"
CURRENT_COGNITO_DOMAIN="$(jq -r '
  [.containerDefinitions[]
   | select(.name=="web")
   | (.environment // [])[]
   | select(.name=="AWS_COGNITO_DOMAIN")
   | .value][0] // ""
' "$WORK_DIR/task-current.json")"
CURRENT_IMAGE="$(jq -r '.containerDefinitions[] | select(.name=="web") | .image // empty' "$WORK_DIR/task-current.json")"
[[ -n "$CURRENT_IMAGE" ]]
echo "CURRENT_GOOGLE_RUNTIME_FLAG=$CURRENT_GOOGLE_FLAG"
echo "DESIRED_GOOGLE_RUNTIME_FLAG=$DESIRED_GOOGLE_FLAG"
echo "CURRENT_COGNITO_DOMAIN_PRESENT=$([[ -n "$CURRENT_COGNITO_DOMAIN" ]] && echo true || echo false)"
echo "DESIRED_COGNITO_DOMAIN=$DESIRED_COGNITO_DOMAIN"

NEW_TASK_ARN="$CURRENT_TASK_ARN"
if [[ "$CURRENT_GOOGLE_FLAG" != "$DESIRED_GOOGLE_FLAG" || "$CURRENT_COGNITO_DOMAIN" != "$DESIRED_COGNITO_DOMAIN" ]]; then
  jq --arg google "$DESIRED_GOOGLE_FLAG" --arg domain "$DESIRED_COGNITO_DOMAIN" '
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
        if .name == "web" then
          .environment = (
            ((.environment // []) | map(select(.name != "AWS_COGNITO_GOOGLE_ENABLED" and .name != "AWS_COGNITO_DOMAIN")))
            + [
                {"name":"AWS_COGNITO_GOOGLE_ENABLED","value":$google},
                {"name":"AWS_COGNITO_DOMAIN","value":$domain}
              ]
          )
        else . end
      )
  ' "$WORK_DIR/task-current.json" > "$WORK_DIR/task-next.json"

  jq '
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
        if .name == "web" then
          .environment = ((.environment // [])
            | map(select(.name != "AWS_COGNITO_GOOGLE_ENABLED" and .name != "AWS_COGNITO_DOMAIN"))
            | sort_by(.name))
        else . end
      )
  ' "$WORK_DIR/task-current.json" > "$WORK_DIR/task-current-normalized.json"
  jq '
    .containerDefinitions |= map(
      if .name == "web" then
        .environment = ((.environment // [])
          | map(select(.name != "AWS_COGNITO_GOOGLE_ENABLED" and .name != "AWS_COGNITO_DOMAIN"))
          | sort_by(.name))
      else . end
    )
  ' "$WORK_DIR/task-next.json" > "$WORK_DIR/task-next-normalized.json"
  cmp -s "$WORK_DIR/task-current-normalized.json" "$WORK_DIR/task-next-normalized.json" || {
    echo "Refusing Google runtime rollout because fields other than AWS_COGNITO_GOOGLE_ENABLED and AWS_COGNITO_DOMAIN changed." >&2
    exit 1
  }

  NEW_TASK_ARN="$(aws ecs register-task-definition \
    --region "$AWS_REGION" \
    --cli-input-json "file://$WORK_DIR/task-next.json" \
    --query 'taskDefinition.taskDefinitionArn' \
    --output text)"
  [[ "$NEW_TASK_ARN" == arn:aws:ecs:*:"$EXPECTED_ACCOUNT":task-definition/sea-n-shore-staging-web:* ]]

  aws ecs update-service \
    --region "$AWS_REGION" \
    --cluster "$CLUSTER_NAME" \
    --service "$SERVICE_NAME" \
    --task-definition "$NEW_TASK_ARN" \
    --force-new-deployment > "$WORK_DIR/service-update.json"

  aws ecs wait services-stable \
    --region "$AWS_REGION" \
    --cluster "$CLUSTER_NAME" \
    --services "$SERVICE_NAME"
fi

# Same bar as the staging deploy's exact-deployment check: the service may run more than one
# task, and rolloutState can reach COMPLETED a little after services-stable returns.
SERVICE_SETTLED=false
for attempt in $(seq 1 30); do
  aws ecs describe-services \
    --region "$AWS_REGION" \
    --cluster "$CLUSTER_NAME" \
    --services "$SERVICE_NAME" \
    --output json > "$WORK_DIR/service-after.json"
  echo "WEB_SERVICE_STATE=$(jq -c '{desired: .services[0].desiredCount, running: .services[0].runningCount, pending: .services[0].pendingCount, deployments: (.services[0].deployments | length), rollout: ([.services[0].deployments[] | select(.status=="PRIMARY")][0].rolloutState), failedTasks: ([.services[0].deployments[] | select(.status=="PRIMARY")][0].failedTasks)}' "$WORK_DIR/service-after.json")"
  if jq -e --arg task "$NEW_TASK_ARN" '
    (.failures | length) == 0
    and .services[0].taskDefinition == $task
    and .services[0].desiredCount >= 1
    and .services[0].runningCount == .services[0].desiredCount
    and .services[0].pendingCount == 0
    and (.services[0].deployments | length) == 1
    and ([.services[0].deployments[] | select(.status=="PRIMARY")][0].taskDefinition) == $task
    and ([.services[0].deployments[] | select(.status=="PRIMARY")][0].rolloutState) == "COMPLETED"
    and ([.services[0].deployments[] | select(.status=="PRIMARY")][0].runningCount) == .services[0].desiredCount
    and ([.services[0].deployments[] | select(.status=="PRIMARY")][0].failedTasks) == 0
  ' "$WORK_DIR/service-after.json" >/dev/null; then
    SERVICE_SETTLED=true
    break
  fi
  sleep 5
done
[[ "$SERVICE_SETTLED" == true ]] || { echo "Web service did not settle on $NEW_TASK_ARN after the rollout." >&2; exit 1; }

aws ecs describe-task-definition \
  --region "$AWS_REGION" \
  --task-definition "$NEW_TASK_ARN" \
  --query taskDefinition \
  --output json > "$WORK_DIR/task-after.json"
jq -e --arg google "$DESIRED_GOOGLE_FLAG" '
  [.containerDefinitions[]
   | select(.name=="web")
   | (.environment // [])[]
   | select(.name=="AWS_COGNITO_GOOGLE_ENABLED")
   | .value] == [$google]
' "$WORK_DIR/task-after.json" >/dev/null
jq -e --arg domain "$DESIRED_COGNITO_DOMAIN" '
  [.containerDefinitions[]
   | select(.name=="web")
   | (.environment // [])[]
   | select(.name=="AWS_COGNITO_DOMAIN")
   | .value] == [$domain]
' "$WORK_DIR/task-after.json" >/dev/null
[[ "$(jq -r '.containerDefinitions[] | select(.name=="web") | .image' "$WORK_DIR/task-after.json")" == "$CURRENT_IMAGE" ]]

if [[ "$DESIRED_GOOGLE_FLAG" == "true" ]]; then
  SIGN_IN_HTML="$(curl --fail --silent --show-error --max-time 45 "${PUBLIC_SITE_URL%/}/auth/sign-in?googleProbe=1")"
  grep -Fq 'Continue with Google' <<<"$SIGN_IN_HTML"

  GOOGLE_START_HEADERS="$WORK_DIR/google-start.headers"
  GOOGLE_START_STATUS="$(curl --silent --show-error --max-time 45 \
    -D "$GOOGLE_START_HEADERS" \
    -o /dev/null \
    -w '%{http_code}' \
    "${PUBLIC_SITE_URL%/}/auth/google/start?intent=sign-in")"
  [[ "$GOOGLE_START_STATUS" =~ ^30[1278]$ ]]
  GOOGLE_START_LOCATION="$(awk 'BEGIN{IGNORECASE=1} /^location:/ {sub(/^[^:]+:[[:space:]]*/,""); gsub("\r",""); print}' "$GOOGLE_START_HEADERS" | tail -n 1)"
  [[ "$GOOGLE_START_LOCATION" == "https://$DESIRED_COGNITO_DOMAIN/oauth2/authorize"* ]]
  [[ "$GOOGLE_START_LOCATION" == *"identity_provider=Google"* ]]
fi
echo "GOOGLE_RUNTIME_VERIFIED=true"

STATE_SERIAL_AFTER="$(jq -r '.serial' "$WORK_DIR/state-after.json")"
[[ "$STATE_SERIAL_AFTER" -ge "$STATE_SERIAL_BEFORE" ]]
echo "STATE_SERIAL_AFTER=$STATE_SERIAL_AFTER"

# The hosted-UI client must accept the canonical site as an OAuth callback and logout origin.
jq -e --arg site "$PUBLIC_SITE_URL" '
  (.UserPoolClient.CallbackURLs | index($site + "/auth/google/callback")) != null
  and (.UserPoolClient.LogoutURLs | index($site)) != null
' "$WORK_DIR/client.json" >/dev/null
echo "COGNITO_CLIENT_CALLBACK_URLS=$(jq -c '.UserPoolClient.CallbackURLs' "$WORK_DIR/client.json")"
echo "COGNITO_CLIENT_LOGOUT_URLS=$(jq -c '.UserPoolClient.LogoutURLs' "$WORK_DIR/client.json")"
echo "COGNITO_CLIENT_SITE_URLS_VERIFIED=true"
echo "PHONE_OTP_COGNITO_INFRA_VERIFIED=true"
echo "MULTI_LOGIN_AUTH_INFRA_APPLY_VERIFIED=true"
