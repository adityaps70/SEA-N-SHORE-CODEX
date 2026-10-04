#!/usr/bin/env bash
# Round 14 (1.4) stage A, guarded: an HTTPS origin listener for origin-staging.seaandshore.in that
# forwards only requests with the secret X-Origin-Verify header (403 otherwise), the origin
# certificate's DNS validation, the origin DNS name, the shared secret, and a security group that
# admits CloudFront's origin-facing range on 443. Everything is additive: CloudFront keeps using the
# HTTP origin until stage B. Targeted plan; only these creates and the ALB's security-group update
# are accepted. The action file holds "plan" or "apply-once". The secret is never printed.
set -euo pipefail
umask 077
export PATH="$HOME/bin:$PATH"
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
STATE_BUCKET="sea-n-shore-310356785722-ap-south-1-tfstate"
STATE_KEY="sea-n-shore/staging/terraform.tfstate"
APP_DIR="$PWD/infra/aws/app"
ACTION_FILE="scripts/aws/edge-origin-lockdown-infra-action.txt"
ORIGIN_HOST="origin-staging.seaandshore.in"
PUBLIC_SITE_URL="$(tr -d '[:space:]' < scripts/aws/public-site-url.txt)"
[[ "$PUBLIC_SITE_URL" =~ ^https://[a-z0-9.-]+$ ]]
export PUBLIC_SITE_URL

[[ "${EDGE_ORIGIN_LOCKDOWN_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "EDGE_ORIGIN_LOCKDOWN_EXPECTED_SHA must be an exact commit SHA." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$EDGE_ORIGIN_LOCKDOWN_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- \
  infra/aws/app/edge-origin-lockdown.tf \
  infra/aws/app/origin_tls.tf \
  infra/aws/app/main.tf \
  scripts/aws/edge-origin-lockdown-infra.sh \
  scripts/aws/edge-origin-lockdown-infra-action.txt \
  scripts/aws/edge-origin-lockdown-infra.test.mjs \
  scripts/aws/public-site-url.txt \
  .github/workflows/aws-edge-origin-lockdown-infra.yml
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]

ACTION="$(tr -d '[:space:]' < "$ACTION_FILE")"
case "$ACTION" in plan|apply-once) ;; *) echo "Unsupported edge origin lockdown action." >&2; exit 1 ;; esac

WORK_DIR="$(mktemp -d "$PWD/.edge-origin-lockdown.XXXXXXXX")"
TF_TMPDIR="$(mktemp -d /var/tmp/sns-tf.XXXXXX)"
export TMPDIR="$TF_TMPDIR"
trap 'rm -rf -- "$WORK_DIR" "$TF_TMPDIR"' EXIT

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

# The origin certificate request was made long ago and never validated. A request left
# unvalidated for 72 hours times out for good, so a timed-out (or failed) one is replaced: with
# create_before_destroy the new request is created, validated through Route 53 below, and only
# then is the dead, unused one deleted.
CERT_ARN="$(jq -r '[.resources[] | select(.mode=="managed" and .type=="aws_acm_certificate" and .name=="origin_tls") | .instances[0].attributes.arn][0] // empty' "$WORK_DIR/state.json")"
[[ "$CERT_ARN" == arn:aws:acm:$AWS_REGION:$EXPECTED_ACCOUNT:certificate/* ]]
aws acm describe-certificate --region "$AWS_REGION" --certificate-arn "$CERT_ARN" --output json > "$WORK_DIR/certificate.json"
CERT_STATUS="$(jq -r '.Certificate.Status' "$WORK_DIR/certificate.json")"
echo "ORIGIN_CERTIFICATE_STATUS_BEFORE=$CERT_STATUS"
REPLACE_CERTIFICATE=false
case "$CERT_STATUS" in
  PENDING_VALIDATION|ISSUED) ;;
  VALIDATION_TIMED_OUT|FAILED)
    jq -e '(.Certificate.InUseBy // []) | length == 0' "$WORK_DIR/certificate.json" >/dev/null || {
      echo "The $CERT_STATUS origin certificate is still in use; refusing to replace it." >&2
      exit 1
    }
    REPLACE_CERTIFICATE=true
    ;;
  *) echo "The origin certificate is $CERT_STATUS; refusing to continue." >&2; exit 1 ;;
esac
echo "ORIGIN_CERTIFICATE_REPLACE=$REPLACE_CERTIFICATE"

terraform -chdir="$APP_DIR" init -input=false -no-color \
  -backend-config="bucket=$STATE_BUCKET" \
  -backend-config="key=$STATE_KEY" \
  -backend-config="region=$AWS_REGION" \
  -backend-config=use_lockfile=true > "$WORK_DIR/init.log"

TARGETS=(
  aws_route53_record.origin_tls_validation
  aws_acm_certificate_validation.origin_tls
  aws_route53_record.origin_staging
  random_password.origin_verify
  aws_secretsmanager_secret.origin_verify
  aws_secretsmanager_secret_version.origin_verify
  aws_lb_listener.origin_https
  aws_lb_listener_rule.origin_https_verified
  aws_security_group.alb_cloudfront
  aws_lb.app
)
PLAN_ARGS=()
for target in "${TARGETS[@]}"; do PLAN_ARGS+=("-target=$target"); done
if [[ "$REPLACE_CERTIFICATE" == true ]]; then
  PLAN_ARGS+=("-target=aws_acm_certificate.origin_tls" "-replace=aws_acm_certificate.origin_tls")
fi

terraform -chdir="$APP_DIR" plan -input=false -no-color -lock-timeout=60s \
  "${PLAN_ARGS[@]}" -var-file="$WORK_DIR/variables.json" -out="$WORK_DIR/lockdown.tfplan" > "$WORK_DIR/plan.log"
terraform -chdir="$APP_DIR" show -json "$WORK_DIR/lockdown.tfplan" > "$WORK_DIR/plan.json"

python3 - "$WORK_DIR/plan.json" "$REPLACE_CERTIFICATE" <<'PY'
import json, sys
allowed = {
  'aws_route53_record.origin_tls_validation["origin-staging.seaandshore.in"]': {('create',)},
  'aws_acm_certificate_validation.origin_tls': {('create',)},
  'aws_route53_record.origin_staging': {('create',)},
  'random_password.origin_verify': {('create',)},
  'aws_secretsmanager_secret.origin_verify': {('create',)},
  'aws_secretsmanager_secret_version.origin_verify': {('create',)},
  'aws_lb_listener.origin_https': {('create',)},
  'aws_lb_listener_rule.origin_https_verified': {('create',)},
  'aws_security_group.alb_cloudfront': {('create',)},
  'aws_lb.app': {('update',)},
}
if sys.argv[2] == 'true':
    # Only the dead certificate request, replaced create-before-destroy. When an earlier attempt
    # left it deposed, Terraform plans a plain create plus a delete of the deposed object.
    allowed['aws_acm_certificate.origin_tls'] = {('create', 'delete'), ('create',), ('delete',)}
plan = json.load(open(sys.argv[1]))
changes = [r for r in plan.get('resource_changes', []) if r.get('mode') != 'data' and r['change']['actions'] != ['no-op']]
for r in changes:
    actions = tuple(r['change']['actions'])
    if r['address'] not in allowed or actions not in allowed[r['address']]:
        raise SystemExit(f"unexpected edge origin lockdown change refused: {r['address']} {list(actions)}")
    if r['address'] == 'aws_acm_certificate.origin_tls' and actions == ('delete',) and not r.get('deposed'):
        raise SystemExit('only the deposed origin certificate may be deleted on its own')
print('EDGE_ORIGIN_LOCKDOWN_PLAN_CHANGES=' + str(len(changes)))
for r in changes:
    print(f"EDGE_ORIGIN_LOCKDOWN_CHANGE={r['address']}|{','.join(r['change']['actions'])}")
    if r['address'] == 'aws_lb.app':
        before, after = r['change']['before'] or {}, r['change']['after'] or {}
        keys = sorted(k for k in set(before) | set(after) if before.get(k) != after.get(k) and k not in ('tags', 'tags_all'))
        if set(keys) - {'security_groups'}:
            raise SystemExit('ALB change outside security_groups refused: ' + ','.join(keys))
        unknown = r['change'].get('after_unknown') or {}
        if after.get('security_groups') is None and unknown.get('security_groups') is True:
            # The new CloudFront group's id is only known at apply time; the post-apply check proves
            # both the existing group and the CloudFront group are attached.
            print('ALB_SECURITY_GROUPS_AFTER=unknown-until-apply')
        elif not set(before.get('security_groups') or []) <= set(after.get('security_groups') or []):
            raise SystemExit('ALB must keep its existing security group while the CloudFront group is added')
    if r['address'] == 'aws_lb_listener.origin_https':
        after = r['change']['after']
        if after.get('port') != 443 or after.get('protocol') != 'HTTPS':
            raise SystemExit('origin listener must be HTTPS on 443')
        action = (after.get('default_action') or [{}])[0]
        if action.get('type') != 'fixed-response' or (action.get('fixed_response') or [{}])[0].get('status_code') != '403':
            raise SystemExit('origin listener default must be a 403 fixed response')
PY

echo "STATE_SERIAL_BEFORE=$(jq -r '.serial' "$WORK_DIR/state.json")"
echo "EDGE_ORIGIN_LOCKDOWN_ACTION=$ACTION"
echo "EDGE_ORIGIN_LOCKDOWN_PLAN_VERIFIED=true"
echo "PLAN_SHA256=$(sha256sum "$WORK_DIR/lockdown.tfplan" | cut -d' ' -f1)"

if [[ "$ACTION" == "plan" ]]; then
  echo "EDGE_ORIGIN_LOCKDOWN_PLAN_ONLY_NO_APPLY"
  exit 0
fi

[[ "$(git ls-remote origin refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$EDGE_ORIGIN_LOCKDOWN_EXPECTED_SHA" ]]
[[ "$(aws s3api get-bucket-versioning --bucket "$STATE_BUCKET" --query Status --output text)" == Enabled ]]
STATE_BACKUP_VERSION="$(jq -r '.VersionId // empty' "$WORK_DIR/object.json")"
[[ -n "$STATE_BACKUP_VERSION" ]]
echo "STATE_BACKUP_VERSION=$STATE_BACKUP_VERSION"

terraform -chdir="$APP_DIR" apply -input=false -no-color "$WORK_DIR/lockdown.tfplan" > "$WORK_DIR/apply.log"

terraform -chdir="$APP_DIR" plan -input=false -no-color -lock-timeout=60s \
  "${PLAN_ARGS[@]}" -var-file="$WORK_DIR/variables.json" -out="$WORK_DIR/after.tfplan" > "$WORK_DIR/plan-after.log"
terraform -chdir="$APP_DIR" show -json "$WORK_DIR/after.tfplan" > "$WORK_DIR/plan-after.json"
[[ "$(jq '[.resource_changes[]? | select(.mode != "data") | select(.change.actions != ["no-op"])] | length' "$WORK_DIR/plan-after.json")" == "0" ]] || {
  echo "Edge origin lockdown resources still drift after apply." >&2
  exit 1
}
rm -f "$WORK_DIR/plan.json" "$WORK_DIR/plan-after.json"

terraform -chdir="$APP_DIR" state pull > "$WORK_DIR/state-after.json"
CERT_ARN="$(jq -r '[.resources[] | select(.mode=="managed" and .type=="aws_acm_certificate" and .name=="origin_tls") | .instances[0].attributes.arn][0] // empty' "$WORK_DIR/state-after.json")"
[[ "$(aws acm describe-certificate --region "$AWS_REGION" --certificate-arn "$CERT_ARN" --query Certificate.Status --output text)" == ISSUED ]]
echo "ORIGIN_CERTIFICATE_ISSUED=true"
ZONE_ID="$(jq -r '[.resources[] | select(.mode=="managed" and .type=="aws_route53_zone" and .name=="seaandshore") | .instances[0].attributes.zone_id][0] // empty' "$WORK_DIR/state.json")"
[[ -n "$ZONE_ID" ]]
aws route53 test-dns-answer --hosted-zone-id "$ZONE_ID" --record-name "$ORIGIN_HOST" --record-type A --output json \
  | jq -e '.ResponseCode == "NOERROR" and (.RecordData | length) > 0' >/dev/null
echo "ORIGIN_DNS_RECORD_VERIFIED=true"

# Reach the new listener at the ALB's own address (no dependence on DNS caches).
ALB_DNS="$(aws elbv2 describe-load-balancers --region "$AWS_REGION" --names sea-n-shore-staging-alb --query 'LoadBalancers[0].DNSName' --output text)"
ALB_IP="$(getent ahostsv4 "$ALB_DNS" | awk 'NR==1 {print $1}')"
[[ "$ALB_IP" =~ ^[0-9.]+$ ]]
aws secretsmanager get-secret-value --region "$AWS_REGION" --secret-id sea-n-shore-staging/origin-verify \
  --query SecretString --output text | awk '{printf "X-Origin-Verify: %s\n", $0}' > "$WORK_DIR/origin-header"
probe() { curl -sS -o /dev/null -w '%{http_code}' --max-time 20 --resolve "$ORIGIN_HOST:443:$ALB_IP" "$@" "https://$ORIGIN_HOST/api/health/live" || true; }
UNSIGNED=""
SIGNED=""
for attempt in $(seq 1 18); do
  UNSIGNED="$(probe)"
  SIGNED="$(probe -H @"$WORK_DIR/origin-header")"
  [[ "$UNSIGNED" == 403 && "$SIGNED" == 200 ]] && break
  sleep 10
done
rm -f "$WORK_DIR/origin-header"
echo "ORIGIN_HTTPS_WITHOUT_HEADER=$UNSIGNED"
echo "ORIGIN_HTTPS_WITH_HEADER=$SIGNED"
[[ "$UNSIGNED" == 403 && "$SIGNED" == 200 ]]
echo "ORIGIN_HTTPS_LISTENER_VERIFIED=true"

ALB_BASE_GROUP="$(aws ec2 describe-security-groups --region "$AWS_REGION" --filters Name=group-name,Values=sea-n-shore-staging-alb --query 'SecurityGroups[0].GroupId' --output text)"
ALB_CF_GROUP="$(aws ec2 describe-security-groups --region "$AWS_REGION" --filters Name=group-name,Values=sea-n-shore-staging-alb-cloudfront --query 'SecurityGroups[0].GroupId' --output text)"
[[ "$ALB_BASE_GROUP" == sg-* && "$ALB_CF_GROUP" == sg-* ]]
aws elbv2 describe-load-balancers --region "$AWS_REGION" --names sea-n-shore-staging-alb --output json \
  | jq -e --arg base "$ALB_BASE_GROUP" --arg cf "$ALB_CF_GROUP" '.LoadBalancers[0].SecurityGroups | sort == ([$base, $cf] | sort)' >/dev/null
echo "ALB_CLOUDFRONT_GROUP_ATTACHED=true"

# The public site is unchanged (CloudFront still uses the HTTP origin until stage B).
[[ "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 30 "${PUBLIC_SITE_URL%/}/api/health/live")" == 200 ]]
echo "PUBLIC_SITE_LIVE_VERIFIED=true"
echo "EDGE_ORIGIN_LOCKDOWN_APPLY_VERIFIED=true"
