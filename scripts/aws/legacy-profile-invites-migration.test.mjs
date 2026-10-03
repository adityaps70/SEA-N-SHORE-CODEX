import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('legacy invite migration is additive and guarded', async () => {
  const sql = await readFile(new URL('../../infra/aws/database/migrations/0059_legacy_profile_invites.sql', import.meta.url), 'utf8')
  assert.match(sql, /create table if not exists public\.legacy_profile_invites/)
  assert.match(sql, /unique \(profile_id\)/)
  assert.match(sql, /unique \(claim_token\)/)
  assert.match(sql, /legacy_profile_invites_email_unique/)
  assert.doesNotMatch(sql, /drop\s+table|truncate|delete\s+from/i)

  const scriptUrl = new URL('./legacy-profile-invites-migration.sh', import.meta.url)
  const actionUrl = new URL('./legacy-profile-invites-migration-action.txt', import.meta.url)
  const workflowUrl = new URL('../../.github/workflows/aws-legacy-profile-invites-migration.yml', import.meta.url)
  assert.equal(existsSync(scriptUrl), true)
  assert.equal(existsSync(actionUrl), true)
  assert.equal(existsSync(workflowUrl), true)
  assert.ok(['plan', 'migrate-once'].includes((await readFile(actionUrl, 'utf8')).trim()))

  const script = await readFile(scriptUrl, 'utf8')
  assert.match(script, /0059_legacy_profile_invites\.sql/)
  assert.match(script, /plan\|migrate-once/)
  assert.match(script, /LEGACY_PROFILE_INVITES_PLAN_ONLY_NO_APPLY/)
  assert.match(script, /LEGACY_PROFILE_INVITES_APPLY_VERIFIED=true/)
})

test('outbox worker runs bounded legacy invitation sweeps', async () => {
  const worker = await readFile(new URL('../workers/publish-outbox.ts', import.meta.url), 'utf8')
  assert.match(worker, /createLegacyInviteWorker/)
  assert.match(worker, /legacyInviteWorker\.runSweep\(5\)/)
  assert.match(worker, /LEGACY_INVITE_SWEEP_MS = 60 \* 1000/)
})
