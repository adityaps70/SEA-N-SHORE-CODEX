import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const workflowPath = '.github/workflows/aws-onboarding-e2e.yml'
const actionPath = 'scripts/aws/onboarding-e2e-action.txt'

test('onboarding e2e defaults to a safe plan action and is branch-scoped with exact-head CI gating', () => {
  const action = readFileSync(actionPath, 'utf8').trim()
  assert.equal(action, 'plan')

  const workflow = readFileSync(workflowPath, 'utf8')
  assert.match(workflow, /feat\/aws-native-phase-0-1/)
  assert.match(workflow, /scripts\/aws\/onboarding-e2e-action\.txt/)
  assert.match(workflow, /environment:\s*staging/)
  assert.match(workflow, /actions:\s*read/)
  assert.match(workflow, /Wait for exact-head AWS Infrastructure CI/)
  assert.match(workflow, /Exact-head AWS Infrastructure CI is not green/)
  assert.match(workflow, /ONBOARDING_E2E_ACTION/)
  assert.match(workflow, /probe/)
})

test('probe mode is read-only and runs on the staging bootstrap through SSM', () => {
  const workflow = readFileSync(workflowPath, 'utf8')

  assert.match(workflow, /Discover bootstrap instance/)
  assert.match(workflow, /sea-n-shore-bootstrap/)
  assert.match(workflow, /aws ssm send-command/)
  assert.match(workflow, /sea-n-shore-staging-users/)
  assert.match(workflow, /admin-get-user/)
  assert.match(workflow, /UserNotFoundException/)
  assert.match(workflow, /COGNITO_ADMIN_PROBE_AVAILABLE=true/)

  assert.doesNotMatch(workflow, /admin-create-user/)
  assert.doesNotMatch(workflow, /admin-set-user-password/)
  assert.doesNotMatch(workflow, /admin-delete-user/)
  assert.doesNotMatch(workflow, /delete from public\.profiles/i)
})
