#!/usr/bin/env bash
# Guarded release path for the legacy domain seaandshore.in (Route 53 zone copy, redirect-only
# CloudFront distribution, certificate). Modeled on seanshore-domain-bootstrap.sh: plan is the
# default; apply-once applies exactly the saved plan the guard just checked.
set -euo pipefail
umask 077
export PATH="$HOME/bin:$PATH"
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
DOMAIN="seaandshore.in"
LEGACY_IP="216.10.253.21"
AWS_REGION="ap-south-1"
EDGE_REGION="us-east-1"
STATE_BUCKET="sea-n-shore-310356785722-ap-south-1-tfstate"
STATE_KEY="sea-n-shore/staging/terraform.tfstate"
APP_DIR="$PWD/infra/aws/app"
ACTION_FILE="scripts/aws/seaandshore-domain-action.txt"
FUNCTION_NAME="sea-n-shore-staging-legacy-domain-redirect"

[[ "${SEAANDSHORE_DOMAIN_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "SEAANDSHORE_DOMAIN_EXPECTED_SHA must be an exact commit SHA." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$SEAANDSHORE_DOMAIN_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- \
  infra/aws/app/seaandshore_domain.tf \
  infra/aws/app/edge.tf \
  infra/aws/app/cloudfront/legacy-domain-redirect.js.tftpl \
  scripts/aws/seaandshore-domain.sh \
  scripts/aws/seaandshore-domain-action.txt \
  scripts/aws/seaandshore-domain.test.mjs \
  .github/workflows/aws-seaandshore-domain.yml
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]

ACTION="$(tr -d '[:space:]' < "$ACTION_FILE")"
case "$ACTION" in plan|apply-once) ;; *) echo "Unsupported seaandshore domain action." >&2; exit 1 ;; esac

WORK_DIR="$(mktemp -d "$PWD/.seaandshore-domain.XXXXXXXX")"
trap 'rm -rf -- "$WORK_DIR"' EXIT

aws s3api get-object --bucket "$STATE_BUCKET" --key "$STATE_KEY" --region "$AWS_REGION" "$WORK_DIR/state.json" > "$WORK_DIR/object.json"
jq -e '.lineage == "197a6fae-9997-636e-e52b-c3ac6da85d90"' "$WORK_DIR/state.json" >/dev/null

ZONE_STATE_COUNT="$(jq '[.resources[]? | select(.mode=="managed" and .type=="aws_route53_zone" and .name=="seaandshore") | .instances[]?] | length' "$WORK_DIR/state.json")"
[[ "$ZONE_STATE_COUNT" == "0" || "$ZONE_STATE_COUNT" == "1" ]]
aws route53 list-hosted-zones-by-name --dns-name "$DOMAIN" --max-items 20 --output json > "$WORK_DIR/zones.json"
LIVE_ZONE_COUNT="$(jq --arg name "$DOMAIN." '[.HostedZones[]? | select(.Name==$name and .Config.PrivateZone==false)] | length' "$WORK_DIR/zones.json")"
if [[ "$ZONE_STATE_COUNT" == "0" ]]; then
  [[ "$LIVE_ZONE_COUNT" == "0" ]] || { echo "Untracked public Route53 zone already exists for $DOMAIN; refusing duplicate." >&2; exit 1; }
else
  [[ "$LIVE_ZONE_COUNT" == "1" ]] || { echo "Tracked Route53 zone does not match live inventory." >&2; exit 1; }
fi

# The stage switch is the Terraform variable default in seaandshore_domain.tf (repository-controlled).
REDIRECT_LIVE="$(python3 - "$APP_DIR/seaandshore_domain.tf" <<'PY'
import re, sys
text = open(sys.argv[1]).read()
match = re.search(r'variable "seaandshore_redirect_live" \{.*?default\s*=\s*(true|false)', text, re.S)
if not match: raise SystemExit('seaandshore_redirect_live default not found')
print(match.group(1))
PY
)"
echo "SEAANDSHORE_REDIRECT_LIVE=$REDIRECT_LIVE"

