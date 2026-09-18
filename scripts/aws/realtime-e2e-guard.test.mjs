import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

const actionPath = 'scripts/aws/realtime-e2e-action.txt'
const workflowPath = '.github/workflows/aws-realtime-e2e.yml'
const browserPath = 'scripts/aws/realtime-staging-e2e.mjs'
const ssmPath = 'scripts/aws/realtime-e2e-ssm.mjs'
const remotePath = 'scripts/aws/realtime-e2e-remote.sh'

test('realtime e2e is branch-scoped and guarded by plan, run-once, bounded connect probe, targeted cleanup-once, or read-only connect diagnosis', () => {
  assert.equal(existsSync(actionPath), true)
  const action = readFileSync(actionPath, 'utf8').trim()
  assert.ok(
    action === 'plan'
      || action === 'run-once'
      || action === 'messaging-once'
      || action === 'probe-connect-once'
      || /^cleanup-once:[0-9]+$/.test(action)
      || /^diagnose-connect-once:[0-9]+$/.test(action),
  )
  for (const path of [workflowPath, browserPath, ssmPath, remotePath]) {
    assert.equal(existsSync(path), true, `${path} must exist`)
  }
  const workflow = readFileSync(workflowPath, 'utf8')
  assert.match(workflow, /feat\/aws-native-phase-0-1/)
  assert.match(workflow, /realtime-e2e-action\.txt/)
  assert.match(workflow, /run-once/)
  assert.match(workflow, /probe-connect-once/)
  assert.match(workflow, /cleanup-once:/)
  assert.match(workflow, /diagnose-connect-once:/)
  assert.match(workflow, /run_probe/)
  assert.match(workflow, /cleanup_source_run_id/)
  assert.match(workflow, /diagnostic_source_run_id/)
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
  assert.match(browser, /input\[name="slug"\]/)
  assert.doesNotMatch(browser, /Profile address/)
  assert.doesNotMatch(browser, /message-read-sentinel/)
  assert.match(browser, /1 unread messages/)
  assert.match(browser, /\[aria-label="1 unread messages"\]:visible/)
  assert.match(browser, /Unread conversation with/)
  assert.match(browser, /REALTIME_E2E_UNREAD_BADGE_CLEARED=true/)
  assert.match(browser, /malformed/i)
  const senderConversationLoad = browser.indexOf("senderPage.goto(`${siteUrl}/messages/${conversationId}`")
  const senderProbeOpen = browser.indexOf("openProbeSocket(senderPage, 'sender')")
  const recipientInboxLoad = browser.indexOf("recipientPage.goto(`${siteUrl}/messages`")
  const recipientProbeOpen = browser.indexOf("openProbeSocket(recipientPage, 'recipient')")
  const recipientConversationOpen = browser.indexOf("recipientPage.getByRole('link', { name: `Open conversation with ${users.sender.fullName}` })")
  assert.ok(senderConversationLoad >= 0 && senderProbeOpen > senderConversationLoad, 'sender probe socket must open after conversation navigation')
  assert.ok(recipientInboxLoad >= 0 && recipientProbeOpen > recipientInboxLoad, 'recipient probe socket must open after inbox navigation')
  assert.ok(recipientConversationOpen > recipientProbeOpen, 'recipient must open the unread conversation only after the message arrives')
  assert.match(remote, /public\.connections/i)
  assert.match(remote, /public\.conversations/i)
  assert.match(remote, /public\.messages/i)
  assert.match(remote, /public\.event_outbox/i)
  assert.match(remote, /dynamodb/i)
  assert.match(remote, /sqs/i)
  assert.match(remote, /cloudwatch/i)
  assert.match(remote, /last_read_message_id/i)
  assert.match(remote, /REALTIME_E2E_DURABLE_READ_CURSOR_VERIFIED=true/)
  assert.match(remote, /REALTIME_E2E_DURABLE_MESSAGE_VERIFIED=true/)
  assert.match(remote, /REALTIME_E2E_INFRA_HEALTH_VERIFIED=true/)
  assert.match(workflow, /npx playwright install --with-deps chromium/)
})

