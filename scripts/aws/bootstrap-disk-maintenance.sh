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
# Round 15 follow-up: grow the root EBS volume to 20 GB gp3 and extend the filesystem.
ROOT_TARGET_GB=20

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
case "$ACTION" in plan|apply-once|swap-once|grow-root-once) ;; *) echo "Unsupported bootstrap disk maintenance action: $ACTION" >&2; exit 1 ;; esac

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

INSTANCE_ID="$(curl -sS -m 3 -H "X-aws-ec2-metadata-token: $IMDS_TOKEN" http://169.254.169.254/latest/meta-data/instance-id 2>/dev/null || true)"
ROOT_DEVICE_NAME="$(aws ec2 describe-instances --region "$AWS_REGION" --instance-ids "$INSTANCE_ID" --query 'Reservations[0].Instances[0].RootDeviceName' --output text 2>/dev/null || echo unknown)"
ROOT_VOLUME_ID="$(aws ec2 describe-instances --region "$AWS_REGION" --instance-ids "$INSTANCE_ID" --query "Reservations[0].Instances[0].BlockDeviceMappings[?DeviceName=='$ROOT_DEVICE_NAME'].Ebs.VolumeId | [0]" --output text 2>/dev/null || echo unknown)"
ROOT_VOLUME_JSON="$(aws ec2 describe-volumes --region "$AWS_REGION" --volume-ids "$ROOT_VOLUME_ID" --query 'Volumes[0].{size:Size,type:VolumeType,iops:Iops,throughput:Throughput}' --output json 2>/dev/null || echo '{}')"
echo "BOOTSTRAP_ROOT_VOLUME_ID=$ROOT_VOLUME_ID"
echo "BOOTSTRAP_ROOT_VOLUME=$(jq -c . <<<"$ROOT_VOLUME_JSON")"
echo "BOOTSTRAP_ROOT_FILESYSTEM=$(findmnt -no FSTYPE / 2>/dev/null || echo unknown) $(findmnt -no SOURCE / 2>/dev/null || echo unknown)"
echo "BOOTSTRAP_ROOT_FS_SIZE_MB=$(df -Pm / | awk 'NR==2 {print $2}')"
# Whether this host may modify its own root volume (a dry run changes nothing).
if aws ec2 modify-volume --region "$AWS_REGION" --volume-id "$ROOT_VOLUME_ID" --size "$ROOT_TARGET_GB" --volume-type gp3 --dry-run >/dev/null 2>"$WORK_DIR/dry-run.err" || grep -q DryRunOperation "$WORK_DIR/dry-run.err"; then
  echo "BOOTSTRAP_ROOT_MODIFY_ALLOWED=true"
else
  echo "BOOTSTRAP_ROOT_MODIFY_ALLOWED=false ($(grep -o 'An error occurred ([A-Za-z]*)' "$WORK_DIR/dry-run.err" | head -n 1))"
fi

