#!/usr/bin/env bash
# Domain move (seanshore.net), Phase 1 infrastructure (owner-approved 18 Nov; infra/aws/app/domain-move.tf).
#
#   plan               read only: plans the next step (import while the seanshore.net zone is not in state, then
#                      create, then serve once the new certificate is in state) and checks it with
#                      check-domain-move-plan.py.
#   import-once <sha>  imports the console-made resources; the plan must be exactly those imports, all no-op.
#   create-once <sha>  creates the new certificates (waits until both are ISSUED), the seanshore.net Resend and DMARC
#                      records and the private edge-logs bucket with CloudFront log delivery, and updates the main
#                      distribution's viewer-request function so x-sns-viewer-host is always the real Host (owner,
#                      21 Nov: the first edge change, before seanshore.net is served); nothing else. Then checks live
#                      that a faked x-sns-viewer-host still lands on https://seanshore.in.
#   serve-once <sha>   serves seanshore.net next to seanshore.in: the main distribution's aliases and certificate, the
#                      viewer function (www.seanshore.net -> seanshore.net), the page cache key, four seanshore.net
#                      alias records, and the browser origins in Cognito and the realtime authorizer; nothing
#                      else. The media bucket's upload CORS is the staging deploy's (it lists the alias hosts). Refuses if seanshore.net already has A/AAAA records, then checks live
#                      that both domains answer (seanshore.in unchanged) through the distribution.
#
# Prints addresses, counts and true/false only (the edge-logs bucket is never listed: logs hold visitor IPs).
set -euo pipefail
umask 077
export PATH="$HOME/bin:$PATH"
export AWS_PAGER=""
EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
STATE_BUCKET="sea-n-shore-310356785722-ap-south-1-tfstate"
STATE_KEY="sea-n-shore/staging/terraform.tfstate"
APP_DIR="$PWD/infra/aws/app"
ACTION_FILE="scripts/aws/domain-move-infra-action.txt"
IMPORTS_TEMPLATE="scripts/aws/domain-move-imports.tf.tpl"
EDGE_LOGS_BUCKET="sea-n-shore-staging-310356785722-edge-logs"
IMPORT_TARGETS=(
  "aws_route53_zone.seanshore_net"
  "aws_route53_zone.console"
  "aws_acm_certificate.console_redirect"
  "aws_cloudfront_function.console_redirect"
  "aws_cloudfront_distribution.console_redirect"
  "aws_route53_record.console_redirect_alias"
  "aws_route53_record.console_redirect_validation"
  "aws_route53_record.seanshore_google_site_verification"
  "aws_route53_record.seanshore_resend_dkim"
  "aws_route53_record.seanshore_resend_return_path"
)
CREATE_TARGETS=(
  "aws_route53_record.seanshore_net_resend_dkim"
  "aws_route53_record.seanshore_net_resend_return_path"
  "aws_route53_record.seanshore_net_dmarc"
  "aws_acm_certificate.site_edge"
  "aws_route53_record.site_edge_validation"
  "aws_acm_certificate_validation.site_edge"
  "aws_acm_certificate.legacy_redirect"
  "aws_acm_certificate_validation.legacy_redirect"
  "aws_s3_bucket.edge_logs"
  "aws_s3_bucket_public_access_block.edge_logs"
  "aws_s3_bucket_ownership_controls.edge_logs"
  "aws_s3_bucket_server_side_encryption_configuration.edge_logs"
  "aws_s3_bucket_lifecycle_configuration.edge_logs"
  "aws_s3_bucket_policy.edge_logs"
  "aws_cloudwatch_log_delivery_source.edge"
  "aws_cloudwatch_log_delivery_destination.edge_logs"
  "aws_cloudwatch_log_delivery.edge"
  "aws_cloudfront_function.canonical_host_redirect"
)
SERVE_TARGETS=(
  "aws_cloudfront_distribution.app"
  "aws_cloudfront_function.canonical_host_redirect"
  "aws_cloudfront_cache_policy.public_pages"
  "aws_route53_record.site_net_alias"
  "aws_cognito_user_pool_client.web"
  "aws_lambda_function.realtime_authorizer"
)
SEANSHORE_NET_ZONE_ID="Z09758912UIE2T2PK09U"
EDGE_HOST="d3prih0q6jofyr.cloudfront.net"

