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

# Round 14: a few plans on this host never returned; SSM killed them after 30 minutes and left the
# S3 state lock behind. Plans are read-only, so terraform_plan_bounded gives each one
# TERRAFORM_PLAN_TIMEOUT_SECONDS, then interrupts it (Terraform releases its own state lock on
# SIGINT) and retries once. Terraform's debug log goes through a filter that keeps only AWS API
# operation names and log sources, so request and response bodies never reach the disk; on a
# timeout those names show what the plan was waiting on.
# Usage: terraform_plan_bounded <stdout-file> <the usual Terraform arguments>
TERRAFORM_PLAN_TIMEOUT_SECONDS="${TERRAFORM_PLAN_TIMEOUT_SECONDS:-600}"
terraform_plan_bounded() {
  local log="$1" ops attempt status
  shift
  for attempt in 1 2; do
    ops="$(mktemp)"
    status=0
    TF_LOG=DEBUG TF_LOG_PATH=>(grep --line-buffered -oE 'rpc\.method=[A-Za-z0-9]+|\[(DEBUG|INFO|WARN|ERROR)\] [A-Za-z.-]+' > "$ops") \
      timeout --signal=INT --kill-after=120 "$TERRAFORM_PLAN_TIMEOUT_SECONDS" terraform "$@" > "$log" || status=$?
    if [[ "$status" != 124 ]]; then
      rm -f -- "$ops"
      return "$status"
    fi
    sleep 1
    echo "TERRAFORM_PLAN_TIMED_OUT_ATTEMPT=$attempt"
    grep -E '^rpc\.method=' "$ops" | sort | uniq -c | sort -rn | head -n 5 | sed 's/^ */TERRAFORM_PLAN_AWS_CALLS=/' || true
    tail -n 8 "$ops" | sed 's/^/TERRAFORM_PLAN_LAST_LOG=/' || true
    rm -f -- "$ops"
  done
  echo "Terraform plan did not finish within ${TERRAFORM_PLAN_TIMEOUT_SECONDS}s, twice; refusing to continue." >&2
  return 124
}
