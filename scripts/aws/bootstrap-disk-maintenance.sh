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
# Round 15 (F2): the t3.micro has 913 MB and no swap; Terraform plans hung on memory in Round 14.
SWAP_FILE="/swapfile"
SWAP_MB=2048

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
source scripts/aws/bootstrap-terraform-lock.sh

ACTION="$(tr -d '[:space:]' < "$ACTION_FILE")"
case "$ACTION" in plan|apply-once|swap-once) ;; *) echo "Unsupported bootstrap disk maintenance action: $ACTION" >&2; exit 1 ;; esac

WORK_DIR="$(mktemp -d /var/tmp/sea-n-shore-bootstrap-disk-maintenance.XXXXXXXX)"
trap 'rm -rf -- "$WORK_DIR"' EXIT; trap 'exit 129' HUP; trap 'exit 130' INT; trap 'exit 143' TERM
aws s3api get-object --bucket "$STATE_BUCKET" --key "$STATE_KEY" --region "$AWS_REGION" "$WORK_DIR/state-before.json" >/dev/null
jq -e '.lineage == "197a6fae-9997-636e-e52b-c3ac6da85d90"' "$WORK_DIR/state-before.json" >/dev/null
STATE_SERIAL_BEFORE="$(jq -r '.serial' "$WORK_DIR/state-before.json")"
FREE_MB_BEFORE="$(df -Pm / | awk 'NR==2 {print $4}')"
echo "STATE_SERIAL_BEFORE=$STATE_SERIAL_BEFORE"
echo "BOOTSTRAP_FREE_MB_BEFORE=$FREE_MB_BEFORE"
echo "BOOTSTRAP_DISK_MAINTENANCE_ACTION=$ACTION"
# Round 14: /tmp is a RAM-backed tmpfs on this host, so its use competes with Terraform for memory.
echo "BOOTSTRAP_TMP_FILESYSTEM=$(findmnt -no FSTYPE /tmp 2>/dev/null || echo unknown)"
echo "BOOTSTRAP_TMP_USED_MB=$(df -Pm /tmp | awk 'NR==2 {print $3}')"
echo "BOOTSTRAP_MEM_AVAILABLE_MB=$(awk '/^MemAvailable:/ {print int($2 / 1024)}' /proc/meminfo)"
echo "BOOTSTRAP_MEM_TOTAL_MB=$(awk '/^MemTotal:/ {print int($2 / 1024)}' /proc/meminfo)"
echo "BOOTSTRAP_SWAP_USED_MB=$(awk '/^SwapTotal:/ {t = $2} /^SwapFree:/ {f = $2} END {print int((t - f) / 1024)}' /proc/meminfo)"
echo "BOOTSTRAP_LOAD_AVERAGE=$(cut -d' ' -f1-3 /proc/loadavg)"
IMDS_TOKEN="$(curl -sS -m 3 -X PUT http://169.254.169.254/latest/api/token -H 'X-aws-ec2-metadata-token-ttl-seconds: 60' 2>/dev/null || true)"
echo "BOOTSTRAP_INSTANCE_TYPE=$(curl -sS -m 3 -H "X-aws-ec2-metadata-token: $IMDS_TOKEN" http://169.254.169.254/latest/meta-data/instance-type 2>/dev/null || echo unknown)"

mapfile -d '' CANDIDATES < <(
  find /var/tmp -mindepth 1 -maxdepth 1 -type d -user "$(id -u)" \
    \( -name 'sea-n-shore-*' -o -name 'sns-tf.*' \) \
    -mmin +"$MIN_AGE_MINUTES" -print0 2>/dev/null
)

# Stale Terraform leftovers (provider staging, plugin sockets, mktemp files) this user left in /tmp.
mapfile -d '' TMP_CANDIDATES < <(
  find /tmp -mindepth 1 -maxdepth 1 -user "$(id -u)" \
    \( -name 'terraform*' -o -name 'plugin*' -o -name 'tmp.*' \) \
    -mmin +"$MIN_AGE_MINUTES" -print0 2>/dev/null
)
CANDIDATES+=("${TMP_CANDIDATES[@]}")

