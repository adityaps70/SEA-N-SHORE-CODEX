#!/usr/bin/env bash
# Guarded release of a stale Terraform state lock left behind by a guarded run that was killed
# (for example an SSM execution timeout). The action file holds either "plan" or the exact lock
# ID to release; a lock is released only when its recorded metadata matches a dead guarded run.
set -euo pipefail
umask 077
export PATH="$HOME/bin:$PATH"
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="ap-south-1"
STATE_BUCKET="sea-n-shore-310356785722-ap-south-1-tfstate"
STATE_KEY="sea-n-shore/staging/terraform.tfstate"
LOCK_KEY="sea-n-shore/staging/terraform.tfstate.tflock"
APP_DIR="$PWD/infra/aws/app"
ACTION_FILE="scripts/aws/terraform-state-unlock-action.txt"
MIN_LOCK_AGE_SECONDS=900

[[ "${TERRAFORM_STATE_UNLOCK_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "TERRAFORM_STATE_UNLOCK_EXPECTED_SHA must be an exact commit SHA." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$TERRAFORM_STATE_UNLOCK_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- \
  scripts/aws/terraform-state-unlock.sh \
  scripts/aws/terraform-state-unlock-action.txt \
  scripts/aws/terraform-state-unlock.test.mjs \
  .github/workflows/aws-terraform-state-unlock.yml
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]

ACTION="$(tr -d '[:space:]' < "$ACTION_FILE")"
[[ "$ACTION" == "plan" || "$ACTION" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] || {
  echo "Unsupported Terraform state unlock action (plan or an exact lock ID)." >&2
  exit 1
}

WORK_DIR="$(mktemp -d "$PWD/.terraform-state-unlock.XXXXXXXX")"
TF_TMPDIR="$(mktemp -d /var/tmp/sns-tf.XXXXXX)"
trap 'rm -rf -- "$WORK_DIR"; rm -rf -- "$TF_TMPDIR"' EXIT
export TMPDIR="$TF_TMPDIR"

aws s3api get-object --bucket "$STATE_BUCKET" --key "$STATE_KEY" --region "$AWS_REGION" "$WORK_DIR/state.json" > "$WORK_DIR/object.json"
jq -e '.lineage == "197a6fae-9997-636e-e52b-c3ac6da85d90"' "$WORK_DIR/state.json" >/dev/null
echo "STATE_SERIAL=$(jq -r '.serial' "$WORK_DIR/state.json")"

if ! aws s3api get-object --bucket "$STATE_BUCKET" --key "$LOCK_KEY" --region "$AWS_REGION" "$WORK_DIR/lock.json" > "$WORK_DIR/lock-object.json" 2> "$WORK_DIR/lock.err"; then
  grep -q "NoSuchKey" "$WORK_DIR/lock.err" || { cat "$WORK_DIR/lock.err" >&2; exit 1; }
  echo "TERRAFORM_STATE_LOCK=none"
  echo "TERRAFORM_STATE_UNLOCK_ACTION=$ACTION"
  echo "TERRAFORM_STATE_UNLOCK_NOTHING_TO_RELEASE"
  exit 0
fi

LOCK_ID="$(jq -r '.ID // empty' "$WORK_DIR/lock.json")"
LOCK_OPERATION="$(jq -r '.Operation // empty' "$WORK_DIR/lock.json")"
LOCK_WHO="$(jq -r '.Who // empty' "$WORK_DIR/lock.json")"
LOCK_CREATED="$(jq -r '.Created // empty' "$WORK_DIR/lock.json")"
echo "TERRAFORM_STATE_LOCK=$LOCK_ID|$LOCK_OPERATION|$LOCK_WHO|$LOCK_CREATED"
[[ -n "$LOCK_ID" && -n "$LOCK_CREATED" ]]
LOCK_AGE="$(python3 - "$LOCK_CREATED" <<'PY'
import sys
from datetime import datetime, timezone
raw = sys.argv[1].strip()
# Terraform stores RFC3339 with nanoseconds ("2026-09-30T06:25:06.760726784Z"); the CLI prints
# "2026-09-30 06:25:06.760726784 +0000 UTC". Accept both, ignoring sub-second precision.
import re
match = re.match(r'^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})', raw)
if not match:
    raise SystemExit(f'unrecognised lock timestamp: {raw}')
value = datetime.strptime(f'{match.group(1)} {match.group(2)}', '%Y-%m-%d %H:%M:%S').replace(tzinfo=timezone.utc)
print(int((datetime.now(timezone.utc) - value).total_seconds()))
PY
)"
echo "TERRAFORM_STATE_LOCK_AGE_SECONDS=$LOCK_AGE"
echo "TERRAFORM_STATE_UNLOCK_ACTION=$ACTION"

if [[ "$ACTION" == "plan" ]]; then
  echo "TERRAFORM_STATE_UNLOCK_PLAN_ONLY_NO_RELEASE"
  exit 0
fi

[[ "$ACTION" == "$LOCK_ID" ]] || { echo "Lock ID $LOCK_ID does not match the approved ID $ACTION; refusing." >&2; exit 1; }
[[ "$LOCK_WHO" == ssm-user@* ]] || { echo "Lock holder $LOCK_WHO is not a guarded SSM run; refusing." >&2; exit 1; }
[[ "$LOCK_OPERATION" == "OperationTypePlan" || "$LOCK_OPERATION" == "OperationTypeApply" ]] || { echo "Unexpected lock operation $LOCK_OPERATION; refusing." >&2; exit 1; }
[[ "$LOCK_AGE" -ge "$MIN_LOCK_AGE_SECONDS" ]] || { echo "Lock is only $LOCK_AGE seconds old; a live run may still hold it. Refusing." >&2; exit 1; }
if pgrep -u "$(id -u)" -x terraform >/dev/null 2>&1; then
  echo "A terraform process is still running on this instance; refusing to release the lock." >&2
  exit 1
fi
[[ "$(git ls-remote origin refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$TERRAFORM_STATE_UNLOCK_EXPECTED_SHA" ]]

terraform -chdir="$APP_DIR" init -input=false -no-color \
  -backend-config="bucket=$STATE_BUCKET" -backend-config="key=$STATE_KEY" \
  -backend-config="region=$AWS_REGION" -backend-config=use_lockfile=true > "$WORK_DIR/init.log"
echo "RELEASING_STALE_TERRAFORM_STATE_LOCK=$LOCK_ID"
terraform -chdir="$APP_DIR" force-unlock -force "$LOCK_ID" > "$WORK_DIR/unlock.log" 2>&1 || { cat "$WORK_DIR/unlock.log" >&2; exit 1; }
if aws s3api head-object --bucket "$STATE_BUCKET" --key "$LOCK_KEY" --region "$AWS_REGION" > /dev/null 2>&1; then
  echo "Lock object still present after force-unlock." >&2
  exit 1
fi
aws s3api get-object --bucket "$STATE_BUCKET" --key "$STATE_KEY" --region "$AWS_REGION" "$WORK_DIR/state-after.json" > /dev/null
[[ "$(jq -r '.serial' "$WORK_DIR/state-after.json")" == "$(jq -r '.serial' "$WORK_DIR/state.json")" ]]
echo "TERRAFORM_STATE_UNCHANGED=true"
echo "TERRAFORM_STATE_UNLOCK_VERIFIED=true"