[[ "${DOMAIN_MOVE_INFRA_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "DOMAIN_MOVE_INFRA_EXPECTED_SHA must be an exact commit SHA." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$DOMAIN_MOVE_INFRA_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- infra/aws/app scripts/aws/domain-move-infra.sh scripts/aws/check-domain-move-plan.py "$IMPORTS_TEMPLATE" "$ACTION_FILE"
# The import blocks are never part of the committed configuration.
if compgen -G "$APP_DIR/*import*.tf" >/dev/null; then echo "Import blocks found in infra/aws/app; refusing." >&2; exit 1; fi
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]
source scripts/aws/bootstrap-terraform-lock.sh

ACTION="$(cut -d' ' -f1 < "$ACTION_FILE" | tr -d '[:space:]')"
case "$ACTION" in plan|import-once|create-once|serve-once) ;; *) echo "Unsupported domain move infra action." >&2; exit 1 ;; esac

WORK_DIR="$(mktemp -d "$PWD/.domain-move-infra.XXXXXXXX")"
trap 'rm -rf -- "$WORK_DIR"; rm -f -- "$APP_DIR/zz_domain_move_imports.tf"' EXIT; trap 'exit 129' HUP; trap 'exit 130' INT; trap 'exit 143' TERM

aws s3api get-object --bucket "$STATE_BUCKET" --key "$STATE_KEY" --region "$AWS_REGION" "$WORK_DIR/state.json" > "$WORK_DIR/object.json"
MEDIA_BUCKET="$(jq -r '[.resources[] | select(.mode == "managed" and .type == "aws_s3_bucket" and .name == "app") | .instances[] | select(.index_key == "media") | .attributes.bucket][0] // empty' "$WORK_DIR/state.json")"
jq -e '.lineage == "197a6fae-9997-636e-e52b-c3ac6da85d90"' "$WORK_DIR/state.json" >/dev/null
# Variables for the configuration (as the other targeted runners), and the two distribution ids the log delivery
# names, checked against state.
python3 - "$WORK_DIR/state.json" "$WORK_DIR/variables.json" "$WORK_DIR/facts.env" <<'PY'
import json, sys
with open(sys.argv[1]) as f:
    resources = json.load(f)['resources']

def one(kind, name):
    matches = [r for r in resources if r['mode'] == 'managed' and r['type'] == kind and r['name'] == name]
    assert len(matches) == 1, f'Expected one {kind}.{name}'
    return matches[0]['instances'][0]['attributes']

web = next(c for c in json.loads(one('aws_ecs_task_definition', 'web')['container_definitions']) if c['name'] == 'web')
# site_url as the Cognito runners pass it (scripts/aws/public-site-url.txt; refresh-rotation-infra.sh,
# account-security-infra.sh): the serve step plans the Cognito client, which pulls in the user pool and the email-sender
# Lambda, whose SITE_URL comes from this variable (run 45004263159 planned a change to that Lambda's environment).
with open('scripts/aws/public-site-url.txt') as f:
    site_url = f.read().strip()
assert site_url.startswith('https://') and '/' not in site_url[len('https://'):], 'public-site-url.txt must be an https origin'
image = web['image']
assert ':' in image.rsplit('/', 1)[-1], f'Expected tag-qualified web image, got {image}'
with open(sys.argv[2], 'w') as f:
    json.dump({'image_tag': image.rsplit(':', 1)[1], 'site_url': site_url, 'aurora_engine_version': one('aws_rds_cluster', 'aurora')['engine_version']}, f)
imported = any(r['mode'] == 'managed' and r['type'] == 'aws_route53_zone' and r['name'] == 'seanshore_net' for r in resources)
site_edge = [r for r in resources if r['mode'] == 'managed' and r['type'] == 'aws_acm_certificate' and r['name'] == 'site_edge']
with open(sys.argv[3], 'w') as f:
    f.write(f"APP_DISTRIBUTION_ID={one('aws_cloudfront_distribution', 'app')['id']}\n")
    f.write(f"REDIRECT_DISTRIBUTION_ID={one('aws_cloudfront_distribution', 'seaandshore_redirect')['id']}\n")
    f.write(f"IMPORTED={'true' if imported else 'false'}\n")
    f.write(f"CREATED={'true' if site_edge else 'false'}\n")
    f.write(f"SITE_EDGE_CERTIFICATE_ARN={site_edge[0]['instances'][0]['attributes']['arn'] if site_edge else ''}\n")
