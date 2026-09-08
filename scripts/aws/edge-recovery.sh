#!/usr/bin/env bash
set -euo pipefail
umask 077
export PATH="$HOME/bin:$PATH"
export AWS_PAGER=""
[[ "${EDGE_AUDIT_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]]
[[ "$(git rev-parse HEAD)" == "$EDGE_AUDIT_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- scripts/aws infra/aws/app
[[ "$(aws sts get-caller-identity --query Account --output text)" == "310356785722" ]]
ACTION="$(tr -d '[:space:]' < scripts/aws/edge-recovery-action.txt)"
case "$ACTION" in plan|apply-once) ;; *) echo "Unsupported edge action." >&2; exit 1 ;; esac
APP_DIR="$PWD/infra/aws/app"
RECOVERY_DIR="$(mktemp -d "$PWD/.edge-recovery-data.XXXXXXXX")"
PRESERVE_RECOVERY=false
trap 'if [[ "$PRESERVE_RECOVERY" == true ]]; then echo "PRIVATE_RECOVERY_DIRECTORY=$RECOVERY_DIR" >&2; else rm -rf -- "$RECOVERY_DIR"; fi' EXIT
STATE_BUCKET=sea-n-shore-310356785722-ap-south-1-tfstate
STATE_KEY=sea-n-shore/staging/terraform.tfstate
aws s3api get-object --bucket "$STATE_BUCKET" --key "$STATE_KEY" --region ap-south-1 "$RECOVERY_DIR/state.json" > "$RECOVERY_DIR/object.json"
jq -e '.lineage == "197a6fae-9997-636e-e52b-c3ac6da85d90"' "$RECOVERY_DIR/state.json" >/dev/null
jq -e '[.resources[] | select(.type == "aws_wafv2_web_acl" and .name == "edge") | .instances[].attributes.id] == ["3d249028-c2ca-4c2e-bcc4-1ef31ad2acc0"]' "$RECOVERY_DIR/state.json" >/dev/null
# A first creation requires zero live distributions; an existing edge must match the tracked ID.
aws cloudfront list-distributions --no-paginate --output json > "$RECOVERY_DIR/distributions.json"
[[ -s "$RECOVERY_DIR/distributions.json" ]]
jq -e '.DistributionList.IsTruncated == false' "$RECOVERY_DIR/distributions.json" >/dev/null
STATE_CF_ID="$(jq -r '[.resources[] | select(.type == "aws_cloudfront_distribution") | .instances[].attributes.id] | if length == 0 then "" elif length == 1 then .[0] else error("Unexpected distributions in state") end' "$RECOVERY_DIR/state.json")"
if [[ -z "$STATE_CF_ID" ]]; then
  jq -e '.DistributionList.Quantity == 0' "$RECOVERY_DIR/distributions.json" >/dev/null
  echo 'LIVE_CLOUDFRONT_DISTRIBUTIONS=0'
else
  jq -e --arg id "$STATE_CF_ID" '.DistributionList.Quantity == 1 and .DistributionList.Items[0].Id == $id' "$RECOVERY_DIR/distributions.json" >/dev/null
  echo "LIVE_CLOUDFRONT_DISTRIBUTION=$STATE_CF_ID"
fi
ORIGIN="$(aws elbv2 describe-load-balancers --names sea-n-shore-staging-alb --region ap-south-1 --query 'LoadBalancers[0].DNSName' --output text)"
[[ "$ORIGIN" == sea-n-shore-staging-alb-*.ap-south-1.elb.amazonaws.com ]]
python3 - "$RECOVERY_DIR/state.json" "$RECOVERY_DIR/variables.json" <<'PY'
import json, sys
with open(sys.argv[1]) as f: state=json.load(f)
resources=state['resources']
def attrs(kind, name):
    matches=[r for r in resources if r['type']==kind and r['mode']=='managed' and r['name']==name]
    assert len(matches)==1, f'Expected exactly one {kind}.{name}'
    assert len(matches[0].get('instances', []))==1, f'Expected exactly one instance for {kind}.{name}'
    return matches[0]['instances'][0]['attributes']
task=attrs('aws_ecs_task_definition', 'web')
containers=json.loads(task['container_definitions'])
web=next(c for c in containers if c['name']=='web')
site=next(e['value'] for e in web['environment'] if e['name']=='NEXT_PUBLIC_SITE_URL')
values={'image_tag':web['image'].rsplit(':',1)[-1], 'site_url':site, 'aurora_engine_version':attrs('aws_rds_cluster', 'aurora')['engine_version']}
with open(sys.argv[2],'w') as f: json.dump(values,f)
PY
# Reuse the observed, lockfile-verified provider; never reset the host checkout.
PLUGIN_DIR="$HOME/SEA-N-SHORE-CODEX/infra/aws/app/.terraform/providers"
[[ -x "$PLUGIN_DIR/registry.terraform.io/hashicorp/aws/6.62.0/linux_amd64/terraform-provider-aws_v6.62.0_x5" ]]
terraform -chdir="$APP_DIR" init -input=false -no-color -lockfile=readonly -plugin-dir="$PLUGIN_DIR" \
  -backend-config="bucket=$STATE_BUCKET" -backend-config="key=$STATE_KEY" \
  -backend-config=region=ap-south-1 -backend-config=use_lockfile=true > "$RECOVERY_DIR/init.log"
set +e
terraform -chdir="$APP_DIR" plan -input=false -no-color -lock-timeout=60s \
  -target=aws_cloudfront_distribution.app -target=aws_wafv2_web_acl.edge \
  -var-file="$RECOVERY_DIR/variables.json" -out="$RECOVERY_DIR/edge.tfplan" \
  > "$RECOVERY_DIR/plan.log" 2> "$RECOVERY_DIR/plan.err"
PLAN_EXIT=$?
set -e
if [[ "$PLAN_EXIT" != 0 ]]; then cat "$RECOVERY_DIR/plan.err" >&2; exit "$PLAN_EXIT"; fi
terraform -chdir="$APP_DIR" show -json "$RECOVERY_DIR/edge.tfplan" > "$RECOVERY_DIR/plan.json"
jq '{actions: [.resource_changes[] | {address, actions: .change.actions}], policies: [.planned_values.root_module.resources[]? | select(.mode == "data") | {address, values: {id: .values.id, name: .values.name}}], distribution: [.resource_changes[] | select(.address == "aws_cloudfront_distribution.app") | {after: (.change.after | {aliases, enabled, web_acl_id, origin, default_cache_behavior, viewer_certificate}), unknown: .change.after_unknown}]}' "$RECOVERY_DIR/plan.json"
aws cloudfront get-cache-policy --id 4135ea2d-6df8-44a3-9df3-4b5a84be39ad --output json > "$RECOVERY_DIR/cache-policy.json"
jq -e '.CachePolicy.CachePolicyConfig | .MinTTL == 0 and .DefaultTTL == 0 and .MaxTTL == 0' "$RECOVERY_DIR/cache-policy.json" >/dev/null
python3 scripts/aws/check-edge-plan.py "$RECOVERY_DIR/plan.json" "$ORIGIN"
jq '[.resource_changes[] | {address, actions: .change.actions}]' "$RECOVERY_DIR/plan.json"
echo "PLAN_SHA256=$(sha256sum "$RECOVERY_DIR/edge.tfplan" | cut -d' ' -f1)"
echo "STATE_SERIAL_BEFORE=$(jq -r '.serial' "$RECOVERY_DIR/state.json")"
if [[ "$ACTION" == plan ]]; then
  echo 'EDGE_RECOVERY_PLAN_VERIFIED_NO_APPLY'
  exit 0
fi
# Apply only the exact saved plan just checked. Existing edge repair must be an in-place CloudFront update.
if [[ -n "$STATE_CF_ID" ]]; then
  jq -e '[.resource_changes[] | select(.mode == "managed") | {address, actions: .change.actions}] | sort_by(.address) == [
    {"address":"aws_cloudfront_distribution.app","actions":["update"]},
    {"address":"aws_wafv2_web_acl.edge","actions":["no-op"]}
  ]' "$RECOVERY_DIR/plan.json" >/dev/null || {
    echo 'Existing edge apply must contain exactly CloudFront update plus WAF no-op.' >&2
    exit 1
  }
