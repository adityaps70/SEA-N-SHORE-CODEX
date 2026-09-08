import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

const workflowPath = '.github/workflows/aws-onboarding-e2e.yml'
const actionPath = 'scripts/aws/onboarding-e2e-action.txt'
const browserScriptPath = 'scripts/aws/onboarding-staging-e2e.mjs'

test('onboarding e2e is safe by default and branch-scoped with exact-head CI gating', () => {
  const action = readFileSync(actionPath, 'utf8').trim()
  assert.ok(['plan', 'probe', 'run-once'].includes(action), `Unexpected onboarding e2e action: ${action}`)

  const workflow = readFileSync(workflowPath, 'utf8')
  assert.match(workflow, /feat\/aws-native-phase-0-1/)
  assert.match(workflow, /scripts\/aws\/onboarding-e2e-action\.txt/)
  assert.match(workflow, /environment:\s*staging/)
  assert.match(workflow, /actions:\s*read/)
  assert.match(workflow, /Wait for exact-head AWS Infrastructure CI/)
  assert.match(workflow, /Exact-head AWS Infrastructure CI is not green/)
  assert.match(workflow, /ONBOARDING_E2E_ACTION/)
  assert.match(workflow, /run-once/)
})

test('probe mode remains read-only and runs on the staging bootstrap through SSM', () => {
  const workflow = readFileSync(workflowPath, 'utf8')
  assert.match(workflow, /Discover bootstrap instance/)
  assert.match(workflow, /sea-n-shore-bootstrap/)
  assert.match(workflow, /aws ssm send-command/)
  assert.match(workflow, /sea-n-shore-staging-users/)
  assert.match(workflow, /admin-get-user/)
  assert.match(workflow, /UserNotFoundException/)
  assert.match(workflow, /COGNITO_ADMIN_PROBE_AVAILABLE=true/)

  const start = workflow.indexOf('- name: Send read-only Cognito admin capability probe through SSM')
  const end = workflow.indexOf('- name: Wait and surface read-only probe evidence')
  assert.ok(start >= 0 && end > start)
  const probeBlock = workflow.slice(start, end)
  assert.doesNotMatch(probeBlock, /admin-confirm-sign-up/)
  assert.doesNotMatch(probeBlock, /admin-delete-user/)
  assert.doesNotMatch(probeBlock, /delete from public\.profiles/i)
})

test('run-once performs disposable public sign-up browser journeys and guarded cleanup', () => {
  assert.equal(existsSync(browserScriptPath), true, `${browserScriptPath} must exist`)
  const workflow = readFileSync(workflowPath, 'utf8')
  const browserScript = readFileSync(browserScriptPath, 'utf8')

  assert.match(workflow, /npx playwright install --with-deps chromium/)
  assert.match(workflow, /node scripts\/aws\/onboarding-staging-e2e\.mjs/)
  assert.match(workflow, /admin-confirm-sign-up/)
  assert.match(workflow, /admin-delete-user/)
  assert.match(workflow, /delete from public\.profiles/i)
  assert.match(workflow, /sea-n-shore-e2e-/)
  assert.match(workflow, /example\.com/)
  assert.match(workflow, /ONBOARDING_E2E_CLEANUP_VERIFIED=true/)

  assert.match(browserScript, /\/auth\/sign-up/)
  assert.match(browserScript, /Create account/)
  assert.match(browserScript, /\/auth\/sign-in/)
  assert.match(browserScript, /Sign in/)
  assert.match(browserScript, /Search professional identities/)
  assert.match(browserScript, /Master — Sea-going · Deck/)
  assert.match(browserScript, /Search additional identities/)
  assert.match(browserScript, /Mentor/)
  assert.match(browserScript, /getByRole\('button', \{ name: 'Remove Mentor' \}\)/)
  assert.doesNotMatch(browserScript, /getByText\('Mentor', \{ exact: true \}\)\.toBeVisible/)
  assert.match(browserScript, /Custom maritime identity/)
  assert.match(browserScript, /Search organisation identities/)
  assert.match(browserScript, /Shipowner — Shipping & Ship Management/)
  assert.match(browserScript, /Use letters, numbers, and single hyphens/)
  assert.match(browserScript, /\/home/)
  assert.match(browserScript, /\/profile/)
  assert.match(browserScript, /\/profile\/edit/)
})

test('signup diagnostics ignore the empty Next.js route announcer and cleanup audits only completed journeys', () => {
  const workflow = readFileSync(workflowPath, 'utf8')
  const browserScript = readFileSync(browserScriptPath, 'utf8')

  assert.match(browserScript, /locator\('p\[role="alert"\]'\)/)
  assert.match(browserScript, /locator\('p\[role="status"\]'\)/)
  assert.doesNotMatch(browserScript, /getByRole\('alert'\)/)
  assert.match(workflow, /id:\s*journeys/)
  assert.match(workflow, /AUDIT_EXPECTED/)
  assert.match(workflow, /steps\.journeys\.outcome/)
  assert.match(workflow, /ONBOARDING_E2E_CLEANUP_VERIFIED=true/)
})
