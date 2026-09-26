import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

const workflowPath = '.github/workflows/aws-membership-launch-sequence.yml'
const helperPath = 'scripts/aws/membership-launch-sequence.mjs'
const guardPaths = [
  'scripts/aws/membership-access-migration-action.txt',
  'scripts/aws/staging-deploy-action.txt',
  'scripts/aws/onboarding-e2e-action.txt',
]

test('membership launch sequence is manual-only and requires exact explicit approval', () => {
  assert.equal(existsSync(workflowPath), true, `${workflowPath} must exist`)
  const workflow = readFileSync(workflowPath, 'utf8')

  assert.match(workflow, /^on:\n\s+workflow_dispatch:/m)
  assert.doesNotMatch(workflow, /^\s+push:/m)
  assert.match(workflow, /expected_sha:/)
  assert.match(workflow, /confirmation:/)
  assert.match(workflow, /I_APPROVE_MEMBERSHIP_STAGING_ONE_SHOT/)
  assert.match(workflow, /environment:\s*staging/)
  assert.match(workflow, /contents:\s*write/)
  assert.match(workflow, /actions:\s*write/)
  assert.match(workflow, /concurrency:/)
  assert.match(workflow, /sea-n-shore-membership-launch-sequence/)
})

test('launch helper enforces exact branch head and green exact-head infrastructure CI', () => {
  assert.equal(existsSync(helperPath), true, `${helperPath} must exist`)
  const helper = readFileSync(helperPath, 'utf8')

  assert.match(helper, /feat\/aws-native-phase-0-1/)
  assert.match(helper, /expectedSha/)
  assert.match(helper, /AWS Infrastructure CI/)
  assert.match(helper, /head_sha/)
  assert.match(helper, /conclusion/)
  assert.match(helper, /success/)
  assert.match(helper, /branch moved/i)
})

test('launch helper executes migration then deploy then onboarding e2e in strict order', () => {
  const helper = readFileSync(helperPath, 'utf8')

  const migration = helper.indexOf('migrate-once')
  const deploy = helper.indexOf('deploy-once')
  const e2e = helper.indexOf('run-once')

  assert.ok(migration >= 0, 'migration arm must exist')
  assert.ok(deploy > migration, 'deploy must be sequenced after migration')
  assert.ok(e2e > deploy, 'E2E must be sequenced after deploy')

  assert.match(helper, /AWS Membership Access Migration/)
  assert.match(helper, /AWS Staging Deploy/)
  assert.match(helper, /AWS Onboarding E2E/)
  assert.match(helper, /waitForWorkflowRun/)
})

test('launch sequence defines runtime cleanup and rearms every execution guard to plan even on failure', () => {
  const workflow = readFileSync(workflowPath, 'utf8')
  const helper = readFileSync(helperPath, 'utf8')

  assert.match(workflow, /if:\s*always\(\)/)
  assert.match(workflow, /rearm/)
  assert.match(helper, /async function rearmAllGuards\s*\(/)
  for (const path of guardPaths) assert.ok(helper.includes(path), `${path} must be rearmed`)
  assert.match(helper, /'plan'/)
})

test('execution guards allow only one approved one-shot stage at a time', () => {
  const allowed = [
    new Set(['plan', 'migrate-once']),
    new Set(['plan', 'deploy-once']),
    new Set(['plan', 'run-once']),
  ]
  const states = guardPaths.map((path) => readFileSync(path, 'utf8').trim())

  states.forEach((state, index) => {
    assert.equal(allowed[index].has(state), true, `${guardPaths[index]} has unsupported state ${state}`)
  })

  const armed = states.filter((state) => state !== 'plan')
  assert.ok(armed.length <= 1, `only one one-shot stage may be armed, found: ${armed.join(', ')}`)
})