PY
rm -f -- "$WORK_DIR/state.json"
# shellcheck disable=SC1091
source "$WORK_DIR/facts.env"
[[ "$APP_DISTRIBUTION_ID" == EF1K45UVP11XZ && "$REDIRECT_DISTRIBUTION_ID" == EK1KQZWPWQZNQ ]] || {
  echo "The distribution ids in state are not the ones domain-move.tf names; refusing." >&2
  exit 1
}

STEP=import
[[ "$IMPORTED" == true ]] && STEP=create
[[ "$IMPORTED" == true && "$CREATED" == true ]] && STEP=serve
case "$ACTION" in
  import-once) [[ "$STEP" == import ]] || { echo "DOMAIN_MOVE_INFRA=FAIL the import is already in state." >&2; exit 1; } ;;
  create-once) [[ "$STEP" == create ]] || { echo "DOMAIN_MOVE_INFRA=FAIL create-once is not the next step." >&2; exit 1; } ;;
  serve-once) [[ "$STEP" == serve ]] || { echo "DOMAIN_MOVE_INFRA=FAIL serve-once is not the next step." >&2; exit 1; } ;;
esac
echo "DOMAIN_MOVE_INFRA_ACTION=$ACTION"
echo "DOMAIN_MOVE_INFRA_STEP=$STEP"

# A failing Terraform step prints its Error blocks (this step's resources hold no secrets) instead of stopping
# silently; run 44479432280 stopped after DOMAIN_MOVE_INFRA_STEP with nothing to show why.
terraform_errors() {
  echo "DOMAIN_MOVE_INFRA=FAIL $1"
  grep -E -A12 '^(│ )?Error' "$2" | sed -e 's/^│ //' | head -120 >&2 || true
  exit 1
}
terraform -chdir="$APP_DIR" init -input=false -no-color \
  -backend-config="bucket=$STATE_BUCKET" -backend-config="key=$STATE_KEY" \
  -backend-config="region=$AWS_REGION" -backend-config=use_lockfile=true > "$WORK_DIR/init.log" 2>&1 \
  || terraform_errors "terraform init" "$WORK_DIR/init.log"

PLAN_ARGS=()
if [[ "$STEP" == import ]]; then
  cp -- "$IMPORTS_TEMPLATE" "$APP_DIR/zz_domain_move_imports.tf"
  for target in "${IMPORT_TARGETS[@]}"; do PLAN_ARGS+=("-target=$target"); done
elif [[ "$STEP" == create ]]; then
  for target in "${CREATE_TARGETS[@]}"; do PLAN_ARGS+=("-target=$target"); done
