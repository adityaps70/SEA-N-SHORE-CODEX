#!/usr/bin/env bash
# Domain move (seanshore.net), Phase 1 infrastructure (owner-approved 18 Nov; infra/aws/app/domain-move.tf).
#
#   plan               read only: plans the next step (import while the seanshore.net zone is not in state, then
#                      create) and checks it with check-domain-move-plan.py.
#   import-once <sha>  imports the console-made resources; the plan must be exactly those imports, all no-op.
#   create-once <sha>  creates the new certificates (waits until both are ISSUED), the seanshore.net Resend and DMARC
#                      records and the private edge-logs bucket with CloudFront log delivery; nothing else.
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
)

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
case "$ACTION" in plan|import-once|create-once) ;; *) echo "Unsupported domain move infra action." >&2; exit 1 ;; esac

WORK_DIR="$(mktemp -d "$PWD/.domain-move-infra.XXXXXXXX")"
trap 'rm -rf -- "$WORK_DIR"; rm -f -- "$APP_DIR/zz_domain_move_imports.tf"' EXIT; trap 'exit 129' HUP; trap 'exit 130' INT; trap 'exit 143' TERM

aws s3api get-object --bucket "$STATE_BUCKET" --key "$STATE_KEY" --region "$AWS_REGION" "$WORK_DIR/state.json" > "$WORK_DIR/object.json"
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
site_url = next(item['value'] for item in web['environment'] if item['name'] == 'NEXT_PUBLIC_SITE_URL')
image = web['image']
assert ':' in image.rsplit('/', 1)[-1], f'Expected tag-qualified web image, got {image}'
with open(sys.argv[2], 'w') as f:
    json.dump({'image_tag': image.rsplit(':', 1)[1], 'site_url': site_url, 'aurora_engine_version': one('aws_rds_cluster', 'aurora')['engine_version']}, f)
imported = any(r['mode'] == 'managed' and r['type'] == 'aws_route53_zone' and r['name'] == 'seanshore_net' for r in resources)
with open(sys.argv[3], 'w') as f:
    f.write(f"APP_DISTRIBUTION_ID={one('aws_cloudfront_distribution', 'app')['id']}\n")
    f.write(f"REDIRECT_DISTRIBUTION_ID={one('aws_cloudfront_distribution', 'seaandshore_redirect')['id']}\n")
    f.write(f"IMPORTED={'true' if imported else 'false'}\n")
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
case "$ACTION" in
  import-once) [[ "$STEP" == import ]] || { echo "DOMAIN_MOVE_INFRA=FAIL the import is already in state." >&2; exit 1; } ;;
  create-once) [[ "$STEP" == create ]] || { echo "DOMAIN_MOVE_INFRA=FAIL run import-once first." >&2; exit 1; } ;;
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
else
  for target in "${CREATE_TARGETS[@]}"; do PLAN_ARGS+=("-target=$target"); done
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
  else
    python3 -I scripts/aws/check-domain-move-plan.py create "$1" "$APP_DISTRIBUTION_ID" "$REDIRECT_DISTRIBUTION_ID"
  fi
}

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
echo "DOMAIN_MOVE_INFRA_VERIFIED=true"
echo "DOMAIN_MOVE_INFRA_APPLY_COMPLETE"
