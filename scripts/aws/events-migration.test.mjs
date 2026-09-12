import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const workflowPath = '.github/workflows/aws-events-migration.yml'
const runnerPath = 'scripts/aws/events-migration.sh'
const actionPath = 'scripts/aws/events-migration-action.txt'

test('events migration is guarded, exact-head and one-shot', () => {
  const workflow = readFileSync(workflowPath, 'utf8')
  const runner = readFileSync(runnerPath, 'utf8')
  const action = readFileSync(actionPath, 'utf8').trim()

  assert.ok(['plan', 'apply-once'].includes(action), `Unexpected events migration action: ${action}`)
  assert.match(workflow, /workflow_dispatch:/)
  assert.match(workflow, /Wait for exact-head AWS Infrastructure CI/)
  assert.match(workflow, /environment:\s*staging/)
  assert.match(workflow, /EVENTS_MIGRATION_EXPECTED_SHA/)
  assert.match(workflow, /bash scripts\/aws\/events-migration\.sh/)
  assert.match(runner, /EXPECTED_ACCOUNT="310356785722"/)
  assert.doesNotMatch(runner, /992382634586/)
  assert.match(runner, /0012_events_engine\.sql/)
  assert.match(runner, /case "\$ACTION" in plan\|apply-once/)
  assert.match(runner, /git ls-remote origin refs\/heads\/feat\/aws-native-phase-0-1/)
  assert.match(runner, /begin-transaction/)
  assert.match(runner, /rollback-transaction/)
  assert.match(runner, /commit-transaction/)
  assert.match(runner, /EVENTS_MIGRATION_PLAN_ONLY_NO_APPLY/)
  assert.match(runner, /EVENTS_MIGRATION_APPLY_VERIFIED=true/)
})
