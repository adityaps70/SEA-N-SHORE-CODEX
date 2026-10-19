#!/usr/bin/env bash
# Round I (I3) guarded infrastructure: refresh token rotation on the public web client.
# - The web client turns refresh token rotation on (60-second retry grace, the app's REFRESH_REUSE_GRACE_SECONDS).
# - ALLOW_REFRESH_TOKEN_AUTH is dropped: Cognito does not allow it with rotation on. The app already refreshes with
#   GetTokensFromRefreshToken (live since the I3 release).
# - refresh_token_validity goes from 30 to 3650 days. Rotation keeps each new token inside the first token's validity,
#   so the 30-day sliding session is enforced by the app (auth_sessions idle limit), not by Cognito.
# Nothing else on the client, and nothing else in the stack, may change. Targeted plan; anything outside this list is
# refused. Tokens already issued keep working (they are not revoked). The action file holds "plan" or "apply-once".
set -euo pipefail
umask 077
export PATH="$HOME/bin:$PATH"
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
STATE_BUCKET="sea-n-shore-310356785722-ap-south-1-tfstate"
STATE_KEY="sea-n-shore/staging/terraform.tfstate"
APP_DIR="$PWD/infra/aws/app"
ACTION_FILE="scripts/aws/refresh-rotation-infra-action.txt"
PUBLIC_SITE_URL="$(tr -d '[:space:]' < scripts/aws/public-site-url.txt)"
[[ "$PUBLIC_SITE_URL" =~ ^https://[a-z0-9.-]+$ ]]
export PUBLIC_SITE_URL

[[ "${REFRESH_ROTATION_INFRA_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "REFRESH_ROTATION_INFRA_EXPECTED_SHA must be an exact commit SHA." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$REFRESH_ROTATION_INFRA_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- \
  infra/aws/app/auth.tf \
  infra/aws/app/main.tf \
  scripts/aws/refresh-rotation-infra.sh \
  scripts/aws/refresh-rotation-infra-action.txt \
  scripts/aws/refresh-rotation-infra.test.mjs \
  scripts/aws/public-site-url.txt \
  .github/workflows/aws-refresh-rotation-infra.yml
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]
source scripts/aws/bootstrap-terraform-lock.sh

ACTION="$(cut -d' ' -f1 < "$ACTION_FILE" | tr -d '[:space:]')"
case "$ACTION" in plan|apply-once) ;; *) echo "Unsupported refresh rotation infrastructure action." >&2; exit 1 ;; esac

WORK_DIR="$(mktemp -d "$PWD/.refresh-rotation-infra.XXXXXXXX")"
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

# Only settings are printed, never a token.
client_summary() {
  jq -r --arg prefix "$1" '
    .UserPoolClient as $c
    | "\($prefix)_EXPLICIT_AUTH_FLOWS=" + ($c.ExplicitAuthFlows | sort | join(",")),
      "\($prefix)_REFRESH_TOKEN_ROTATION=" + ($c.RefreshTokenRotation.Feature // "DISABLED") + "|grace=" + (($c.RefreshTokenRotation.RetryGracePeriodSeconds // 0) | tostring),
      "\($prefix)_REFRESH_TOKEN_VALIDITY=" + ($c.RefreshTokenValidity | tostring) + "|" + ($c.TokenValidityUnits.RefreshToken // "days"),
      "\($prefix)_TOKEN_REVOCATION=" + (($c.EnableTokenRevocation // false) | tostring)
  '
}
echo "== Before =="
aws cognito-idp describe-user-pool-client --region "$AWS_REGION" --user-pool-id "$USER_POOL_ID" --client-id "$CLIENT_ID" --output json \
  | client_summary COGNITO_CLIENT_BEFORE

terraform -chdir="$APP_DIR" init -input=false -no-color \
  -backend-config="bucket=$STATE_BUCKET" \
  -backend-config="key=$STATE_KEY" \
  -backend-config="region=$AWS_REGION" \
  -backend-config=use_lockfile=true > "$WORK_DIR/init.log"

TARGETS=(
  aws_cognito_user_pool_client.web
)
PLAN_ARGS=()
for target in "${TARGETS[@]}"; do PLAN_ARGS+=("-target=$target"); done

terraform_plan_bounded "$WORK_DIR/plan.log" -chdir="$APP_DIR" plan -input=false -no-color -lock-timeout=60s \
  "${PLAN_ARGS[@]}" -var-file="$WORK_DIR/variables.json" -out="$WORK_DIR/refresh-rotation.tfplan"
terraform -chdir="$APP_DIR" show -json "$WORK_DIR/refresh-rotation.tfplan" > "$WORK_DIR/plan.json"

cat > "$WORK_DIR/classify-plan.py" <<'PY'
import json, sys
client = 'aws_cognito_user_pool_client.web'
allowed_keys = {'explicit_auth_flows', 'refresh_token_rotation', 'refresh_token_validity'}
flows_after = ['ALLOW_USER_PASSWORD_AUTH', 'ALLOW_USER_SRP_AUTH']
rotation_after = [{'feature': 'ENABLED', 'retry_grace_period_seconds': 60}]
validity_after = 3650

def refuse(message):
    raise SystemExit('Refresh rotation plan refused: ' + message)

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
if not changes:
    # After the apply nothing is left to change.
    print('REFRESH_ROTATION_ALREADY_APPLIED=true')
    print('REFRESH_ROTATION_PLAN_CHANGES=0')
    raise SystemExit(0)
for r in changes:
    address, actions = r['address'], r['change']['actions']
    print(f"REFRESH_ROTATION_CHANGE={address}|{','.join(actions)}")
    if address != client:
        refuse(f'unexpected change {address} {actions}')
    if actions != ['update']:
        refuse(f'{address} may only be updated in place, not {actions}')
    before, after = r['change']['before'] or {}, r['change']['after'] or {}
    keys = changed_keys(r)
    print(f"REFRESH_ROTATION_KEYS={address}|{','.join(keys)}")
    if set(keys) - allowed_keys:
        refuse('web client change outside refresh token rotation: ' + ','.join(sorted(set(keys) - allowed_keys)))
    if sorted(after.get('explicit_auth_flows') or []) != flows_after:
        refuse('the web client must end with exactly the password and SRP flows (no REFRESH_TOKEN_AUTH, no custom auth)')
    rotation = after.get('refresh_token_rotation') or []
    if len(rotation) != 1 or {k: first(rotation).get(k) for k in ('feature', 'retry_grace_period_seconds')} != rotation_after[0]:
        refuse('refresh token rotation must be ENABLED with a 60-second retry grace period')
    if after.get('refresh_token_validity') != validity_after:
        refuse('refresh_token_validity must be 3650')
    if first(after.get('token_validity_units')).get('refresh_token') != 'days':
        refuse('the refresh token validity unit must stay days')
    if after.get('enable_token_revocation') is not True:
        refuse('token revocation must stay on (sign out of other devices relies on it)')
    print('COGNITO_CLIENT_EXPLICIT_AUTH_FLOWS_PLANNED_AFTER=' + ','.join(sorted(after['explicit_auth_flows'])))
    print('COGNITO_CLIENT_REFRESH_TOKEN_ROTATION_PLANNED_AFTER=ENABLED|grace=60')
    print('COGNITO_CLIENT_REFRESH_TOKEN_VALIDITY_PLANNED_AFTER=3650|days')
print('REFRESH_ROTATION_PLAN_CHANGES=' + str(len(changes)))
PY
python3 "$WORK_DIR/classify-plan.py" "$WORK_DIR/plan.json" | tee "$WORK_DIR/classify.out"

echo "STATE_SERIAL_BEFORE=$(jq -r '.serial' "$WORK_DIR/state.json")"
echo "REFRESH_ROTATION_ACTION=$ACTION"
echo "REFRESH_ROTATION_PLAN_VERIFIED=true"
echo "PLAN_SHA256=$(sha256sum "$WORK_DIR/refresh-rotation.tfplan" | cut -d' ' -f1)"

if [[ "$ACTION" == "plan" ]]; then
  echo "REFRESH_ROTATION_PLAN_ONLY_NO_APPLY"
  exit 0
fi
if grep -qx 'REFRESH_ROTATION_ALREADY_APPLIED=true' "$WORK_DIR/classify.out"; then
  echo "Refresh token rotation is already applied; nothing to apply." >&2
  exit 1
fi

[[ "$(bash scripts/aws/branch-head.sh refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$REFRESH_ROTATION_INFRA_EXPECTED_SHA" ]]
[[ "$(aws s3api get-bucket-versioning --bucket "$STATE_BUCKET" --query Status --output text)" == Enabled ]]
STATE_BACKUP_VERSION="$(jq -r '.VersionId // empty' "$WORK_DIR/object.json")"
[[ -n "$STATE_BACKUP_VERSION" ]]
echo "STATE_BACKUP_VERSION=$STATE_BACKUP_VERSION"

# Apply exactly the saved plan that was just checked.
terraform -chdir="$APP_DIR" apply -input=false -no-color "$WORK_DIR/refresh-rotation.tfplan" > "$WORK_DIR/apply.log"

terraform_plan_bounded "$WORK_DIR/plan-after.log" -chdir="$APP_DIR" plan -input=false -no-color -lock-timeout=60s \
  "${PLAN_ARGS[@]}" -var-file="$WORK_DIR/variables.json" -out="$WORK_DIR/after.tfplan"
terraform -chdir="$APP_DIR" show -json "$WORK_DIR/after.tfplan" > "$WORK_DIR/plan-after.json"
[[ "$(jq '[.resource_changes[]? | select(.mode != "data") | select(.change.actions != ["no-op"])] | length' "$WORK_DIR/plan-after.json")" == "0" ]] || {
  echo "The web client still drifts after apply." >&2
  jq -c '[.resource_changes[]? | select(.mode != "data") | select(.change.actions != ["no-op"]) | {address, actions: .change.actions}]' "$WORK_DIR/plan-after.json" >&2
  exit 1
}
echo "REFRESH_ROTATION_DRIFT_FREE=true"

# The live client: rotation on with the 60-second grace, password and SRP only, 3650 days, revocation on.
aws cognito-idp describe-user-pool-client --region "$AWS_REGION" --user-pool-id "$USER_POOL_ID" --client-id "$CLIENT_ID" --output json > "$WORK_DIR/client.json"
client_summary COGNITO_CLIENT_AFTER < "$WORK_DIR/client.json"
jq -e '
  .UserPoolClient
  | (.ExplicitAuthFlows | sort) == ["ALLOW_USER_PASSWORD_AUTH", "ALLOW_USER_SRP_AUTH"]
    and .RefreshTokenRotation.Feature == "ENABLED"
    and .RefreshTokenRotation.RetryGracePeriodSeconds == 60
    and .RefreshTokenValidity == 3650
    and (.TokenValidityUnits.RefreshToken // "days") == "days"
    and .EnableTokenRevocation == true
' "$WORK_DIR/client.json" >/dev/null || {
  echo "The live web client does not have the expected refresh token settings." >&2
  exit 1
}
echo "REFRESH_TOKEN_ROTATION_ENABLED=true"
echo "REFRESH_TOKEN_AUTH_FLOW_DISABLED=true"

[[ "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 30 "${PUBLIC_SITE_URL%/}/api/health/live")" == 200 ]]
echo "PUBLIC_SITE_LIVE_VERIFIED=true"
echo "REFRESH_ROTATION_APPLY_VERIFIED=true"
