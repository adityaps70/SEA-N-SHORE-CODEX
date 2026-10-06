#!/usr/bin/env bash
# Round 14 (2.13): moves the legacy SQL dump private-migrations/beaufortmarine.sql out of the media
# bucket into the migration bucket, purges every version and delete marker of exactly that key from
# the media bucket (only after the copy is verified), then applies TLS-only bucket policies to the
# app buckets and a deny on the media bucket's private-migrations/ prefix (Terraform creates only).
# The action file holds "plan" or "apply-once".
set -euo pipefail
umask 077
export PATH="$HOME/bin:$PATH"
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
STATE_BUCKET="sea-n-shore-310356785722-ap-south-1-tfstate"
STATE_KEY="sea-n-shore/staging/terraform.tfstate"
APP_DIR="$PWD/infra/aws/app"
ACTION_FILE="scripts/aws/private-migration-relocate-action.txt"
MEDIA_BUCKET="sea-n-shore-staging-310356785722-media"
MIGRATION_BUCKET="sea-n-shore-staging-310356785722-migration"
PRIVATE_BUCKET="sea-n-shore-staging-310356785722-private"
DUMP_KEY="private-migrations/beaufortmarine.sql"
# The size legacy-user-import.sh expects for this dump.
EXPECTED_DUMP_BYTES="13693941"
PUBLIC_SITE_URL="$(tr -d '[:space:]' < scripts/aws/public-site-url.txt)"
[[ "$PUBLIC_SITE_URL" =~ ^https://[a-z0-9.-]+$ ]]
export PUBLIC_SITE_URL

[[ "${PRIVATE_MIGRATION_RELOCATE_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "PRIVATE_MIGRATION_RELOCATE_EXPECTED_SHA must be an exact commit SHA." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$PRIVATE_MIGRATION_RELOCATE_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- \
  infra/aws/app/bucket-policies.tf \
  scripts/aws/private-migration-relocate.sh \
  scripts/aws/private-migration-relocate-action.txt \
  scripts/aws/private-migration-relocate.test.mjs \
  scripts/aws/public-site-url.txt \
  .github/workflows/aws-private-migration-relocate.yml
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]
source scripts/aws/bootstrap-terraform-lock.sh

ACTION="$(tr -d '[:space:]' < "$ACTION_FILE")"
case "$ACTION" in plan|apply-once) ;; *) echo "Unsupported private migration relocate action." >&2; exit 1 ;; esac

WORK_DIR="$(mktemp -d "$PWD/.private-migration-relocate.XXXXXXXX")"
TF_TMPDIR="$(mktemp -d /var/tmp/sns-tf.XXXXXX)"
export TMPDIR="$TF_TMPDIR"
trap 'rm -rf -- "$WORK_DIR" "$TF_TMPDIR"' EXIT; trap 'exit 129' HUP; trap 'exit 130' INT; trap 'exit 143' TERM

aws s3api get-object --bucket "$STATE_BUCKET" --key "$STATE_KEY" --region "$AWS_REGION" \
  "$WORK_DIR/state.json" > "$WORK_DIR/object.json"
jq -e '.lineage == "197a6fae-9997-636e-e52b-c3ac6da85d90"' "$WORK_DIR/state.json" >/dev/null

python3 - "$WORK_DIR/state.json" "$WORK_DIR/variables.json" <<'PY'
import json, os, sys
state_path, output_path = sys.argv[1:]
resources = json.load(open(state_path))['resources']
def attrs(kind, name):
    matches = [r for r in resources if r.get('mode') == 'managed' and r.get('type') == kind and r.get('name') == name]
    assert len(matches) == 1 and len(matches[0].get('instances') or []) == 1, f'{kind}.{name}'
    return matches[0]['instances'][0]['attributes']
web = attrs('aws_ecs_task_definition', 'web')
image = next(c for c in json.loads(web['container_definitions']) if c['name'] == 'web')['image']
json.dump({
    'image_tag': image.rsplit(':', 1)[1],
    'site_url': os.environ['PUBLIC_SITE_URL'],
    'aurora_engine_version': attrs('aws_rds_cluster', 'aurora')['engine_version'],
}, open(output_path, 'w'))
PY

terraform -chdir="$APP_DIR" init -input=false -no-color \
  -backend-config="bucket=$STATE_BUCKET" \
  -backend-config="key=$STATE_KEY" \
  -backend-config="region=$AWS_REGION" \
  -backend-config=use_lockfile=true > "$WORK_DIR/init.log"

TARGETS=(
  'aws_s3_bucket_policy.app["media"]'
  'aws_s3_bucket_policy.app["private_documents"]'
  'aws_s3_bucket_policy.app["migration_backup"]'
)
PLAN_ARGS=()
for target in "${TARGETS[@]}"; do PLAN_ARGS+=("-target=$target"); done

terraform -chdir="$APP_DIR" plan -input=false -no-color -lock-timeout=60s \
  "${PLAN_ARGS[@]}" -var-file="$WORK_DIR/variables.json" -out="$WORK_DIR/private-migration-relocate.tfplan" > "$WORK_DIR/plan.log"
terraform -chdir="$APP_DIR" show -json "$WORK_DIR/private-migration-relocate.tfplan" > "$WORK_DIR/plan.json"

python3 - "$WORK_DIR/plan.json" <<'PY'
import json, sys
allowed = {
  'aws_s3_bucket_policy.app["media"]',
  'aws_s3_bucket_policy.app["private_documents"]',
  'aws_s3_bucket_policy.app["migration_backup"]',
}
plan = json.load(open(sys.argv[1]))
changes = [r for r in plan.get('resource_changes', []) if r.get('mode') != 'data' and r['change']['actions'] != ['no-op']]
for r in changes:
    if r['address'] not in allowed or r['change']['actions'] != ['create']:
        raise SystemExit(f"unexpected private migration change refused: {r['address']} {r['change']['actions']}")
    statements = json.loads(r['change']['after'].get('policy') or '{}').get('Statement', [])
    sids = sorted(st.get('Sid') for st in statements)
    if any(st.get('Effect') != 'Deny' for st in statements):
        raise SystemExit(r['address'] + ' may only add Deny statements')
    expected = ['DenyInsecureTransport', 'DenyPrivateMigrationsPrefix'] if r['address'].endswith('["media"]') else ['DenyInsecureTransport']
    if sids != expected:
        raise SystemExit(r['address'] + ' has unexpected statements: ' + ','.join(sids))
print('PRIVATE_MIGRATION_RELOCATE_PLAN_CHANGES=' + str(len(changes)))
for r in changes:
    print(f"PRIVATE_MIGRATION_RELOCATE_CHANGE={r['address']}|create")
PY


# Every version and delete marker of exactly the dump key in the media bucket (never a wider prefix).
dump_versions() {
  aws s3api list-object-versions --region "$AWS_REGION" --bucket "$MEDIA_BUCKET" --prefix "$DUMP_KEY" --output json \
    | jq -c --arg key "$DUMP_KEY" '[((.Versions // [])[] | select(.Key == $key) | {VersionId, IsLatest, Size, LastModified, Kind: "version"}), ((.DeleteMarkers // [])[] | select(.Key == $key) | {VersionId, IsLatest, LastModified, Kind: "delete_marker"})]'
}
destination_size() {
  aws s3api head-object --region "$AWS_REGION" --bucket "$MIGRATION_BUCKET" --key "$DUMP_KEY" --query ContentLength --output text 2>/dev/null || echo missing
}
MEDIA_DUMP_VERSIONS="$(dump_versions)"
echo "MEDIA_DUMP_VERSION_COUNT=$(jq 'length' <<<"$MEDIA_DUMP_VERSIONS")"
echo "MEDIA_DUMP_STORED_VERSIONS=$(jq '[.[] | select(.Kind == "version")] | length' <<<"$MEDIA_DUMP_VERSIONS") MEDIA_DUMP_DELETE_MARKERS=$(jq '[.[] | select(.Kind == "delete_marker")] | length' <<<"$MEDIA_DUMP_VERSIONS") MEDIA_DUMP_LATEST=$(jq -r '[.[] | select(.IsLatest)][0].Kind // "none"' <<<"$MEDIA_DUMP_VERSIONS")"
echo "MIGRATION_BUCKET_DUMP_SIZE=$(destination_size)"
echo "STATE_SERIAL_BEFORE=$(jq -r '.serial' "$WORK_DIR/state.json")"
echo "PRIVATE_MIGRATION_RELOCATE_ACTION=$ACTION"
echo "PRIVATE_MIGRATION_RELOCATE_PLAN_VERIFIED=true"
echo "PLAN_SHA256=$(sha256sum "$WORK_DIR/private-migration-relocate.tfplan" | cut -d' ' -f1)"

if [[ "$ACTION" == "plan" ]]; then
  echo "PRIVATE_MIGRATION_RELOCATE_PLAN_ONLY_NO_APPLY"
  exit 0
fi

[[ "$(bash scripts/aws/branch-head.sh refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$PRIVATE_MIGRATION_RELOCATE_EXPECTED_SHA" ]]
[[ "$(aws s3api get-bucket-versioning --bucket "$STATE_BUCKET" --query Status --output text)" == Enabled ]]
STATE_BACKUP_VERSION="$(jq -r '.VersionId // empty' "$WORK_DIR/object.json")"
[[ -n "$STATE_BACKUP_VERSION" ]]
echo "STATE_BACKUP_VERSION=$STATE_BACKUP_VERSION"


# 1. Copy the latest dump into the migration bucket and prove the copy, before anything is deleted.
if [[ "$(destination_size)" == missing ]]; then
  # The current version may be a delete marker, so copy the newest stored version by its ID.
  SOURCE_VERSION="$(jq -c '[.[] | select(.Kind == "version")] | sort_by(.LastModified) | last // empty' <<<"$(dump_versions)")"
  [[ -n "$SOURCE_VERSION" ]] || { echo "No stored version of the dump exists in the media bucket; refusing." >&2; exit 1; }
  SOURCE_VERSION_ID="$(jq -r '.VersionId' <<<"$SOURCE_VERSION")"
  SOURCE_SIZE="$(jq -r '.Size' <<<"$SOURCE_VERSION")"
  [[ "$SOURCE_SIZE" == "$EXPECTED_DUMP_BYTES" ]] || { echo "The newest stored dump is $SOURCE_SIZE bytes, expected $EXPECTED_DUMP_BYTES; refusing." >&2; exit 1; }
  aws s3api copy-object --region "$AWS_REGION" --bucket "$MIGRATION_BUCKET" --key "$DUMP_KEY" \
    --copy-source "$MEDIA_BUCKET/$DUMP_KEY?versionId=$SOURCE_VERSION_ID" --server-side-encryption AES256 >/dev/null
  [[ "$(destination_size)" == "$SOURCE_SIZE" ]] || { echo "The copied dump does not match the source size; refusing to purge." >&2; exit 1; }
  echo "DUMP_COPIED_FROM_VERSION=$SOURCE_VERSION_ID"
fi
DESTINATION_SIZE="$(destination_size)"
[[ "$DESTINATION_SIZE" =~ ^[0-9]+$ && "$DESTINATION_SIZE" -gt 0 ]] || { echo "The migration bucket copy is missing; refusing to purge." >&2; exit 1; }
echo "DUMP_COPY_VERIFIED_BYTES=$DESTINATION_SIZE"

# 2. Purge every version and delete marker of exactly that key from the media bucket.
for VERSION_ID in $(jq -r '.[].VersionId' <<<"$(dump_versions)"); do
  aws s3api delete-object --region "$AWS_REGION" --bucket "$MEDIA_BUCKET" --key "$DUMP_KEY" --version-id "$VERSION_ID" >/dev/null
done
[[ "$(jq 'length' <<<"$(dump_versions)")" == "0" ]] || { echo "Dump versions remain in the media bucket." >&2; exit 1; }
echo "MEDIA_DUMP_VERSIONS_PURGED=true"

terraform -chdir="$APP_DIR" apply -input=false -no-color "$WORK_DIR/private-migration-relocate.tfplan" > "$WORK_DIR/apply.log"

terraform -chdir="$APP_DIR" plan -input=false -no-color -lock-timeout=60s \
  "${PLAN_ARGS[@]}" -var-file="$WORK_DIR/variables.json" -out="$WORK_DIR/after.tfplan" > "$WORK_DIR/plan-after.log"
terraform -chdir="$APP_DIR" show -json "$WORK_DIR/after.tfplan" > "$WORK_DIR/plan-after.json"
[[ "$(jq '[.resource_changes[]? | select(.mode != "data") | select(.change.actions != ["no-op"])] | length' "$WORK_DIR/plan-after.json")" == "0" ]] || {
  echo "Bucket policies still drift after apply." >&2
  exit 1
}

for BUCKET in "$MEDIA_BUCKET" "$PRIVATE_BUCKET" "$MIGRATION_BUCKET"; do
  aws s3api get-bucket-policy --region "$AWS_REGION" --bucket "$BUCKET" --query Policy --output text \
    | jq -e '[.Statement[] | select(.Sid == "DenyInsecureTransport" and .Effect == "Deny" and .Condition.Bool["aws:SecureTransport"] == "false")] | length == 1' >/dev/null
done
echo "BUCKETS_TLS_ONLY_VERIFIED=true"
aws s3api get-bucket-policy --region "$AWS_REGION" --bucket "$MEDIA_BUCKET" --query Policy --output text \
  | jq -e --arg resource "arn:aws:s3:::$MEDIA_BUCKET/private-migrations/*" '[.Statement[] | select(.Sid == "DenyPrivateMigrationsPrefix" and .Effect == "Deny" and .Resource == $resource)] | length == 1' >/dev/null
echo "MEDIA_PRIVATE_PREFIX_DENIED=true"
[[ "$(jq 'length' <<<"$(dump_versions)")" == "0" ]]
[[ "$(destination_size)" =~ ^[1-9][0-9]*$ ]]
echo "DUMP_ONLY_IN_MIGRATION_BUCKET_VERIFIED=true"
[[ "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 30 "${PUBLIC_SITE_URL%/}/api/health/live")" == 200 ]]
echo "PUBLIC_SITE_LIVE_VERIFIED=true"
echo "PRIVATE_MIGRATION_RELOCATE_APPLY_VERIFIED=true"
