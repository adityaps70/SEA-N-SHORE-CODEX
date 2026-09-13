import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const workflowPath = '.github/workflows/aws-messaging-migration.yml'
const runnerPath = 'scripts/aws/messaging-migration.sh'
const actionPath = 'scripts/aws/messaging-migration-action.txt'
const migrationPath = 'infra/aws/database/migrations/0014_messaging.sql'

test('messaging migration is guarded, exact-head, fail-closed and one-shot', () => {
  const workflow = readFileSync(workflowPath, 'utf8')
  const runner = readFileSync(runnerPath, 'utf8')
  const action = readFileSync(actionPath, 'utf8').trim()
  const migration = readFileSync(migrationPath, 'utf8')

  assert.ok(['plan', 'apply-once'].includes(action), `Unexpected messaging migration action: ${action}`)
  assert.match(workflow, /workflow_dispatch:/)
  assert.match(workflow, /Wait for exact-head AWS Infrastructure CI/)
  assert.match(workflow, /Guard migration against a moved branch/)
  assert.match(workflow, /environment:\s*staging/)
  assert.match(workflow, /MESSAGING_MIGRATION_EXPECTED_SHA/)
  assert.match(workflow, /bash scripts\/aws\/messaging-migration\.sh/)

  assert.match(runner, /EXPECTED_ACCOUNT="310356785722"/)
  assert.doesNotMatch(runner, /992382634586/)
  assert.match(runner, /0014_messaging\.sql/)
  assert.match(runner, /case "\$ACTION" in plan\|apply-once/)
  assert.match(runner, /git ls-remote origin refs\/heads\/feat\/aws-native-phase-0-1/)
  assert.match(runner, /statement-breakpoint/)
  assert.match(runner, /begin-transaction/)
  assert.match(runner, /rollback-transaction/)
  assert.match(runner, /commit-transaction/)
  assert.match(runner, /Partial or unexpected messaging schema detected/)
  assert.match(runner, /MESSAGING_MIGRATION_PLAN_ONLY_NO_APPLY/)
  assert.match(runner, /MESSAGING_MIGRATION_APPLY_VERIFIED=true/)
  assert.match(runner, /information_schema\.tables/)
  assert.match(runner, /information_schema\.columns/)
  assert.match(runner, /pg_indexes/)
  assert.match(runner, /pg_trigger/)
  assert.match(runner, /pg_constraint/)

  assert.match(migration, /create table public\.conversations/i)
  assert.match(migration, /create table public\.messages/i)
  assert.match(migration, /create table public\.conversation_participants/i)
  assert.match(migration, /create trigger conversations_set_updated_at/i)
})
