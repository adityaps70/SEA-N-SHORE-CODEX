import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const packageJson = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'))
const publisher = await readFile(new URL('./publish-outbox.ts', import.meta.url), 'utf8')
const consumer = await readFile(new URL('./consume-notifications.ts', import.meta.url), 'utf8')

test('package exposes the two worker commands through the production image', () => {
  assert.equal(packageJson.scripts['worker:outbox'], 'node --import tsx scripts/workers/publish-outbox.ts')
  assert.equal(packageJson.scripts['worker:notifications'], 'node --import tsx scripts/workers/consume-notifications.ts')
  assert.ok(packageJson.dependencies.tsx)
  assert.ok(packageJson.dependencies['@aws-sdk/client-eventbridge'])
  assert.ok(packageJson.dependencies['@aws-sdk/client-sqs'])
})

test('workers stop gracefully on ECS termination', () => {
  assert.match(publisher, /process\.on\('SIGTERM'/)
  assert.match(consumer, /process\.on\('SIGTERM'/)
})

test('notification worker defaults safely to shadow and validates active mode explicitly', () => {
  assert.match(consumer, /SOCIAL_NOTIFICATION_MODE \?\? 'shadow'/)
  assert.match(consumer, /configuredMode !== 'shadow' && configuredMode !== 'active'/)
  assert.match(consumer, /createProductionNotificationEventConsumer\(mode\)/)
})

test('notification worker long-polls and deletes only after successful consumption', () => {
  assert.match(consumer, /WaitTimeSeconds:\s*20/)
  assert.match(consumer, /VisibilityTimeout:\s*60/)
  const consumePosition = consumer.indexOf('await processMessage(message.Body)')
  const deletePosition = consumer.indexOf('new DeleteMessageCommand')
  assert.ok(consumePosition >= 0)
  assert.ok(deletePosition > consumePosition)
})

test('workers do not log notification payloads or email data', () => {
  assert.doesNotMatch(consumer, /console\.(info|error)\([^\n]*message\.Body/)
  assert.doesNotMatch(consumer, /email/i)
})
