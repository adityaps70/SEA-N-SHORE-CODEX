#!/usr/bin/env bash
# Round P3 (B7): the signed-media pieces outside the distribution (infra/aws/app/media-cdn.tf and the media bucket
# policy), and switching URL signing on in the web task.
#
# plan: targeted Terraform plan, allowed only to create the key, its secret, the CloudFront public key, key group
#   and origin access control, the execution role's read of the secret, and the one new bucket policy statement.
# apply-once: applies exactly that plan and verifies each piece live.
# enable-once: proves the whole path with a real signed request through CloudFront (the edge apply and the
#   backfill's probe object must exist), then registers a web task definition revision that carries the signing
#   key secret and its key id. The next staging deploy rolls it out; until then nothing changes for visitors.
# disable-once: registers a revision without them (the app falls back to its first-party URLs on the next deploy).
#
# The private key is read only into a private temporary file to sign the probe; it is never printed.
set -euo pipefail
umask 077
export PATH="$HOME/bin:$PATH"
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
STATE_BUCKET="sea-n-shore-310356785722-ap-south-1-tfstate"
STATE_KEY="sea-n-shore/staging/terraform.tfstate"
APP_DIR="$PWD/infra/aws/app"
ACTION_FILE="scripts/aws/media-cdn-infra-action.txt"
SECRET_NAME="sea-n-shore-staging/media-cdn-signing-key"
EXECUTION_ROLE="sea-n-shore-staging-ecs-execution"
POLICY_NAME="sea-n-shore-staging-media-cdn-signing-key"
MEDIA_BUCKET="sea-n-shore-staging-310356785722-media"
DISTRIBUTION_ID="EF1K45UVP11XZ"
WEB_TASK_FAMILY="sea-n-shore-staging-web"
WEB_CONTAINER="web"
SITE="https://seanshore.in"
PROBE_KEY="m/_probe/backfill.txt"
PROBE_BODY="sea-n-shore media cdn probe"
RESOURCES=(
  "tls_private_key.media_cdn"
  "aws_secretsmanager_secret.media_cdn_signing_key"
  "aws_secretsmanager_secret_version.media_cdn_signing_key"
  "aws_cloudfront_public_key.media_cdn"
  "aws_cloudfront_key_group.media_cdn"
  "aws_cloudfront_origin_access_control.media"
  "aws_iam_role_policy.ecs_execution_media_cdn_signing_key"
  'aws_s3_bucket_policy.app["media"]'
)

[[ "${MEDIA_CDN_INFRA_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "MEDIA_CDN_INFRA_EXPECTED_SHA must be an exact commit SHA." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$MEDIA_CDN_INFRA_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- \
  infra/aws/app \
  scripts/aws/media-cdn-infra.sh \
  scripts/aws/media-cdn-infra-action.txt \
  scripts/aws/media-cdn-infra.test.mjs \
  .github/workflows/aws-media-cdn-infra.yml
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]
source scripts/aws/bootstrap-terraform-lock.sh

ACTION="$(cut -d' ' -f1 < "$ACTION_FILE" | tr -d '[:space:]')"
case "$ACTION" in plan|apply-once|enable-once|disable-once) ;; *) echo "Unsupported media CDN infra action." >&2; exit 1 ;; esac

WORK_DIR="$(mktemp -d "$PWD/.media-cdn-infra.XXXXXXXX")"
trap 'rm -rf -- "$WORK_DIR"' EXIT; trap 'exit 129' HUP; trap 'exit 130' INT; trap 'exit 143' TERM

aws s3api get-object \
  --bucket "$STATE_BUCKET" \
  --key "$STATE_KEY" \
  --region "$AWS_REGION" \
  "$WORK_DIR/state.json" > "$WORK_DIR/object.json"
jq -e '.lineage == "197a6fae-9997-636e-e52b-c3ac6da85d90"' "$WORK_DIR/state.json" >/dev/null
# The bucket policy names the app distribution by id (media-cdn.tf): it must be the one in state.
jq -e --arg id "$DISTRIBUTION_ID" '[.resources[] | select(.mode == "managed" and .type == "aws_cloudfront_distribution" and .name == "app") | .instances[].attributes.id] == [$id]' "$WORK_DIR/state.json" >/dev/null || {
  echo "The app distribution in state is not $DISTRIBUTION_ID; refusing." >&2
  exit 1
}
grep -q "app_distribution_id  = \"$DISTRIBUTION_ID\"" "$APP_DIR/media-cdn.tf"

