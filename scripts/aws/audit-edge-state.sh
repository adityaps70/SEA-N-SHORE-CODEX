#!/usr/bin/env bash
set -euo pipefail

EXPECTED_SHA="${EDGE_AUDIT_EXPECTED_SHA:-}"
[[ "$EXPECTED_SHA" =~ ^[0-9a-f]{40}$ ]] || {
  echo "EDGE_AUDIT_EXPECTED_SHA must be an exact commit SHA." >&2
  exit 1
}
CURRENT_ROOT="$(git rev-parse --show-toplevel)"
[[ "$PWD" == "$CURRENT_ROOT" && "$(git rev-parse HEAD)" == "$EXPECTED_SHA" ]] || {
  echo "Audit checkout does not match the expected root and commit." >&2
  exit 1
}
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]] || {
  echo "Unexpected audit repository." >&2
  exit 1
}
git diff --quiet HEAD -- scripts/aws/audit-edge-state.sh infra/aws/app || {
  echo "Audit code/config differs from the pinned commit." >&2
  exit 1
}

export PATH="$HOME/bin:$PATH"

for command_name in aws jq grep; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "$command_name is required." >&2
    exit 1
  }
done

APP_DIR="infra/aws/app"
STATE_BUCKET="sea-n-shore-310356785722-ap-south-1-tfstate"
STATE_KEY="sea-n-shore/staging/terraform.tfstate"
STATE_REGION="ap-south-1"
EXPECTED_ACCOUNT_ID="310356785722"
umask 077
EVIDENCE_DIR="$(mktemp -d)"
STATE_JSON="$EVIDENCE_DIR/state.json"
EDGE_JSON="$EVIDENCE_DIR/edge.json"
trap 'rm -rf -- "$EVIDENCE_DIR"' EXIT; trap 'exit 129' HUP; trap 'exit 130' INT; trap 'exit 143' TERM

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
[[ "$ACCOUNT_ID" == "$EXPECTED_ACCOUNT_ID" ]] || {
  echo "Refusing audit in unexpected AWS account $ACCOUNT_ID." >&2
  exit 1
}

echo "=== EDGE STATE AUDIT COMMIT ==="
git rev-parse --verify HEAD

echo
echo "=== TERRAFORM REMOTE BACKEND READ ==="
aws s3api get-object \
  --bucket "$STATE_BUCKET" \
  --key "$STATE_KEY" \
  --region "$STATE_REGION" \
  "$STATE_JSON" > "$EVIDENCE_DIR/state-object.json"
jq -e '.version == 4 and (.resources | type == "array") and (.lineage | type == "string")' "$STATE_JSON" >/dev/null
echo "STATE_OBJECT_VERSION=$(jq -r '.VersionId // "unversioned"' "$EVIDENCE_DIR/state-object.json")"

echo "STATE_SERIAL=$(jq -r '.serial' "$STATE_JSON")"
echo "STATE_LINEAGE=$(jq -r '.lineage' "$STATE_JSON")"

