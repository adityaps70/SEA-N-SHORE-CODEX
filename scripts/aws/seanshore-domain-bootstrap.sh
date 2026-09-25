#!/usr/bin/env bash
set -euo pipefail
umask 077
export PATH="$HOME/bin:$PATH"
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
EXPECTED_DOMAIN="seanshore.in"
AWS_REGION="ap-south-1"
EDGE_REGION="us-east-1"
STATE_BUCKET="sea-n-shore-310356785722-ap-south-1-tfstate"
STATE_KEY="sea-n-shore/staging/terraform.tfstate"
APP_DIR="$PWD/infra/aws/app"
ACTION_FILE="scripts/aws/seanshore-domain-bootstrap-action.txt"

[[ "${SEANSHORE_DOMAIN_BOOTSTRAP_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "SEANSHORE_DOMAIN_BOOTSTRAP_EXPECTED_SHA must be an exact commit SHA." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$SEANSHORE_DOMAIN_BOOTSTRAP_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- \
  infra/aws/app/seanshore_domain.tf \
  scripts/aws/seanshore-domain-bootstrap.sh \
  scripts/aws/seanshore-domain-bootstrap-action.txt \
  scripts/aws/seanshore-domain-bootstrap.test.mjs \
  .github/workflows/aws-seanshore-domain-bootstrap.yml
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]

ACTION="$(tr -d '[:space:]' < "$ACTION_FILE")"
case "$ACTION" in plan|apply-once) ;; *) echo "Unsupported seanshore domain bootstrap action." >&2; exit 1 ;; esac

WORK_DIR="$(mktemp -d "$PWD/.seanshore-domain-bootstrap.XXXXXXXX")"
trap 'rm -rf -- "$WORK_DIR"' EXIT

aws s3api get-object \
  --bucket "$STATE_BUCKET" \
  --key "$STATE_KEY" \
  --region "$AWS_REGION" \
  "$WORK_DIR/state.json" > "$WORK_DIR/object.json"
jq -e '.lineage == "197a6fae-9997-636e-e52b-c3ac6da85d90"' "$WORK_DIR/state.json" >/dev/null

ZONE_STATE_COUNT="$(jq '[.resources[]? | select(.mode=="managed" and .type=="aws_route53_zone" and .name=="seanshore") | .instances[]?] | length' "$WORK_DIR/state.json")"
CERT_STATE_COUNT="$(jq '[.resources[]? | select(.mode=="managed" and .type=="aws_acm_certificate" and .name=="seanshore_edge") | .instances[]?] | length' "$WORK_DIR/state.json")"
[[ "$ZONE_STATE_COUNT" == "0" || "$ZONE_STATE_COUNT" == "1" ]]
[[ "$CERT_STATE_COUNT" == "0" || "$CERT_STATE_COUNT" == "1" ]]

aws route53 list-hosted-zones-by-name --dns-name "$EXPECTED_DOMAIN" --max-items 20 --output json > "$WORK_DIR/zones.json"
LIVE_ZONE_COUNT="$(jq --arg name "$EXPECTED_DOMAIN." '[.HostedZones[]? | select(.Name==$name and .Config.PrivateZone==false)] | length' "$WORK_DIR/zones.json")"
if [[ "$ZONE_STATE_COUNT" == "0" ]]; then
  [[ "$LIVE_ZONE_COUNT" == "0" ]] || { echo "Untracked public Route53 zone already exists for $EXPECTED_DOMAIN; refusing duplicate." >&2; exit 1; }
else
  [[ "$LIVE_ZONE_COUNT" == "1" ]] || { echo "Tracked Route53 zone does not match live inventory." >&2; exit 1; }
fi

