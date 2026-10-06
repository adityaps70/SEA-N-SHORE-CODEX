// Round 14 (2.8): migration 0064 only creates the social_action_events table and its two indexes,
// behind the usual plan / migrate-once guard.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { guardAction } from './guard-value.mjs'

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8')

test('migration 0064 is additive: one CREATE TABLE IF NOT EXISTS and two CREATE INDEX IF NOT EXISTS', async () => {
  const sql = await read('../../infra/aws/database/migrations/0064_social_action_quotas.sql')
  const statements = sql.split(/^\s*-- statement-breakpoint\s*$/m)
    .map((part) => part.replace(/^\s*--.*$/gm, '').trim())
    .filter(Boolean)
  assert.equal(statements.length, 3)
  assert.match(statements[0], /^create table if not exists public\.social_action_events \(/)
  assert.match(statements[0], /profile_id uuid not null references public\.profiles\(id\) on delete cascade/)
  assert.match(statements[0], /action text not null check \(action in \('connection_request', 'post', 'comment', 'reaction'\)\)/)
  assert.match(statements[0], /target_profile_id uuid null references public\.profiles\(id\) on delete cascade/)
  assert.match(statements[0], /created_at timestamptz not null default now\(\)/)
  assert.match(statements[1], /^create index if not exists social_action_events_profile_action_created_idx\s+on public\.social_action_events \(profile_id, action, created_at desc\);$/)
  assert.match(statements[2], /^create index if not exists social_action_events_connection_target_idx\s+on public\.social_action_events \(profile_id, target_profile_id, created_at desc\)\s+where action = 'connection_request';$/)
  const code = sql.replace(/^\s*--.*$/gm, '').replace(/\bon delete cascade\b/gi, '')
  assert.doesNotMatch(code, /\b(drop|truncate|delete|update|alter|insert|grant|revoke)\b/i)
})

test('the runner is guarded, transactional and verifies the table and both indexes', async () => {
  const script = await read('./social-action-quotas-migration.sh')
  const action = guardAction(await read('./social-action-quotas-migration-action.txt'))
  const workflow = await read('../../.github/workflows/aws-social-action-quotas-migration.yml')
  const ci = await read('../../.github/workflows/aws-infra-ci.yml')
  assert.ok(['plan', 'migrate-once'].includes(action))
  assert.match(script, /0064_social_action_quotas\.sql/)
  assert.match(script, /expected 3 statements/)
  assert.match(script, /only CREATE TABLE IF NOT EXISTS and CREATE INDEX IF NOT EXISTS on public\.social_action_events are allowed/)
  assert.match(script, /destructive SQL forbidden/)
  assert.match(script, /pg_advisory_xact_lock/)
  assert.match(script, /SET LOCAL lock_timeout = '5s'/)
  assert.match(script, /tablename='social_action_events'/)
  assert.match(script, /social_action_events_profile_action_created_idx/)
  assert.match(script, /social_action_events_connection_target_idx/)
  assert.match(script, /trap cleanup EXIT; trap 'exit 129' HUP; trap 'exit 130' INT; trap 'exit 143' TERM/)
  // A SQL migration runs no Terraform, so it does not queue on the bootstrap Terraform lock.
  assert.doesNotMatch(script, /bootstrap-terraform-lock/)
  assert.match(script, /SOCIAL_ACTION_QUOTAS_PLAN_ONLY_NO_APPLY=true/)
  assert.match(script, /SOCIAL_ACTION_QUOTAS_APPLY_VERIFIED=true/)
  assert.match(script, /SOCIAL_ACTION_QUOTAS_ALREADY_APPLIED=true/)
  assert.match(workflow, /export SOCIAL_ACTION_QUOTAS_EXPECTED_SHA=\{sha\}/)
  assert.match(workflow, /- infra\/aws\/database\/migrations\/0064_social_action_quotas\.sql\n/)
  assert.match(ci, /node --test scripts\/aws\/social-action-quotas-migration\.test\.mjs/)
})
