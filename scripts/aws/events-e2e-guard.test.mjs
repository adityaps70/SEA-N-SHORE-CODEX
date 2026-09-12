import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

const actionPath = 'scripts/aws/events-e2e-action.txt'
const workflowPath = '.github/workflows/aws-events-e2e.yml'
const browserPath = 'scripts/aws/events-staging-e2e.mjs'
const ssmPath = 'scripts/aws/events-e2e-ssm.mjs'
const remotePath = 'scripts/aws/events-e2e-remote.sh'

test('events e2e is branch-scoped and guarded by plan or run-once', () => {
  assert.equal(existsSync(actionPath), true)
  assert.ok(['plan', 'run-once'].includes(readFileSync(actionPath, 'utf8').trim()))
  for (const path of [workflowPath, browserPath, ssmPath, remotePath]) assert.equal(existsSync(path), true, `${path} must exist`)
  const workflow = readFileSync(workflowPath, 'utf8')
  assert.match(workflow, /feat\/aws-native-phase-0-1/)
  assert.match(workflow, /events-e2e-action\.txt/)
  assert.match(workflow, /run-once/)
  assert.match(workflow, /Wait for exact-head AWS Infrastructure CI/)
  assert.match(workflow, /Guard push E2E against a moved branch/)
  assert.match(workflow, /environment:\s*staging/)
  assert.match(workflow, /310356785722/)
  assert.doesNotMatch(workflow, /992382634586/)
})

test('events e2e proves authenticated create, RSVP, edit, withdrawal, cancellation and durable Aurora state', () => {
  const browser = readFileSync(browserPath, 'utf8')
  const remote = readFileSync(remotePath, 'utf8')
  const workflow = readFileSync(workflowPath, 'utf8')
  assert.match(browser, /\/auth\/sign-up/)
  assert.match(browser, /\/auth\/sign-in/)
  assert.match(browser, /\/events\/create/)
  assert.match(browser, /Publish event/)
  assert.match(browser, /Attend event/)
  assert.match(browser, /Withdraw attendance/)
  assert.match(browser, /\/events\/my/)
  assert.match(browser, /\/edit/)
  assert.match(browser, /Cancel event/)
  assert.match(browser, /Join online session/)
  assert.match(remote, /public\.events/i)
  assert.match(remote, /public\.event_attendees/i)
  assert.match(remote, /EVENTS_E2E_ATTENDANCE_VERIFIED=true/)
  assert.match(remote, /EVENTS_E2E_WITHDRAWAL_VERIFIED=true/)
  assert.match(remote, /EVENTS_E2E_CANCELLED_VERIFIED=true/)
  assert.match(workflow, /npx playwright install --with-deps chromium/)
})

test('events e2e cleanup is unconditional and constrained to disposable identities and event title', () => {
  const workflow = readFileSync(workflowPath, 'utf8')
  const remote = readFileSync(remotePath, 'utf8')
  assert.match(workflow, /if:\s*always\(\)/)
  assert.match(remote, /sea-n-shore-events-e2e-/)
  assert.match(remote, /E2E Maritime Event/)
  assert.match(remote, /delete from public\.event_attendees/i)
  assert.match(remote, /delete from public\.events/i)
  assert.match(remote, /delete from public\.profiles/i)
  assert.match(remote, /admin-delete-user/)
  assert.match(remote, /EVENTS_E2E_CLEANUP_VERIFIED=true/)
})
