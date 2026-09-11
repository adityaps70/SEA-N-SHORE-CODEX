import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

const actionPath = 'scripts/aws/organization-hiring-e2e-action.txt'
const workflowPath = '.github/workflows/aws-organization-hiring-e2e.yml'
const browserScriptPath = 'scripts/aws/organization-hiring-staging-e2e.mjs'

test('organization hiring e2e is plan-only by default and exact-head branch gated', () => {
  assert.equal(existsSync(actionPath), true, `${actionPath} must exist`)
  assert.equal(readFileSync(actionPath, 'utf8').trim(), 'plan')
  assert.equal(existsSync(workflowPath), true, `${workflowPath} must exist`)

  const workflow = readFileSync(workflowPath, 'utf8')
  assert.match(workflow, /feat\/aws-native-phase-0-1/)
  assert.match(workflow, /scripts\/aws\/organization-hiring-e2e-action\.txt/)
  assert.match(workflow, /ORGANIZATION_HIRING_E2E_ACTION/)
  assert.match(workflow, /run-once/)
  assert.match(workflow, /environment:\s*staging/)
  assert.match(workflow, /actions:\s*read/)
  assert.match(workflow, /Wait for exact-head AWS Infrastructure CI/)
  assert.match(workflow, /Exact-head AWS Infrastructure CI is not green/)
  assert.match(workflow, /Guard push E2E against a moved branch/)
  assert.match(workflow, /310356785722/)
  assert.doesNotMatch(workflow, /992382634586/)
})

test('run-once uses disposable authenticated users and the live organization approval and hiring UI', () => {
  assert.equal(existsSync(browserScriptPath), true, `${browserScriptPath} must exist`)
  const workflow = readFileSync(workflowPath, 'utf8')
  const browserScript = readFileSync(browserScriptPath, 'utf8')

  assert.match(workflow, /npx playwright install --with-deps chromium/)
  assert.match(workflow, /sea-n-shore-hiring-e2e-/)
  assert.match(workflow, /-applicant@example\.com/)
  assert.match(workflow, /-admin@example\.com/)
  assert.match(workflow, /-unauthorized@example\.com/)
  assert.match(workflow, /admin-confirm-sign-up/)
  assert.match(workflow, /insert into public\.user_roles/i)
  assert.match(workflow, /administrator/i)

  assert.match(browserScript, /\/auth\/sign-up/)
  assert.match(browserScript, /\/auth\/sign-in/)
  assert.match(browserScript, /Search organisation identities/)
  assert.match(browserScript, /Shipowner — Shipping & Ship Management/)
  assert.match(browserScript, /\/hiring\/organization/)
  assert.match(browserScript, /Submit for verification/)
  assert.match(browserScript, /Verification in progress/)
  assert.match(browserScript, /\/admin\/organizations\//)
  assert.match(browserScript, /Approve organization/)
  assert.match(browserScript, /Verified employer/)
  assert.match(browserScript, /\/hiring\/jobs\/new/)
  assert.match(browserScript, /Post a maritime job/)
  assert.match(browserScript, /Create job/)
  assert.match(browserScript, /Hiring access required/)
})

test('database audit proves approval and published job ownership before cleanup', () => {
  const workflow = readFileSync(workflowPath, 'utf8')

  assert.match(workflow, /organization_applications/i)
  assert.match(workflow, /company_members/i)
  assert.match(workflow, /is_verified/i)
  assert.match(workflow, /approved_at/i)
  assert.match(workflow, /public\.jobs/i)
  assert.match(workflow, /status.*published/i)
  assert.match(workflow, /ORGANIZATION_HIRING_E2E_APPROVAL_VERIFIED=true/)
  assert.match(workflow, /ORGANIZATION_HIRING_E2E_JOB_VERIFIED=true/)
  assert.match(workflow, /ORGANIZATION_HIRING_E2E_UNAUTHORIZED_VERIFIED=true/)
})

test('cleanup is unconditional, prefix constrained, and removes every disposable hiring artifact', () => {
  const workflow = readFileSync(workflowPath, 'utf8')

  assert.match(workflow, /if:\s*always\(\)/)
  assert.match(workflow, /delete from public\.jobs/i)
  assert.match(workflow, /delete from public\.audit_events/i)
  assert.match(workflow, /delete from public\.organization_applications/i)
  assert.match(workflow, /delete from public\.company_access_requests/i)
  assert.match(workflow, /delete from public\.company_members/i)
  assert.match(workflow, /delete from public\.companies/i)
  assert.match(workflow, /delete from public\.user_roles/i)
  assert.match(workflow, /delete from public\.profiles/i)
  assert.match(workflow, /admin-delete-user/)
  assert.match(workflow, /sea-n-shore-hiring-e2e-/)
  assert.match(workflow, /ORGANIZATION_HIRING_E2E_CLEANUP_VERIFIED=true/)
})
