import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const workflowPath = '.github/workflows/aws-organization-hiring-approval-migration.yml'
const runnerPath = 'scripts/aws/organization-hiring-approval-migration.sh'
const actionPath = 'scripts/aws/organization-hiring-approval-migration-action.txt'

test('organization hiring approval migration is guarded, exact-head and one-shot', () => {
  const workflow = readFileSync(workflowPath, 'utf8')
  const runner = readFileSync(runnerPath, 'utf8')
  const action = readFileSync(actionPath, 'utf8').trim()

  assert.ok(['plan', 'apply-once'].includes(action), `Unexpected organization hiring approval migration action: ${action}`)
  assert.match(workflow, /workflow_dispatch:/)
  assert.match(workflow, /push:\s*\n\s*branches:\s*\n\s*- feat\/aws-native-phase-0-1/)
  assert.match(workflow, /scripts\/aws\/organization-hiring-approval-migration-action\.txt/)
  assert.match(workflow, /environment:\s*staging/)
  assert.match(workflow, /Wait for exact-head AWS Infrastructure CI/)
  assert.match(workflow, /Exact-head AWS Infrastructure CI is not green/)
  assert.match(workflow, /aws-actions\/configure-aws-credentials@v4/)
  assert.match(workflow, /ORGANIZATION_HIRING_APPROVAL_MIGRATION_EXPECTED_SHA/)
  assert.match(workflow, /bash scripts\/aws\/organization-hiring-approval-migration\.sh/)

  assert.match(runner, /EXPECTED_ACCOUNT="310356785722"/)
  assert.doesNotMatch(runner, /992382634586/)
  assert.match(runner, /0011_organization_hiring_approval\.sql/)
  assert.match(runner, /EXPECTED_STATEMENTS=9/)
  assert.match(runner, /case "\$ACTION" in plan\|apply-once/)
  assert.match(runner, /git ls-remote origin refs\/heads\/feat\/aws-native-phase-0-1/)
  assert.match(runner, /begin-transaction/)
  assert.match(runner, /rollback-transaction/)
  assert.match(runner, /commit-transaction/)
  assert.match(runner, /ORGANIZATION_HIRING_APPROVAL_MIGRATION_PLAN_ONLY_NO_APPLY/)
  assert.match(runner, /ORGANIZATION_HIRING_APPROVAL_MIGRATION_APPLY_VERIFIED=true/)
})

test('organization hiring approval migration verifies live additive shape and compatibility debt', () => {
  const runner = readFileSync(runnerPath, 'utf8')

  for (const token of [
    'ORGANIZATION_APPLICATION_COLUMNS',
    'ACCESS_REQUEST_COLUMNS',
    'NEW_INDEXES',
    'COMPATIBILITY_DEBT',
  ]) assert.match(runner, new RegExp(token))

  assert.match(runner, /EXPECTED_ORGANIZATION_APPLICATION_COLUMNS=13/)
  assert.match(runner, /EXPECTED_ACCESS_REQUEST_COLUMNS=11/)
  assert.match(runner, /EXPECTED_NEW_INDEXES=6/)
  assert.match(runner, /Partial or unexpected organization hiring approval schema detected/)
  assert.match(runner, /ORGANIZATION_HIRING_APPROVAL_MIGRATION_ALREADY_APPLIED=true/)
})
