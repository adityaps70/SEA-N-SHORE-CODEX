#!/usr/bin/env bash
set -euo pipefail
umask 077
export PATH="$HOME/bin:$PATH"
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
EXPECTED_HOSTNAME="origin-staging.seaandshore.in"
AWS_REGION="ap-south-1"
STATE_BUCKET="sea-n-shore-310356785722-ap-south-1-tfstate"
STATE_KEY="sea-n-shore/staging/terraform.tfstate"

[[ "${ORIGIN_CERT_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || { echo "Missing exact SHA." >&2; exit 1; }
[[ "$(git rev-parse HEAD)" == "$ORIGIN_CERT_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- scripts/aws infra/aws/app
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]

ACTION="$(tr -d '[:space:]' < scripts/aws/origin-tls-certificate-action.txt)"
case "$ACTION" in plan|apply-once) ;; *) echo "Unsupported origin certificate action." >&2; exit 1 ;; esac

APP_DIR="$PWD/infra/aws/app"
WORK_DIR="$(mktemp -d "$PWD/.origin-cert.XXXXXXXX")"
trap 'rm -rf -- "$WORK_DIR"' EXIT

aws s3api get-object --bucket "$STATE_BUCKET" --key "$STATE_KEY" --region "$AWS_REGION" "$WORK_DIR/state.json" > "$WORK_DIR/object.json"
jq -e '.lineage == "197a6fae-9997-636e-e52b-c3ac6da85d90"' "$WORK_DIR/state.json" >/dev/null

python3 - "$WORK_DIR/state.json" "$WORK_DIR/variables.json" <<'PY'
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
values={
  'image_tag':web['image'].rsplit(':',1)[-1],
  'site_url':site,
  'aurora_engine_version':attrs('aws_rds_cluster')['engine_version']
}
with open(sys.argv[2],'w') as f: json.dump(values,f)
PY

PLUGIN_DIR="$HOME/SEA-N-SHORE-CODEX/infra/aws/app/.terraform/providers"
[[ -x "$PLUGIN_DIR/registry.terraform.io/hashicorp/aws/6.62.0/linux_amd64/terraform-provider-aws_v6.62.0_x5" ]]
terraform -chdir="$APP_DIR" init -input=false -no-color -lockfile=readonly -plugin-dir="$PLUGIN_DIR" \
  -backend-config="bucket=$STATE_BUCKET" -backend-config="key=$STATE_KEY" \
  -backend-config="region=$AWS_REGION" -backend-config=use_lockfile=true > "$WORK_DIR/init.log"

terraform -chdir="$APP_DIR" plan -input=false -no-color -lock-timeout=60s \
  -target=aws_acm_certificate.origin_tls \
  -var-file="$WORK_DIR/variables.json" -out="$WORK_DIR/origin-cert.tfplan" \
  > "$WORK_DIR/plan.log"
terraform -chdir="$APP_DIR" show -json "$WORK_DIR/origin-cert.tfplan" > "$WORK_DIR/plan.json"

jq -e --arg hostname "$EXPECTED_HOSTNAME" '
  ([.resource_changes[] | select(.change.actions != ["no-op"])]) as $changes |
  ($changes | length) == 1 and
  $changes[0].address == "aws_acm_certificate.origin_tls" and
  $changes[0].change.actions == ["create"] and
  $changes[0].change.after.domain_name == $hostname and
  $changes[0].change.after.validation_method == "DNS"
' "$WORK_DIR/plan.json" >/dev/null || {
  echo "Origin certificate plan contains unexpected actual changes; refusing." >&2
  jq '[.resource_changes[] | select(.change.actions != ["no-op"]) | {address, actions: .change.actions, after_domain: .change.after.domain_name, validation: .change.after.validation_method}]' "$WORK_DIR/plan.json" >&2
  exit 1
}

jq '[.resource_changes[] | select(.change.actions != ["no-op"]) | {address, actions: .change.actions, after_domain: .change.after.domain_name, validation: .change.after.validation_method}]' "$WORK_DIR/plan.json"
echo "PLAN_SHA256=$(sha256sum "$WORK_DIR/origin-cert.tfplan" | cut -d' ' -f1)"
echo "STATE_SERIAL_BEFORE=$(jq -r '.serial' "$WORK_DIR/state.json")"
echo "ORIGIN_TLS_CERT_PLAN_VERIFIED=CREATE_ONLY"

if [[ "$ACTION" == plan ]]; then
  echo "ORIGIN_TLS_CERT_PLAN_ONLY_NO_APPLY"
  exit 0
fi

[[ "$(git ls-remote origin refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$ORIGIN_CERT_EXPECTED_SHA" ]]
[[ "$(aws s3api get-bucket-versioning --bucket "$STATE_BUCKET" --query Status --output text)" == Enabled ]]
echo "STATE_BACKUP_VERSION=$(jq -r '.VersionId' "$WORK_DIR/object.json")"
jq -e '.VersionId != null' "$WORK_DIR/object.json" >/dev/null

echo "APPLYING_SAVED_ORIGIN_CERTIFICATE_ONLY_PLAN"
terraform -chdir="$APP_DIR" apply -input=false -no-color "$WORK_DIR/origin-cert.tfplan" > "$WORK_DIR/apply.log"

CERT_ARN="$(terraform -chdir="$APP_DIR" output -raw origin_tls_certificate_arn)"
[[ "$CERT_ARN" == arn:aws:acm:ap-south-1:310356785722:certificate/* ]]
aws acm describe-certificate --region "$AWS_REGION" --certificate-arn "$CERT_ARN" --output json > "$WORK_DIR/cert.json"
[[ "$(jq -r '.Certificate.DomainName' "$WORK_DIR/cert.json")" == "$EXPECTED_HOSTNAME" ]]
STATUS="$(jq -r '.Certificate.Status' "$WORK_DIR/cert.json")"
echo "ORIGIN_ACM_CERTIFICATE_ARN=$CERT_ARN"
echo "ORIGIN_ACM_CERTIFICATE_STATUS=$STATUS"
jq -r '.Certificate.DomainValidationOptions[] | select(.ResourceRecord != null) | "ORIGIN_ACM_DNS_RECORD=" + .ResourceRecord.Type + "|" + .ResourceRecord.Name + "|" + .ResourceRecord.Value' "$WORK_DIR/cert.json"
terraform -chdir="$APP_DIR" state pull > "$WORK_DIR/state-after.json"
echo "STATE_SERIAL_AFTER=$(jq -r '.serial' "$WORK_DIR/state-after.json")"
echo "ORIGIN_TLS_CERTIFICATE_REQUEST_APPLY_VERIFIED"
