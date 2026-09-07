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
[[ "$ACTION" == plan ]] || { echo 'Only read-only planning is enabled.' >&2; exit 1; }
APP_DIR="$PWD/infra/aws/app"
RECOVERY_DIR="$(mktemp -d)"
trap 'rm -rf -- "$RECOVERY_DIR"' EXIT
STATE_BUCKET=sea-n-shore-310356785722-ap-south-1-tfstate
STATE_KEY=sea-n-shore/staging/terraform.tfstate
aws s3api get-object --bucket "$STATE_BUCKET" --key "$STATE_KEY" --region ap-south-1 "$RECOVERY_DIR/state.json" > "$RECOVERY_DIR/object.json"
jq -e '.lineage == "197a6fae-9997-636e-e52b-c3ac6da85d90"' "$RECOVERY_DIR/state.json" >/dev/null
jq -e '[.resources[] | select(.type == "aws_wafv2_web_acl" and .name == "edge") | .instances[].attributes.id] == ["3d249028-c2ca-4c2e-bcc4-1ef31ad2acc0"]' "$RECOVERY_DIR/state.json" >/dev/null
# Require an explicit non-paginated empty live inventory before first creation.
aws cloudfront list-distributions --no-paginate --output json > "$RECOVERY_DIR/distributions.json"
jq -e '.DistributionList.Quantity == 0 and .DistributionList.IsTruncated == false' "$RECOVERY_DIR/distributions.json" >/dev/null
[[ -s "$RECOVERY_DIR/distributions.json" ]]
echo 'LIVE_CLOUDFRONT_DISTRIBUTIONS=0'
ORIGIN="$(aws elbv2 describe-load-balancers --names sea-n-shore-staging-alb --region ap-south-1 --query 'LoadBalancers[0].DNSName' --output text)"
[[ "$ORIGIN" == sea-n-shore-staging-alb-*.ap-south-1.elb.amazonaws.com ]]
python3 - "$RECOVERY_DIR/state.json" "$RECOVERY_DIR/variables.json" <<'PY'
import json, sys
with open(sys.argv[1]) as f: state=json.load(f)
resources=state['resources']
def attrs(kind):
    matches=[r for r in resources if r['type']==kind and r['mode']=='managed']
    assert len(matches)==1, 'Expected exactly one '+kind
    return matches[0]['instances'][0]['attributes']
task=attrs('aws_ecs_task_definition')
containers=json.loads(task['container_definitions'])
web=next(c for c in containers if c['name']=='web')
site=next(e['value'] for e in web['environment'] if e['name']=='NEXT_PUBLIC_SITE_URL')
values={'image_tag':web['image'].rsplit(':',1)[-1], 'site_url':site, 'aurora_engine_version':attrs('aws_rds_cluster')['engine_version']}
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
python3 scripts/aws/check-edge-plan.py "$RECOVERY_DIR/plan.json" "$ORIGIN"
jq '[.resource_changes[] | {address, actions: .change.actions}]' "$RECOVERY_DIR/plan.json"
echo "PLAN_SHA256=$(sha256sum "$RECOVERY_DIR/edge.tfplan" | cut -d' ' -f1)"
echo "STATE_SERIAL_BEFORE=$(jq -r '.serial' "$RECOVERY_DIR/state.json")"
echo 'EDGE_RECOVERY_PLAN_VERIFIED_NO_APPLY'
