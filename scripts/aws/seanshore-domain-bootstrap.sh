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

# Terraform stages provider downloads in TMPDIR; the instance's /tmp is a small tmpfs that
# overflows when several guarded plans run at once, so stage them inside the work directory.
export TMPDIR="$WORK_DIR/tmp"
mkdir -p "$TMPDIR"
terraform -chdir="$APP_DIR" init -input=false -no-color \
  -backend-config="bucket=$STATE_BUCKET" \
  -backend-config="key=$STATE_KEY" \
  -backend-config="region=$AWS_REGION" \
  -backend-config=use_lockfile=true > "$WORK_DIR/init.log"

terraform -chdir="$APP_DIR" plan -input=false -no-color -lock-timeout=60s \
  -target=aws_route53_zone.seanshore \
  -target=aws_acm_certificate.seanshore_edge \
  -target=aws_route53_record.seanshore_apex_a \
  -target=aws_route53_record.seanshore_apex_aaaa \
  -target=aws_route53_record.seanshore_www_a \
  -target=aws_route53_record.seanshore_www_aaaa \
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
}
# Phase 2 cutover: the legacy website A records become aliases to the app distribution in place
# (moved from seanshore_legacy_*), and AAAA aliases are created next to them.
CLOUDFRONT_HOSTED_ZONE_ID='Z2FDTNDATAQYW2'
APP_DISTRIBUTION_DOMAIN='d3prih0q6jofyr.cloudfront.net'
site_records={
  'aws_route53_record.seanshore_apex_a': ('seanshore.in', 'A', ['update'], 'aws_route53_record.seanshore_legacy_apex'),
  'aws_route53_record.seanshore_apex_aaaa': ('seanshore.in', 'AAAA', ['create'], None),
  'aws_route53_record.seanshore_www_a': ('www.seanshore.in', 'A', ['update'], 'aws_route53_record.seanshore_legacy_www'),
  'aws_route53_record.seanshore_www_aaaa': ('www.seanshore.in', 'AAAA', ['create'], None),
}
def is_app_alias(after):
    aliases=after.get('alias') or []
    return (
        len(aliases) == 1
        and aliases[0].get('name', '').rstrip('.') == APP_DISTRIBUTION_DOMAIN
        and aliases[0].get('zone_id') == CLOUDFRONT_HOSTED_ZONE_ID
        and aliases[0].get('evaluate_target_health') is False
        and not after.get('records')
        and after.get('ttl') in (None, 0)
    )
validation_prefix='aws_route53_record.seanshore_edge_validation['
ses_dkim_prefix='aws_route53_record.seanshore_ses_dkim['
stale_ses_dkim_addresses={
  'aws_route53_record.seanshore_ses_dkim["2wwo3k3osbixwfbu7wdffxojx2nrnhzj"]',
  'aws_route53_record.seanshore_ses_dkim["m5dlbuzu6k7hean2miuvuwfv6a7775bf"]',
  'aws_route53_record.seanshore_ses_dkim["oo6wrb42ubkjrfjceovwfs5ixicw5jzw"]',
}
with open(sys.argv[1]) as f: plan=json.load(f)
changes=[r for r in plan.get('resource_changes',[]) if r.get('mode')!='data' and r.get('change',{}).get('actions')!=['no-op']]
for r in changes:
    if (
        r['address'] not in allowed
        and not r['address'].startswith(validation_prefix)
        and not r['address'].startswith(ses_dkim_prefix)
    ):
        raise SystemExit(f"unexpected domain bootstrap change: {r['address']} {r['change']['actions']}")
    actions = r['change']['actions']
    if r['address'] in site_records:
        name, record_type, expected_actions, previous = site_records[r['address']]
        after = r.get('change', {}).get('after') or {}
        before = r.get('change', {}).get('before') or {}
        unknown = r.get('change', {}).get('after_unknown') or {}
        if actions != expected_actions:
            raise SystemExit(f"site record {r['address']} must be {expected_actions}, got {actions}")
        if after.get('name', '').rstrip('.') != name or after.get('type') != record_type:
            raise SystemExit(f"site record {r['address']} name/type mismatch: {after.get('name')} {after.get('type')}")
        if unknown.get('alias') is True or unknown.get('name') is True or unknown.get('type') is True:
            raise SystemExit(f"site record {r['address']} alias target must be known at plan time")
        if not is_app_alias(after):
            raise SystemExit(f"site record {r['address']} must alias the app CloudFront distribution")
        if actions == ['update']:
            if before.get('records') != ['162.215.226.7'] or before.get('type') != record_type:
                raise SystemExit(f"site record {r['address']} may only replace the legacy 162.215.226.7 record")
            if r.get('previous_address') not in (previous, None):
                raise SystemExit(f"site record {r['address']} unexpected previous address {r.get('previous_address')}")
        print(f"SEANSHORE_DOMAIN_BOOTSTRAP_SITE_RECORD={r['address']}|{','.join(actions)}|{name}|{record_type}")
        continue
    if actions == ['create']:
        continue
    if r['address'] in stale_ses_dkim_addresses and actions == ['delete']:
        before = r.get('change', {}).get('before') or {}
        name = (before.get('name') or '').rstrip('.')
        record_type = before.get('type')
        records = before.get('records') or []
        if (
            name.endswith('._domainkey.seaandshore.in')
            and record_type == 'CNAME'
            and len(records) == 1
            and records[0].rstrip('.').endswith('.dkim.amazonses.com')
        ):
            print(f"SEANSHORE_DOMAIN_BOOTSTRAP_STALE_SES_DKIM_DELETE={r['address']}|{name}")
            continue
    raise SystemExit(f"non-create domain bootstrap change refused: {r['address']} {actions}")