else
  [[ "$SITE_EDGE_CERTIFICATE_ARN" == arn:aws:acm:us-east-1:310356785722:certificate/* ]]
  for target in "${SERVE_TARGETS[@]}"; do PLAN_ARGS+=("-target=$target"); done
fi
plan() {
  # Bounded like every host plan: interrupted and retried once if it hangs (scripts/aws/bootstrap-terraform-lock.sh).
  terraform_plan_bounded "$WORK_DIR/$1.log" -chdir="$APP_DIR" plan -input=false -no-color -lock-timeout=60s \
    "${PLAN_ARGS[@]}" -var-file="$WORK_DIR/variables.json" -out="$WORK_DIR/$1.tfplan" \
    || terraform_errors "terraform plan ($1)" "$WORK_DIR/$1.log"
  terraform -chdir="$APP_DIR" show -json "$WORK_DIR/$1.tfplan" > "$WORK_DIR/$1.json" 2> "$WORK_DIR/$1.show.err" \
    || terraform_errors "terraform show ($1)" "$WORK_DIR/$1.show.err"
}
classify() {
  if [[ "$STEP" == import ]]; then
    python3 -I scripts/aws/check-domain-move-plan.py import "$1"
  elif [[ "$STEP" == serve ]]; then
    python3 -I scripts/aws/check-domain-move-plan.py serve "$1" "$APP_DISTRIBUTION_ID" "$SITE_EDGE_CERTIFICATE_ARN"
  else
    python3 -I scripts/aws/check-domain-move-plan.py create "$1" "$APP_DISTRIBUTION_ID" "$REDIRECT_DISTRIBUTION_ID"
  fi
}

# Run 45004263159: the media bucket's CORS rule is the staging deploy's (put-bucket-cors on every deploy), not in
# Terraform state, so the serve step never targets it. Read-only facts: whether the live rule already lists
# seanshore.net (a deploy since the alias host was added), counts and true/false only.
if [[ "$STEP" == serve ]]; then
  if [[ -n "$MEDIA_BUCKET" ]] && aws s3api get-bucket-cors --bucket "$MEDIA_BUCKET" --output json > "$WORK_DIR/media-cors.json" 2> "$WORK_DIR/media-cors.err"; then
    jq -r '"DOMAIN_MOVE_MEDIA_CORS_LIVE rules=\(.CORSRules | length) put_only=\([.CORSRules[] | .AllowedMethods == ["PUT"]] | all) content_type_only=\([.CORSRules[] | (.AllowedHeaders // []) == ["Content-Type"]] | all) origins=\([.CORSRules[] | (.AllowedOrigins // [])[]] | length) has_in=\([.CORSRules[] | (.AllowedOrigins // [])[]] | index("https://seanshore.in") != null) has_net=\([.CORSRules[] | (.AllowedOrigins // [])[]] | index("https://seanshore.net") != null) has_edge=\([.CORSRules[] | (.AllowedOrigins // [])[]] | index("https://d3prih0q6jofyr.cloudfront.net") != null)"' "$WORK_DIR/media-cors.json"
  elif grep -q NoSuchCORSConfiguration "$WORK_DIR/media-cors.err" 2>/dev/null; then
    echo "DOMAIN_MOVE_MEDIA_CORS_LIVE rules=0"
  else
    echo "DOMAIN_MOVE_MEDIA_CORS_LIVE unreadable"
  fi
fi
plan before
# The checker's refusal line is printed before the run stops (a failing $(...) would end the script first).
CLASSIFY_STATUS=0
CLASSIFICATION="$(classify "$WORK_DIR/before.json")" || CLASSIFY_STATUS=$?
echo "$CLASSIFICATION"
[[ "$CLASSIFY_STATUS" == 0 ]] || { echo "DOMAIN_MOVE_INFRA=FAIL plan refused"; exit 1; }
if grep -qx 'DOMAIN_MOVE_PLAN=NO_CHANGES' <<<"$CLASSIFICATION"; then
  echo "DOMAIN_MOVE_INFRA_ALREADY_APPLIED=true"
  exit 0
fi
if [[ "$ACTION" == plan ]]; then
  echo "DOMAIN_MOVE_INFRA_PLAN_ONLY_NO_APPLY"
  exit 0
fi

[[ "$(bash scripts/aws/branch-head.sh refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$DOMAIN_MOVE_INFRA_EXPECTED_SHA" ]] || {
  echo "Branch moved after the domain move run started; refusing stale execution." >&2
  exit 1
}
# serve-once creates the seanshore.net A/AAAA records: none may exist yet (a record made elsewhere is never replaced).
# Counts only.
net_site_records() {
  aws route53 list-resource-record-sets --hosted-zone-id "$SEANSHORE_NET_ZONE_ID" --output json \
    | jq --arg kind "$1" '[.ResourceRecordSets[] | select((.Type == "A" or .Type == "AAAA") and (.Name == "seanshore.net." or .Name == "www.seanshore.net."))
        | select($kind == "any" or ((.AliasTarget.DNSName // "") | ascii_downcase | rtrimstr(".")) == "d3prih0q6jofyr.cloudfront.net")] | length'
}
if [[ "$ACTION" == serve-once ]]; then
  EXISTING_NET_RECORDS="$(net_site_records any)"
  echo "DOMAIN_MOVE_NET_SITE_RECORDS_BEFORE=$EXISTING_NET_RECORDS"
  [[ "$EXISTING_NET_RECORDS" == 0 ]] || { echo "DOMAIN_MOVE_INFRA=FAIL seanshore.net already has A/AAAA records; refusing." >&2; exit 1; }
fi
STATE_SERIAL_BEFORE="$(terraform -chdir="$APP_DIR" state pull | jq -r '.serial')"
[[ "$STATE_SERIAL_BEFORE" =~ ^[0-9]+$ ]]
echo "STATE_SERIAL_BEFORE=$STATE_SERIAL_BEFORE"
# Apply exactly the plan that was classified (the certificate validations wait up to 45 minutes for ISSUED).
terraform -chdir="$APP_DIR" apply -input=false -no-color -lock-timeout=60s "$WORK_DIR/before.tfplan" > "$WORK_DIR/apply.log" 2>&1 \
  || terraform_errors "terraform apply" "$WORK_DIR/apply.log"
rm -f -- "$APP_DIR/zz_domain_move_imports.tf"

# After the import the same addresses plan with no change and no import; after the create, nothing is left to create.
plan after
AFTER="$(classify "$WORK_DIR/after.json")" || true
echo "DOMAIN_MOVE_INFRA_AFTER $AFTER"
grep -qx 'DOMAIN_MOVE_PLAN=NO_CHANGES' <<<"$AFTER" || { echo "The domain move resources still differ after the apply." >&2; exit 1; }
STATE_SERIAL_AFTER="$(terraform -chdir="$APP_DIR" state pull | jq -r '.serial')"
[[ "$STATE_SERIAL_AFTER" -gt "$STATE_SERIAL_BEFORE" ]]
echo "STATE_SERIAL_AFTER=$STATE_SERIAL_AFTER"

if [[ "$ACTION" == create-once ]]; then
  for cert in site_edge legacy_redirect; do
    arn="$(terraform -chdir="$APP_DIR" state pull | jq -r --arg name "$cert" '[.resources[] | select(.mode == "managed" and .type == "aws_acm_certificate" and .name == $name) | .instances[0].attributes.arn][0]')"
    [[ "$arn" == arn:aws:acm:us-east-1:310356785722:certificate/* ]]
    status="$(aws acm describe-certificate --region us-east-1 --certificate-arn "$arn" --query Certificate.Status --output text)"
    echo "DOMAIN_MOVE_CERTIFICATE_${cert^^}=$status"
    [[ "$status" == ISSUED ]]
  done
  public="$(aws s3api get-public-access-block --region us-east-1 --bucket "$EDGE_LOGS_BUCKET" --output json \
    | jq '.PublicAccessBlockConfiguration | [.BlockPublicAcls, .IgnorePublicAcls, .BlockPublicPolicy, .RestrictPublicBuckets] | all')"
  lifecycle="$(aws s3api get-bucket-lifecycle-configuration --region us-east-1 --bucket "$EDGE_LOGS_BUCKET" --output json \
    | jq '[.Rules[] | select(.Status == "Enabled" and .Expiration.Days == 30)] | length == 1')"
  deliveries="$(aws logs describe-deliveries --region us-east-1 --output json \
    | jq '[.deliveries[]? | select(.deliverySourceName | startswith("sea-n-shore-staging-edge-"))] | length')"
  echo "DOMAIN_MOVE_EDGE_LOGS public_blocked=$public lifecycle_30_days=$lifecycle deliveries=$deliveries"
  [[ "$public" == true && "$lifecycle" == true && "$deliveries" == 2 ]]
fi
# Live, after create-once only (the import changes nothing at the edge): a browser that fakes x-sns-viewer-host must
# still be sent to https://seanshore.in. /auth/session-ended without a session redirects to sign-in on the origin the
# app picks, and is never cached. The function was published at the start of the apply and reaches every edge
# location within minutes; this retries for about 10 more. Prints true/false and the attempt count only.
if [[ "$ACTION" == create-once ]]; then
  viewer_host_location() {
    curl --silent --show-error --max-time 30 -o /dev/null -w '%{redirect_url}' "$@" \
      "https://seanshore.in/auth/session-ended?viewer_host_check=$(date +%s)" || true
  }
  FAKED_OK=false
  for attempt in $(seq 1 20); do
    if [[ "$(viewer_host_location -H 'x-sns-viewer-host: seanshore.net')" == "https://seanshore.in/auth/sign-in" ]]; then
      FAKED_OK=true
      break
    fi
    sleep 30
  done
  PLAIN_OK=false
  [[ "$(viewer_host_location)" == "https://seanshore.in/auth/sign-in" ]] && PLAIN_OK=true
  WWW_OK=false
  [[ "$(curl --silent --show-error --max-time 30 -o /dev/null -w '%{http_code} %{redirect_url}' "https://www.seanshore.in/help?viewer_host_check=1" || true)" == "301 https://seanshore.in/help?viewer_host_check=1" ]] && WWW_OK=true
  echo "DOMAIN_MOVE_VIEWER_HOST_CHECK faked_lands_on_canonical=$FAKED_OK attempts=$attempt plain=$PLAIN_OK www_redirect=$WWW_OK"
  [[ "$FAKED_OK" == true && "$PLAIN_OK" == true && "$WWW_OK" == true ]]
fi
# Live, after serve-once: both domains through the distribution. DNS for seanshore.net is new, so a resolver may still
# hold an old "no such name" answer; the requests go to the distribution directly with the right name (TLS checks
# the certificate for that name), and the records are checked in Route 53. Prints true/false only.
if [[ "$ACTION" == serve-once ]]; then
  edge() {
    local host="$1"; shift
    curl --silent --show-error --max-time 30 --connect-to "$host:443:$EDGE_HOST:443" "$@" || true
  }
  NET_HEALTH=false
  for attempt in $(seq 1 20); do
    [[ "$(edge seanshore.net -o /dev/null -w '%{http_code}' "https://seanshore.net/api/health/live?serve_check=$(date +%s)")" == 200 ]] && { NET_HEALTH=true; break; }
    sleep 30
  done
  IN_HEALTH=false
  [[ "$(curl --silent --show-error --max-time 30 -o /dev/null -w '%{http_code}' "https://seanshore.in/api/health/live?serve_check=1" || true)" == 200 ]] && IN_HEALTH=true
  NET_WWW=false
  [[ "$(edge www.seanshore.net -o /dev/null -w '%{http_code} %{redirect_url}' "https://www.seanshore.net/help?serve_check=1")" == "301 https://seanshore.net/help?serve_check=1" ]] && NET_WWW=true
  IN_WWW=false
  [[ "$(curl --silent --show-error --max-time 30 -o /dev/null -w '%{http_code} %{redirect_url}' "https://www.seanshore.in/help?serve_check=1" || true)" == "301 https://seanshore.in/help?serve_check=1" ]] && IN_WWW=true
  # The app sends a visitor back to the domain they are on: seanshore.net stays on seanshore.net, and a faked header on
  # seanshore.in still lands on seanshore.in.
  NET_STAYS=false
  [[ "$(edge seanshore.net -o /dev/null -w '%{redirect_url}' "https://seanshore.net/auth/session-ended?serve_check=$(date +%s)")" == "https://seanshore.net/auth/sign-in" ]] && NET_STAYS=true
  IN_FAKED=false
  [[ "$(curl --silent --show-error --max-time 30 -o /dev/null -w '%{redirect_url}' -H 'x-sns-viewer-host: seanshore.net' "https://seanshore.in/auth/session-ended?serve_check=$(date +%s)" || true)" == "https://seanshore.in/auth/sign-in" ]] && IN_FAKED=true
  NET_RECORDS="$(net_site_records edge)"
  echo "DOMAIN_MOVE_SERVE_CHECK net_health=$NET_HEALTH attempts=$attempt in_health=$IN_HEALTH net_www_redirect=$NET_WWW in_www_redirect=$IN_WWW net_stays_on_net=$NET_STAYS in_faked_lands_on_in=$IN_FAKED net_alias_records=$NET_RECORDS"
  [[ "$NET_HEALTH" == true && "$IN_HEALTH" == true && "$NET_WWW" == true && "$IN_WWW" == true && "$NET_STAYS" == true && "$IN_FAKED" == true && "$NET_RECORDS" == 4 ]]
fi
echo "DOMAIN_MOVE_INFRA_VERIFIED=true"
echo "DOMAIN_MOVE_INFRA_APPLY_COMPLETE"
