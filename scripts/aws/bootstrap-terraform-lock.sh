# Sourced by every Terraform runner on the bootstrap host before it reads or writes state, and by
# disk maintenance. One holds the lock at a time; the others wait their turn (queued, never
# cancelled) for up to TERRAFORM_HOST_LOCK_WAIT_SECONDS. The lock is released when the runner exits.
# The wait stays well inside each runner's SSM executionTimeout, so a queued run never outlives the
# workflow that is watching it.
TERRAFORM_HOST_LOCK_FILE="/var/tmp/sea-n-shore-terraform-host.lock"
TERRAFORM_HOST_LOCK_WAIT_SECONDS="${TERRAFORM_HOST_LOCK_WAIT_SECONDS:-600}"
command -v flock >/dev/null 2>&1 || { echo "flock is required on the bootstrap host." >&2; exit 1; }
[[ -e "$TERRAFORM_HOST_LOCK_FILE" ]] || (umask 0111 && : >> "$TERRAFORM_HOST_LOCK_FILE")
exec 9>>"$TERRAFORM_HOST_LOCK_FILE"
TERRAFORM_HOST_LOCK_WAIT_STARTED=$SECONDS
flock -w "$TERRAFORM_HOST_LOCK_WAIT_SECONDS" 9 || {
  echo "Another Terraform runner held the bootstrap host for over ${TERRAFORM_HOST_LOCK_WAIT_SECONDS}s; refusing to queue longer." >&2
  exit 1
}
echo "BOOTSTRAP_TERRAFORM_HOST_LOCK_WAITED_SECONDS=$((SECONDS - TERRAFORM_HOST_LOCK_WAIT_STARTED))"

# Terraform stages provider downloads and plugin sockets in TMPDIR. The host's /tmp is a small
# RAM-backed tmpfs: what runs killed by SSM leave there eats memory until the next Terraform run
# swaps and stalls. Every runner therefore works in a short directory on the main volume (disk
# maintenance removes stale ones); a runner that already made its own keeps it.
if [[ "${TMPDIR:-/tmp}" == /tmp || "${TMPDIR:-/tmp}" == /tmp/* ]]; then
  TMPDIR="$(mktemp -d /var/tmp/sns-tf.XXXXXX)"
  export TMPDIR
fi

# Round 14: the bootstrap host is a t3.micro (913 MB, no swap, /tmp in RAM). The AWS provider needs
# several hundred MB for a plan, so with anything else resident Terraform could run out of memory
# and grind for half an hour until SSM killed it, leaving the S3 state lock behind. Keep its
# footprint down: a soft Go heap limit (Terraform and its providers honour GOMEMLIMIT) and fewer
# concurrent operations.
export GOMEMLIMIT="${GOMEMLIMIT:-320MiB}"
export TF_CLI_ARGS_plan="${TF_CLI_ARGS_plan:--parallelism=4}"
export TF_CLI_ARGS_apply="${TF_CLI_ARGS_apply:--parallelism=4}"
echo "BOOTSTRAP_MEM_AVAILABLE_MB=$(awk '/^MemAvailable:/ {print int($2 / 1024)}' /proc/meminfo)"

# Plans are read-only, so terraform_plan_bounded gives each one TERRAFORM_PLAN_TIMEOUT_SECONDS,
# then interrupts it (Terraform releases its own state lock on SIGINT) and retries once. A plan
# that ignores the interrupt is killed two minutes later; its lock then stays behind for the
# state-unlock runner, so that case is not retried.
# Usage: terraform_plan_bounded <stdout-file> <the usual Terraform arguments>
TERRAFORM_PLAN_TIMEOUT_SECONDS="${TERRAFORM_PLAN_TIMEOUT_SECONDS:-600}"
terraform_plan_bounded() {
  local log="$1" attempt status
  shift
  for attempt in 1 2; do
    status=0
    timeout --signal=INT --kill-after=120 "$TERRAFORM_PLAN_TIMEOUT_SECONDS" terraform "$@" > "$log" || status=$?
    [[ "$status" == 124 || "$status" == 137 ]] || return "$status"
    echo "TERRAFORM_PLAN_TIMED_OUT_ATTEMPT=$attempt"
    echo "TERRAFORM_PLAN_TIMED_OUT_MEM_AVAILABLE_MB=$(awk '/^MemAvailable:/ {print int($2 / 1024)}' /proc/meminfo)"
    if [[ "$status" == 137 ]]; then
      echo "Terraform plan ignored the interrupt and was killed; release its state lock with the state-unlock runner." >&2
      return 137
    fi
  done
  echo "Terraform plan did not finish within ${TERRAFORM_PLAN_TIMEOUT_SECONDS}s, twice; refusing to continue." >&2
  return 124
}
