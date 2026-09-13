import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

const actionPath = 'scripts/aws/realtime-e2e-action.txt'
const workflowPath = '.github/workflows/aws-realtime-e2e.yml'
const browserPath = 'scripts/aws/realtime-staging-e2e.mjs'
const ssmPath = 'scripts/aws/realtime-e2e-ssm.mjs'
const remotePath = 'scripts/aws/realtime-e2e-remote.sh'

test('realtime e2e is branch-scoped and guarded by plan or run-once', () => {
  assert.equal(existsSync(actionPath), true)
  assert.ok(['plan', 'run-once'].includes(readFileSync(actionPath, 'utf8').trim()))
  for (const path of [workflowPath, browserPath, ssmPath, remotePath]) {
    assert.equal(existsSync(path), true, `${path} must exist`)
  }
  const workflow = readFileSync(workflowPath, 'utf8')
  assert.match(workflow, /feat\/aws-native-phase-0-1/)
  assert.match(workflow, /realtime-e2e-action\.txt/)
  assert.match(workflow, /run-once/)
  assert.match(workflow, /Wait for exact-head AWS Infrastructure CI/)
  assert.match(workflow, /Guard push E2E against a moved branch/)
  assert.match(workflow, /environment:\s*staging/)
  assert.match(workflow, /310356785722/)
  assert.doesNotMatch(workflow, /992382634586/)
})

test('realtime e2e proves canonical message and read-cursor fanout over authenticated websocket', () => {
  const browser = readFileSync(browserPath, 'utf8')
  const remote = readFileSync(remotePath, 'utf8')
  const workflow = readFileSync(workflowPath, 'utf8')
  assert.match(browser, /\/auth\/sign-up/)
  assert.match(browser, /\/auth\/sign-in/)
  assert.match(browser, /\/api\/realtime\/ticket/)
  assert.match(browser, /new WebSocket/)
  assert.match(browser, /message\.created/)
  assert.match(browser, /conversation\.read_cursor_advanced/)
  assert.match(browser, /Write a message/)
  assert.match(browser, /Send message/)
  assert.match(browser, /malformed/i)
  const senderConversationLoad = browser.indexOf("senderPage.goto(`${siteUrl}/messages/${conversationId}`")
  const senderProbeOpen = browser.indexOf("openProbeSocket(senderPage, 'sender')")
  const recipientConversationLoad = browser.indexOf("recipientPage.goto(`${siteUrl}/messages/${conversationId}`")
  const recipientProbeOpen = browser.indexOf("openProbeSocket(recipientPage, 'recipient')")
  assert.ok(senderConversationLoad >= 0 && senderProbeOpen > senderConversationLoad, 'sender probe socket must open after conversation navigation')
  assert.ok(recipientConversationLoad >= 0 && recipientProbeOpen > recipientConversationLoad, 'recipient probe socket must open after conversation navigation')
  assert.match(remote, /public\.connections/i)
  assert.match(remote, /public\.conversations/i)
  assert.match(remote, /public\.messages/i)
  assert.match(remote, /public\.event_outbox/i)
  assert.match(remote, /dynamodb/i)
  assert.match(remote, /sqs/i)
  assert.match(remote, /cloudwatch/i)
  assert.match(remote, /REALTIME_E2E_DURABLE_MESSAGE_VERIFIED=true/)
  assert.match(remote, /REALTIME_E2E_INFRA_HEALTH_VERIFIED=true/)
  assert.match(workflow, /npx playwright install --with-deps chromium/)
})

test('realtime e2e cleanup is unconditional and constrained to disposable identities', () => {
  const workflow = readFileSync(workflowPath, 'utf8')
  const remote = readFileSync(remotePath, 'utf8')
  assert.match(workflow, /if:\s*always\(\)/)
  assert.match(remote, /sea-n-shore-realtime-e2e-/)
  assert.match(remote, /delete from public\.messages/i)
  assert.match(remote, /delete from public\.conversation_participants/i)
  assert.match(remote, /delete from public\.conversations/i)
  assert.match(remote, /delete from public\.connections/i)
  assert.match(remote, /delete from public\.profiles/i)
  assert.match(remote, /admin-delete-user/)
  assert.match(remote, /REALTIME_E2E_CLEANUP_VERIFIED=true/)
})