python3 - "$WORK_DIR/state.json" "$WORK_DIR/variables.json" <<'PY'
import json, sys
with open(sys.argv[1]) as f:
    state = json.load(f)
resources = state['resources']

def attrs(kind, name):
    matches = [r for r in resources if r['mode'] == 'managed' and r['type'] == kind and r['name'] == name]
    assert len(matches) == 1, f'Expected one {kind}.{name}'
    return matches[0]['instances'][0]['attributes']

web = next(c for c in json.loads(attrs('aws_ecs_task_definition', 'web')['container_definitions']) if c['name'] == 'web')
site_url = next(item['value'] for item in web['environment'] if item['name'] == 'NEXT_PUBLIC_SITE_URL')
image = web['image']
assert ':' in image.rsplit('/', 1)[-1], f'Expected tag-qualified web image, got {image}'
with open(sys.argv[2], 'w') as f:
    json.dump({'image_tag': image.rsplit(':', 1)[1], 'site_url': site_url, 'aurora_engine_version': attrs('aws_rds_cluster', 'aurora')['engine_version']}, f)
PY

terraform -chdir="$APP_DIR" init -input=false -no-color \
  -backend-config="bucket=$STATE_BUCKET" \
  -backend-config="key=$STATE_KEY" \
  -backend-config="region=$AWS_REGION" \
  -backend-config=use_lockfile=true > "$WORK_DIR/init.log"

PLAN_ARGS=()
for resource in "${RESOURCES[@]}"; do PLAN_ARGS+=("-target=$resource"); done

terraform -chdir="$APP_DIR" plan -input=false -no-color -lock-timeout=60s \
  "${PLAN_ARGS[@]}" \
  -var-file="$WORK_DIR/variables.json" \
  -out="$WORK_DIR/before.tfplan" > "$WORK_DIR/plan-before.log"
terraform -chdir="$APP_DIR" show -json "$WORK_DIR/before.tfplan" > "$WORK_DIR/plan-before.json"

# Only the signed-media resources may change; the bucket policy only by gaining the CloudFront read of m/*.
python3 - "$WORK_DIR/plan-before.json" "$MEDIA_BUCKET" "$DISTRIBUTION_ID" <<'PY'
import json, sys
plan = json.load(open(sys.argv[1]))
bucket, distribution = sys.argv[2], sys.argv[3]
created_only = {
    'tls_private_key.media_cdn', 'aws_secretsmanager_secret.media_cdn_signing_key',
    'aws_secretsmanager_secret_version.media_cdn_signing_key', 'aws_cloudfront_public_key.media_cdn',
    'aws_cloudfront_key_group.media_cdn',
}
create_or_update = {'aws_cloudfront_origin_access_control.media', 'aws_iam_role_policy.ecs_execution_media_cdn_signing_key'}
expected_statement = {
    'Sid': 'CloudFrontReadsMediaCdnPrefix', 'Effect': 'Allow',
    'Principal': {'Service': 'cloudfront.amazonaws.com'}, 'Action': 's3:GetObject',
    'Resource': f'arn:aws:s3:::{bucket}/m/*',
    'Condition': {'StringEquals': {'AWS:SourceArn': f'arn:aws:cloudfront::310356785722:distribution/{distribution}'}},
}
errors = []
for change in plan.get('resource_changes', []):
    if change.get('mode') == 'data':
        continue
    address, actions = change['address'], change['change']['actions']
    if actions == ['no-op']:
        continue
    if address in created_only and actions == ['create']:
        continue
    if address in create_or_update and actions in (['create'], ['update']):
        continue
    if address == 'aws_s3_bucket_policy.app["media"]' and actions == ['update']:
        before = json.loads(change['change']['before']['policy'])['Statement']
        after_policy = change['change']['after'].get('policy')
        after = json.loads(after_policy)['Statement'] if isinstance(after_policy, str) else None
        if after == before + [expected_statement] or after == before:
            continue
        errors.append('The media bucket policy may only gain the CloudFront read of m/*')
        continue
    errors.append(f'Unexpected change: {address} {actions}')
oac = [c for c in plan.get('resource_changes', []) if c['address'] == 'aws_cloudfront_origin_access_control.media' and c['change']['actions'] != ['no-op']]
for change in oac:
    after = change['change']['after']
    if (after.get('origin_access_control_origin_type'), after.get('signing_behavior'), after.get('signing_protocol')) != ('s3', 'always', 'sigv4'):
        errors.append('The origin access control must sign every S3 request (sigv4, always)')
if errors:
    print('\n'.join(errors), file=sys.stderr)
    sys.exit(1)