# Snapshot of the previous DNS host, taken 2026-09-29 by querying ns1.bhin-pp-wb5.webhostbox.net directly.
echo "LEGACY_DNS_SNAPSHOT_BEGIN"
LEGACY_NS_IP="$LEGACY_IP"
for query in "$DOMAIN A" "$DOMAIN MX" "$DOMAIN TXT" "www.$DOMAIN CNAME" "ftp.$DOMAIN CNAME" "mail.$DOMAIN A" "webmail.$DOMAIN A" "ns1.$DOMAIN A" "ns2.$DOMAIN A" "_acme-challenge.$DOMAIN TXT"; do
  set -- $query
  ANSWER="$(dig +short +time=5 +tries=2 "$2" "$1" "@$LEGACY_NS_IP" 2>/dev/null | sort | tr '\n' '|' || true)"
  echo "LEGACY_DNS=$1|$2|$ANSWER"
done
echo "LEGACY_DNS_SNAPSHOT_END"

python3 - "$WORK_DIR/state.json" "$WORK_DIR/variables.json" <<'PY'
import json, sys
with open(sys.argv[1]) as f: state=json.load(f)
resources=state['resources']
def attrs(kind, name):
    matches=[r for r in resources if r.get('mode')=='managed' and r.get('type')==kind and r.get('name')==name]
    assert len(matches)==1, f'Expected exactly one {kind}.{name}'
    instances=matches[0].get('instances') or []
    assert len(instances)==1
    return instances[0]['attributes']
task=attrs('aws_ecs_task_definition','web')
containers=json.loads(task['container_definitions'])
web=next(c for c in containers if c['name']=='web')
site=next(e['value'] for e in web['environment'] if e['name']=='NEXT_PUBLIC_SITE_URL')
image=web['image']
values={'image_tag': image.rsplit(':',1)[1], 'site_url': site, 'aurora_engine_version': attrs('aws_rds_cluster','aurora')['engine_version']}
with open(sys.argv[2],'w') as f: json.dump(values,f)
PY

terraform -chdir="$APP_DIR" init -input=false -no-color \
  -backend-config="bucket=$STATE_BUCKET" -backend-config="key=$STATE_KEY" \
  -backend-config="region=$AWS_REGION" -backend-config=use_lockfile=true > "$WORK_DIR/init.log"

TARGETS=(
  aws_route53_zone.seaandshore
  aws_route53_record.seaandshore_mx
  aws_route53_record.seaandshore_txt
  aws_route53_record.seaandshore_mail_a
  aws_route53_record.seaandshore_webmail_a
  aws_route53_record.seaandshore_ftp_cname
  aws_route53_record.seaandshore_ns1_a
  aws_route53_record.seaandshore_ns2_a
  aws_route53_record.seaandshore_acme_challenge_txt
  aws_route53_record.seaandshore_apex_a
  aws_route53_record.seaandshore_www
  aws_route53_record.seaandshore_apex_aaaa
  aws_route53_record.seaandshore_www_aaaa
  aws_acm_certificate.seaandshore_edge
  aws_route53_record.seaandshore_edge_validation
  aws_cloudfront_function.legacy_domain_redirect
  aws_cloudfront_distribution.seaandshore_redirect
)
PLAN_ARGS=()
for target in "${TARGETS[@]}"; do PLAN_ARGS+=("-target=$target"); done

terraform -chdir="$APP_DIR" plan -input=false -no-color -lock-timeout=60s \
  "${PLAN_ARGS[@]}" -var-file="$WORK_DIR/variables.json" \
  -out="$WORK_DIR/seaandshore.tfplan" > "$WORK_DIR/plan.log"
terraform -chdir="$APP_DIR" show -json "$WORK_DIR/seaandshore.tfplan" > "$WORK_DIR/plan.json"

