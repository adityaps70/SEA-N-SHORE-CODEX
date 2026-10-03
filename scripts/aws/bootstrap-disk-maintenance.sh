#!/usr/bin/env bash
set -euo pipefail
umask 077
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="ap-south-1"
STATE_BUCKET="sea-n-shore-310356785722-ap-south-1-tfstate"
STATE_KEY="sea-n-shore/staging/terraform.tfstate"
ACTION_FILE="scripts/aws/bootstrap-disk-maintenance-action.txt"
MIN_AGE_MINUTES=30
MIN_FREE_MB=1536

[[ "${BOOTSTRAP_DISK_MAINTENANCE_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "BOOTSTRAP_DISK_MAINTENANCE_EXPECTED_SHA must be an exact commit SHA." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$BOOTSTRAP_DISK_MAINTENANCE_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- \
  scripts/aws/bootstrap-disk-maintenance.sh \
  scripts/aws/bootstrap-disk-maintenance-action.txt \
  scripts/aws/bootstrap-disk-maintenance.test.mjs \
  .github/workflows/aws-bootstrap-disk-maintenance.yml
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]

ACTION="$(tr -d '[:space:]' < "$ACTION_FILE")"
case "$ACTION" in plan|apply-once) ;; *) echo "Unsupported bootstrap disk maintenance action: $ACTION" >&2; exit 1 ;; esac

WORK_DIR="$(mktemp -d /var/tmp/sea-n-shore-bootstrap-disk-maintenance.XXXXXXXX)"
trap 'rm -rf -- "$WORK_DIR"' EXIT
aws s3api get-object --bucket "$STATE_BUCKET" --key "$STATE_KEY" --region "$AWS_REGION" "$WORK_DIR/state-before.json" >/dev/null
jq -e '.lineage == "197a6fae-9997-636e-e52b-c3ac6da85d90"' "$WORK_DIR/state-before.json" >/dev/null
STATE_SERIAL_BEFORE="$(jq -r '.serial' "$WORK_DIR/state-before.json")"
FREE_MB_BEFORE="$(df -Pm / | awk 'NR==2 {print $4}')"
echo "STATE_SERIAL_BEFORE=$STATE_SERIAL_BEFORE"
echo "BOOTSTRAP_FREE_MB_BEFORE=$FREE_MB_BEFORE"
echo "BOOTSTRAP_DISK_MAINTENANCE_ACTION=$ACTION"

mapfile -d '' CANDIDATES < <(
  find /var/tmp -mindepth 1 -maxdepth 1 -type d -user "$(id -u)" \
    \( -name 'sea-n-shore-*' -o -name 'sns-tf.*' \) \
    -mmin +"$MIN_AGE_MINUTES" -print0 2>/dev/null
)

for path in "${CANDIDATES[@]}"; do
  case "$path" in
    /var/tmp/sea-n-shore-*|/var/tmp/sns-tf.*) ;;
    *) echo "Refusing unexpected cleanup path: $path" >&2; exit 1 ;;
  esac
done

CANDIDATE_COUNT="${#CANDIDATES[@]}"
CANDIDATE_BYTES=0
for path in "${CANDIDATES[@]}"; do
  bytes="$(du -sb -- "$path" 2>/dev/null | awk '{print $1}' || echo 0)"
  CANDIDATE_BYTES=$((CANDIDATE_BYTES + bytes))
done
echo "BOOTSTRAP_CLEANUP_CANDIDATE_COUNT=$CANDIDATE_COUNT"
echo "BOOTSTRAP_CLEANUP_CANDIDATE_BYTES=$CANDIDATE_BYTES"

echo "BOOTSTRAP_VAR_TMP_TOP_USAGE_BEGIN"
du -x -m -d 1 /var/tmp 2>/dev/null | sort -nr | head -n 20 || true
echo "BOOTSTRAP_VAR_TMP_TOP_USAGE_END"

if [[ "$ACTION" == "plan" ]]; then
  echo "BOOTSTRAP_DISK_MAINTENANCE_PLAN_ONLY_NO_DELETE"
  exit 0
fi

if pgrep -u "$(id -u)" -x terraform >/dev/null 2>&1; then
  echo "A terraform process is still running as this user; refusing cleanup." >&2
  exit 1
fi
[[ "$(git ls-remote origin refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$BOOTSTRAP_DISK_MAINTENANCE_EXPECTED_SHA" ]]

for path in "${CANDIDATES[@]}"; do
  rm -rf -- "$path"
done
sync

FREE_MB_AFTER="$(df -Pm / | awk 'NR==2 {print $4}')"
aws s3api get-object --bucket "$STATE_BUCKET" --key "$STATE_KEY" --region "$AWS_REGION" "$WORK_DIR/state-after.json" >/dev/null
STATE_SERIAL_AFTER="$(jq -r '.serial' "$WORK_DIR/state-after.json")"
[[ "$STATE_SERIAL_AFTER" == "$STATE_SERIAL_BEFORE" ]]
echo "STATE_SERIAL_AFTER=$STATE_SERIAL_AFTER"
echo "TERRAFORM_STATE_UNCHANGED=true"
echo "BOOTSTRAP_FREE_MB_AFTER=$FREE_MB_AFTER"
echo "BOOTSTRAP_FREED_MB=$((FREE_MB_AFTER - FREE_MB_BEFORE))"
[[ "$FREE_MB_AFTER" -ge "$MIN_FREE_MB" ]] || {
  echo "Bootstrap still has less than ${MIN_FREE_MB}MB free after bounded cleanup." >&2
  exit 1
}
echo "BOOTSTRAP_DISK_MAINTENANCE_VERIFIED=true"