print('SEANSHORE_DOMAIN_BOOTSTRAP_CHANGE_COUNT=' + str(len(changes)))
for r in changes:
    print(f"SEANSHORE_DOMAIN_BOOTSTRAP_CHANGE={r['address']}|{','.join(r['change']['actions'])}")
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
  [.ResourceRecordSets[] | select((.Name=="seanshore.in." or .Name=="www.seanshore.in.") and (.Type=="A" or .Type=="AAAA"))] as $site
  | ($site | length) == 4
  and all($site[]; .AliasTarget.DNSName=="d3prih0q6jofyr.cloudfront.net." and .AliasTarget.HostedZoneId=="Z2FDTNDATAQYW2" and .AliasTarget.EvaluateTargetHealth==false and (.ResourceRecords|not))
  and ([$site[] | .Name + "/" + .Type] | sort) == ["seanshore.in./A","seanshore.in./AAAA","www.seanshore.in./A","www.seanshore.in./AAAA"]
  and (any(.ResourceRecordSets[]; (.ResourceRecords // []) | any(.Value=="162.215.226.7")) | not)
' "$WORK_DIR/records-after.json" >/dev/null
echo "SITE_ALIAS_RECORDS_VERIFIED=true"

# Authoritative answer straight from the zone's own name servers, then the app over the real
# hostname pinned to the distribution (public resolvers may still cache the legacy answer).
ROUTE53_NS="$(jq -r '.DelegationSet.NameServers[0]' "$WORK_DIR/zone-after.json")"
for host in seanshore.in www.seanshore.in; do
  AUTH_ANSWER="$(dig +short A "$host" "@$ROUTE53_NS" | sort | tr '\n' ' ')"
  echo "AUTHORITATIVE_A=$host|$AUTH_ANSWER"
  [[ -n "$AUTH_ANSWER" && "$AUTH_ANSWER" != *162.215.226.7* ]]
  AUTH_AAAA="$(dig +short AAAA "$host" "@$ROUTE53_NS" | sort | tr '\n' ' ')"
  echo "AUTHORITATIVE_AAAA=$host|$AUTH_AAAA"
  [[ -n "$AUTH_AAAA" ]]
done
EDGE_IP="$(dig +short A d3prih0q6jofyr.cloudfront.net | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' | head -n 1)"
[[ -n "$EDGE_IP" ]]
APEX_STATUS="$(curl --silent --show-error --max-time 45 --resolve "seanshore.in:443:$EDGE_IP" -o "$WORK_DIR/apex-health.json" -w '%{http_code}' "https://seanshore.in/api/health/phase4")"
[[ "$APEX_STATUS" == 200 ]]
jq -e '.status == "ok"' "$WORK_DIR/apex-health.json" >/dev/null
WWW_REDIRECT="$(curl --silent --show-error --max-time 45 --resolve "www.seanshore.in:443:$EDGE_IP" -o /dev/null -w '%{http_code} %{redirect_url}' "https://www.seanshore.in/help?probe=www")"
[[ "$WWW_REDIRECT" == "301 https://seanshore.in/help?probe=www" ]]
echo "SEANSHORE_CUTOVER_HTTPS_VERIFIED=true"
echo "ACM_DNS_VALIDATION_RECORD_COUNT=$(jq '[.ResourceRecordSets[] | select(.Type=="CNAME" and (.Name|startswith("_")))] | length' "$WORK_DIR/records-after.json")"

jq -e '
  ([.ResourceRecordSets[]
    | select(
        .Type=="CNAME"
        and (.Name|endswith("._domainkey.seanshore.in."))
        and (.ResourceRecords|length)==1
        and (.ResourceRecords[0].Value|endswith(".dkim.amazonses.com"))
      )
  ] | length) == 3
' "$WORK_DIR/records-after.json" >/dev/null
echo "SES_DKIM_RECORDS_VERIFIED=true"

echo "STATE_SERIAL_AFTER=$(jq -r '.serial' "$WORK_DIR/state-after.json")"
echo "SEANSHORE_DOMAIN_BOOTSTRAP_APPLY_VERIFIED=true"