if [[ "$LIVE_ZONE_COUNT" == "1" ]]; then
  LIVE_ZONE_ID="$(jq -r --arg name "$EXPECTED_DOMAIN." '[.HostedZones[] | select(.Name==$name and .Config.PrivateZone==false)][0].Id // empty' "$WORK_DIR/zones.json" | sed 's#^/hostedzone/##')"
  [[ "$LIVE_ZONE_ID" == Z* ]]
  echo "SEANSHORE_DOMAIN_LIVE_ZONE_ID=$LIVE_ZONE_ID"

  aws route53 get-hosted-zone --id "$LIVE_ZONE_ID" --output json > "$WORK_DIR/live-zone.json"
  jq -r '.DelegationSet.NameServers[] | "ROUTE53_NAME_SERVER=" + .' "$WORK_DIR/live-zone.json" | sort

  echo "PUBLIC_NAME_SERVERS_BEGIN"
  while IFS= read -r nameserver; do
    [[ -n "$nameserver" ]] || continue
    nameserver="${nameserver%.}"
    echo "PUBLIC_NAME_SERVER=$nameserver"
  done < <(dig +short NS "$EXPECTED_DOMAIN" | sort)
  echo "PUBLIC_NAME_SERVERS_END"

  echo "REGISTRY_DELEGATION_BEGIN"
  ROUTE53_NS_FILE="$WORK_DIR/route53-ns.txt"
  REGISTRY_NS_FILE="$WORK_DIR/registry-ns.txt"
  jq -r '.DelegationSet.NameServers[]' "$WORK_DIR/live-zone.json" | sed 's/\.$//' | sort -u > "$ROUTE53_NS_FILE"
  : > "$REGISTRY_NS_FILE"
  for parent_ns in ns1.registry.in ns2.registry.in ns3.registry.in ns4.registry.in; do
    echo "REGISTRY_PARENT=$parent_ns"
    while IFS= read -r nameserver; do
      [[ -n "$nameserver" ]] || continue
      nameserver="${nameserver%.}"
      echo "REGISTRY_NAME_SERVER=$parent_ns|$nameserver"
      printf '%s\n' "$nameserver" >> "$REGISTRY_NS_FILE"
    done < <(dig +norecurse +noall +authority NS "$EXPECTED_DOMAIN" @"$parent_ns" | awk '$4=="NS" {print $5}' | sort)
  done
  sort -u -o "$REGISTRY_NS_FILE" "$REGISTRY_NS_FILE"
  if cmp -s "$ROUTE53_NS_FILE" "$REGISTRY_NS_FILE"; then
    echo "REGISTRY_DELEGATION_MATCHES_ROUTE53=true"
  else
    echo "REGISTRY_DELEGATION_MATCHES_ROUTE53=false"
  fi
  echo "REGISTRY_DELEGATION_END"
fi

aws acm list-certificates \
  --region "$EDGE_REGION" \
  --includes keyTypes=RSA_1024,RSA_2048,RSA_3072,RSA_4096,EC_prime256v1,EC_secp384r1,EC_secp521r1 \
  --output json > "$WORK_DIR/certs.json"
LIVE_CERT_COUNT="$(jq --arg domain "$EXPECTED_DOMAIN" '[.CertificateSummaryList[]? | select(.DomainName==$domain)] | length' "$WORK_DIR/certs.json")"
if [[ "$CERT_STATE_COUNT" == "0" ]]; then
  [[ "$LIVE_CERT_COUNT" == "0" ]] || { echo "Untracked ACM certificate already exists for $EXPECTED_DOMAIN in us-east-1; refusing duplicate." >&2; exit 1; }
else
  [[ "$LIVE_CERT_COUNT" == "1" ]] || { echo "Tracked ACM certificate does not match live inventory." >&2; exit 1; }
fi

python3 - "$WORK_DIR/state.json" "$WORK_DIR/variables.json" <<'PY'
import json, sys
with open(sys.argv[1]) as f:
    state=json.load(f)
resources=state['resources']
def attrs(kind, name):
    matches=[r for r in resources if r.get('mode')=='managed' and r.get('type')==kind and r.get('name')==name]
    assert len(matches)==1, f'Expected exactly one {kind}.{name}'
    instances=matches[0].get('instances') or []
    assert len(instances)==1, f'Expected one instance for {kind}.{name}'
    return instances[0]['attributes']
task=attrs('aws_ecs_task_definition','web')
containers=json.loads(task['container_definitions'])
web=next(c for c in containers if c['name']=='web')
site=next(e['value'] for e in web['environment'] if e['name']=='NEXT_PUBLIC_SITE_URL')
image=web['image']
assert ':' in image.rsplit('/',1)[-1]
values={
  'image_tag': image.rsplit(':',1)[1],
  'site_url': site,
  'aurora_engine_version': attrs('aws_rds_cluster','aurora')['engine_version'],
}
with open(sys.argv[2],'w') as f:
    json.dump(values,f)
