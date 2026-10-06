import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { guardAction } from './guard-value.mjs'

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8')

test('bootstrap disk maintenance is bounded to stale Sea N Shore temp directories', async () => {
  const script = await read('./bootstrap-disk-maintenance.sh')
  const action = guardAction(await read('./bootstrap-disk-maintenance-action.txt'))

  assert.ok(['plan', 'apply-once', 'swap-once', 'grow-root-once'].includes(action))
  assert.match(script, /BOOTSTRAP_DISK_MAINTENANCE_EXPECTED_SHA/)
  assert.match(script, /MIN_AGE_MINUTES=30/)
  assert.match(script, /MIN_FREE_MB=1536/)
  assert.match(script, /find \/var\/tmp/)
  assert.match(script, /-name 'sea-n-shore-\*'/)
  assert.match(script, /-name 'sns-tf\.\*'/)
  assert.match(script, /-mmin \+"\$MIN_AGE_MINUTES"/)
  // Round 14: /tmp is RAM-backed on the host; report memory and remove this user's stale Terraform leftovers there.
  assert.match(script, /find \/tmp -mindepth 1 -maxdepth 1 -user "\$\(id -u\)"/)
  assert.match(script, /-name 'terraform\*' -o -name 'plugin\*' -o -name 'tmp\.\*'/)
  assert.match(script, /\/var\/tmp\/sea-n-shore-\*\|\/var\/tmp\/sns-tf\.\*\|\/tmp\/terraform\*\|\/tmp\/plugin\*\|\/tmp\/tmp\.\*\) ;;/)
  assert.match(script, /BOOTSTRAP_MEM_AVAILABLE_MB=/)
  assert.match(script, /BOOTSTRAP_TMP_USED_MB=/)
  assert.match(script, /pgrep -u "\$\(id -u\)" -x terraform/)
  assert.match(script, /rm -rf -- "\$path"/)
  assert.match(script, /TERRAFORM_STATE_UNCHANGED=true/)
  assert.match(script, /BOOTSTRAP_DISK_MAINTENANCE_PLAN_ONLY_NO_DELETE/)
  assert.match(script, /BOOTSTRAP_DISK_MAINTENANCE_VERIFIED=true/)
  assert.doesNotMatch(script, /rm -rf -- \/(home|etc|var\/lib|var\/log|opt|root)/)
  // Round 15 (F2): swap-once adds a 2 GB swap file and nothing else; it never overwrites a file.
  assert.match(script, /SWAP_FILE="\/swapfile"/)
  assert.match(script, /SWAP_MB=2048/)
  assert.match(script, /exists but is not active swap; refusing to overwrite it/)
  assert.match(script, /\$\(\(SWAP_MB \+ MIN_FREE_MB\)\)/)
  assert.match(script, /sudo -n mkswap "\$SWAP_FILE"/)
  assert.match(script, /sudo -n swapon "\$SWAP_FILE"/)
  assert.match(script, /\/swapfile none swap sw 0 0/)
  assert.match(script, /vm\.swappiness = 10/)
  assert.match(script, /BOOTSTRAP_SWAP_VERIFIED=true/)
  assert.doesNotMatch(script, /sudo -n (rm|swapoff)/)
  // grow-root-once: only the host's own root volume, only up to 20 GB gp3, never a shrink.
  assert.match(script, /ROOT_TARGET_GB=20/)
  assert.match(script, /--size "\$ROOT_TARGET_GB" --volume-type gp3 --dry-run/)
  assert.match(script, /refusing to shrink/)
  assert.match(script, /sudo -n growpart "\$ROOT_DISK" "\$ROOT_PART_NUM"/)
  assert.match(script, /xfs\) sudo -n xfs_growfs -d \//)
  assert.match(script, /BOOTSTRAP_ROOT_GROWN_VERIFIED=true/)
  assert.doesNotMatch(script, /(delete-volume|detach-volume|create-volume|stop-instances|terminate-instances)/)
  assert.doesNotMatch(script, /terraform\s+(-chdir=.*\s+)?(apply|destroy|state rm|force-unlock)/)
})
