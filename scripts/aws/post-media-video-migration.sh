#!/usr/bin/env bash
set -euo pipefail
umask 077
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
EXPECTED_BRANCH="feat/aws-native-phase-0-1"
CLUSTER_ID="sea-n-shore-staging-aurora"
DATABASE_NAME="sea_n_shore"
MIGRATION_FILE="infra/aws/database/migrations/0008_post_media_video.sql"
ACTION_FILE="scripts/aws/post-media-video-migration-action.txt"
EXPECTED_REMOTE="https://github.com/adityaps70/SEA-N-SHORE-CODEX.git"

[[ "$AWS_REGION" == "ap-south-1" ]] || {
  echo "Post media video migration is restricted to ap-south-1." >&2
  exit 1
}
[[ "${POST_MEDIA_VIDEO_MIGRATION_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "POST_MEDIA_VIDEO_MIGRATION_EXPECTED_SHA must be an exact commit SHA." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$POST_MEDIA_VIDEO_MIGRATION_EXPECTED_SHA" ]] || {
  echo "Current checkout does not match the expected migration SHA." >&2
  exit 1
}
[[ "$(git remote get-url origin)" == "$EXPECTED_REMOTE" ]] || {
  echo "Unexpected repository origin; refusing migration." >&2
  exit 1
}
git show-ref --verify --quiet "refs/remotes/origin/$EXPECTED_BRANCH" || {
  echo "Expected feature branch is not present in the checkout." >&2
  exit 1
}
git merge-base --is-ancestor "$POST_MEDIA_VIDEO_MIGRATION_EXPECTED_SHA" "origin/$EXPECTED_BRANCH" || {
  echo "Expected SHA is not part of the approved feature branch." >&2
  exit 1
}
git diff --quiet HEAD -- "$MIGRATION_FILE" "$0" "$ACTION_FILE" || {
  echo "Migration inputs differ from the committed expected SHA." >&2
  exit 1
}
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]] || {
  echo "Unexpected AWS account; refusing migration." >&2
  exit 1
}

ACTION="$(tr -d '[:space:]' < "$ACTION_FILE")"
case "$ACTION" in
  plan|apply-once) ;;
  *)
    echo "Unsupported post media video migration action." >&2
    exit 1
    ;;
esac

python3 - "$MIGRATION_FILE" <<'PY'
import re
import sys

path = sys.argv[1]
sql = open(path, encoding='utf-8').read().strip()
parts = [
    part.strip()
    for part in re.split(r'^\s*-- statement-breakpoint\s*$', sql, flags=re.M)
    if part.strip()
]
if len(parts) != 2:
    raise SystemExit(f'Post media video migration must contain exactly two statements; found {len(parts)}')

expected_drop = re.compile(
    r'^alter\s+table\s+public\.post_media\s+drop\s+constraint\s+post_media_mime_check\s*;$',
    re.I | re.S,
)
expected_add = re.compile(
    r'^alter\s+table\s+public\.post_media\s+add\s+constraint\s+post_media_mime_check\s+check\s*'
    r'\(\s*mime_type\s+in\s*\([\s\S]*\)\s*\)\s*;$',
    re.I | re.S,
)
if not expected_drop.match(parts[0]) or not expected_add.match(parts[1]):
    raise SystemExit('Post media video migration statement order or scope changed')

normalized = ' '.join(sql.split()).lower()
if re.search(r'\bdrop\s+table\b|\btruncate\b|\bdelete\s+from\b|\bupdate\s+[a-z_."]+\s+set\b|\binsert\s+into\b', normalized, re.I):
    raise SystemExit('Post media video migration contains destructive or data-changing SQL')

altered_tables = re.findall(r'\balter\s+table\s+([a-z0-9_."]+)', normalized, re.I)
if altered_tables != ['public.post_media', 'public.post_media']:
    raise SystemExit('Post media video migration may alter only public.post_media')

dropped = re.findall(r'\bdrop\s+constraint\s+([a-z0-9_]+)', normalized, re.I)
added = re.findall(r'\badd\s+constraint\s+([a-z0-9_]+)', normalized, re.I)
if dropped != ['post_media_mime_check'] or added != ['post_media_mime_check']:
    raise SystemExit('Post media video migration may change only post_media_mime_check')

approved = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm']
quoted = re.findall(r"'([^']+)'", normalized)
if quoted != approved:
    raise SystemExit('Post media video migration MIME allowlist differs from the approved five values')

print('POST_MEDIA_VIDEO_MIGRATION_SQL_GUARD=POST_MEDIA_MIME_CHECK_ONLY')
PY

echo "POST_MEDIA_VIDEO_MIGRATION_SHA256=$(sha256sum "$MIGRATION_FILE" | cut -d' ' -f1)"

CLUSTER_JSON="$(aws rds describe-db-clusters --region "$AWS_REGION" --db-cluster-identifier "$CLUSTER_ID" --output json)"
CLUSTER_ARN="$(jq -r '.DBClusters[0].DBClusterArn // empty' <<<"$CLUSTER_JSON")"
SECRET_ARN="$(jq -r '.DBClusters[0].MasterUserSecret.SecretArn // empty' <<<"$CLUSTER_JSON")"
HTTP_ENDPOINT="$(jq -r '.DBClusters[0].HttpEndpointEnabled // false' <<<"$CLUSTER_JSON")"
STATUS="$(jq -r '.DBClusters[0].Status // empty' <<<"$CLUSTER_JSON")"
[[ "$STATUS" == "available" && "$HTTP_ENDPOINT" == "true" ]] || {
  echo "Staging Aurora is not available with the Data API enabled." >&2
  exit 1
}
[[ "$CLUSTER_ARN" == "arn:aws:rds:ap-south-1:310356785722:cluster:sea-n-shore-staging-aurora" ]] || {
  echo "Unexpected Aurora cluster ARN." >&2
  exit 1
}
[[ "$SECRET_ARN" == arn:aws:secretsmanager:ap-south-1:310356785722:secret:rds\!cluster-* ]] || {
  echo "Unexpected Aurora managed secret reference." >&2
  exit 1
}

