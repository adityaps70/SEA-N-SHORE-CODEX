import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const workflowPath = '.github/workflows/aws-jobs-intelligence-migration.yml'
const runnerPath = 'scripts/aws/jobs-intelligence-migration.sh'
const actionPath = 'scripts/aws/jobs-intelligence-migration-action.txt'

test('jobs intelligence migration is guarded, exact-head and one-shot', () => {
  const workflow = readFileSync(workflowPath, 'utf8')
  const runner = readFileSync(runnerPath, 'utf8')
  const action = readFileSync(actionPath, 'utf8').trim()

  assert.ok(['plan', 'apply-once'].includes(action), `Unexpected jobs intelligence migration action: ${action}`)
  assert.match(workflow, /workflow_dispatch:/)
  assert.match(workflow, /push:\s*\n\s*branches:\s*\n\s*- feat\/aws-native-phase-0-1/)
  assert.match(workflow, /scripts\/aws\/jobs-intelligence-migration-action\.txt/)
  assert.match(workflow, /environment:\s*staging/)
  assert.match(workflow, /Wait for exact-head AWS Infrastructure CI/)
  assert.match(workflow, /Exact-head AWS Infrastructure CI is not green/)
  assert.match(workflow, /aws-actions\/configure-aws-credentials@v4/)
  assert.match(workflow, /JOBS_INTELLIGENCE_MIGRATION_EXPECTED_SHA/)
  assert.match(workflow, /bash scripts\/aws\/jobs-intelligence-migration\.sh/)

  assert.match(runner, /EXPECTED_ACCOUNT="310356785722"/)
  assert.doesNotMatch(runner, /992382634586/)
  assert.match(runner, /0010_jobs_intelligence\.sql/)
  assert.match(runner, /EXPECTED_STATEMENTS=24/)
  assert.match(runner, /case "\$ACTION" in plan\|apply-once/)
  assert.match(runner, /git ls-remote origin refs\/heads\/feat\/aws-native-phase-0-1/)
  assert.match(runner, /begin-transaction/)
  assert.match(runner, /rollback-transaction/)
  assert.match(runner, /commit-transaction/)
  assert.match(runner, /JOBS_INTELLIGENCE_MIGRATION_PLAN_ONLY_NO_APPLY/)
  assert.match(runner, /JOBS_INTELLIGENCE_MIGRATION_APPLY_VERIFIED=true/)
})

test('jobs intelligence migration verifies the additive live schema and backfills', () => {
  const runner = readFileSync(runnerPath, 'utf8')

  for (const token of [
    'JOBS_COLUMNS',
    'COMPANY_COLUMNS',
    'MEMBER_COLUMNS',
    'NEW_TABLES',
    'NEW_INDEXES',
    'PUBLISHED_WITHOUT_TIMESTAMP',
    'APPLICATIONS_WITHOUT_EVENT',
  ]) assert.match(runner, new RegExp(token))

  assert.match(runner, /Partial or unexpected jobs intelligence schema detected/)
  assert.match(runner, /JOBS_INTELLIGENCE_MIGRATION_ALREADY_APPLIED=true/)
})
