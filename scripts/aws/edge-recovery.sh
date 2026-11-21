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
source scripts/aws/bootstrap-terraform-lock.sh
ACTION="$(cut -d' ' -f1 < scripts/aws/edge-recovery-action.txt | tr -d '[:space:]')"
case "$ACTION" in plan|apply-once) ;; *) echo "Unsupported edge action." >&2; exit 1 ;; esac
APP_DIR="$PWD/infra/aws/app"
RECOVERY_DIR="$(mktemp -d "$PWD/.edge-recovery-data.XXXXXXXX")"
PRESERVE_RECOVERY=false
TF_TMPDIR="$(mktemp -d /var/tmp/sns-tf.XXXXXX)"
trap 'if [[ "$PRESERVE_RECOVERY" == true ]]; then echo "PRIVATE_RECOVERY_DIRECTORY=$RECOVERY_DIR" >&2; else rm -rf -- "$RECOVERY_DIR"; fi; rm -rf -- "$TF_TMPDIR"' EXIT; trap 'exit 129' HUP; trap 'exit 130' INT; trap 'exit 143' TERM
STATE_BUCKET=sea-n-shore-310356785722-ap-south-1-tfstate
STATE_KEY=sea-n-shore/staging/terraform.tfstate
aws s3api get-object --bucket "$STATE_BUCKET" --key "$STATE_KEY" --region ap-south-1 "$RECOVERY_DIR/state.json" > "$RECOVERY_DIR/object.json"
jq -e '.lineage == "197a6fae-9997-636e-e52b-c3ac6da85d90"' "$RECOVERY_DIR/state.json" >/dev/null
jq -e '[.resources[] | select(.type == "aws_wafv2_web_acl" and .name == "edge") | .instances[].attributes.id] == ["3d249028-c2ca-4c2e-bcc4-1ef31ad2acc0"]' "$RECOVERY_DIR/state.json" >/dev/null
# Phase 3 intentionally introduced a second distribution for the legacy seaandshore.in redirect.
# Fail closed unless Terraform state and the live CloudFront inventory contain exactly those two
# tracked distributions; Phase 4 must only mutate the main app distribution/function.
aws cloudfront list-distributions --no-paginate --output json > "$RECOVERY_DIR/distributions.json"
[[ -s "$RECOVERY_DIR/distributions.json" ]]
jq -e '.DistributionList.IsTruncated == false' "$RECOVERY_DIR/distributions.json" >/dev/null
# Domain move (Phase 1, import step): the console redirect distribution may also be in state, by its exact id only
# (infra/aws/app/domain-move.tf). This runner still never plans it.
jq -e '[.resources[] | select(.mode == "managed" and .type == "aws_cloudfront_distribution") | .name] | sort | (. == ["app", "seaandshore_redirect"] or . == ["app", "console_redirect", "seaandshore_redirect"])' "$RECOVERY_DIR/state.json" >/dev/null
jq -e '[.resources[] | select(.mode == "managed" and .type == "aws_cloudfront_distribution" and .name == "console_redirect") | .instances[].attributes.id] | (. == [] or . == ["E2MCZ79G101LLD"])' "$RECOVERY_DIR/state.json" >/dev/null
STATE_CF_ID="$(jq -r '[.resources[] | select(.type == "aws_cloudfront_distribution" and .name == "app" and .mode == "managed") | .instances[].attributes.id] | if length == 1 then .[0] else error("Expected exactly one app distribution in state") end' "$RECOVERY_DIR/state.json")"
LEGACY_CF_ID="$(jq -r '[.resources[] | select(.type == "aws_cloudfront_distribution" and .name == "seaandshore_redirect" and .mode == "managed") | .instances[].attributes.id] | if length == 1 then .[0] else error("Expected exactly one legacy redirect distribution in state") end' "$RECOVERY_DIR/state.json")"
# Round P3: one more distribution, made outside Terraform for the seanshore.nl/.ph/.si and seaandshore.si
# domains, is known and allowed by its exact id. This runner never plans or touches it; any other
# untracked distribution still stops the run, by name.
KNOWN_UNTRACKED_CF_IDS='["E2MCZ79G101LLD"]'
jq -e --arg app "$STATE_CF_ID" --arg legacy "$LEGACY_CF_ID" --argjson known "$KNOWN_UNTRACKED_CF_IDS" '(([.DistributionList.Items[]?.Id] - $known) | sort) == ([$app, $legacy] | sort)' "$RECOVERY_DIR/distributions.json" >/dev/null || {
  echo "Unexpected CloudFront distributions: $(jq -c --arg app "$STATE_CF_ID" --arg legacy "$LEGACY_CF_ID" --argjson known "$KNOWN_UNTRACKED_CF_IDS" '[.DistributionList.Items[]?.Id] - [$app, $legacy] - $known' "$RECOVERY_DIR/distributions.json")" >&2
  exit 1
}
echo "LIVE_CLOUDFRONT_KNOWN_UNTRACKED=$(jq -c --argjson known "$KNOWN_UNTRACKED_CF_IDS" '[.DistributionList.Items[]?.Id | select(IN($known[]))]' "$RECOVERY_DIR/distributions.json")"
echo "LIVE_CLOUDFRONT_APP_DISTRIBUTION=$STATE_CF_ID"
echo "LIVE_CLOUDFRONT_LEGACY_REDIRECT_DISTRIBUTION=$LEGACY_CF_ID"
echo 'LIVE_CLOUDFRONT_DISTRIBUTIONS_VERIFIED=true'
# Round 14 (1.4): CloudFront reaches the ALB over HTTPS on its dedicated origin hostname with the
# shared X-Origin-Verify secret. The secret goes to a private file for the plan check and the
# post-apply comparison; it is never printed (the repository and its Actions logs are public).
ORIGIN="origin-staging.seaandshore.in"
aws secretsmanager get-secret-value --region ap-south-1 --secret-id sea-n-shore-staging/origin-verify \
  --query SecretString --output text > "$RECOVERY_DIR/origin-verify"
