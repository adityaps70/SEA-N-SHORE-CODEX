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
ACTION_FILE="scripts/aws/cognito-custom-domain-infra-action.txt"
GOOGLE_SECRET_ID="sea-n-shore-staging/google-oauth"
CUSTOM_DOMAIN="auth.seanshore.in"
PREFIX_DOMAIN="sea-n-shore-staging-${EXPECTED_ACCOUNT}"
PUBLIC_SITE_URL="$(tr -d '[:space:]' < scripts/aws/public-site-url.txt)"
[[ "$PUBLIC_SITE_URL" =~ ^https://[a-z0-9.-]+$ ]]
export PUBLIC_SITE_URL

[[ "${COGNITO_CUSTOM_DOMAIN_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "COGNITO_CUSTOM_DOMAIN_EXPECTED_SHA must be an exact commit SHA." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$COGNITO_CUSTOM_DOMAIN_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- \
  infra/aws/app/cognito_custom_domain.tf \
  infra/aws/app/auth.tf \
  infra/aws/app/seanshore_domain.tf \
  infra/aws/app/providers-aws-native.tf \
  scripts/aws/cognito-custom-domain-infra.sh \
  scripts/aws/cognito-custom-domain-infra-action.txt \
  scripts/aws/cognito-custom-domain-infra.test.mjs \
  scripts/aws/public-site-url.txt \
  .github/workflows/aws-cognito-custom-domain-infra.yml
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]

ACTION="$(tr -d '[:space:]' < "$ACTION_FILE")"
case "$ACTION" in plan|apply-once) ;; *) echo "Unsupported Cognito custom domain action." >&2; exit 1 ;; esac

WORK_DIR="$(mktemp -d "$PWD/.cognito-custom-domain.XXXXXXXX")"
trap 'rm -rf -- "$WORK_DIR"' EXIT

aws s3api get-object \
  --bucket "$STATE_BUCKET" \
  --key "$STATE_KEY" \
  --region "$AWS_REGION" \
  "$WORK_DIR/state.json" > "$WORK_DIR/object.json"
jq -e '.lineage == "197a6fae-9997-636e-e52b-c3ac6da85d90"' "$WORK_DIR/state.json" >/dev/null

# Same variable derivation as multi-login-auth-infra.sh so dependent resources plan as no-op.
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

python3 - "$WORK_DIR/state.json" "$WORK_DIR/variables.json" "$GOOGLE_OAUTH_CREDENTIALS_READY" <<'PY'
import json, os, sys
state_path, output_path, google_ready = sys.argv[1:]
with open(state_path) as f:
    resources = json.load(f)['resources']

def attrs(kind, name):
    matches = [r for r in resources if r.get('mode') == 'managed' and r.get('type') == kind and r.get('name') == name]
    assert len(matches) == 1, f'Expected exactly one {kind} {name}'
    instances = matches[0].get('instances') or []
    assert len(instances) == 1, f'Expected one instance for {kind} {name}'
    return instances[0]['attributes']

web = attrs('aws_ecs_task_definition', 'web')
web_container = next(c for c in json.loads(web['container_definitions']) if c['name'] == 'web')
image = web_container['image']
assert ':' in image.rsplit('/', 1)[-1]
values = {
    'image_tag': image.rsplit(':', 1)[1],
    'site_url': os.environ['PUBLIC_SITE_URL'],
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
  aws_acm_certificate.cognito_auth
  aws_route53_record.cognito_auth_validation
  aws_acm_certificate_validation.cognito_auth
  aws_cognito_user_pool_domain.custom
  aws_route53_record.cognito_auth_a
  aws_route53_record.cognito_auth_aaaa
)
PLAN_ARGS=()
for target in "${TARGETS[@]}"; do PLAN_ARGS+=("-target=$target"); done

terraform -chdir="$APP_DIR" plan -input=false -no-color -lock-timeout=60s \
  "${PLAN_ARGS[@]}" \
  -var-file="$WORK_DIR/variables.json" \
  -out="$WORK_DIR/domain.tfplan" > "$WORK_DIR/plan.log"
terraform -chdir="$APP_DIR" show -json "$WORK_DIR/domain.tfplan" > "$WORK_DIR/plan.json"

# -target also pulls in dependencies (the user pool, the seanshore.in zone): any change to
# them, and any update, replacement or destroy, is refused. Only the new resources may be created.
python3 - "$WORK_DIR/plan.json" <<'PY'
import json, re, sys
allowed = [
  r'aws_acm_certificate\.cognito_auth',
  r'aws_route53_record\.cognito_auth_validation\["auth\.seanshore\.in"\]',
  r'aws_acm_certificate_validation\.cognito_auth',
  r'aws_cognito_user_pool_domain\.custom',
  r'aws_route53_record\.cognito_auth_a',
  r'aws_route53_record\.cognito_auth_aaaa',
]
with open(sys.argv[1]) as f:
    plan = json.load(f)
changes = [
    r for r in plan.get('resource_changes', [])
    if r.get('mode') != 'data' and r.get('change', {}).get('actions') != ['no-op']
]
for r in changes:
    address = r['address']
    actions = r['change']['actions']
    if not any(re.fullmatch(pattern, address) for pattern in allowed):
        raise SystemExit(f'unexpected Cognito custom domain change: {address} {actions}')
    if actions != ['create']:
        raise SystemExit(f'only creates are allowed, refused: {address} {actions}')
print('COGNITO_CUSTOM_DOMAIN_PLAN_CHANGES=' + str(len(changes)))
for r in changes:
    print(f"COGNITO_CUSTOM_DOMAIN_CHANGE={r['address']}|{','.join(r['change']['actions'])}")
    after = r['change'].get('after') or {}
    for key in ('domain_name', 'domain', 'name', 'type', 'validation_method'):
        if isinstance(after.get(key), str):
            print(f"COGNITO_CUSTOM_DOMAIN_CHANGE_DETAIL={r['address']}|{key}={after[key]}")
PY

STATE_SERIAL_BEFORE="$(jq -r '.serial' "$WORK_DIR/state.json")"
echo "STATE_SERIAL_BEFORE=$STATE_SERIAL_BEFORE"
echo "COGNITO_CUSTOM_DOMAIN_ACTION=$ACTION"
echo "COGNITO_CUSTOM_DOMAIN_PLAN_VERIFIED=true"
echo "PLAN_SHA256=$(sha256sum "$WORK_DIR/domain.tfplan" | cut -d' ' -f1)"

if [[ "$ACTION" == "plan" ]]; then
  echo "COGNITO_CUSTOM_DOMAIN_PLAN_ONLY_NO_APPLY"
  exit 0
fi

[[ "$(git ls-remote origin refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$COGNITO_CUSTOM_DOMAIN_EXPECTED_SHA" ]]
[[ "$(aws s3api get-bucket-versioning --bucket "$STATE_BUCKET" --query Status --output text)" == Enabled ]]
STATE_BACKUP_VERSION="$(jq -r '.VersionId // empty' "$WORK_DIR/object.json")"
[[ -n "$STATE_BACKUP_VERSION" ]]
echo "STATE_BACKUP_VERSION=$STATE_BACKUP_VERSION"

terraform -chdir="$APP_DIR" apply -input=false -no-color "$WORK_DIR/domain.tfplan" > "$WORK_DIR/apply.log"

terraform -chdir="$APP_DIR" plan -input=false -no-color -lock-timeout=60s \
  "${PLAN_ARGS[@]}" \
  -var-file="$WORK_DIR/variables.json" \
  -out="$WORK_DIR/after.tfplan" > "$WORK_DIR/plan-after.log"
terraform -chdir="$APP_DIR" show -json "$WORK_DIR/after.tfplan" > "$WORK_DIR/plan-after.json"
AFTER_CHANGES="$(jq '[.resource_changes[]? | select(.mode != "data") | select(.change.actions != ["no-op"])] | length' "$WORK_DIR/plan-after.json")"
[[ "$AFTER_CHANGES" == "0" ]] || {
  echo "Cognito custom domain still has targeted drift after apply." >&2
  exit 1
}

terraform -chdir="$APP_DIR" state pull > "$WORK_DIR/state-after.json"
USER_POOL_ID="$(jq -r '[.resources[] | select(.mode=="managed" and .type=="aws_cognito_user_pool" and .name=="app") | .instances[0].attributes.id][0] // empty' "$WORK_DIR/state-after.json")"
CERT_ARN="$(jq -r '[.resources[] | select(.mode=="managed" and .type=="aws_acm_certificate" and .name=="cognito_auth") | .instances[0].attributes.arn][0] // empty' "$WORK_DIR/state-after.json")"
ZONE_ID="$(jq -r '[.resources[] | select(.mode=="managed" and .type=="aws_route53_zone" and .name=="seanshore") | .instances[0].attributes.zone_id][0] // empty' "$WORK_DIR/state-after.json")"
[[ "$USER_POOL_ID" == ap-south-1_* ]]
[[ "$CERT_ARN" == arn:aws:acm:us-east-1:"$EXPECTED_ACCOUNT":certificate/* ]]
[[ -n "$ZONE_ID" ]]

aws acm describe-certificate --region us-east-1 --certificate-arn "$CERT_ARN" > "$WORK_DIR/cert.json"
jq -e --arg d "$CUSTOM_DOMAIN" '.Certificate.Status == "ISSUED" and .Certificate.DomainName == $d' "$WORK_DIR/cert.json" >/dev/null
echo "COGNITO_CUSTOM_DOMAIN_CERTIFICATE_ISSUED=true"

STATUS=""
for attempt in $(seq 1 120); do
  aws cognito-idp describe-user-pool-domain --region "$AWS_REGION" --domain "$CUSTOM_DOMAIN" > "$WORK_DIR/custom-domain.json"
  STATUS="$(jq -r '.DomainDescription.Status // empty' "$WORK_DIR/custom-domain.json")"
  [[ "$STATUS" == ACTIVE ]] && break
  sleep 10
done
echo "COGNITO_CUSTOM_DOMAIN_STATUS=$STATUS"
[[ "$STATUS" == ACTIVE ]]
jq -e --arg pool "$USER_POOL_ID" --arg cert "$CERT_ARN" '
  .DomainDescription.UserPoolId == $pool
  and .DomainDescription.CustomDomainConfig.CertificateArn == $cert
' "$WORK_DIR/custom-domain.json" >/dev/null
CLOUDFRONT_TARGET="$(jq -r '.DomainDescription.CloudFrontDistribution // empty' "$WORK_DIR/custom-domain.json")"
[[ "$CLOUDFRONT_TARGET" == *.cloudfront.net ]]

aws cognito-idp describe-user-pool-domain --region "$AWS_REGION" --domain "$PREFIX_DOMAIN" > "$WORK_DIR/prefix-domain.json"
jq -e --arg pool "$USER_POOL_ID" '.DomainDescription.UserPoolId == $pool and .DomainDescription.Status == "ACTIVE"' "$WORK_DIR/prefix-domain.json" >/dev/null
echo "COGNITO_PREFIX_DOMAIN_KEPT=true"

aws route53 list-resource-record-sets --hosted-zone-id "$ZONE_ID" --start-record-name "$CUSTOM_DOMAIN" --max-items 4 > "$WORK_DIR/records.json"
for type in A AAAA; do
  jq -e --arg n "$CUSTOM_DOMAIN." --arg t "$type" --arg target "$CLOUDFRONT_TARGET" '
    [.ResourceRecordSets[] | select(.Name == $n and .Type == $t and ((.AliasTarget.DNSName // "") | rtrimstr(".")) == $target)] | length == 1
  ' "$WORK_DIR/records.json" >/dev/null
done
echo "COGNITO_CUSTOM_DOMAIN_ALIAS_RECORDS_VERIFIED=true"

# DNS and CloudFront propagation can lag the ACTIVE status, so the live probe is evidence only.
HTTPS_STATUS="$(curl --silent --output /dev/null --max-time 20 --write-out '%{http_code}' "https://$CUSTOM_DOMAIN/oauth2/authorize" || true)"
echo "COGNITO_CUSTOM_DOMAIN_HTTPS_STATUS=${HTTPS_STATUS:-none}"

STATE_SERIAL_AFTER="$(jq -r '.serial' "$WORK_DIR/state-after.json")"
[[ "$STATE_SERIAL_AFTER" -ge "$STATE_SERIAL_BEFORE" ]]
echo "STATE_SERIAL_AFTER=$STATE_SERIAL_AFTER"
echo "COGNITO_CUSTOM_DOMAIN_APPLY_VERIFIED=true"