for path in "${CANDIDATES[@]}"; do
  case "$path" in
    /var/tmp/sea-n-shore-*|/var/tmp/sns-tf.*|/tmp/terraform*|/tmp/plugin*|/tmp/tmp.*) ;;
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
echo "BOOTSTRAP_TMP_CLEANUP_CANDIDATE_COUNT=${#TMP_CANDIDATES[@]}"

swap_active() {
  swapon --show=NAME --noheadings 2>/dev/null | grep -qx "$SWAP_FILE"
}
echo "BOOTSTRAP_SWAP_TOTAL_MB=$(awk '/^SwapTotal:/ {print int($2 / 1024)}' /proc/meminfo)"
echo "BOOTSTRAP_SWAP_FILE_ACTIVE=$(swap_active && echo true || echo false)"
echo "BOOTSTRAP_SUDO_AVAILABLE=$(sudo -n true 2>/dev/null && echo true || echo false)"

if [[ "$ACTION" == "swap-once" ]]; then
  # Adds a swap file only; deletes nothing and never touches Terraform state.
  if pgrep -u "$(id -u)" -x terraform >/dev/null 2>&1; then
    echo "A terraform process is still running as this user; refusing to add swap now." >&2
    exit 1
  fi
  [[ "$(git ls-remote origin refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$BOOTSTRAP_DISK_MAINTENANCE_EXPECTED_SHA" ]]
  sudo -n true 2>/dev/null || { echo "ssm-user has no passwordless sudo; cannot add swap." >&2; exit 1; }
  if swap_active; then
    echo "BOOTSTRAP_SWAP_ALREADY_PRESENT=true"
  else
    [[ ! -e "$SWAP_FILE" ]] || { echo "$SWAP_FILE exists but is not active swap; refusing to overwrite it." >&2; exit 1; }
    [[ "$FREE_MB_BEFORE" -ge $((SWAP_MB + MIN_FREE_MB)) ]] || {
      echo "Not enough free disk for a ${SWAP_MB}MB swap file (free ${FREE_MB_BEFORE}MB)." >&2
      exit 1
    }
    sudo -n dd if=/dev/zero of="$SWAP_FILE" bs=1M count="$SWAP_MB" status=none
    sudo -n chmod 600 "$SWAP_FILE"
    sudo -n mkswap "$SWAP_FILE" >/dev/null
    sudo -n swapon "$SWAP_FILE"
  fi
  grep -qE '^/swapfile[[:space:]]' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo -n tee -a /etc/fstab >/dev/null
  # Prefer RAM; swap only absorbs Terraform's peaks.
  echo 'vm.swappiness = 10' | sudo -n tee /etc/sysctl.d/99-sea-n-shore-swap.conf >/dev/null
  sudo -n sysctl -q -w vm.swappiness=10
  swap_active
  SWAP_TOTAL_MB="$(awk '/^SwapTotal:/ {print int($2 / 1024)}' /proc/meminfo)"
  [[ "$SWAP_TOTAL_MB" -ge $((SWAP_MB - 64)) ]]
  grep -qE '^/swapfile[[:space:]]+none[[:space:]]+swap' /etc/fstab
  aws s3api get-object --bucket "$STATE_BUCKET" --key "$STATE_KEY" --region "$AWS_REGION" "$WORK_DIR/state-after.json" >/dev/null
  [[ "$(jq -r '.serial' "$WORK_DIR/state-after.json")" == "$STATE_SERIAL_BEFORE" ]]
  echo "TERRAFORM_STATE_UNCHANGED=true"
  echo "BOOTSTRAP_SWAP_TOTAL_MB_AFTER=$SWAP_TOTAL_MB"
  echo "BOOTSTRAP_SWAPPINESS=$(cat /proc/sys/vm/swappiness)"
  echo "BOOTSTRAP_FREE_MB_AFTER=$(df -Pm / | awk 'NR==2 {print $4}')"
  echo "BOOTSTRAP_SWAP_VERIFIED=true"
  exit 0
fi

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