jq '[
  .resources[]?
  | select(.mode == "managed")
  | select(.type | test("^aws_(cloudfront_|wafv2_)"))
  | {
      address: (.type + "." + .name),
      type,
      name,
      provider,
      instances: [
        .instances[]?
        | {
            id: (.attributes.id // null),
            arn: (.attributes.arn // null),
            name: (.attributes.name // null),
            domain_name: (.attributes.domain_name // null),
            scope: (.attributes.scope // null)
          }
      ]
    }
]' "$STATE_JSON" > "$EDGE_JSON"

EDGE_RESOURCE_COUNT="$(jq 'length' "$EDGE_JSON")"
US_EAST_1_STATE_REFERENCES="$(jq '[.[] | select(.provider | contains(".us_east_1"))] | length' "$EDGE_JSON")"
if grep -RqsE 'alias[[:space:]]*=[[:space:]]*"us_east_1"' "$APP_DIR"/*.tf; then
  CONFIG_HAS_US_EAST_1_ALIAS="true"
else
  CONFIG_HAS_US_EAST_1_ALIAS="false"
fi

if [[ -f "$APP_DIR/edge.tf" ]]; then
  CONFIG_HAS_EDGE_TF="true"
else
  CONFIG_HAS_EDGE_TF="false"
fi

echo
echo "=== TERRAFORM EDGE STATE ==="
echo "EDGE_RESOURCE_COUNT=$EDGE_RESOURCE_COUNT"
echo "US_EAST_1_STATE_REFERENCES=$US_EAST_1_STATE_REFERENCES"
echo "CONFIG_HAS_US_EAST_1_ALIAS=$CONFIG_HAS_US_EAST_1_ALIAS"
echo "CONFIG_HAS_EDGE_TF=$CONFIG_HAS_EDGE_TF"
jq . "$EDGE_JSON"

echo
echo "=== TERRAFORM STATE PROVIDER REFERENCES ==="
jq '[.resources[]?.provider] | unique' "$STATE_JSON"

if [[ "$US_EAST_1_STATE_REFERENCES" -gt 0 && "$CONFIG_HAS_US_EAST_1_ALIAS" == "false" ]]; then
  echo "ORPHANED_PROVIDER_ALIAS_STATE=true"
else
  echo "ORPHANED_PROVIDER_ALIAS_STATE=false"
fi

if [[ "$EDGE_RESOURCE_COUNT" -gt 0 && "$CONFIG_HAS_EDGE_TF" == "false" ]]; then
  echo "EDGE_RESOURCES_PRESENT_WITHOUT_CONFIG=true"
else
  echo "EDGE_RESOURCES_PRESENT_WITHOUT_CONFIG=false"
fi

echo
echo "=== LIVE EDGE INVENTORY ==="
aws cloudfront list-distributions --no-paginate --output json > "$EVIDENCE_DIR/distributions.json"
[[ -s "$EVIDENCE_DIR/distributions.json" ]] || { echo "Empty CloudFront inventory response." >&2; exit 1; }
jq -e '.DistributionList.IsTruncated == false and (.DistributionList.Quantity | type == "number")' "$EVIDENCE_DIR/distributions.json" >/dev/null
echo "LIVE_CLOUDFRONT_COUNT=$(jq -r '.DistributionList.Quantity' "$EVIDENCE_DIR/distributions.json")"
jq '[.DistributionList.Items[]? | {Id, DomainName, Status, Enabled, WebACLId, Aliases, Origins: [.Origins.Items[]? | {Id, DomainName}]}]' "$EVIDENCE_DIR/distributions.json"
aws wafv2 list-web-acls --scope CLOUDFRONT --region us-east-1 --output json | jq '.WebACLs'
# Round P3 (B7): read-only, the signed-media public key, key group and origin access control must
# exist under the same id and name as in state. Uses the loop's type, state_name, id and live_name.
check_media_signing_resource() {
  local read_command name_path id_path
  case "$type" in
    aws_cloudfront_public_key) read_command=(aws cloudfront get-public-key --id "$id"); name_path='.PublicKey.PublicKeyConfig.Name'; id_path='.PublicKey.Id' ;;
    aws_cloudfront_key_group) read_command=(aws cloudfront get-key-group --id "$id"); name_path='.KeyGroup.KeyGroupConfig.Name'; id_path='.KeyGroup.Id' ;;
    *) read_command=(aws cloudfront get-origin-access-control --id "$id"); name_path='.OriginAccessControl.OriginAccessControlConfig.Name'; id_path='.OriginAccessControl.Id' ;;
  esac
  if [[ -z "$live_name" || "$live_name" == "null" ]]; then
    LIVE_CHECK_FAILED=1
    echo "$type.$state_name LIVE_QUERY_SKIPPED id=$id reason=missing-name-in-state"
    return
  fi
  if "${read_command[@]}" --output json > "$EVIDENCE_DIR/edge-media-resource.json" 2>"$EVIDENCE_DIR/edge-live-error.txt"; then
    if jq -e --arg id "$id" --arg name "$live_name" "($id_path) == \$id and ($name_path) == \$name" "$EVIDENCE_DIR/edge-media-resource.json" >/dev/null; then
      echo "$type.$state_name LIVE=true id=$id name=$live_name"
    else
      LIVE_CHECK_FAILED=1
      echo "$type.$state_name LIVE_QUERY_FAILED id=$id name=$live_name reason=state-id-name-mismatch"
    fi
  else
    LIVE_CHECK_FAILED=1
    ERROR_TEXT="$(tr '\n' ' ' < "$EVIDENCE_DIR/edge-live-error.txt" | sed -E 's/[[:space:]]+/ /g' | cut -c1-300)"
    echo "$type.$state_name LIVE_QUERY_FAILED id=$id name=$live_name error=$ERROR_TEXT"
  fi
}

echo "=== LIVE EDGE RESOURCE CHECK ==="
LIVE_CHECK_FAILED=0
while IFS=$'\t' read -r type state_name id live_name; do
  [[ -n "$type" && -n "$id" && "$id" != "null" ]] || continue

  case "$type" in
    aws_cloudfront_distribution)
      if aws cloudfront get-distribution --id "$id" --output json > "$EVIDENCE_DIR/edge-cloudfront.json" 2>"$EVIDENCE_DIR/edge-live-error.txt"; then
        jq -r --arg address "aws_cloudfront_distribution.$state_name" '
          "\($address) LIVE=true id=\(.Distribution.Id) status=\(.Distribution.Status) enabled=\(.Distribution.DistributionConfig.Enabled) domain=\(.Distribution.DomainName) web_acl_id=\(.Distribution.DistributionConfig.WebACLId // "")"
        ' "$EVIDENCE_DIR/edge-cloudfront.json"
      else
        LIVE_CHECK_FAILED=1
        ERROR_TEXT="$(tr '\n' ' ' < "$EVIDENCE_DIR/edge-live-error.txt" | sed -E 's/[[:space:]]+/ /g' | cut -c1-300)"
        echo "aws_cloudfront_distribution.$state_name LIVE_QUERY_FAILED id=$id error=$ERROR_TEXT"
      fi
      ;;
    aws_cloudfront_function)
      case "$state_name:$live_name" in
        canonical_host_redirect:sea-n-shore-staging-canonical-host-redirect|legacy_domain_redirect:sea-n-shore-staging-legacy-domain-redirect) ;;
        # Domain move: the console-made redirect function, imported unchanged under its console name (domain-move.tf).
        console_redirect:seanshore-redirect-domains) ;;
        *)
          LIVE_CHECK_FAILED=1
          echo "aws_cloudfront_function.$state_name LIVE_QUERY_REFUSED id=$id name=$live_name reason=unexpected-function-name"
          continue
          ;;
      esac
      if [[ "$id" != "$live_name" ]]; then
        LIVE_CHECK_FAILED=1
        echo "aws_cloudfront_function.$state_name LIVE_QUERY_REFUSED id=$id name=$live_name reason=state-id-name-mismatch"
        continue
      fi
      if aws cloudfront describe-function \
        --name "$live_name" \
        --stage LIVE \
        --output json > "$EVIDENCE_DIR/edge-function.json" 2>"$EVIDENCE_DIR/edge-live-error.txt"; then
        if jq -e --arg expected "$live_name" '.FunctionSummary.Name == $expected and .FunctionSummary.FunctionConfig.Runtime == "cloudfront-js-2.0"' "$EVIDENCE_DIR/edge-function.json" >/dev/null; then
          echo "aws_cloudfront_function.$state_name LIVE=true id=$id name=$live_name"
        else
          LIVE_CHECK_FAILED=1
          echo "aws_cloudfront_function.$state_name LIVE_QUERY_FAILED id=$id name=$live_name reason=unexpected-live-function-shape"
        fi
      else
        LIVE_CHECK_FAILED=1
        ERROR_TEXT="$(tr '\n' ' ' < "$EVIDENCE_DIR/edge-live-error.txt" | sed -E 's/[[:space:]]+/ /g' | cut -c1-300)"
        echo "aws_cloudfront_function.$state_name LIVE_QUERY_FAILED id=$id name=$live_name error=$ERROR_TEXT"
      fi
      ;;
    aws_cloudfront_cache_policy)
      # Read-only: the managed cache policy must exist under the same id and name as in state.
      if [[ -z "$live_name" || "$live_name" == "null" ]]; then
        LIVE_CHECK_FAILED=1
        echo "aws_cloudfront_cache_policy.$state_name LIVE_QUERY_SKIPPED id=$id reason=missing-name-in-state"
        continue
      fi
      if aws cloudfront get-cache-policy --id "$id" --output json > "$EVIDENCE_DIR/edge-cache-policy.json" 2>"$EVIDENCE_DIR/edge-live-error.txt"; then
        if jq -e --arg id "$id" --arg name "$live_name" '.CachePolicy.Id == $id and .CachePolicy.CachePolicyConfig.Name == $name' "$EVIDENCE_DIR/edge-cache-policy.json" >/dev/null; then
          jq -r --arg address "aws_cloudfront_cache_policy.$state_name" '
            "\($address) LIVE=true id=\(.CachePolicy.Id) name=\(.CachePolicy.CachePolicyConfig.Name) default_ttl=\(.CachePolicy.CachePolicyConfig.DefaultTTL)"
          ' "$EVIDENCE_DIR/edge-cache-policy.json"
        else
          LIVE_CHECK_FAILED=1
          echo "aws_cloudfront_cache_policy.$state_name LIVE_QUERY_FAILED id=$id name=$live_name reason=unexpected-live-cache-policy"
        fi
      else
        LIVE_CHECK_FAILED=1
        ERROR_TEXT="$(tr '\n' ' ' < "$EVIDENCE_DIR/edge-live-error.txt" | sed -E 's/[[:space:]]+/ /g' | cut -c1-300)"
        echo "aws_cloudfront_cache_policy.$state_name LIVE_QUERY_FAILED id=$id name=$live_name error=$ERROR_TEXT"
      fi
      ;;
    aws_cloudfront_public_key)
      check_media_signing_resource
      ;;
    aws_cloudfront_key_group)
      check_media_signing_resource
      ;;
    aws_cloudfront_origin_access_control)
      check_media_signing_resource
      ;;
    aws_wafv2_web_acl)
      if [[ -z "$live_name" || "$live_name" == "null" ]]; then
        LIVE_CHECK_FAILED=1
        echo "aws_wafv2_web_acl.$state_name LIVE_QUERY_SKIPPED id=$id reason=missing-name-in-state"
        continue
      fi
      if aws wafv2 get-web-acl \
        --scope CLOUDFRONT \
        --region us-east-1 \
        --name "$live_name" \
        --id "$id" \
        --output json > "$EVIDENCE_DIR/edge-waf.json" 2>"$EVIDENCE_DIR/edge-live-error.txt"; then
        jq -r --arg address "aws_wafv2_web_acl.$state_name" '
          "\($address) LIVE=true id=\(.WebACL.Id) name=\(.WebACL.Name) arn=\(.WebACL.ARN)"
        ' "$EVIDENCE_DIR/edge-waf.json"
        jq '.WebACL | {Name, DefaultAction, Rules, VisibilityConfig}' "$EVIDENCE_DIR/edge-waf.json"
      else
        LIVE_CHECK_FAILED=1
        ERROR_TEXT="$(tr '\n' ' ' < "$EVIDENCE_DIR/edge-live-error.txt" | sed -E 's/[[:space:]]+/ /g' | cut -c1-300)"
        echo "aws_wafv2_web_acl.$state_name LIVE_QUERY_FAILED id=$id name=$live_name error=$ERROR_TEXT"
      fi
      ;;
    *)
      LIVE_CHECK_FAILED=1
      echo "$type.$state_name LIVE_QUERY_SKIPPED id=$id reason=unsupported-edge-type"
      ;;
  esac
done < <(jq -r '.[] | . as $resource | .instances[]? | [$resource.type, $resource.name, (.id // ""), (.name // "")] | @tsv' "$EDGE_JSON")

echo
[[ "$LIVE_CHECK_FAILED" == 0 ]] || { echo "Edge audit incomplete: live checks failed." >&2; exit 1; }
echo "=== ORIGIN HTTPS READINESS (READ ONLY) ==="
aws elbv2 describe-load-balancers --names sea-n-shore-staging-alb --region "$STATE_REGION" --output json > "$EVIDENCE_DIR/alb.json"
jq -e '.LoadBalancers | length == 1' "$EVIDENCE_DIR/alb.json" >/dev/null
jq '.LoadBalancers[] | {LoadBalancerArn,DNSName,State,SecurityGroups}' "$EVIDENCE_DIR/alb.json"
ALB_ARN="$(jq -r '.LoadBalancers[0].LoadBalancerArn' "$EVIDENCE_DIR/alb.json")"
aws elbv2 describe-listeners --load-balancer-arn "$ALB_ARN" --region "$STATE_REGION" --output json | jq '[.Listeners[] | {ListenerArn,Port,Protocol,SslPolicy,Certificates,DefaultActions}]'
while IFS= read -r group_id; do
  aws ec2 describe-security-groups --group-ids "$group_id" --region "$STATE_REGION" --output json | jq '[.SecurityGroups[] | {GroupId,IpPermissions,IpPermissionsEgress}]'
done < <(jq -r '.LoadBalancers[0].SecurityGroups[]' "$EVIDENCE_DIR/alb.json")
# Include all certificate statuses and common key types, including pending DNS validation.
aws acm list-certificates --region "$STATE_REGION" --includes keyTypes=RSA_1024,RSA_2048,RSA_3072,RSA_4096,EC_prime256v1,EC_secp384r1,EC_secp521r1 --output json > "$EVIDENCE_DIR/certificates.json"
while IFS= read -r certificate_arn; do
  aws acm describe-certificate --certificate-arn "$certificate_arn" --region "$STATE_REGION" --output json | jq '.Certificate | {CertificateArn,DomainName,SubjectAlternativeNames,Status,NotAfter,InUseBy,DomainValidationOptions}'
done < <(jq -r '.CertificateSummaryList[].CertificateArn' "$EVIDENCE_DIR/certificates.json")
echo "ACM_CERTIFICATE_COUNT=$(jq '.CertificateSummaryList | length' "$EVIDENCE_DIR/certificates.json")"
aws route53 list-hosted-zones --output json | jq '[.HostedZones[] | {Id,Name,Config}]'
# Header names only: CloudFront's X-Origin-Verify value is the ALB origin secret (Round 14, 1.4).
aws cloudfront get-distribution --id EF1K45UVP11XZ --output json | jq '.Distribution | {Id,Status,Origins:[.DistributionConfig.Origins.Items[]? | {Id,DomainName,CustomOriginConfig,CustomHeaderNames:[.CustomHeaders.Items[]?.HeaderName]}],Aliases:.DistributionConfig.Aliases}'
# Only resource identities/protocol fields from state; never dump raw state or secrets.
jq '[.resources[] | select(.mode == "managed" and (.type | test("^aws_(lb_listener|acm_certificate|route53_record)$"))) | {type,name,instances:[.instances[] | {id:.attributes.id,port:.attributes.port,protocol:.attributes.protocol,certificate_arn:.attributes.certificate_arn}]}]' "$STATE_JSON"
echo "ORIGIN HTTPS READINESS INVENTORY COMPLETE"

echo "=== BOOTSTRAP TERRAFORM CAPACITY ==="
df -h /tmp "$HOME"
for provider_root in "$HOME/SEA-N-SHORE-CODEX" "$HOME/.terraform.d"; do
  if [[ -d "$provider_root" ]]; then
    find "$provider_root" -maxdepth 12 -type f -name 'terraform-provider-aws*' -printf '%p %s bytes\n'
  fi
done
echo "EDGE TERRAFORM STATE AUDIT PASSED (READ ONLY)"
