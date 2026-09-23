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
PUBLIC_SITE_URL="https://d3prih0q6jofyr.cloudfront.net"

[[ "${MULTI_LOGIN_AUTH_INFRA_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "MULTI_LOGIN_AUTH_INFRA_EXPECTED_SHA must be an exact commit SHA." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$MULTI_LOGIN_AUTH_INFRA_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- \
  infra/aws/app/auth.tf \
  infra/aws/app/main.tf \
  infra/aws/app/aws-native-variables.tf \
  infra/aws/app/lambda/cognito-define-auth-challenge.mjs \
  infra/aws/app/lambda/cognito-create-auth-challenge.mjs \
  infra/aws/app/lambda/cognito-verify-auth-challenge.mjs \
  scripts/aws/multi-login-auth-infra.sh \
  scripts/aws/multi-login-auth-infra-action.txt \
  scripts/aws/multi-login-auth-infra.test.mjs \
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
site_url = 'https://d3prih0q6jofyr.cloudfront.net'
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
  aws_iam_role.cognito_auth_challenge
  aws_iam_role_policy_attachment.cognito_auth_challenge_logs
  aws_iam_role_policy.cognito_auth_challenge_sms
  aws_cloudwatch_log_group.cognito_define_auth_challenge
  aws_cloudwatch_log_group.cognito_create_auth_challenge
  aws_cloudwatch_log_group.cognito_verify_auth_challenge
  aws_lambda_function.cognito_define_auth_challenge
  aws_lambda_function.cognito_create_auth_challenge
  aws_lambda_function.cognito_verify_auth_challenge
  aws_lambda_permission.cognito_define_auth_challenge
  aws_lambda_permission.cognito_create_auth_challenge
  aws_lambda_permission.cognito_verify_auth_challenge
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

python3 - "$WORK_DIR/plan.json" <<'PY'
import json, sys
allowed = {
  'aws_secretsmanager_secret.google_oauth',
  'aws_iam_role.cognito_auth_challenge',
  'aws_iam_role_policy_attachment.cognito_auth_challenge_logs',
  'aws_iam_role_policy.cognito_auth_challenge_sms',
  'aws_cloudwatch_log_group.cognito_define_auth_challenge',
  'aws_cloudwatch_log_group.cognito_create_auth_challenge',
  'aws_cloudwatch_log_group.cognito_verify_auth_challenge',
  'aws_lambda_function.cognito_define_auth_challenge',
  'aws_lambda_function.cognito_create_auth_challenge',
  'aws_lambda_function.cognito_verify_auth_challenge',
  'aws_lambda_permission.cognito_define_auth_challenge',
  'aws_lambda_permission.cognito_create_auth_challenge',
  'aws_lambda_permission.cognito_verify_auth_challenge',
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
PY

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

terraform -chdir="$APP_DIR" apply -input=false -no-color "$WORK_DIR/auth.tfplan" > "$WORK_DIR/apply.log"

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
  sea-n-shore-staging-cognito-verify-auth-challenge; do
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
' "$WORK_DIR/user-pool.json" >/dev/null

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
' "$WORK_DIR/client.json" >/dev/null

if [[ "$GOOGLE_OAUTH_CREDENTIALS_READY" == "true" ]]; then
  jq -e '(.UserPoolClient.SupportedIdentityProviders | index("Google")) != null' "$WORK_DIR/client.json" >/dev/null
  aws cognito-idp describe-identity-provider \
    --region "$AWS_REGION" \
    --user-pool-id "$USER_POOL_ID" \
    --provider-name Google > "$WORK_DIR/google-provider.json"
  jq -e '.IdentityProvider.ProviderType == "Google"' "$WORK_DIR/google-provider.json" >/dev/null
  echo "GOOGLE_FEDERATION_VERIFIED=true"
else
  jq -e '(.UserPoolClient.SupportedIdentityProviders | index("Google")) == null' "$WORK_DIR/client.json" >/dev/null
  echo "GOOGLE_FEDERATION_VERIFIED=false"
fi

terraform -chdir="$APP_DIR" state pull > "$WORK_DIR/state-after.json"
STATE_SERIAL_AFTER="$(jq -r '.serial' "$WORK_DIR/state-after.json")"
[[ "$STATE_SERIAL_AFTER" -ge "$STATE_SERIAL_BEFORE" ]]
echo "STATE_SERIAL_AFTER=$STATE_SERIAL_AFTER"
echo "PHONE_OTP_COGNITO_INFRA_VERIFIED=true"
echo "MULTI_LOGIN_AUTH_INFRA_APPLY_VERIFIED=true"