test('realtime infra health SQS jq filter preserves the root object for both queue counters', () => {
  const remote = readFileSync(remotePath, 'utf8')
  const match = remote.match(/jq -e '([^']*ApproximateNumberOfMessages[^']*)' <<<"\$MAIN_ATTR"/)
  assert.ok(match, 'SQS health jq filter must be present')
  const sample = JSON.stringify({
    Attributes: {
      ApproximateNumberOfMessages: '0',
      ApproximateNumberOfMessagesNotVisible: '0',
    },
  })
  const result = spawnSync('jq', ['-e', match[1]], { input: sample, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr || result.stdout)
})

test('realtime infra health emits bounded numeric diagnostics without weakening zero-failure thresholds', () => {
  const remote = readFileSync(remotePath, 'utf8')
  for (const marker of [
    'REALTIME_INFRA_DIAG_DYNAMODB_CONNECTIONS=',
    'REALTIME_INFRA_DIAG_MAIN_QUEUE_VISIBLE=',
    'REALTIME_INFRA_DIAG_MAIN_QUEUE_NOT_VISIBLE=',
    'REALTIME_INFRA_DIAG_DLQ_VISIBLE=',
    'REALTIME_INFRA_DIAG_LAMBDA_ERRORS=',
    'REALTIME_INFRA_DIAG_LAMBDA_THROTTLES=',
    'REALTIME_INFRA_DIAG_FANOUT_BODY_LOG_HITS=',
  ]) {
    assert.match(remote, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
  assert.match(remote, /\[\[ "\$DLQ_VISIBLE" == 0 \]\]/)
  assert.match(remote, /\[\[ "\$LOG_HITS" == 0 \]\]/)
  assert.doesNotMatch(remote, /REALTIME_INFRA_DIAG_.*MESSAGE_BODY/)
  assert.doesNotMatch(remote, /REALTIME_INFRA_DIAG_.*SECRET/)
})

test('realtime Lambda health treats CloudWatch decimal zero as zero without accepting non-zero metrics', () => {
  const remote = readFileSync(remotePath, 'utf8')
  const match = remote.match(/jq -e --arg sum "\$SUM" '([^']*tonumber[^']*)' <<<null/)
  assert.ok(match, 'Lambda metric zero check must numerically coerce the CloudWatch Sum')
  for (const value of ['0', '0.0', '0.00']) {
    const result = spawnSync('jq', ['-e', '--arg', 'sum', value, match[1]], { input: 'null\n', encoding: 'utf8' })
    assert.equal(result.status, 0, `expected ${value} to be accepted as numeric zero: ${result.stderr || result.stdout}`)
  }
  for (const value of ['0.1', '1', '2.0']) {
    const result = spawnSync('jq', ['-e', '--arg', 'sum', value, match[1]], { input: 'null\n', encoding: 'utf8' })
    assert.notEqual(result.status, 0, `expected ${value} to be rejected as non-zero`)
  }
})

test('realtime authenticated connect probe is narrow, exact-head gated, and always cleaned up', () => {
  const workflow = readFileSync(workflowPath, 'utf8')
  const browser = readFileSync(browserPath, 'utf8')
  assert.match(workflow, /realtime-connect-probe:/)
  assert.match(workflow, /needs\.guard\.outputs\.run_probe == 'true'/)
  assert.match(workflow, /E2E_PHASE=connect-probe node scripts\/aws\/realtime-staging-e2e\.mjs/)
  assert.match(workflow, /Cleanup disposable Realtime connect probe data[\s\S]*if:\s*always\(\)/)
  assert.match(browser, /'connect-probe'/)
  assert.match(browser, /REALTIME_E2E_CONNECT_PROBE_RESULT=/)
  assert.match(browser, /openProbeSocket\(senderPage, 'connect_probe'\)/)

  const probeJobStart = workflow.indexOf('realtime-connect-probe:')
  const nextJobStart = workflow.indexOf('\n  realtime-cleanup:', probeJobStart)
  assert.ok(probeJobStart >= 0 && nextJobStart > probeJobStart, 'connect probe job must be independently bounded')
  const probeJob = workflow.slice(probeJobStart, nextJobStart)
  assert.doesNotMatch(probeJob, /verify-durable|verify-infra|E2E_PHASE=realtime|Prepare accepted disposable connection and conversation/)
})

test('realtime e2e cleanup is unconditional, missing-table resilient, and constrained to disposable identities', () => {
  const workflow = readFileSync(workflowPath, 'utf8')
  const remote = readFileSync(remotePath, 'utf8')
  assert.match(workflow, /if:\s*always\(\)/)
  assert.match(remote, /sea-n-shore-realtime-e2e-/)
  assert.match(remote, /to_regclass\('public\.conversations'\)/i)
  assert.match(remote, /to_regclass\('public\.conversation_participants'\)/i)
  assert.match(remote, /to_regclass\('public\.messages'\)/i)
  assert.match(remote, /delete from public\.messages/i)
  assert.match(remote, /delete from public\.conversation_participants/i)
  assert.match(remote, /delete from public\.conversations/i)
  assert.match(remote, /delete from public\.connections/i)
  assert.match(remote, /delete from public\.profiles/i)
  const messagingCleanupEnd = remote.indexOf('MESSAGING_TABLES_PRESENT')
  const connectionCleanup = remote.indexOf('DELETE FROM public.connections')
  assert.ok(messagingCleanupEnd >= 0 && connectionCleanup > messagingCleanupEnd, 'connection cleanup must proceed independently of messaging table presence')
  assert.match(remote, /admin-delete-user/)
  assert.match(remote, /REALTIME_E2E_CLEANUP_VERIFIED=true/)
})

test('realtime cleanup-only mode targets a prior disposable run without signup or onboarding', () => {
  const workflow = readFileSync(workflowPath, 'utf8')
  assert.match(workflow, /realtime-cleanup:/)
  assert.match(workflow, /needs\.guard\.outputs\.run_cleanup == 'true'/)
  assert.match(workflow, /E2E_SENDER_EMAIL=sea-n-shore-realtime-e2e-\$\{SOURCE_RUN_ID\}-sender@example\.com/)
  assert.match(workflow, /E2E_RECIPIENT_EMAIL=sea-n-shore-realtime-e2e-\$\{SOURCE_RUN_ID\}-recipient@example\.com/)
  assert.match(workflow, /node scripts\/aws\/realtime-e2e-ssm\.mjs cleanup/)
  const cleanupJob = workflow.slice(workflow.indexOf('realtime-cleanup:'))
  assert.doesNotMatch(cleanupJob, /E2E_PHASE=signup/)
  assert.doesNotMatch(cleanupJob, /E2E_PHASE=onboarding/)
})

test('realtime connect diagnosis is read-only, exact-head gated, and bounded to prior-run CloudWatch evidence', () => {
  const workflow = readFileSync(workflowPath, 'utf8')
  const remote = readFileSync(remotePath, 'utf8')
  assert.match(workflow, /realtime-connect-diagnostic:/)
  assert.match(workflow, /needs\.guard\.outputs\.run_diagnostic == 'true'/)
  assert.match(workflow, /SOURCE_RUN_ID:\s*\$\{\{ needs\.guard\.outputs\.diagnostic_source_run_id \}\}/)
  assert.match(workflow, /node scripts\/aws\/realtime-e2e-ssm\.mjs diagnose-connect/)
  assert.match(remote, /diagnose-connect\)/)
  assert.match(remote, /\/aws\/apigateway\/sea-n-shore-staging\/realtime/)
  assert.match(remote, /\/aws\/lambda\/sea-n-shore-staging-realtime-authorizer/)
  assert.match(remote, /\/aws\/lambda\/sea-n-shore-staging-realtime-connection/)
  assert.match(remote, /aws logs filter-log-events/)
  assert.match(remote, /REALTIME_E2E_CONNECT_DIAGNOSTIC_VERIFIED=true/)
  const diagnosticCase = remote.slice(remote.indexOf('diagnose-connect)'))
  assert.doesNotMatch(diagnosticCase, /admin-confirm-sign-up|admin-delete-user|rds-data execute-statement|dynamodb .*put|sqs .*send/i)
})


test('realtime remote shell is syntax-valid with one durable and one diagnostic case', () => {
  const syntax = spawnSync('bash', ['-n', remotePath], { encoding: 'utf8' })
  assert.equal(syntax.status, 0, syntax.stderr || syntax.stdout)
  const remote = readFileSync(remotePath, 'utf8')
  assert.equal((remote.match(/^  verify-durable\)$/gm) ?? []).length, 1)
  assert.equal((remote.match(/^  diagnose-connect\)$/gm) ?? []).length, 1)
  assert.equal((remote.match(/^esac$/gm) ?? []).length, 1)
})


