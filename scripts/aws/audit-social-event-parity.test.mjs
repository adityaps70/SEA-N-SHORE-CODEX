import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const script = await readFile(new URL('./audit-social-event-parity.sh', import.meta.url), 'utf8')

test('parity audit verifies both live worker task images and notification shadow mode', () => {
  assert.match(script, /describe-task-definition/)
  assert.match(script, /SOCIAL_OUTBOX_WORKER_IMAGE/)
  assert.match(script, /SOCIAL_NOTIFICATION_WORKER_IMAGE/)
  assert.match(script, /SOCIAL_NOTIFICATION_MODE/)
  assert.match(script, /shadow/)
})

test('parity audit reviews both worker CloudWatch logs for strong runtime errors', () => {
  assert.match(script, /filter-log-events/)
  assert.match(script, /SOCIAL_OUTBOX_STRONG_RUNTIME_ERROR_MATCHES/)
  assert.match(script, /SOCIAL_NOTIFICATION_STRONG_RUNTIME_ERROR_MATCHES/)
})
