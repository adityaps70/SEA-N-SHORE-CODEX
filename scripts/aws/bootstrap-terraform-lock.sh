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