PY
jq -r '.resource_changes[]? | select(.mode != "data") | select(.change.actions != ["no-op"]) | "MEDIA_CDN_INFRA_CHANGE=\(.address)|\(.change.actions | join(","))"' "$WORK_DIR/plan-before.json"
CHANGE_COUNT="$(jq '[.resource_changes[]? | select(.mode != "data") | select(.change.actions != ["no-op"])] | length' "$WORK_DIR/plan-before.json")"
echo "MEDIA_CDN_INFRA_ACTION=$ACTION"
echo "MEDIA_CDN_INFRA_CHANGE_COUNT=$CHANGE_COUNT"
echo "MEDIA_CDN_INFRA_PLAN_VERIFIED=true"

state_value() {
  terraform -chdir="$APP_DIR" state pull | jq -r --arg type "$1" --arg name "$2" --arg field "$3" \
    '[.resources[] | select(.mode == "managed" and .type == $type and .name == $name) | .instances[0].attributes[$field]][0] // empty'
}

verify_live() {
  local secret_arn key_id key_group_id oac_id
  secret_arn="$(aws secretsmanager describe-secret --region "$AWS_REGION" --secret-id "$SECRET_NAME" --query ARN --output text)"
  [[ "$secret_arn" == arn:aws:secretsmanager:ap-south-1:310356785722:secret:sea-n-shore-staging/media-cdn-signing-key-* ]]
  aws iam get-role-policy --role-name "$EXECUTION_ROLE" --policy-name "$POLICY_NAME" --output json > "$WORK_DIR/role-policy.json"
  jq -e --arg secret "$secret_arn" '
    def as_array: if type == "array" then . else [.] end;
    (.PolicyDocument.Statement | length) == 1 and .PolicyDocument.Statement[0].Effect == "Allow"
    and ((.PolicyDocument.Statement[0].Action | as_array) == ["secretsmanager:GetSecretValue"])
    and ((.PolicyDocument.Statement[0].Resource | as_array) == [$secret])
  ' "$WORK_DIR/role-policy.json" >/dev/null

  key_id="$(state_value aws_cloudfront_public_key media_cdn id)"
  key_group_id="$(state_value aws_cloudfront_key_group media_cdn id)"
  oac_id="$(state_value aws_cloudfront_origin_access_control media id)"
  [[ "$key_id" =~ ^K[A-Z0-9]{6,32}$ && -n "$key_group_id" && -n "$oac_id" ]]
  aws cloudfront get-key-group --id "$key_group_id" --output json > "$WORK_DIR/key-group.json"
  jq -e --arg key "$key_id" '.KeyGroup.KeyGroupConfig.Items == [$key]' "$WORK_DIR/key-group.json" >/dev/null
  aws cloudfront get-public-key --id "$key_id" --output json > "$WORK_DIR/public-key.json"
  jq -r '.PublicKey.PublicKeyConfig.EncodedKey' "$WORK_DIR/public-key.json" > "$WORK_DIR/public-key.pem"
  openssl pkey -pubin -in "$WORK_DIR/public-key.pem" -noout -text 2>/dev/null | grep -q 'prime256v1\|P-256'
  aws cloudfront get-origin-access-control --id "$oac_id" --output json > "$WORK_DIR/oac.json"
  jq -e '.OriginAccessControl.OriginAccessControlConfig | .OriginAccessControlOriginType == "s3" and .SigningBehavior == "always" and .SigningProtocol == "sigv4"' "$WORK_DIR/oac.json" >/dev/null
  aws s3api get-bucket-policy --bucket "$MEDIA_BUCKET" --query Policy --output text > "$WORK_DIR/bucket-policy.json"
  jq -e --arg bucket "$MEDIA_BUCKET" --arg distribution "$DISTRIBUTION_ID" '
    [.Statement[] | select(.Effect == "Allow")] == [{
      "Sid": "CloudFrontReadsMediaCdnPrefix", "Effect": "Allow",
      "Principal": {"Service": "cloudfront.amazonaws.com"}, "Action": "s3:GetObject",
      "Resource": ("arn:aws:s3:::" + $bucket + "/m/*"),
      "Condition": {"StringEquals": {"AWS:SourceArn": ("arn:aws:cloudfront::310356785722:distribution/" + $distribution)}}
    }]
  ' "$WORK_DIR/bucket-policy.json" >/dev/null
  aws s3api get-public-access-block --bucket "$MEDIA_BUCKET" --output json > "$WORK_DIR/public-access.json"
  jq -e '.PublicAccessBlockConfiguration | .BlockPublicAcls and .BlockPublicPolicy and .IgnorePublicAcls and .RestrictPublicBuckets' "$WORK_DIR/public-access.json" >/dev/null
  echo "MEDIA_CDN_KEY_PAIR_ID=$key_id"
  echo "MEDIA_CDN_INFRA_LIVE_VERIFIED=true"
}