else
  jq -e '[.resource_changes[] | select(.mode == "managed") | {address, actions: .change.actions}] | sort_by(.address) == [
    {"address":"aws_cloudfront_distribution.app","actions":["create"]},
    {"address":"aws_wafv2_web_acl.edge","actions":["no-op"]}
  ]' "$RECOVERY_DIR/plan.json" >/dev/null || {
    echo 'First edge apply must contain exactly CloudFront create plus WAF no-op.' >&2
    exit 1
  }
fi
[[ "$(git ls-remote origin refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$EDGE_AUDIT_EXPECTED_SHA" ]]
[[ "$(aws s3api get-bucket-versioning --bucket "$STATE_BUCKET" --query Status --output text)" == Enabled ]]
echo "STATE_BACKUP_VERSION=$(jq -r '.VersionId' "$RECOVERY_DIR/object.json")"
jq -e '.VersionId != null' "$RECOVERY_DIR/object.json" >/dev/null
CLUSTER="$(jq -r '.resources[] | select(.type == "aws_ecs_cluster" and .name == "app") | .instances[0].attributes.name' "$RECOVERY_DIR/state.json")"
SERVICE="$(jq -r '.resources[] | select(.type == "aws_ecs_service" and .name == "web") | .instances[0].attributes.name' "$RECOVERY_DIR/state.json")"
aws ecs describe-services --cluster "$CLUSTER" --services "$SERVICE" --region ap-south-1 > "$RECOVERY_DIR/ecs-before.json"
PRESERVE_RECOVERY=true
touch .edge-recovery-preserve
echo 'APPLYING_SAVED_EDGE_ONLY_PLAN'
if ! terraform -chdir="$APP_DIR" apply -input=false -no-color "$RECOVERY_DIR/edge.tfplan" > "$RECOVERY_DIR/apply.log" 2> "$RECOVERY_DIR/apply.err"; then
  cat "$RECOVERY_DIR/apply.err" >&2
  echo 'Apply failed; inspect remote state/live resources before retrying.' >&2
  exit 1