if [[ "$ACTION" == "grow-root-once" ]]; then
  # Grows the root volume and its filesystem only; deletes nothing and never touches Terraform state.
  if pgrep -u "$(id -u)" -x terraform >/dev/null 2>&1; then
    echo "A terraform process is still running as this user; refusing to grow the root volume now." >&2
    exit 1
  fi
  [[ "$(bash scripts/aws/branch-head.sh refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$BOOTSTRAP_DISK_MAINTENANCE_EXPECTED_SHA" ]]
  sudo -n true 2>/dev/null || { echo "ssm-user has no passwordless sudo; cannot extend the filesystem." >&2; exit 1; }
  [[ "$ROOT_VOLUME_ID" == vol-* ]] || { echo "Could not identify the root volume." >&2; exit 1; }
  CURRENT_GB="$(jq -r '.size // 0' <<<"$ROOT_VOLUME_JSON")"
  CURRENT_TYPE="$(jq -r '.type // ""' <<<"$ROOT_VOLUME_JSON")"
  [[ "$CURRENT_GB" -le "$ROOT_TARGET_GB" ]] || { echo "The root volume is already larger than ${ROOT_TARGET_GB} GB; refusing to shrink." >&2; exit 1; }
  if [[ "$CURRENT_GB" -lt "$ROOT_TARGET_GB" || "$CURRENT_TYPE" != gp3 ]]; then
    aws ec2 modify-volume --region "$AWS_REGION" --volume-id "$ROOT_VOLUME_ID" --size "$ROOT_TARGET_GB" --volume-type gp3 >/dev/null
  fi
  for attempt in $(seq 1 60); do
    STATE="$(aws ec2 describe-volumes-modifications --region "$AWS_REGION" --volume-ids "$ROOT_VOLUME_ID" --query 'VolumesModifications[0].ModificationState' --output text 2>/dev/null || echo none)"
    SIZE_NOW="$(aws ec2 describe-volumes --region "$AWS_REGION" --volume-ids "$ROOT_VOLUME_ID" --query 'Volumes[0].Size' --output text)"
    # The new size is usable once the modification is optimizing or completed.
    if [[ "$SIZE_NOW" == "$ROOT_TARGET_GB" && ( "$STATE" == optimizing || "$STATE" == completed || "$STATE" == none ) ]]; then break; fi
    sleep 10
  done
  [[ "$SIZE_NOW" == "$ROOT_TARGET_GB" ]] || { echo "The root volume did not reach ${ROOT_TARGET_GB} GB." >&2; exit 1; }
  ROOT_SOURCE="$(findmnt -no SOURCE /)"
  ROOT_DISK="/dev/$(lsblk -no PKNAME "$ROOT_SOURCE")"
  ROOT_PART_NUM="$(cat "/sys/class/block/$(basename "$ROOT_SOURCE")/partition" 2>/dev/null || echo "")"
  sleep 5
  if [[ -n "$ROOT_PART_NUM" ]]; then
    sudo -n growpart "$ROOT_DISK" "$ROOT_PART_NUM" || echo "growpart reported no change (already grown)."
  fi
  case "$(findmnt -no FSTYPE /)" in
    xfs) sudo -n xfs_growfs -d / >/dev/null ;;
    ext4) sudo -n resize2fs "$ROOT_SOURCE" >/dev/null ;;
    *) echo "Unsupported root filesystem; refusing to resize." >&2; exit 1 ;;
  esac
  aws s3api get-object --bucket "$STATE_BUCKET" --key "$STATE_KEY" --region "$AWS_REGION" "$WORK_DIR/state-after.json" >/dev/null
  [[ "$(jq -r '.serial' "$WORK_DIR/state-after.json")" == "$STATE_SERIAL_BEFORE" ]]
  FS_SIZE_AFTER_MB="$(df -Pm / | awk 'NR==2 {print $2}')"
  [[ "$FS_SIZE_AFTER_MB" -ge $(( (ROOT_TARGET_GB - 1) * 1000 )) ]] || { echo "The root filesystem did not grow (size ${FS_SIZE_AFTER_MB} MB)." >&2; exit 1; }
  echo "TERRAFORM_STATE_UNCHANGED=true"
  echo "BOOTSTRAP_ROOT_VOLUME_AFTER=$(aws ec2 describe-volumes --region "$AWS_REGION" --volume-ids "$ROOT_VOLUME_ID" --query 'Volumes[0].{size:Size,type:VolumeType,iops:Iops,throughput:Throughput}' --output json | jq -c .)"
  echo "BOOTSTRAP_ROOT_FS_SIZE_MB_AFTER=$FS_SIZE_AFTER_MB"
  echo "BOOTSTRAP_FREE_MB_AFTER=$(df -Pm / | awk 'NR==2 {print $4}')"
  echo "BOOTSTRAP_ROOT_GROWN_VERIFIED=true"
  exit 0
fi

if [[ "$ACTION" == "swap-once" ]]; then
  # Adds a swap file only; deletes nothing and never touches Terraform state.
  if pgrep -u "$(id -u)" -x terraform >/dev/null 2>&1; then
    echo "A terraform process is still running as this user; refusing to add swap now." >&2
    exit 1
  fi
  [[ "$(bash scripts/aws/branch-head.sh refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$BOOTSTRAP_DISK_MAINTENANCE_EXPECTED_SHA" ]]
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
[[ "$(bash scripts/aws/branch-head.sh refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$BOOTSTRAP_DISK_MAINTENANCE_EXPECTED_SHA" ]]

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
