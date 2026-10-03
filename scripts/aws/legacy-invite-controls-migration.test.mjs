import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('legacy invite controls migration adds prepare/cancel states without destructive data operations', async () => {
  const sql = await readFile(new URL('../../infra/aws/database/migrations/0060_legacy_invite_controls.sql', import.meta.url), 'utf8')
  assert.match(sql, /'prepared'/)
  assert.match(sql, /'cancelled'/)
  assert.match(sql, /alter column status set default 'prepared'/)
  assert.match(sql, /where status = 'queued'/)
  assert.match(sql, /attempts = 0/)
  assert.doesNotMatch(sql, /drop\s+(table|column|type|schema)|truncate|delete\s+from/i)

  const scriptUrl = new URL('./legacy-invite-controls-migration.sh', import.meta.url)
  const actionUrl = new URL('./legacy-invite-controls-migration-action.txt', import.meta.url)
  const workflowUrl = new URL('../../.github/workflows/aws-legacy-invite-controls-migration.yml', import.meta.url)
  assert.equal(existsSync(scriptUrl), true)
  assert.equal(existsSync(actionUrl), true)
  assert.equal(existsSync(workflowUrl), true)
  assert.ok(['plan', 'migrate-once'].includes((await readFile(actionUrl, 'utf8')).trim()))

  const script = await readFile(scriptUrl, 'utf8')
  assert.match(script, /0060_legacy_invite_controls\.sql/)
  assert.match(script, /plan\|migrate-once/)
  assert.match(script, /LEGACY_INVITE_CONTROLS_PLAN_ONLY_NO_APPLY/)
  assert.match(script, /LEGACY_INVITE_CONTROLS_APPLY_VERIFIED=true/)
})

test('outbox worker limits legacy invitation sweeps to five at a time', async () => {
  const worker = await readFile(new URL('../workers/publish-outbox.ts', import.meta.url), 'utf8')
  assert.match(worker, /createLegacyInviteWorker/)
  assert.match(worker, /legacyInviteWorker\.runSweep\(5\)/)
  assert.match(worker, /LEGACY_INVITE_SWEEP_MS = 60 \* 1000/)
})