python3 - "$WORK_DIR/plan.json" "$REDIRECT_LIVE" "$APP_DIR/cloudfront/legacy-domain-redirect.js.tftpl" <<'PY'
import json, sys
plan_path, redirect_live, template_path = sys.argv[1:]
live = redirect_live == 'true'
with open(plan_path) as f: plan=json.load(f)
LEGACY_IP='216.10.253.21'; TTL=21600; CF_ZONE='Z2FDTNDATAQYW2'
expected_records={
  'aws_route53_record.seaandshore_mx': ('seaandshore.in','MX',['1 smtp.google.com.'] ,TTL),
  'aws_route53_record.seaandshore_txt': ('seaandshore.in','TXT',['v=spf1 include:_spf.google.com ~all','google-site-verification=bg3lvB1nw4ODMIG7ExwNWTI5t8zW8AkR0DexUVLD1H4'],TTL),
  'aws_route53_record.seaandshore_mail_a': ('mail.seaandshore.in','A',[LEGACY_IP],TTL),
  'aws_route53_record.seaandshore_webmail_a': ('webmail.seaandshore.in','A',[LEGACY_IP],TTL),
  'aws_route53_record.seaandshore_ftp_cname': ('ftp.seaandshore.in','CNAME',['seaandshore.in'],TTL),
  'aws_route53_record.seaandshore_ns1_a': ('ns1.seaandshore.in','A',[LEGACY_IP],TTL),
  'aws_route53_record.seaandshore_ns2_a': ('ns2.seaandshore.in','A',[LEGACY_IP],TTL),
  'aws_route53_record.seaandshore_acme_challenge_txt': ('_acme-challenge.seaandshore.in','TXT',['coLRxfhIhhYaWhwZE_BBLN8nw1jEVxQpbXTphW4vU1A'],TTL),
}
template=open(template_path).read().replace('${canonical_host}','seanshore.in')
def alias_ok(after):
    aliases=after.get('alias') or []
    return len(aliases)==1 and aliases[0].get('zone_id')==CF_ZONE and aliases[0].get('evaluate_target_health') is False and not after.get('records')
changes=[r for r in plan.get('resource_changes',[]) if r.get('mode')!='data' and r.get('change',{}).get('actions')!=['no-op']]
class Refused(SystemExit):
    pass
def check(condition, address, after, detail):
    if not condition:
        print(f'SEAANDSHORE_DOMAIN_GUARD_REFUSED={address}|{detail}', file=sys.stderr)
        print(json.dumps(after, sort_keys=True)[:4000], file=sys.stderr)
        raise Refused(1)
