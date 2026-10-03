import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

const scriptPath = 'scripts/aws/onboarding-e2e-stale-cleanup.sh'
const actionPath = 'scripts/aws/onboarding-e2e-stale-cleanup-action.txt'
const workflowPath = '.github/workflows/aws-onboarding-e2e-stale-cleanup.yml'

assert.equal(existsSync(scriptPath), true)
assert.equal(existsSync(actionPath), true)
assert.equal(existsSync(workflowPath), true)

const script = readFileSync(scriptPath, 'utf8')
const action = readFileSync(actionPath, 'utf8').trim()
const workflow = readFileSync(workflowPath, 'utf8')

assert.ok(['plan', 'cleanup-once'].includes(action))
assert.match(script, /310356785722/)
assert.match(script, /ONBOARDING_E2E_EXPECTED_SHA/)
assert.ok(script.includes('sea-n-shore-e2e-[0-9]+-'))
assert.ok(script.includes('@example[.]com'))
assert.match(script, /DELETE FROM public\.profiles/i)
assert.match(script, /admin-delete-user/)
assert.match(script, /ONBOARDING_E2E_STALE_CLEANUP_VERIFIED=true/)

assert.match(workflow, /feat\/aws-native-phase-0-1/)
assert.match(workflow, /cleanup-once/)
assert.match(workflow, /Wait for exact-head AWS Infrastructure CI/)
assert.match(workflow, /Guard cleanup against a moved branch/)
assert.match(workflow, /310356785722/)
assert.match(workflow, /ONBOARDING_E2E_EXPECTED_SHA/)
assert.match(workflow, /bash scripts\/aws\/onboarding-e2e-stale-cleanup\.sh/)
assert.match(workflow, /ONBOARDING_E2E_STALE_CLEANUP_VERIFIED=true/)

console.log('ONBOARDING_E2E_STALE_CLEANUP_CONTRACT_VERIFIED=true')