grep -Eq '^[A-Za-z0-9]{48}$' "$RECOVERY_DIR/origin-verify" || { echo 'Origin verify secret is missing or malformed.' >&2; exit 1; }
export EDGE_ORIGIN_VERIFY_FILE="$RECOVERY_DIR/origin-verify"
# The custom domain rides on the tracked seanshore.in certificate, which must already be ISSUED.
CERT_ARN="$(jq -r '[.resources[] | select(.mode == "managed" and .type == "aws_acm_certificate" and .name == "seanshore_edge") | .instances[0].attributes.arn][0] // empty' "$RECOVERY_DIR/state.json")"
[[ "$CERT_ARN" == arn:aws:acm:us-east-1:310356785722:certificate/* ]]
aws acm describe-certificate --region us-east-1 --certificate-arn "$CERT_ARN" --output json > "$RECOVERY_DIR/certificate.json"
jq -e '.Certificate | .DomainName == "seanshore.in" and ((.SubjectAlternativeNames | sort) == ["seanshore.in", "www.seanshore.in"])' "$RECOVERY_DIR/certificate.json" >/dev/null
echo "ACM_CERTIFICATE_STATUS=$(jq -r '.Certificate.Status' "$RECOVERY_DIR/certificate.json")"
jq -e '.Certificate.Status == "ISSUED"' "$RECOVERY_DIR/certificate.json" >/dev/null || { echo 'seanshore.in edge certificate is not ISSUED; refusing to plan the custom domain.' >&2; exit 1; }
EXPECTED_FUNCTION_ARN="arn:aws:cloudfront::310356785722:function/sea-n-shore-staging-canonical-host-redirect"
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
# Plain init like the other guarded scripts (the committed lock pins only aws; the module also
# needs archive/random), then assert the exact provider versions the plan will run with.
# Terraform stages provider downloads and plugin sockets in TMPDIR: the instance's /tmp is a
# small tmpfs that overflows when several guarded plans run at once, and a socket path must stay
# under 108 characters, so use a short directory on the main volume.
export TMPDIR="$TF_TMPDIR"
terraform -chdir="$APP_DIR" init -input=false -no-color \
  -backend-config="bucket=$STATE_BUCKET" -backend-config="key=$STATE_KEY" \
  -backend-config=region=ap-south-1 -backend-config=use_lockfile=true > "$RECOVERY_DIR/init.log"
python3 - "$APP_DIR/.terraform.lock.hcl" <<'PY'
import re, sys
text = open(sys.argv[1]).read()
expected = {
    'registry.terraform.io/hashicorp/aws': '6.62.0',
    'registry.terraform.io/hashicorp/archive': '2.8.1',
    'registry.terraform.io/hashicorp/random': '3.9.1',
}
for source, version in expected.items():
    match = re.search(rf'provider\s+"{re.escape(source)}"\s*\{{(?P<body>.*?)\n\}}', text, re.S)
    if not match:
        raise SystemExit(f'Missing provider lock for {source}')
    found = re.search(r'version\s*=\s*"([^"]+)"', match.group('body'))
    if not found or found.group(1) != version:
        raise SystemExit(f'Unexpected provider version for {source}: {found.group(1) if found else None}; expected {version}')
PY
echo 'EDGE_PROVIDER_LOCK_VERIFIED=true'
PLAN_EXIT=0
terraform_plan_bounded "$RECOVERY_DIR/plan.log" -chdir="$APP_DIR" plan -input=false -no-color -lock-timeout=60s \
  -target=aws_cloudfront_distribution.app -target=aws_wafv2_web_acl.edge -target=aws_cloudfront_function.canonical_host_redirect -target=aws_cloudfront_cache_policy.next_image -target=aws_cloudfront_cache_policy.public_pages -target=aws_cloudfront_cache_policy.media_cdn -target=aws_cloudfront_cache_policy.public_company_logo \
  -var-file="$RECOVERY_DIR/variables.json" -out="$RECOVERY_DIR/edge.tfplan" \
  2> "$RECOVERY_DIR/plan.err" || PLAN_EXIT=$?
if [[ "$PLAN_EXIT" != 0 ]]; then cat "$RECOVERY_DIR/plan.err" >&2; exit "$PLAN_EXIT"; fi
terraform -chdir="$APP_DIR" show -json "$RECOVERY_DIR/edge.tfplan" > "$RECOVERY_DIR/plan.json"
jq '{actions: [.resource_changes[] | {address, actions: .change.actions}], policies: [.planned_values.root_module.resources[]? | select(.mode == "data") | {address, values: {id: .values.id, name: .values.name}}], distribution: [.resource_changes[] | select(.address == "aws_cloudfront_distribution.app") | {after: (.change.after | {aliases, enabled, web_acl_id, origin: [(.origin // [])[] | .custom_header = [(.custom_header // [])[] | {name, value: (if .name == "X-Origin-Verify" then "[redacted]" else .value end)}]], default_cache_behavior, viewer_certificate}), unknown: .change.after_unknown}], redirect_function: [.resource_changes[] | select(.address == "aws_cloudfront_function.canonical_host_redirect") | {actions: .change.actions, after: (.change.after | {name, runtime, publish, comment}), unknown: .change.after_unknown}]}' "$RECOVERY_DIR/plan.json"
aws cloudfront get-cache-policy --id 4135ea2d-6df8-44a3-9df3-4b5a84be39ad --output json > "$RECOVERY_DIR/cache-policy.json"
jq -e '.CachePolicy.CachePolicyConfig | .MinTTL == 0 and .DefaultTTL == 0 and .MaxTTL == 0' "$RECOVERY_DIR/cache-policy.json" >/dev/null
# Round 14 (3.1): hashed /_next/static assets and public brand images use the managed CachingOptimized
# policy, which never keys on cookies (signed-in HTML stays on CachingDisabled).
aws cloudfront get-cache-policy --id 658327ea-f89d-4fab-a63d-7e88639e58f6 --output json > "$RECOVERY_DIR/optimized-policy.json"
jq -e '.CachePolicy.CachePolicyConfig | .Name == "Managed-CachingOptimized" and .ParametersInCacheKeyAndForwardedToOrigin.CookiesConfig.CookieBehavior == "none" and .ParametersInCacheKeyAndForwardedToOrigin.QueryStringsConfig.QueryStringBehavior == "none"' "$RECOVERY_DIR/optimized-policy.json" >/dev/null
# Round P3 (B7): the media key group and origin access control come from media-cdn-infra.sh. Until that
# has run they would be created here: a plan says so and stops (green), an apply refuses.
for media_address in aws_cloudfront_key_group.media_cdn aws_cloudfront_origin_access_control.media; do
  if jq -e --arg address "$media_address" '[.resource_changes[]? | select(.address == $address and .change.actions != ["no-op"])] | length > 0' "$RECOVERY_DIR/plan.json" >/dev/null; then
    if [[ "$ACTION" == plan ]]; then
      echo "EDGE_MEDIA_PREREQUISITES_MISSING=$media_address (apply media-cdn-infra.sh first)"
      echo 'EDGE_RECOVERY_PLAN_VERIFIED_NO_APPLY'
      exit 0
    fi
    echo "Edge apply refused: $media_address does not exist yet; apply media-cdn-infra.sh first." >&2
    exit 1
  fi
done
python3 scripts/aws/check-edge-plan.py "$RECOVERY_DIR/plan.json" "$ORIGIN" "$CERT_ARN"
jq '[.resource_changes[] | {address, actions: .change.actions}]' "$RECOVERY_DIR/plan.json"
echo "PLAN_SHA256=$(sha256sum "$RECOVERY_DIR/edge.tfplan" | cut -d' ' -f1)"
echo "STATE_SERIAL_BEFORE=$(jq -r '.serial' "$RECOVERY_DIR/state.json")"
if [[ "$ACTION" == plan ]]; then
  echo 'EDGE_RECOVERY_PLAN_VERIFIED_NO_APPLY'
  exit 0
fi
# Apply only the exact saved plan just checked. Dependencies pulled in by -target (the seanshore.in
# certificate) must be no-ops; for an existing edge, only bounded in-place CloudFront/WAF updates
# plus the repository redirect function (create/update) are allowed, and at least one must change.
# Round 14 (3.1): the image cache policy the distribution references may be created or updated too.
# Round P3 (B4): so may the page cache policy (check-edge-plan.py validates its exact settings).
# Round P3 (B7): and the media cache policy. The media key group, public key and origin access
# control come from media-cdn-infra.sh first, so here they must be no-ops like every dependency.
# Request cuts (owner-approved 18 Nov): and the cookie-free public logo cache policy (check-edge-plan.py validates it).
EDGE_ADDRESSES='["aws_cloudfront_cache_policy.media_cdn", "aws_cloudfront_cache_policy.next_image", "aws_cloudfront_cache_policy.public_company_logo", "aws_cloudfront_cache_policy.public_pages", "aws_cloudfront_distribution.app", "aws_cloudfront_function.canonical_host_redirect", "aws_wafv2_web_acl.edge"]'
jq -e --argjson edge "$EDGE_ADDRESSES" '
  [.resource_changes[] | select(.mode == "managed") | select((.address | IN($edge[])) | not) | select(.change.actions != ["no-op"])] | length == 0
' "$RECOVERY_DIR/plan.json" >/dev/null || {
  echo 'Edge apply refused: a dependency outside the edge resources would change.' >&2
  exit 1
}
if [[ -n "$STATE_CF_ID" ]]; then
  jq -e --argjson edge "$EDGE_ADDRESSES" '
    [.resource_changes[] | select(.mode == "managed") | select(.address | IN($edge[])) | {address, actions: .change.actions}] as $changes
    | ($changes | length) == 7
      and ([ $changes[].address ] | sort) == ($edge | sort)
      and ([ $changes[] | select(.address == "aws_cloudfront_cache_policy.media_cdn") ][0].actions as $mp | ($mp == ["no-op"] or $mp == ["update"] or $mp == ["create"]))
      and ([ $changes[] | select(.address == "aws_cloudfront_cache_policy.next_image") ][0].actions as $cp | ($cp == ["no-op"] or $cp == ["update"] or $cp == ["create"]))
      and ([ $changes[] | select(.address == "aws_cloudfront_cache_policy.public_pages") ][0].actions as $pp | ($pp == ["no-op"] or $pp == ["update"] or $pp == ["create"]))
      and ([ $changes[] | select(.address == "aws_cloudfront_cache_policy.public_company_logo") ][0].actions as $lp | ($lp == ["no-op"] or $lp == ["update"] or $lp == ["create"]))
      and ([ $changes[] | select(.address == "aws_cloudfront_distribution.app") ][0].actions as $cf | ($cf == ["no-op"] or $cf == ["update"]))
      and ([ $changes[] | select(.address == "aws_wafv2_web_acl.edge") ][0].actions as $waf | ($waf == ["no-op"] or $waf == ["update"]))
      and ([ $changes[] | select(.address == "aws_cloudfront_function.canonical_host_redirect") ][0].actions as $fn | ($fn == ["no-op"] or $fn == ["update"] or $fn == ["create"]))
      and (([ $changes[] | select(.address == "aws_cloudfront_distribution.app") ][0].actions == ["update"])
        or ([ $changes[] | select(.address == "aws_wafv2_web_acl.edge") ][0].actions == ["update"])
        or ([ $changes[] | select(.address == "aws_cloudfront_function.canonical_host_redirect") ][0].actions != ["no-op"]))
  ' "$RECOVERY_DIR/plan.json" >/dev/null || {
    echo 'Existing edge apply must contain only bounded CloudFront/WAF in-place changes and the redirect function.' >&2
    exit 1
  }
else
  jq -e --argjson edge "$EDGE_ADDRESSES" '
    [.resource_changes[] | select(.mode == "managed") | select(.address | IN($edge[])) | {address, actions: .change.actions}] as $changes
    | ($changes | length) == 7
      and ([ $changes[].address ] | sort) == ($edge | sort)
      and ([ $changes[] | select(.address == "aws_cloudfront_cache_policy.media_cdn") ][0].actions as $mp | ($mp == ["no-op"] or $mp == ["create"]))
      and ([ $changes[] | select(.address == "aws_cloudfront_cache_policy.next_image") ][0].actions as $cp | ($cp == ["no-op"] or $cp == ["create"]))
      and ([ $changes[] | select(.address == "aws_cloudfront_cache_policy.public_pages") ][0].actions as $pp | ($pp == ["no-op"] or $pp == ["create"]))
      and ([ $changes[] | select(.address == "aws_cloudfront_cache_policy.public_company_logo") ][0].actions as $lp | ($lp == ["no-op"] or $lp == ["create"]))
      and ([ $changes[] | select(.address == "aws_cloudfront_distribution.app") ][0].actions == ["create"])
      and ([ $changes[] | select(.address == "aws_wafv2_web_acl.edge") ][0].actions as $waf | ($waf == ["no-op"] or $waf == ["update"]))
      and ([ $changes[] | select(.address == "aws_cloudfront_function.canonical_host_redirect") ][0].actions as $fn | ($fn == ["no-op"] or $fn == ["create"]))
  ' "$RECOVERY_DIR/plan.json" >/dev/null || {
    echo 'First edge apply must contain CloudFront create plus bounded WAF update/no-op and the redirect function.' >&2
    exit 1
  }
fi
[[ "$(bash scripts/aws/branch-head.sh refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$EDGE_AUDIT_EXPECTED_SHA" ]]
[[ "$(aws s3api get-bucket-versioning --bucket "$STATE_BUCKET" --query Status --output text)" == Enabled ]]
echo "STATE_BACKUP_VERSION=$(jq -r '.VersionId' "$RECOVERY_DIR/object.json")"
jq -e '.VersionId != null' "$RECOVERY_DIR/object.json" >/dev/null
CLUSTER="$(jq -r '.resources[] | select(.type == "aws_ecs_cluster" and .name == "app") | .instances[0].attributes.name' "$RECOVERY_DIR/state.json")"
SERVICE="$(jq -r '.resources[] | select(.type == "aws_ecs_service" and .name == "web") | .instances[0].attributes.name' "$RECOVERY_DIR/state.json")"
aws ecs describe-services --cluster "$CLUSTER" --services "$SERVICE" --region ap-south-1 > "$RECOVERY_DIR/ecs-before.json"
# Round P3 (B4): the page cache policy is only safe once the app decides what is public, so the app
# release that sends the header (src/lib/http/public-page-cache.ts) must already be live.
LIVE_PAGE_HEADERS="$(curl --silent --show-error --max-time 45 -o /dev/null -D - -H 'Accept: text/html' -H 'Sec-Fetch-Dest: document' "https://seanshore.in/privacy?edge_precheck=$(date +%s)" | tr -d '\r' | tr '[:upper:]' '[:lower:]')"
grep -q '^cache-control: public, max-age=0, s-maxage=60, stale-while-revalidate=240$' <<<"$LIVE_PAGE_HEADERS" || {
  echo 'Edge apply refused: the live app does not mark signed-out public pages cacheable yet; deploy the app first.' >&2
  exit 1
}
LIVE_SESSION_HEADERS="$(curl --silent --show-error --max-time 45 -o /dev/null -D - -H 'Accept: text/html' -H 'Sec-Fetch-Dest: document' -H 'Cookie: sns_cognito_access=edge-precheck-not-a-session' "https://seanshore.in/privacy?edge_precheck=$(date +%s)" | tr -d '\r' | tr '[:upper:]' '[:lower:]')"
if grep -q '^cache-control: public' <<<"$LIVE_SESSION_HEADERS"; then
  echo 'Edge apply refused: the live app marks a request with a session cookie public.' >&2
  exit 1
fi
echo 'LIVE_APP_PAGE_CACHE_HEADERS_VERIFIED=true'
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
jq -e '.Distribution | .Status == "Deployed" and .DistributionConfig.Enabled == true and .DistributionConfig.WebACLId == "arn:aws:wafv2:us-east-1:310356785722:global/webacl/sea-n-shore-staging-edge/3d249028-c2ca-4c2e-bcc4-1ef31ad2acc0"' "$RECOVERY_DIR/live.json" >/dev/null
jq -e '.Distribution.DistributionConfig | .Aliases.Quantity == 2 and ((.Aliases.Items | sort) == ["seanshore.in", "www.seanshore.in"])' "$RECOVERY_DIR/live.json" >/dev/null
jq -e --arg cert "$CERT_ARN" '.Distribution.DistributionConfig.ViewerCertificate | .ACMCertificateArn == $cert and .SSLSupportMethod == "sni-only" and .MinimumProtocolVersion == "TLSv1.2_2021" and (.CloudFrontDefaultCertificate // false) == false' "$RECOVERY_DIR/live.json" >/dev/null
jq -e --arg fn "$EXPECTED_FUNCTION_ARN" '.Distribution.DistributionConfig.DefaultCacheBehavior | .FunctionAssociations.Quantity == 1 and .FunctionAssociations.Items[0].EventType == "viewer-request" and .FunctionAssociations.Items[0].FunctionARN == $fn and (.LambdaFunctionAssociations.Quantity // 0) == 0' "$RECOVERY_DIR/live.json" >/dev/null
IMAGE_POLICY_ID="$(jq -r '.resources[] | select(.mode == "managed" and .type == "aws_cloudfront_cache_policy" and .name == "next_image") | .instances[0].attributes.id' "$RECOVERY_DIR/state-after.json")"
[[ -n "$IMAGE_POLICY_ID" && "$IMAGE_POLICY_ID" != null ]]
PAGES_POLICY_ID="$(jq -r '.resources[] | select(.mode == "managed" and .type == "aws_cloudfront_cache_policy" and .name == "public_pages") | .instances[0].attributes.id' "$RECOVERY_DIR/state-after.json")"
[[ -n "$PAGES_POLICY_ID" && "$PAGES_POLICY_ID" != null ]]
state_id() { jq -r --arg type "$1" --arg name "$2" '.resources[] | select(.mode == "managed" and .type == $type and .name == $name) | .instances[0].attributes.id' "$RECOVERY_DIR/state-after.json"; }
MEDIA_POLICY_ID="$(state_id aws_cloudfront_cache_policy media_cdn)"
LOGO_POLICY_ID="$(state_id aws_cloudfront_cache_policy public_company_logo)"
[[ -n "$LOGO_POLICY_ID" && "$LOGO_POLICY_ID" != null ]]
MEDIA_KEY_GROUP_ID="$(state_id aws_cloudfront_key_group media_cdn)"
MEDIA_OAC_ID="$(state_id aws_cloudfront_origin_access_control media)"
for value in "$MEDIA_POLICY_ID" "$MEDIA_KEY_GROUP_ID" "$MEDIA_OAC_ID"; do [[ -n "$value" && "$value" != null ]]; done
jq -e --arg fn "$EXPECTED_FUNCTION_ARN" --arg optimized 658327ea-f89d-4fab-a63d-7e88639e58f6 --arg image "$IMAGE_POLICY_ID" --arg pages "$PAGES_POLICY_ID" --arg media "$MEDIA_POLICY_ID" --arg logo "$LOGO_POLICY_ID" '
  .Distribution.DistributionConfig as $config
  | $config.DefaultCacheBehavior.CachePolicyId == $pages
    and ([$config.CacheBehaviors.Items[]? | [.PathPattern, .CachePolicyId]] == [["/m/*", $media], ["/_next/static/*", $optimized], ["/_next/image*", $image], ["/brand/*", $optimized], ["/landing/*", $optimized], ["/favicon.ico", $optimized], ["/api/public/company-logo/*", $logo]])
    and all($config.CacheBehaviors.Items[]? | select(.PathPattern != "/m/*"); ((.GrpcConfig.Enabled // false) == false) and .ViewerProtocolPolicy == "redirect-to-https" and .AllowedMethods.Quantity == 2 and ((.OriginRequestPolicyId // "") == "") and .FunctionAssociations.Quantity == 1 and .FunctionAssociations.Items[0].FunctionARN == $fn and (.LambdaFunctionAssociations.Quantity // 0) == 0)
' "$RECOVERY_DIR/live.json" >/dev/null
# Round P3 (B7): /m/* answers only signed requests (the media key group), from the private media
# bucket through origin access control, with no viewer function.
jq -e --arg group "$MEDIA_KEY_GROUP_ID" --arg oac "$MEDIA_OAC_ID" '
  .Distribution.DistributionConfig as $config
  | ([$config.CacheBehaviors.Items[]? | select(.PathPattern == "/m/*")] | length == 1)
    and ([$config.CacheBehaviors.Items[]? | select(.PathPattern == "/m/*")][0] as $media
      | $media.TargetOriginId == "sea-n-shore-staging-media"
        and $media.ViewerProtocolPolicy == "redirect-to-https"
        and $media.AllowedMethods.Quantity == 2
        and $media.TrustedKeyGroups.Enabled == true and $media.TrustedKeyGroups.Quantity == 1 and $media.TrustedKeyGroups.Items == [$group]
        and (($media.TrustedSigners.Enabled // false) == false)
        and (($media.FunctionAssociations.Quantity // 0) == 0) and (($media.LambdaFunctionAssociations.Quantity // 0) == 0)
        and (($media.OriginRequestPolicyId // "") == ""))
    and ([$config.Origins.Items[] | select(.Id == "sea-n-shore-staging-media")] as $origins
      | ($origins | length) == 1
        and $origins[0].DomainName == "sea-n-shore-staging-310356785722-media.s3.ap-south-1.amazonaws.com"
        and $origins[0].OriginAccessControlId == $oac
        and (($origins[0].S3OriginConfig.OriginAccessIdentity // "") == "")
        and (($origins[0].CustomHeaders.Quantity // 0) == 0)
        and (($origins[0].OriginPath // "") == ""))
' "$RECOVERY_DIR/live.json" >/dev/null
aws cloudfront get-cache-policy --id "$MEDIA_POLICY_ID" --output json > "$RECOVERY_DIR/live-media-policy.json"
jq -e '.CachePolicy.CachePolicyConfig | .MinTTL == 86400 and .DefaultTTL == 31536000 and .MaxTTL == 31536000
  and .ParametersInCacheKeyAndForwardedToOrigin.CookiesConfig.CookieBehavior == "none"
  and .ParametersInCacheKeyAndForwardedToOrigin.HeadersConfig.HeaderBehavior == "none"
  and .ParametersInCacheKeyAndForwardedToOrigin.QueryStringsConfig.QueryStringBehavior == "none"' "$RECOVERY_DIR/live-media-policy.json" >/dev/null
echo 'EDGE_SIGNED_MEDIA_BEHAVIOR_VERIFIED=true'
aws cloudfront get-cache-policy --id "$IMAGE_POLICY_ID" --output json > "$RECOVERY_DIR/live-image-policy.json"
jq -e '.CachePolicy.CachePolicyConfig.ParametersInCacheKeyAndForwardedToOrigin | .CookiesConfig.CookieBehavior == "none" and (.HeadersConfig.Headers.Items == ["Accept"]) and ((.QueryStringsConfig.QueryStrings.Items | sort) == ["q", "url", "w"])' "$RECOVERY_DIR/live-image-policy.json" >/dev/null
echo 'EDGE_STATIC_ASSET_CACHING_VERIFIED=true'
# Round P3 (B4): the live page policy stores only origin-marked public responses for at most 5
# minutes and keys on both session cookies, so a signed-in request never shares a cached copy.
aws cloudfront get-cache-policy --id "$PAGES_POLICY_ID" --output json > "$RECOVERY_DIR/live-pages-policy.json"
jq -e '.CachePolicy.CachePolicyConfig | .MinTTL == 0 and .DefaultTTL == 0 and .MaxTTL == 300
  and .ParametersInCacheKeyAndForwardedToOrigin.CookiesConfig.CookieBehavior == "whitelist"
  and ((.ParametersInCacheKeyAndForwardedToOrigin.CookiesConfig.Cookies.Items | sort) == ["sns_cognito_access", "sns_cognito_refresh"])
  and ((.ParametersInCacheKeyAndForwardedToOrigin.HeadersConfig.Headers.Items | map(ascii_downcase) | sort) == ["next-router-prefetch", "next-router-segment-prefetch", "next-router-state-tree", "rsc"])
  and .ParametersInCacheKeyAndForwardedToOrigin.QueryStringsConfig.QueryStringBehavior == "all"' "$RECOVERY_DIR/live-pages-policy.json" >/dev/null
echo 'EDGE_PAGE_CACHE_POLICY_VERIFIED=true'
# Request cuts: the live public logo policy never keys on cookies or headers (only the path and v) and keeps what
# the origin marks public for at most an hour; its behavior has no origin request policy (checked above).
aws cloudfront get-cache-policy --id "$LOGO_POLICY_ID" --output json > "$RECOVERY_DIR/live-logo-policy.json"
jq -e '.CachePolicy.CachePolicyConfig | .MinTTL == 0 and .DefaultTTL == 0 and .MaxTTL == 3600
  and .ParametersInCacheKeyAndForwardedToOrigin.CookiesConfig.CookieBehavior == "none"
  and .ParametersInCacheKeyAndForwardedToOrigin.HeadersConfig.HeaderBehavior == "none"
  and .ParametersInCacheKeyAndForwardedToOrigin.QueryStringsConfig.QueryStringBehavior == "whitelist"
  and (.ParametersInCacheKeyAndForwardedToOrigin.QueryStringsConfig.QueryStrings.Items == ["v"])' "$RECOVERY_DIR/live-logo-policy.json" >/dev/null
echo 'EDGE_PUBLIC_LOGO_CACHE_POLICY_VERIFIED=true'
aws cloudfront describe-function --name sea-n-shore-staging-canonical-host-redirect --stage LIVE --output json > "$RECOVERY_DIR/live-function.json"
jq -e --arg fn "$EXPECTED_FUNCTION_ARN" '.FunctionSummary | .FunctionMetadata.FunctionARN == $fn and .FunctionConfig.Runtime == "cloudfront-js-2.0"' "$RECOVERY_DIR/live-function.json" >/dev/null
echo 'CANONICAL_HOST_REDIRECT_FUNCTION_LIVE=true'
DOMAIN="$(jq -r '.Distribution.DomainName' "$RECOVERY_DIR/live.json")"
[[ "$DOMAIN" == "d3prih0q6jofyr.cloudfront.net" ]]
jq -e --arg domain "$DOMAIN" --arg origin "$ORIGIN" --rawfile verify "$RECOVERY_DIR/origin-verify" '
  .Distribution.DistributionConfig.Origins
  | ([.Items[] | select(.Id == "sea-n-shore-staging-alb")]) as $alb
  | .Quantity == 2 and ($alb | length) == 1
    and $alb[0].DomainName == $origin
    and $alb[0].CustomOriginConfig.OriginProtocolPolicy == "https-only"
    and $alb[0].CustomHeaders.Quantity == 2
    and ([$alb[0].CustomHeaders.Items[] | select(.HeaderName == "X-Forwarded-Host") | .HeaderValue] == [$domain])
    and ([$alb[0].CustomHeaders.Items[] | select(.HeaderName == "X-Origin-Verify") | .HeaderValue] == [($verify | rtrimstr("\n"))])
' "$RECOVERY_DIR/live.json" >/dev/null
echo 'EDGE_HTTPS_ORIGIN_WITH_VERIFY_HEADER=true'

aws wafv2 get-web-acl \
  --scope CLOUDFRONT \
  --region us-east-1 \
  --name sea-n-shore-staging-edge \
  --id 3d249028-c2ca-4c2e-bcc4-1ef31ad2acc0 \
  --output json > "$RECOVERY_DIR/live-waf.json"
python3 - "$RECOVERY_DIR/live-waf.json" <<'PY'
import base64
import json
import sys

with open(sys.argv[1]) as handle:
    waf = json.load(handle)['WebACL']
rules = waf['Rules']

common = [rule for rule in rules if rule['Name'] == 'AWSManagedRulesCommonRuleSet']
assert len(common) == 1
managed = common[0]['Statement']['ManagedRuleGroupStatement']
assert managed['Name'] == 'AWSManagedRulesCommonRuleSet'
assert managed['VendorName'] == 'AWS'
overrides = managed.get('RuleActionOverrides', [])
assert {override['Name'] for override in overrides} == {'SizeRestrictions_BODY', 'CrossSiteScripting_BODY'}
for override in overrides:
    assert set(override['ActionToUse']) == {'Count'}

custom = [rule for rule in rules if rule['Name'] == 'BlockManagedBodyXssExceptProfileMedia']
assert len(custom) == 1
custom = custom[0]
assert custom['Priority'] == 15
assert set(custom['Action']) == {'Block'}
statements = custom['Statement']['AndStatement']['Statements']
assert len(statements) == 2
label_statements = [statement['LabelMatchStatement'] for statement in statements if 'LabelMatchStatement' in statement]
not_statements = [statement['NotStatement'] for statement in statements if 'NotStatement' in statement]
assert label_statements == [{
    'Scope': 'LABEL',
    'Key': 'awswaf:managed:aws:core-rule-set:CrossSiteScripting_Body',
}]
assert len(not_statements) == 1
inner = not_statements[0]['Statement']['AndStatement']['Statements']
assert len(inner) == 2

def decoded(value):
    if value in ('POST', '/profile', '/m/'):
        return value
    try:
        return base64.b64decode(value, validate=True).decode('utf-8')
    except Exception:
        return value

seen = {}
for statement in inner:
    byte_match = statement['ByteMatchStatement']
    assert byte_match['PositionalConstraint'] == 'EXACTLY'
    assert byte_match['TextTransformations'] == [{'Priority': 0, 'Type': 'NONE'}]
    field = byte_match['FieldToMatch']
    if set(field) == {'Method'}:
        seen['method'] = decoded(byte_match['SearchString'])
    elif set(field) == {'UriPath'}:
        seen['uri'] = decoded(byte_match['SearchString'])
    else:
        raise AssertionError(f'Unexpected profile-media exception field: {field}')
assert seen == {'method': 'POST', 'uri': '/profile'}

rate = [rule for rule in rules if rule['Name'] == 'PerIpRateLimit']
assert len(rate) == 1
rate = rate[0]
assert rate['Priority'] == 20
assert set(rate['Action']) == {'Block'}
rate_statement = rate['Statement']['RateBasedStatement']
assert rate_statement['AggregateKeyType'] == 'IP'
assert rate_statement['Limit'] == 2000
assert rate_statement['EvaluationWindowSec'] == 300
NO_TRANSFORM = [{'Priority': 0, 'Type': 'NONE'}]

def skips_signed_media(scope):
    match = scope['NotStatement']['Statement']['ByteMatchStatement']
    assert set(match['FieldToMatch']) == {'UriPath'}
    assert match['PositionalConstraint'] == 'STARTS_WITH'
    assert decoded(match['SearchString']) == '/m/'
    assert match['TextTransformations'] == NO_TRANSFORM

def skips_session_cookie(scope):
    size = scope['NotStatement']['Statement']['SizeConstraintStatement']
    assert size['ComparisonOperator'] == 'GT' and size['Size'] == 0
    assert size['TextTransformations'] == NO_TRANSFORM
    assert size['FieldToMatch'] == {'Cookies': {
        'MatchPattern': {'IncludedCookies': ['sns_cognito_refresh']},
        'MatchScope': 'VALUE',
        'OversizeHandling': 'MATCH',
    }}

# Round P3 (B7): signed media (/m/*) is never counted. ARCH decision 6 (ship IPs): PerIpRateLimit may
# also skip signed-in requests, but only together with the exact per-session limit and per-IP ceiling.
scope = rate_statement.get('ScopeDownStatement')
signed_out_only = False
if scope is not None:
    if 'AndStatement' in scope:
        parts = scope['AndStatement']['Statements']
        assert len(parts) == 2
        skips_signed_media(parts[0])
        skips_session_cookie(parts[1])
        signed_out_only = True
    else:
        skips_signed_media(scope)
    print('RATE_LIMIT_SKIPS_SIGNED_MEDIA_VERIFIED=true')

ship_rules = {rule['Name']: rule for rule in rules if rule['Name'] in ('PerSessionRateLimit', 'PerIpCeiling')}
if signed_out_only or ship_rules:
    assert signed_out_only and set(ship_rules) == {'PerSessionRateLimit', 'PerIpCeiling'}
    for name, priority, key, limit in [('PerSessionRateLimit', 21, 'CUSTOM_KEYS', 1000), ('PerIpCeiling', 22, 'IP', 20000)]:
        rule = ship_rules[name]
        assert rule['Priority'] == priority
        assert set(rule['Action']) == {'Block'}
        statement = rule['Statement']['RateBasedStatement']
        assert statement['AggregateKeyType'] == key
        assert statement['Limit'] == limit
        assert statement['EvaluationWindowSec'] == 300
        skips_signed_media(statement['ScopeDownStatement'])
    assert ship_rules['PerSessionRateLimit']['Statement']['RateBasedStatement']['CustomKeys'] == [
        {'Cookie': {'Name': 'sns_cognito_refresh', 'TextTransformations': NO_TRANSFORM}}
    ]
    assert 'CustomKeys' not in ship_rules['PerIpCeiling']['Statement']['RateBasedStatement']
    print('SHIP_IP_RATE_LIMITS_VERIFIED=true')
print('PROFILE_MEDIA_XSS_EXCEPTION_VERIFIED=true')
PY

# Round 15 put /api/health/home behind the health check token. It goes in a private header file for
# `curl -H @file` and is never printed (the Actions log is public). /api/health/phase4 stays open.
aws secretsmanager get-secret-value --region ap-south-1 --secret-id sea-n-shore-staging/health-check-token \
  --query SecretString --output text > "$RECOVERY_DIR/health-check-token"
grep -Eq '^[A-Za-z0-9]{32,}$' "$RECOVERY_DIR/health-check-token" || { echo 'Health check token secret is missing or malformed.' >&2; exit 1; }
printf 'x-health-check-token: %s\n' "$(cat "$RECOVERY_DIR/health-check-token")" > "$RECOVERY_DIR/health-check-header"
rm -f "$RECOVERY_DIR/health-check-token"
curl --fail --silent --show-error --retry 5 --retry-all-errors --retry-delay 5 --max-time 45 "https://$DOMAIN/api/health/phase4" > "$RECOVERY_DIR/phase4.json"
curl --fail --silent --show-error --retry 5 --retry-all-errors --retry-delay 5 --max-time 45 -H @"$RECOVERY_DIR/health-check-header" "https://$DOMAIN/api/health/home" > "$RECOVERY_DIR/home.json"
jq -e '.status == "ok" and .database and .identityMappings and .contentNetwork' "$RECOVERY_DIR/phase4.json" >/dev/null
jq -e '.status == "ok" and .profile and .network and .discovery and .feed and .hydration and .media' "$RECOVERY_DIR/home.json" >/dev/null
HTTP_STATUS="$(curl --silent --show-error --max-time 30 -o /dev/null -w '%{http_code}' "http://$DOMAIN/api/health/phase4")"
[[ "$HTTP_STATUS" == 301 ]]
# Prove the custom domain works at the edge before DNS moves: pin the alias hostnames to the
# distribution's own address so SNI and the Host header are the real ones.
EDGE_IP="$(dig +short A "$DOMAIN" | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' | head -n 1)"
[[ -n "$EDGE_IP" ]]
APEX_STATUS="$(curl --silent --show-error --max-time 45 --resolve "seanshore.in:443:$EDGE_IP" -o "$RECOVERY_DIR/apex-health.json" -w '%{http_code}' "https://seanshore.in/api/health/phase4")"
[[ "$APEX_STATUS" == 200 ]]
jq -e '.status == "ok"' "$RECOVERY_DIR/apex-health.json" >/dev/null
WWW_LOCATION="$(curl --silent --show-error --max-time 45 --resolve "www.seanshore.in:443:$EDGE_IP" -o /dev/null -w '%{http_code} %{redirect_url}' "https://www.seanshore.in/api/health/phase4?probe=www")"
[[ "$WWW_LOCATION" == "301 https://seanshore.in/api/health/phase4?probe=www" ]]
echo 'CUSTOM_DOMAIN_EDGE_VERIFIED; WWW_REDIRECT_VERIFIED'

# Round P3 (B4): prove at the live edge that a signed-out public page is served from the cache and
# that a request with a session cookie, and a personal page, never is. A fresh query string per run
# keeps the probe out of real visitors' cache entries. Waits out the distribution's propagation.
PROBE="edge_probe=$(date +%s)$RANDOM"
page_probe() {
  curl --silent --show-error --max-time 45 --resolve "seanshore.in:443:$EDGE_IP" -o /dev/null -D - \
    -H 'Accept: text/html' -H 'Sec-Fetch-Dest: document' "$@" | tr -d '\r' | tr '[:upper:]' '[:lower:]'
}
PAGE_CACHED=false
for attempt in $(seq 1 30); do
  page_probe "https://seanshore.in/privacy?$PROBE" > /dev/null
  HEADERS="$(page_probe "https://seanshore.in/privacy?$PROBE")"
  if grep -q '^x-cache: hit from cloudfront' <<<"$HEADERS" && grep -q '^cache-control: public, max-age=0, s-maxage=60, stale-while-revalidate=240$' <<<"$HEADERS"; then
    PAGE_CACHED=true
    break
  fi
  sleep 20
done
[[ "$PAGE_CACHED" == true ]] || { echo 'A signed-out public page was not served from the edge cache.' >&2; exit 1; }
echo 'SIGNED_OUT_PUBLIC_PAGE_EDGE_HIT_VERIFIED=true'
for attempt in 1 2 3; do
  HEADERS="$(page_probe -H 'Cookie: sns_cognito_access=edge-probe-not-a-session' "https://seanshore.in/privacy?$PROBE")"
  if grep -q '^x-cache: hit from cloudfront' <<<"$HEADERS" || grep -q '^cache-control: public' <<<"$HEADERS"; then
    echo 'A request with a session cookie was answered from the edge cache or marked public.' >&2
    exit 1
  fi
  HEADERS="$(page_probe "https://seanshore.in/home?$PROBE")"
  if grep -q '^x-cache: hit from cloudfront' <<<"$HEADERS" || grep -q '^cache-control: public' <<<"$HEADERS"; then
    echo 'A personal page was answered from the edge cache or marked public.' >&2
    exit 1
  fi
done
echo 'SIGNED_IN_AND_PERSONAL_NEVER_EDGE_CACHED_VERIFIED=true'
# Round P3 (B7): an unsigned media request is refused at the edge, never served from the bucket.
UNSIGNED_STATUS="$(curl --silent --show-error --max-time 45 --resolve "seanshore.in:443:$EDGE_IP" -o /dev/null -w '%{http_code}' "https://seanshore.in/m/i/edge-probe-$PROBE/320.webp")"
[[ "$UNSIGNED_STATUS" == 403 ]] || { echo "An unsigned media request answered $UNSIGNED_STATUS instead of 403." >&2; exit 1; }
echo 'UNSIGNED_MEDIA_REFUSED_VERIFIED=true'

aws ecs describe-services --cluster "$CLUSTER" --services "$SERVICE" --region ap-south-1 > "$RECOVERY_DIR/ecs-after.json"
jq -e --slurpfile before "$RECOVERY_DIR/ecs-before.json" '.services[0] | .taskDefinition == $before[0].services[0].taskDefinition and .desiredCount == $before[0].services[0].desiredCount and .runningCount == .desiredCount and .pendingCount == 0 and all(.deployments[]; .rolloutState == "COMPLETED" and .failedTasks == 0)' "$RECOVERY_DIR/ecs-after.json" >/dev/null
echo "CLOUDFRONT_ID=$CF_ID"
echo "CLOUDFRONT_HTTPS_URL=https://$DOMAIN"
echo "STATE_SERIAL_AFTER=$(jq -r '.serial' "$RECOVERY_DIR/state-after.json")"
echo 'EDGE_PAGE_CACHE_VERIFIED; EDGE_FORWARDED_HOST_VERIFIED; EDGE_HTTPS_ORIGIN_VERIFIED; PROFILE_UPLOAD_WAF_OVERRIDE_VERIFIED; PROFILE_MEDIA_XSS_EXCEPTION_VERIFIED; HTTPS_HEALTH_PASSED; HTTP_REDIRECT_PASSED; WAF_ATTACHED; SEANSHORE_ALIASES_AND_CERTIFICATE_VERIFIED; ECS_UNCHANGED_AND_HEALTHY'
PRESERVE_RECOVERY=false
rm -f .edge-recovery-preserve