fi
terraform -chdir="$APP_DIR" state pull > "$RECOVERY_DIR/state-after.json"
CF_ID="$(jq -r '.resources[] | select(.type == "aws_cloudfront_distribution" and .name == "app") | .instances[0].attributes.id' "$RECOVERY_DIR/state-after.json")"
[[ -n "$CF_ID" && "$CF_ID" != null ]]
if [[ -n "$STATE_CF_ID" ]]; then [[ "$CF_ID" == "$STATE_CF_ID" ]]; fi
aws cloudfront get-distribution --id "$CF_ID" > "$RECOVERY_DIR/live.json"
jq -e '.Distribution | .Status == "Deployed" and .DistributionConfig.Enabled == true and .DistributionConfig.Aliases.Quantity == 0 and .DistributionConfig.ViewerCertificate.CloudFrontDefaultCertificate == true and .DistributionConfig.WebACLId == "arn:aws:wafv2:us-east-1:310356785722:global/webacl/sea-n-shore-staging-edge/3d249028-c2ca-4c2e-bcc4-1ef31ad2acc0"' "$RECOVERY_DIR/live.json" >/dev/null
DOMAIN="$(jq -r '.Distribution.DomainName' "$RECOVERY_DIR/live.json")"
[[ "$DOMAIN" == "d3prih0q6jofyr.cloudfront.net" ]]
jq -e --arg domain "$DOMAIN" '.Distribution.DistributionConfig.Origins | .Quantity == 1 and .Items[0].CustomHeaders.Quantity == 1 and .Items[0].CustomHeaders.Items[0].HeaderName == "X-Forwarded-Host" and .Items[0].CustomHeaders.Items[0].HeaderValue == $domain' "$RECOVERY_DIR/live.json" >/dev/null
for endpoint in phase4 home; do
  curl --fail --silent --show-error --retry 5 --retry-all-errors --retry-delay 5 --max-time 45 "https://$DOMAIN/api/health/$endpoint" > "$RECOVERY_DIR/$endpoint.json"
done
jq -e '.status == "ok" and .database and .identityMappings and .contentNetwork' "$RECOVERY_DIR/phase4.json" >/dev/null
jq -e '.status == "ok" and .profile and .network and .discovery and .feed and .hydration and .media' "$RECOVERY_DIR/home.json" >/dev/null
HTTP_STATUS="$(curl --silent --show-error --max-time 30 -o /dev/null -w '%{http_code}' "http://$DOMAIN/api/health/phase4")"
[[ "$HTTP_STATUS" == 301 ]]
aws ecs describe-services --cluster "$CLUSTER" --services "$SERVICE" --region ap-south-1 > "$RECOVERY_DIR/ecs-after.json"
jq -e --slurpfile before "$RECOVERY_DIR/ecs-before.json" '.services[0] | .taskDefinition == $before[0].services[0].taskDefinition and .desiredCount == 1 and .runningCount == 1 and .pendingCount == 0 and all(.deployments[]; .rolloutState == "COMPLETED" and .failedTasks == 0)' "$RECOVERY_DIR/ecs-after.json" >/dev/null
echo "CLOUDFRONT_ID=$CF_ID"
echo "CLOUDFRONT_HTTPS_URL=https://$DOMAIN"
echo "STATE_SERIAL_AFTER=$(jq -r '.serial' "$RECOVERY_DIR/state-after.json")"
echo 'EDGE_FORWARDED_HOST_VERIFIED; HTTPS_HEALTH_PASSED; HTTP_REDIRECT_PASSED; WAF_ATTACHED; ECS_UNCHANGED_AND_HEALTHY'
PRESERVE_RECOVERY=false
rm -f .edge-recovery-preserve
