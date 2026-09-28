import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

const scriptPath = 'scripts/aws/staging-data-cleanup.sh'
const actionPath = 'scripts/aws/staging-data-cleanup-action.txt'
const workflowPath = '.github/workflows/aws-staging-data-cleanup.yml'

assert.equal(existsSync(scriptPath), true, 'missing staging data cleanup runner')
assert.equal(existsSync(actionPath), true, 'missing staging data cleanup action guard')
assert.equal(existsSync(workflowPath), true, 'missing staging data cleanup workflow')

const script = readFileSync(scriptPath, 'utf8')
const action = readFileSync(actionPath, 'utf8').trim()
const workflow = readFileSync(workflowPath, 'utf8')

assert.ok(['plan', 'cleanup-once'].includes(action), 'cleanup guard must be plan or cleanup-once')

assert.match(script, /EXPECTED_ACCOUNT="310356785722"/)
assert.match(script, /STAGING_DATA_CLEANUP_EXPECTED_SHA/)
assert.match(script, /sea-n-shore-.*@example\[\.\]com/)
assert.match(script, /legacy_organization_conversions/)
assert.match(script, /status[^\n]+pending/)
assert.match(script, /seller_earnings/)
assert.match(script, /payout_accounts/)
assert.match(script, /payouts/)
assert.match(script, /event_payment_orders/)
assert.match(script, /course_payment_orders/)
assert.match(script, /subscription_payments/)
assert.match(script, /STAGING_DATA_CLEANUP_FINANCIAL_PROTECTED/)
assert.match(script, /STAGING_DATA_CLEANUP_PLAN_VERIFIED=true/)
assert.match(script, /STAGING_DATA_CLEANUP_APPLY_VERIFIED=true/)
assert.match(script, /admin-delete-user/)

assert.match(workflow, /feat\/aws-native-phase-0-1/)
assert.match(workflow, /cleanup-once/)
assert.match(workflow, /Wait for exact-head AWS Infrastructure CI/)
assert.match(workflow, /Guard cleanup against a moved branch/)
assert.match(workflow, /STAGING_DATA_CLEANUP_EXPECTED_SHA/)
assert.match(workflow, /bash scripts\/aws\/staging-data-cleanup\.sh/)
assert.match(workflow, /STAGING_DATA_CLEANUP_PLAN_VERIFIED=true/)
assert.match(workflow, /STAGING_DATA_CLEANUP_APPLY_VERIFIED=true/)

console.log('STAGING_DATA_CLEANUP_CONTRACT_VERIFIED=true')
