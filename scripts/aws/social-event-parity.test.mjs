import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const script = await readFile(new URL('./audit-social-event-parity.sh', import.meta.url), 'utf8')

test('social event parity audit is read only and measures delivery health', () => {
  assert.match(script, /READ_ONLY_AUDIT=true/)
  assert.match(script, /SOCIAL_OUTBOX_UNPUBLISHED/)
  assert.match(script, /SOCIAL_OUTBOX_FAILED/)
  assert.match(script, /SOCIAL_RECEIPTS_SHADOW/)
  assert.match(script, /SOCIAL_PUBLISHED_MISSING_RECEIPTS/)
  assert.match(script, /SOCIAL_SHADOW_SEMANTIC_MISSING/)
  assert.match(script, /SOCIAL_DLQ_VISIBLE/)
  assert.match(script, /describe-services/)
})

test('audit executes only select statements through the Data API', () => {
  const executeLines = script.split('\n').filter((line) => line.includes('execute-statement'))
  assert.ok(executeLines.length > 0)
  assert.doesNotMatch(script, /--sql\s+"(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)/i)
})