PY

terraform -chdir="$APP_DIR" init -input=false -no-color \
  -backend-config="bucket=$STATE_BUCKET" \
  -backend-config="key=$STATE_KEY" \
  -backend-config="region=$AWS_REGION" \
  -backend-config=use_lockfile=true > "$WORK_DIR/init.log"

terraform -chdir="$APP_DIR" plan -input=false -no-color -lock-timeout=60s \
  -target=aws_route53_zone.seanshore \
  -target=aws_acm_certificate.seanshore_edge \
  -target=aws_route53_record.seanshore_legacy_apex \
  -target=aws_route53_record.seanshore_legacy_www \
  -target=aws_route53_record.seanshore_edge_validation \
  -target=aws_route53_record.seanshore_ses_dkim \
  -var-file="$WORK_DIR/variables.json" \
  -out="$WORK_DIR/domain.tfplan" > "$WORK_DIR/plan.log"
terraform -chdir="$APP_DIR" show -json "$WORK_DIR/domain.tfplan" > "$WORK_DIR/plan.json"

python3 - "$WORK_DIR/plan.json" <<'PY'
import json, sys
allowed={
  'aws_route53_zone.seanshore',
  'aws_acm_certificate.seanshore_edge',
  'aws_route53_record.seanshore_legacy_apex',
  'aws_route53_record.seanshore_legacy_www',
}
validation_prefix='aws_route53_record.seanshore_edge_validation['
ses_dkim_prefix='aws_route53_record.seanshore_ses_dkim['
with open(sys.argv[1]) as f: plan=json.load(f)
changes=[r for r in plan.get('resource_changes',[]) if r.get('mode')!='data' and r.get('change',{}).get('actions')!=['no-op']]
for r in changes:
    if (
        r['address'] not in allowed
        and not r['address'].startswith(validation_prefix)
        and not r['address'].startswith(ses_dkim_prefix)
    ):
        raise SystemExit(f"unexpected domain bootstrap change: {r['address']} {r['change']['actions']}")
    if r['change']['actions'] != ['create']:
        raise SystemExit(f"non-create domain bootstrap change refused: {r['address']} {r['change']['actions']}")
print('SEANSHORE_DOMAIN_BOOTSTRAP_CHANGE_COUNT=' + str(len(changes)))
for r in changes:
    print(f"SEANSHORE_DOMAIN_BOOTSTRAP_CHANGE={r['address']}|create")
PY

echo "STATE_SERIAL_BEFORE=$(jq -r '.serial' "$WORK_DIR/state.json")"
echo "SEANSHORE_DOMAIN_BOOTSTRAP_ACTION=$ACTION"
echo "SEANSHORE_DOMAIN_BOOTSTRAP_PLAN_VERIFIED=true"
echo "PLAN_SHA256=$(sha256sum "$WORK_DIR/domain.tfplan" | cut -d' ' -f1)"

if [[ "$ACTION" == "plan" ]]; then
  echo "SEANSHORE_DOMAIN_BOOTSTRAP_PLAN_ONLY_NO_APPLY"
  exit 0
fi

[[ "$(git ls-remote origin refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$SEANSHORE_DOMAIN_BOOTSTRAP_EXPECTED_SHA" ]]
[[ "$(aws s3api get-bucket-versioning --bucket "$STATE_BUCKET" --query Status --output text)" == Enabled ]]
STATE_BACKUP_VERSION="$(jq -r '.VersionId // empty' "$WORK_DIR/object.json")"
[[ -n "$STATE_BACKUP_VERSION" ]]
echo "STATE_BACKUP_VERSION=$STATE_BACKUP_VERSION"

terraform -chdir="$APP_DIR" apply -input=false -no-color "$WORK_DIR/domain.tfplan" > "$WORK_DIR/apply.log"
terraform -chdir="$APP_DIR" state pull > "$WORK_DIR/state-after.json"