test('realtime disposable usernames stay within onboarding limits', () => {
  const browser = readFileSync(browserPath, 'utf8')
  assert.match(browser, /const username = `rt-\$\{suffix\}-\$\{runId\}`/)
  assert.doesNotMatch(browser, /sns-realtime-\$\{suffix\}-\$\{runId\}/)
  assert.match(browser, /\/people\/rt-recipient-\$\{runId\}/)
  assert.match(browser, /\/people\/rt-sender-\$\{runId\}/)
})


test('realtime e2e has an isolated messaging-only mode for unread badge verification', () => {
  const workflow = readFileSync(workflowPath, 'utf8')
  const remote = readFileSync(remotePath, 'utf8')
  assert.match(workflow, /messaging-once/)
  assert.match(workflow, /messaging_only/)
  assert.match(workflow, /prepare-messaging/)
  assert.match(workflow, /Verify live authenticated realtime messaging/)
  assert.match(workflow, /needs\.guard\.outputs\.messaging_only != 'true'/)
  assert.match(remote, /^  prepare-messaging\)$/m)
  assert.match(remote, /insert into public\.connections/i)
  assert.match(remote, /status='accepted'|status = 'accepted'|'accepted'/i)
  assert.match(remote, /REALTIME_E2E_PREPARE_MESSAGING_VERIFIED=true/)
})


test('messaging-only unread verification uses canonical inbox refresh instead of websocket delivery', () => {
  const workflow = readFileSync(workflowPath, 'utf8')
  const browser = readFileSync(browserPath, 'utf8')
  assert.match(workflow, /E2E_MESSAGING_ONLY/)
  assert.match(browser, /const messagingOnly = process\.env\.E2E_MESSAGING_ONLY === 'true'/)
  assert.match(browser, /if \(messagingOnly\) \{[\s\S]*recipientPage\.reload/)
  assert.match(browser, /REALTIME_E2E_UNREAD_BADGE_CLEARED=true/)
})