for r in changes:
    address=r['address']; actions=r['change']['actions']; after=r['change'].get('after') or {}; before=r['change'].get('before') or {}
    if address=='aws_route53_zone.seaandshore':
        check(actions==['create'] and after.get('name')=='seaandshore.in', address, after, address)
    elif address in expected_records:
        name,rtype,records,ttl=expected_records[address]
        check(actions==['create'], address, after, f'{address} must be create, got {actions}')
        check(after.get('name','').rstrip('.')==name and after.get('type')==rtype and sorted(after.get('records') or [])==sorted(records) and after.get('ttl')==ttl, address, after, f'{address} differs from the legacy snapshot: {after}')
    elif address=='aws_route53_record.seaandshore_apex_a':
        check(after.get('name','').rstrip('.')=='seaandshore.in' and after.get('type')=='A', address, after, address)
        if live:
            check(actions==['update'] and before.get('records')==[LEGACY_IP] and alias_ok(after), address, after, f'{address} stage B must turn the legacy A into the redirect alias: {actions}')
        else:
            check(actions==['create'] and after.get('records')==[LEGACY_IP] and after.get('ttl')==TTL, address, after, f'{address} stage A must copy the legacy A record')
    elif address=='aws_route53_record.seaandshore_www':
        check(after.get('name','').rstrip('.')=='www.seaandshore.in', address, after, address)
        if live:
            check(actions in (['update'],['delete','create'],['create','delete']) and before.get('type')=='CNAME' and before.get('records')==['seaandshore.in'] and before.get('ttl')==TTL and after.get('type')=='A' and alias_ok(after), address, after, f'{address} stage B must replace the CNAME with the redirect alias: {actions}')
        else:
            check(actions==['create'] and after.get('type')=='CNAME' and after.get('records')==['seaandshore.in'] and after.get('ttl')==TTL, address, after, address)
    elif address in ('aws_route53_record.seaandshore_apex_aaaa[0]','aws_route53_record.seaandshore_www_aaaa[0]'):
        check(live and actions==['create'] and after.get('type')=='AAAA' and alias_ok(after), address, after, address)
    elif address=='aws_acm_certificate.seaandshore_edge':
        names=set(after.get('subject_alternative_names') or []) | {after.get('domain_name')}
        check(actions==['create'], address, after, f'actions {actions}')
        check(after.get('domain_name')=='seaandshore.in' and names=={'seaandshore.in','www.seaandshore.in'}, address, after, 'certificate names')
        check(after.get('validation_method')=='DNS', address, after, 'validation method')
    elif address.startswith('aws_route53_record.seaandshore_edge_validation['):
        check(actions==['create'], address, after, address)
    elif address=='aws_cloudfront_function.legacy_domain_redirect':
        check(actions in (['create'],['update']) and after.get('name')=='sea-n-shore-staging-legacy-domain-redirect' and after.get('runtime')=='cloudfront-js-2.0' and after.get('publish') is True and after.get('code')==template, address, after, address)
    elif address=='aws_cloudfront_distribution.seaandshore_redirect':
        check(actions in (['create'],['update']), address, after, f'{address} {actions}')
        check(after.get('enabled') is True and after.get('web_acl_id') in (None,''), address, after, address)
        origins=after.get('origin') or []
        check(len(origins)==1 and origins[0].get('domain_name')=='seanshore.in' and origins[0]['custom_origin_config'][0].get('origin_protocol_policy')=='https-only', address, after, address)
        behavior=(after.get('default_cache_behavior') or [{}])[0]
        assoc=behavior.get('function_association') or []
        check(len(assoc)==1 and assoc[0].get('event_type')=='viewer-request', address, after, address)
        check(not behavior.get('lambda_function_association'), address, after, address)
        cert=(after.get('viewer_certificate') or [{}])[0]
        if live:
            check(sorted(after.get('aliases') or [])==['seaandshore.in','www.seaandshore.in'] and cert.get('ssl_support_method')=='sni-only' and cert.get('minimum_protocol_version')=='TLSv1.2_2021' and (cert.get('acm_certificate_arn') or '').startswith('arn:aws:acm:us-east-1:310356785722:certificate/'), address, after, address)
        else:
            check(not after.get('aliases') and cert.get('cloudfront_default_certificate') is True, address, after, address)
    else:
        raise SystemExit(f'unexpected seaandshore change: {address} {actions}')
    print(f"SEAANDSHORE_DOMAIN_CHANGE={address}|{','.join(actions)}")
print('SEAANDSHORE_DOMAIN_CHANGE_COUNT='+str(len(changes)))
PY

echo "STATE_SERIAL_BEFORE=$(jq -r '.serial' "$WORK_DIR/state.json")"
echo "SEAANDSHORE_DOMAIN_ACTION=$ACTION"
echo "SEAANDSHORE_DOMAIN_PLAN_VERIFIED=true"
echo "PLAN_SHA256=$(sha256sum "$WORK_DIR/seaandshore.tfplan" | cut -d' ' -f1)"

if [[ "$ACTION" == "plan" ]]; then
  echo "SEAANDSHORE_DOMAIN_PLAN_ONLY_NO_APPLY"
  exit 0
fi

[[ "$(git ls-remote origin refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$SEAANDSHORE_DOMAIN_EXPECTED_SHA" ]]
[[ "$(aws s3api get-bucket-versioning --bucket "$STATE_BUCKET" --query Status --output text)" == Enabled ]]
STATE_BACKUP_VERSION="$(jq -r '.VersionId // empty' "$WORK_DIR/object.json")"
[[ -n "$STATE_BACKUP_VERSION" ]]
echo "STATE_BACKUP_VERSION=$STATE_BACKUP_VERSION"