# Signs a custom policy for every object under a folder exactly as src/lib/media-cdn/signer.ts does (ECDSA P-256,
# SHA-256, DER), with the private key in a file only this process can read.
signed_query() {
  local folder="$1" key_file="$2" key_id="$3" expires policy signature
  expires=$(( $(date +%s) + 600 ))
  policy="{\"Statement\":[{\"Resource\":\"$SITE/$folder/*\",\"Condition\":{\"DateLessThan\":{\"AWS:EpochTime\":$expires}}}]}"
  signature="$(printf '%s' "$policy" | openssl dgst -sha256 -sign "$key_file" | base64 -w0 | tr '+=/' '-_~')"
  printf 'Policy=%s&Signature=%s&Key-Pair-Id=%s&Hash-Algorithm=SHA256' "$(printf '%s' "$policy" | base64 -w0 | tr '+=/' '-_~')" "$signature" "$key_id"
}

prove_signed_path() {
  local key_id="$1" key_file="$WORK_DIR/signing-key.pem" query wrong_folder status body
  aws cloudfront get-distribution --id "$DISTRIBUTION_ID" --output json > "$WORK_DIR/distribution.json"
  jq -e --arg group "$(state_value aws_cloudfront_key_group media_cdn id)" '
    [.Distribution.DistributionConfig.CacheBehaviors.Items[]? | select(.PathPattern == "/m/*")][0].TrustedKeyGroups.Items == [$group]
  ' "$WORK_DIR/distribution.json" >/dev/null || { echo "The /m/* edge behavior is not live yet; run the edge apply first." >&2; exit 1; }
  aws s3api head-object --bucket "$MEDIA_BUCKET" --key "$PROBE_KEY" > /dev/null 2>&1 || { echo "The backfill probe is missing; run the media CDN backfill first." >&2; exit 1; }

  aws secretsmanager get-secret-value --region "$AWS_REGION" --secret-id "$SECRET_NAME" --query SecretString --output text > "$key_file"
  openssl pkey -in "$key_file" -noout 2>/dev/null || { echo "The signing key secret is not a private key." >&2; exit 1; }
  query="$(signed_query m/_probe "$key_file" "$key_id")"
  wrong_folder="$(signed_query m/i/not-the-probe "$key_file" "$key_id")"
  rm -f "$key_file"

  body="$(curl --silent --show-error --max-time 45 --retry 3 --retry-delay 5 "$SITE/$PROBE_KEY?$query")"
  [[ "$body" == "$PROBE_BODY" ]] || { echo "A signed media request did not return the probe object." >&2; exit 1; }
  status="$(curl --silent --show-error --max-time 45 -o /dev/null -w '%{http_code}' "$SITE/$PROBE_KEY")"
  [[ "$status" == 403 ]] || { echo "An unsigned media request answered $status instead of 403." >&2; exit 1; }
  status="$(curl --silent --show-error --max-time 45 -o /dev/null -w '%{http_code}' "$SITE/$PROBE_KEY?$wrong_folder")"
  [[ "$status" == 403 ]] || { echo "A signature for another folder answered $status instead of 403." >&2; exit 1; }
  status="$(curl --silent --show-error --max-time 45 -o /dev/null -w '%{http_code}' "$SITE/$PROBE_KEY?${query/Signature=/Signature=AA}")"
  [[ "$status" == 403 ]] || { echo "A tampered signature answered $status instead of 403." >&2; exit 1; }
  status="$(curl --silent --show-error --max-time 45 -o /dev/null -w '%{http_code}' "https://$MEDIA_BUCKET.s3.ap-south-1.amazonaws.com/$PROBE_KEY")"
  [[ "$status" == 403 ]] || { echo "The bucket answered a direct public request with $status." >&2; exit 1; }
  echo "MEDIA_CDN_SIGNED_PATH_VERIFIED=true"
}