execute_read() {
  aws rds-data execute-statement \
    --region "$AWS_REGION" \
    --resource-arn "$CLUSTER_ARN" \
    --secret-arn "$SECRET_ARN" \
    --database "$DATABASE_NAME" \
    --sql "$1" \
    --output json
}

read_constraint_definition() {
  execute_read "SELECT pg_get_constraintdef(c.oid, true) FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid JOIN pg_namespace n ON n.oid = r.relnamespace WHERE n.nspname = 'public' AND r.relname = 'post_media' AND c.conname = 'post_media_mime_check'" \
    | jq -r '.records[0][0].stringValue // empty'
}

constraint_state() {
  python3 - "$1" <<'PY'
import re
import sys

definition = sys.argv[1]
if not definition:
    print('MISSING')
    raise SystemExit(0)
if 'mime_type' not in definition.lower():
    print('UNEXPECTED')
    raise SystemExit(0)
values = re.findall(r"'([^']+)'", definition.lower())
image_only = ['image/jpeg', 'image/png', 'image/webp']
video_ready = image_only + ['video/mp4', 'video/webm']
if values == image_only:
    print('IMAGE_ONLY')
elif values == video_ready:
    print('VIDEO_READY')
else:
    print('UNEXPECTED')
PY
}

CONSTRAINT_DEFINITION="$(read_constraint_definition)"
CONSTRAINT_STATE="$(constraint_state "$CONSTRAINT_DEFINITION")"
echo "POST_MEDIA_VIDEO_CONSTRAINT_STATE_BEFORE=$CONSTRAINT_STATE"

if [[ "$CONSTRAINT_STATE" == "VIDEO_READY" ]]; then
  echo "POST_MEDIA_VIDEO_MIGRATION_ALREADY_APPLIED=true"
  exit 0
fi
[[ "$CONSTRAINT_STATE" == "IMAGE_ONLY" ]] || {
  echo "Unexpected post_media_mime_check state; refusing automatic migration." >&2
  exit 1
}

echo "POST_MEDIA_VIDEO_MIGRATION_PLAN_VERIFIED=ALLOW_EXACT_FIVE_MIME_TYPES"
if [[ "$ACTION" == "plan" ]]; then
  echo "POST_MEDIA_VIDEO_MIGRATION_PLAN_ONLY_NO_APPLY"
  exit 0
fi

REMOTE_HEAD="$(git ls-remote origin "refs/heads/$EXPECTED_BRANCH" | cut -f1)"
[[ "$REMOTE_HEAD" == "$POST_MEDIA_VIDEO_MIGRATION_EXPECTED_SHA" ]] || {
  echo "Feature branch moved after this migration run was triggered; refusing apply." >&2
  exit 1
}

mapfile -t STATEMENT_B64 < <(python3 - "$MIGRATION_FILE" <<'PY'
import base64
import re
import sys

sql = open(sys.argv[1], encoding='utf-8').read().strip()
parts = [
    part.strip()
    for part in re.split(r'^\s*-- statement-breakpoint\s*$', sql, flags=re.M)
    if part.strip()
]
for part in parts:
    print(base64.b64encode(part.encode()).decode())
PY
)
[[ "${#STATEMENT_B64[@]}" == "2" ]]

TX_ID="$(aws rds-data begin-transaction \
  --region "$AWS_REGION" \
  --resource-arn "$CLUSTER_ARN" \
  --secret-arn "$SECRET_ARN" \
  --database "$DATABASE_NAME" \
  --query transactionId \
  --output text)"
[[ -n "$TX_ID" ]]
committed=false
cleanup() {
  if [[ "$committed" != true && -n "${TX_ID:-}" ]]; then
    aws rds-data rollback-transaction \
      --region "$AWS_REGION" \
      --resource-arn "$CLUSTER_ARN" \
      --secret-arn "$SECRET_ARN" \
      --transaction-id "$TX_ID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

for encoded in "${STATEMENT_B64[@]}"; do
  SQL="$(printf '%s' "$encoded" | base64 --decode)"
  aws rds-data execute-statement \
    --region "$AWS_REGION" \
    --resource-arn "$CLUSTER_ARN" \
    --secret-arn "$SECRET_ARN" \
    --database "$DATABASE_NAME" \
    --transaction-id "$TX_ID" \
    --sql "$SQL" >/dev/null
done

aws rds-data commit-transaction \
  --region "$AWS_REGION" \
  --resource-arn "$CLUSTER_ARN" \
  --secret-arn "$SECRET_ARN" \
  --transaction-id "$TX_ID" >/dev/null
committed=true

CONSTRAINT_DEFINITION_AFTER="$(read_constraint_definition)"
CONSTRAINT_STATE_AFTER="$(constraint_state "$CONSTRAINT_DEFINITION_AFTER")"
echo "POST_MEDIA_VIDEO_CONSTRAINT_STATE_AFTER=$CONSTRAINT_STATE_AFTER"
[[ "$CONSTRAINT_STATE_AFTER" == "VIDEO_READY" ]] || {
  echo "Post media video constraint verification failed after migration." >&2
  exit 1
}
echo "POST_MEDIA_VIDEO_MIGRATION_APPLY_VERIFIED=true"