terraform -chdir="$APP_DIR" apply -input=false -no-color "$WORK_DIR/seaandshore.tfplan" > "$WORK_DIR/apply.log"
terraform -chdir="$APP_DIR" state pull > "$WORK_DIR/state-after.json"

ZONE_ID="$(jq -r '[.resources[] | select(.mode=="managed" and .type=="aws_route53_zone" and .name=="seaandshore") | .instances[0].attributes.zone_id][0] // empty' "$WORK_DIR/state-after.json")"
[[ "$ZONE_ID" == Z* ]]
aws route53 get-hosted-zone --id "$ZONE_ID" --output json > "$WORK_DIR/zone-after.json"
jq -e --arg domain "$DOMAIN." '.HostedZone.Name==$domain and .HostedZone.Config.PrivateZone==false and (.DelegationSet.NameServers|length)==4' "$WORK_DIR/zone-after.json" >/dev/null
jq -r '.DelegationSet.NameServers[] | "ROUTE53_NAME_SERVER=" + .' "$WORK_DIR/zone-after.json"
ROUTE53_NS="$(jq -r '.DelegationSet.NameServers[0]' "$WORK_DIR/zone-after.json")"

# The new zone must answer the mail and verification records exactly like the old host.
echo "DNS_PARITY_BEGIN"
PARITY_OK=true
for query in "$DOMAIN MX" "$DOMAIN TXT" "mail.$DOMAIN A" "webmail.$DOMAIN A" "ftp.$DOMAIN CNAME" "_acme-challenge.$DOMAIN TXT"; do
  set -- $query
  OLD="$(dig +short +time=5 +tries=2 "$2" "$1" "@$LEGACY_IP" 2>/dev/null | sort | tr '\n' '|' || true)"
  NEW="$(dig +short +time=5 +tries=2 "$2" "$1" "@$ROUTE53_NS" 2>/dev/null | sort | tr '\n' '|' || true)"
  echo "DNS_PARITY=$1|$2|old=$OLD|new=$NEW"
  [[ -n "$NEW" && "$OLD" == "$NEW" ]] || PARITY_OK=false
done
echo "DNS_PARITY_END"
[[ "$PARITY_OK" == true ]] || { echo "New zone does not answer identically to the old DNS host for mail/verification records." >&2; exit 1; }
echo "DNS_PARITY_VERIFIED=true"