register_web_revision() {
  local mode="$1" key_id="$2" secret_arn="$3" current="$WORK_DIR/web-current.json" next="$WORK_DIR/web-next.json" task_arn
  aws ecs describe-task-definition --region "$AWS_REGION" --task-definition "$WEB_TASK_FAMILY" --query taskDefinition --output json > "$current"
  jq --arg name "$WEB_CONTAINER" --arg mode "$mode" --arg key "$key_id" --arg secret "$secret_arn" '
    del(.taskDefinitionArn, .revision, .status, .requiresAttributes, .compatibilities, .registeredAt, .registeredBy)
    | .containerDefinitions |= map(
        if .name == $name then
          .environment = (((.environment // []) | map(select(.name != "MEDIA_CDN_KEY_PAIR_ID")))
            + (if $mode == "enable" then [{"name":"MEDIA_CDN_KEY_PAIR_ID","value":$key}] else [] end))
          | .secrets = (((.secrets // []) | map(select(.name != "MEDIA_CDN_SIGNING_KEY")))
            + (if $mode == "enable" then [{"name":"MEDIA_CDN_SIGNING_KEY","valueFrom":$secret}] else [] end))
        else . end
      )
  ' "$current" > "$next"
  if jq -e --slurpfile before "$current" '.containerDefinitions == $before[0].containerDefinitions' "$next" >/dev/null; then
    echo "MEDIA_CDN_WEB_TASK_REVISION=already-$mode"
    return
  fi
  task_arn="$(aws ecs register-task-definition --region "$AWS_REGION" --cli-input-json "file://$next" --query taskDefinition.taskDefinitionArn --output text)"
  [[ "$task_arn" == arn:aws:ecs:ap-south-1:310356785722:task-definition/"$WEB_TASK_FAMILY":* ]]
  echo "MEDIA_CDN_WEB_TASK_REVISION=${task_arn##*/}"
}

if [[ "$ACTION" == "plan" ]]; then
  if [[ "$CHANGE_COUNT" -eq 0 ]]; then verify_live; fi
  echo "MEDIA_CDN_INFRA_PLAN_ONLY_NO_APPLY"
  exit 0
fi

[[ "$(bash scripts/aws/branch-head.sh refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$MEDIA_CDN_INFRA_EXPECTED_SHA" ]]
[[ "$(aws s3api get-bucket-versioning --bucket "$STATE_BUCKET" --query Status --output text)" == Enabled ]]
STATE_BACKUP_VERSION="$(jq -r '.VersionId // empty' "$WORK_DIR/object.json")"
[[ -n "$STATE_BACKUP_VERSION" ]]
echo "STATE_BACKUP_VERSION=$STATE_BACKUP_VERSION"

if [[ "$ACTION" == "apply-once" ]]; then
  if [[ "$CHANGE_COUNT" -gt 0 ]]; then
    terraform -chdir="$APP_DIR" apply -input=false -no-color "$WORK_DIR/before.tfplan" > "$WORK_DIR/apply.log"
  fi
  verify_live
  terraform -chdir="$APP_DIR" plan -input=false -no-color -lock-timeout=60s \
    "${PLAN_ARGS[@]}" -var-file="$WORK_DIR/variables.json" -out="$WORK_DIR/after.tfplan" > "$WORK_DIR/plan-after.log"
  terraform -chdir="$APP_DIR" show -json "$WORK_DIR/after.tfplan" > "$WORK_DIR/plan-after.json"
  [[ "$(jq '[.resource_changes[]? | select(.mode != "data") | select(.change.actions != ["no-op"])] | length' "$WORK_DIR/plan-after.json")" == 0 ]] || {
    echo "Media CDN Terraform drift remains after apply." >&2
    exit 1
  }
  echo "MEDIA_CDN_INFRA_APPLY_VERIFIED=true"
  exit 0
fi

# enable-once / disable-once: the Terraform side must already be applied.
[[ "$CHANGE_COUNT" -eq 0 ]] || { echo "Apply the media CDN infra (apply-once) before switching signing." >&2; exit 1; }
LIVE="$(verify_live)"
printf '%s\n' "$LIVE"
KEY_ID="$(sed -n 's/^MEDIA_CDN_KEY_PAIR_ID=//p' <<<"$LIVE")"
SECRET_ARN="$(aws secretsmanager describe-secret --region "$AWS_REGION" --secret-id "$SECRET_NAME" --query ARN --output text)"
if [[ "$ACTION" == "enable-once" ]]; then
  prove_signed_path "$KEY_ID"
  register_web_revision enable "$KEY_ID" "$SECRET_ARN"
  echo "MEDIA_CDN_SIGNING_ENABLED_FOR_NEXT_DEPLOY=true"
else
  register_web_revision disable "$KEY_ID" "$SECRET_ARN"
  echo "MEDIA_CDN_SIGNING_DISABLED_FOR_NEXT_DEPLOY=true"
fi
