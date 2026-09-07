#!/usr/bin/env bash
set -euo pipefail

EXPECTED_WORKTREE="/home/ssm-user/SEA-N-SHORE-CODEX/.worktrees/aws-native-phase-0-1"
CURRENT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"

[[ "$CURRENT_ROOT" == "$EXPECTED_WORKTREE" ]] || {
  echo "Edge state audit must run from the AWS migration worktree." >&2
  exit 1
}

export PATH="$HOME/bin:$PATH"

for command_name in aws terraform jq grep; do
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
STATE_JSON="$(mktemp)"
EDGE_JSON="$(mktemp)"
trap 'rm -f "$STATE_JSON" "$EDGE_JSON" /tmp/edge-cloudfront.json /tmp/edge-waf.json /tmp/edge-live-error.txt' EXIT

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
[[ "$ACCOUNT_ID" == "$EXPECTED_ACCOUNT_ID" ]] || {
  echo "Refusing audit in unexpected AWS account $ACCOUNT_ID." >&2
  exit 1
}

echo "=== EDGE STATE AUDIT COMMIT ==="
git rev-parse --verify HEAD

echo
echo "=== TERRAFORM REMOTE BACKEND READ ==="
terraform -chdir="$APP_DIR" init \
  -reconfigure \
  -input=false \
  -no-color \
  -backend-config="bucket=$STATE_BUCKET" \
  -backend-config="key=$STATE_KEY" \
  -backend-config="region=$STATE_REGION" \
  -backend-config="use_lockfile=true" \
  >/dev/null

terraform -chdir="$APP_DIR" state pull > "$STATE_JSON"

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
            domain_name: (.attributes.domain_name // null)
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
echo "=== TERRAFORM PROVIDERS ==="
terraform -chdir="$APP_DIR" providers -no-color || true

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
echo "=== LIVE EDGE RESOURCE CHECK ==="
while IFS=$'\t' read -r type state_name id live_name; do
  [[ -n "$type" && -n "$id" && "$id" != "null" ]] || continue

  case "$type" in
    aws_cloudfront_distribution)
      if aws cloudfront get-distribution --id "$id" --output json > /tmp/edge-cloudfront.json 2>/tmp/edge-live-error.txt; then
        jq -r --arg address "aws_cloudfront_distribution.$state_name" '
          "\($address) LIVE=true id=\(.Distribution.Id) status=\(.Distribution.Status) enabled=\(.Distribution.DistributionConfig.Enabled) domain=\(.Distribution.DomainName) web_acl_id=\(.Distribution.DistributionConfig.WebACLId // \"\")"
        ' /tmp/edge-cloudfront.json
      else
        ERROR_TEXT="$(tr '\n' ' ' < /tmp/edge-live-error.txt | sed -E 's/[[:space:]]+/ /g' | cut -c1-300)"
        echo "aws_cloudfront_distribution.$state_name LIVE_QUERY_FAILED id=$id error=$ERROR_TEXT"
      fi
      ;;
    aws_wafv2_web_acl)
      if [[ -z "$live_name" || "$live_name" == "null" ]]; then
        echo "aws_wafv2_web_acl.$state_name LIVE_QUERY_SKIPPED id=$id reason=missing-name-in-state"
        continue
      fi
      if aws wafv2 get-web-acl \
        --scope CLOUDFRONT \
        --region us-east-1 \
        --name "$live_name" \
        --id "$id" \
        --output json > /tmp/edge-waf.json 2>/tmp/edge-live-error.txt; then
        jq -r --arg address "aws_wafv2_web_acl.$state_name" '
          "\($address) LIVE=true id=\(.WebACL.Id) name=\(.WebACL.Name) arn=\(.WebACL.ARN)"
        ' /tmp/edge-waf.json
      else
        ERROR_TEXT="$(tr '\n' ' ' < /tmp/edge-live-error.txt | sed -E 's/[[:space:]]+/ /g' | cut -c1-300)"
        echo "aws_wafv2_web_acl.$state_name LIVE_QUERY_FAILED id=$id name=$live_name error=$ERROR_TEXT"
      fi
      ;;
    *)
      echo "$type.$state_name LIVE_QUERY_SKIPPED id=$id reason=unsupported-edge-type"
      ;;
  esac
done < <(jq -r '.[] | . as $resource | .instances[]? | [$resource.type, $resource.name, (.id // ""), (.name // "")] | @tsv' "$EDGE_JSON")

echo
echo "EDGE TERRAFORM STATE AUDIT PASSED (READ ONLY)"