ZONE_ID="$(jq -r '[.resources[] | select(.mode=="managed" and .type=="aws_route53_zone" and .name=="seanshore") | .instances[0].attributes.zone_id][0] // empty' "$WORK_DIR/state-after.json")"
CERT_ARN="$(jq -r '[.resources[] | select(.mode=="managed" and .type=="aws_acm_certificate" and .name=="seanshore_edge") | .instances[0].attributes.arn][0] // empty' "$WORK_DIR/state-after.json")"
[[ "$ZONE_ID" == Z* ]]
[[ "$CERT_ARN" == arn:aws:acm:us-east-1:310356785722:certificate/* ]]

aws route53 get-hosted-zone --id "$ZONE_ID" --output json > "$WORK_DIR/zone-after.json"
jq -e --arg domain "$EXPECTED_DOMAIN." '.HostedZone.Name==$domain and .HostedZone.Config.PrivateZone==false and (.DelegationSet.NameServers|length)==4' "$WORK_DIR/zone-after.json" >/dev/null
jq -r '.DelegationSet.NameServers[] | "ROUTE53_NAME_SERVER=" + .' "$WORK_DIR/zone-after.json"

for attempt in $(seq 1 30); do
  aws acm describe-certificate --region "$EDGE_REGION" --certificate-arn "$CERT_ARN" --output json > "$WORK_DIR/cert-after.json"
  RECORD_COUNT="$(jq '[.Certificate.DomainValidationOptions[]? | select(.ResourceRecord != null)] | length' "$WORK_DIR/cert-after.json")"
  [[ "$RECORD_COUNT" -ge 1 ]] && break
  sleep 2
done
jq -e --arg domain "$EXPECTED_DOMAIN" '
  .Certificate.DomainName==$domain
  and (.Certificate.SubjectAlternativeNames|sort)==([$domain, ("www."+$domain)]|sort)
  and .Certificate.ValidationMethod=="DNS"
  and ([.Certificate.DomainValidationOptions[]? | select(.ResourceRecord != null)] | length)>=1
' "$WORK_DIR/cert-after.json" >/dev/null
echo "ACM_CERTIFICATE_ARN=$CERT_ARN"
echo "ACM_CERTIFICATE_STATUS=$(jq -r '.Certificate.Status' "$WORK_DIR/cert-after.json")"
jq -r '.Certificate.DomainValidationOptions[] | select(.ResourceRecord != null) | "ACM_VALIDATION_RECORD=" + .ResourceRecord.Type + "|" + .ResourceRecord.Name + "|" + .ResourceRecord.Value' "$WORK_DIR/cert-after.json" | sort -u

aws route53 list-resource-record-sets --hosted-zone-id "$ZONE_ID" --output json > "$WORK_DIR/records-after.json"
jq -e '
  any(.ResourceRecordSets[]; .Name=="seanshore.in." and .Type=="A" and .TTL==300 and .ResourceRecords==[{"Value":"162.215.226.7"}])
  and any(.ResourceRecordSets[]; .Name=="www.seanshore.in." and .Type=="A" and .TTL==300 and .ResourceRecords==[{"Value":"162.215.226.7"}])
' "$WORK_DIR/records-after.json" >/dev/null
echo "LEGACY_DNS_CONTINUITY_RECORDS_VERIFIED=true"
echo "ACM_DNS_VALIDATION_RECORD_COUNT=$(jq '[.ResourceRecordSets[] | select(.Type=="CNAME" and (.Name|startswith("_")))] | length' "$WORK_DIR/records-after.json")"

jq -e '
  ([.ResourceRecordSets[]
    | select(
        .Type=="CNAME"
        and (.Name|endswith("._domainkey.seaandshore.in."))
        and (.ResourceRecords|length)==1
        and (.ResourceRecords[0].Value|endswith(".dkim.amazonses.com"))
      )
  ] | length) == 3
' "$WORK_DIR/records-after.json" >/dev/null
echo "SES_DKIM_RECORDS_VERIFIED=true"

echo "STATE_SERIAL_AFTER=$(jq -r '.serial' "$WORK_DIR/state-after.json")"
echo "SEANSHORE_DOMAIN_BOOTSTRAP_APPLY_VERIFIED=true"