CERT_ARN="$(jq -r '[.resources[] | select(.mode=="managed" and .type=="aws_acm_certificate" and .name=="seaandshore_edge") | .instances[0].attributes.arn][0] // empty' "$WORK_DIR/state-after.json")"
[[ "$CERT_ARN" == arn:aws:acm:us-east-1:310356785722:certificate/* ]]
aws acm describe-certificate --region "$EDGE_REGION" --certificate-arn "$CERT_ARN" --output json > "$WORK_DIR/cert-after.json"
echo "ACM_CERTIFICATE_ARN=$CERT_ARN"
echo "ACM_CERTIFICATE_STATUS=$(jq -r '.Certificate.Status' "$WORK_DIR/cert-after.json")"
jq -r '.Certificate.DomainValidationOptions[] | select(.ResourceRecord != null) | "ACM_VALIDATION_RECORD=" + .ResourceRecord.Type + "|" + .ResourceRecord.Name + "|" + .ResourceRecord.Value' "$WORK_DIR/cert-after.json" | sort -u

CF_ID="$(jq -r '[.resources[] | select(.mode=="managed" and .type=="aws_cloudfront_distribution" and .name=="seaandshore_redirect") | .instances[0].attributes.id][0] // empty' "$WORK_DIR/state-after.json")"
[[ -n "$CF_ID" ]]
aws cloudfront get-distribution --id "$CF_ID" --output json > "$WORK_DIR/redirect-live.json"
REDIRECT_DOMAIN="$(jq -r '.Distribution.DomainName' "$WORK_DIR/redirect-live.json")"
echo "SEAANDSHORE_REDIRECT_DISTRIBUTION=$CF_ID|$REDIRECT_DOMAIN"
jq -e '.Distribution.DistributionConfig | .Enabled == true and .DefaultCacheBehavior.FunctionAssociations.Quantity == 1' "$WORK_DIR/redirect-live.json" >/dev/null
for attempt in $(seq 1 60); do
  [[ "$(jq -r '.Distribution.Status' "$WORK_DIR/redirect-live.json")" == "Deployed" ]] && break
  sleep 20
  aws cloudfront get-distribution --id "$CF_ID" --output json > "$WORK_DIR/redirect-live.json"
done
jq -e '.Distribution.Status == "Deployed"' "$WORK_DIR/redirect-live.json" >/dev/null

# The redirect logic is verified on the distribution's own hostname in both stages.
for probe in "/|https://seanshore.in/" "/FAQs/index.html|https://seanshore.in/help" "/about.php?x=1|https://seanshore.in/about?x=1"; do
  PATH_PART="${probe%%|*}"; EXPECTED="${probe#*|}"
  RESULT="$(curl --silent --show-error --max-time 45 -o /dev/null -w '%{http_code} %{redirect_url}' "https://$REDIRECT_DOMAIN$PATH_PART")"
  echo "REDIRECT_PROBE=$PATH_PART|$RESULT"
  [[ "$RESULT" == "301 $EXPECTED" ]]
done

if [[ "$REDIRECT_LIVE" == "true" ]]; then
  jq -e '.Certificate.Status == "ISSUED"' "$WORK_DIR/cert-after.json" >/dev/null
  jq -e --arg cert "$CERT_ARN" '.Distribution.DistributionConfig | (.Aliases.Items | sort) == ["seaandshore.in","www.seaandshore.in"] and .ViewerCertificate.ACMCertificateArn == $cert' "$WORK_DIR/redirect-live.json" >/dev/null
  aws route53 list-resource-record-sets --hosted-zone-id "$ZONE_ID" --output json > "$WORK_DIR/records-after.json"
  jq -e --arg target "$REDIRECT_DOMAIN." '
    [.ResourceRecordSets[] | select((.Name=="seaandshore.in." or .Name=="www.seaandshore.in.") and (.Type=="A" or .Type=="AAAA" or .Type=="CNAME"))] as $site
    | ($site | length) == 4 and all($site[]; .Type != "CNAME" and .AliasTarget.DNSName == $target)
    and any(.ResourceRecordSets[]; .Name=="seaandshore.in." and .Type=="MX")
    and any(.ResourceRecordSets[]; .Name=="seaandshore.in." and .Type=="TXT")
  ' "$WORK_DIR/records-after.json" >/dev/null
  EDGE_IP="$(dig +short A "$REDIRECT_DOMAIN" | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' | head -n 1)"
  for host in seaandshore.in www.seaandshore.in; do
    for scheme in http https; do
      PORT=443; [[ "$scheme" == http ]] && PORT=80
      RESULT="$(curl --silent --show-error --max-time 45 --resolve "$host:$PORT:$EDGE_IP" -o /dev/null -w '%{http_code} %{redirect_url}' "$scheme://$host/FAQs/index.html?q=1")"
      echo "LEGACY_HOST_REDIRECT=$scheme://$host|$RESULT"
      [[ "$RESULT" == "301 https://seanshore.in/help?q=1" ]]
    done
  done
  echo "SEAANDSHORE_REDIRECT_LIVE_VERIFIED=true"
else
  echo "SEAANDSHORE_STAGE_A_COMPLETE=set the registrar name servers to the ROUTE53_NAME_SERVER values above"
fi

echo "STATE_SERIAL_AFTER=$(jq -r '.serial' "$WORK_DIR/state-after.json")"
echo "SEAANDSHORE_DOMAIN_APPLY_VERIFIED=true"
