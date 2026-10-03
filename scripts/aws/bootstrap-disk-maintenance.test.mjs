import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8')

test('bootstrap disk maintenance is bounded to stale Sea N Shore temp directories', async () => {
  const script = await read('./bootstrap-disk-maintenance.sh')
  const action = (await read('./bootstrap-disk-maintenance-action.txt')).trim()

  assert.ok(['plan', 'apply-once'].includes(action))
  assert.match(script, /BOOTSTRAP_DISK_MAINTENANCE_EXPECTED_SHA/)
  assert.match(script, /MIN_AGE_MINUTES=30/)
  assert.match(script, /MIN_FREE_MB=1536/)
  assert.match(script, /find \/var\/tmp/)
  assert.match(script, /-name 'sea-n-shore-\*'/)
  assert.match(script, /-name 'sns-tf\.\*'/)
  assert.match(script, /-mmin \+"\$MIN_AGE_MINUTES"/)
  assert.match(script, /pgrep -u "\$\(id -u\)" -x terraform/)
  assert.match(script, /rm -rf -- "\$path"/)
  assert.match(script, /TERRAFORM_STATE_UNCHANGED=true/)
  assert.match(script, /BOOTSTRAP_DISK_MAINTENANCE_PLAN_ONLY_NO_DELETE/)
  assert.match(script, /BOOTSTRAP_DISK_MAINTENANCE_VERIFIED=true/)
  assert.doesNotMatch(script, /rm -rf -- \/(home|etc|var\/lib|var\/log|opt|root)/)
  assert.doesNotMatch(script, /terraform\s+(-chdir=.*\s+)?(apply|destroy|state rm|force-unlock)/)
})
