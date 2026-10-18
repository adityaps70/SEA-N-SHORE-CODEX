import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const packageJson = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'))
const publisher = await readFile(new URL('./publish-outbox.ts', import.meta.url), 'utf8')
const consumer = await readFile(new URL('./consume-notifications.ts', import.meta.url), 'utf8')
const builder = await readFile(new URL('../build-workers.mjs', import.meta.url), 'utf8')
const dockerfile = await readFile(new URL('../../Dockerfile', import.meta.url), 'utf8')

test('package exposes the two worker commands through the production image', () => {
  // Round 14 (3.10): the image runs the workers pre-compiled; tsx stays for local development.
  assert.equal(packageJson.scripts['worker:outbox'], 'node dist/workers/publish-outbox.mjs')
  assert.equal(packageJson.scripts['worker:notifications'], 'node dist/workers/consume-notifications.mjs')
  assert.equal(packageJson.scripts['worker:outbox:dev'], 'node --import tsx scripts/workers/publish-outbox.ts')
  assert.equal(packageJson.scripts['worker:notifications:dev'], 'node --import tsx scripts/workers/consume-notifications.ts')
  assert.equal(packageJson.scripts['build:workers'], 'node scripts/build-workers.mjs')
  assert.match(builder, /'scripts\/workers\/publish-outbox\.ts', 'scripts\/workers\/consume-notifications\.ts'/)
  assert.match(builder, /outdir: 'dist\/workers'/)
  assert.match(builder, /packages: 'external'/)
  assert.match(dockerfile, /COPY package\.json package-lock\.json \.\//)
  assert.match(dockerfile, /npm ci --no-audit --no-fund/)
  assert.match(dockerfile, /npm run build \\\n {4}&& npm run build:workers/)
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


test('outbox worker also performs bounded deleted-post retention sweeps', () => {
  assert.match(publisher, /deletedPostRetention/)
  assert.match(publisher, /purgeExpiredDeletedPosts\(200\)/)
  assert.match(publisher, /60 \* 60 \* 1000/)
  assert.match(publisher, /deleted_post_retention_sweep/)
})

test('outbox worker also runs the hourly, idempotent billing sweep for plan subscriptions', () => {
  assert.match(publisher, /subscriptionService\.runSweep\(\)/)
  assert.match(publisher, /BILLING_SWEEP_MS = 60 \* 60 \* 1000/)
  assert.match(publisher, /billing_sweep_error/)
})

test('outbox worker backs off to 5-10 s when idle and logs a batch only when it claimed work', () => {
  assert.match(publisher, /import \{ outboxIdleDelayMs \} from '\.\.\/\.\.\/src\/features\/events\/outbox-backoff'/)
  assert.match(publisher, /if \(result\.claimed > 0\) console\.info\('\[social_outbox_batch\]', result\)/)
  assert.equal(publisher.match(/\[social_outbox_batch\]/g).length, 1)
  assert.match(publisher, /consecutiveIdleBatches = result\.claimed === 0 \? consecutiveIdleBatches \+ 1 : 0/)
  assert.match(publisher, /if \(consecutiveIdleBatches > 0\) await sleep\(outboxIdleDelayMs\(consecutiveIdleBatches\)\)/)
  assert.doesNotMatch(publisher, /sleep\(1000\)/)
  assert.match(publisher, /console\.error\('\[social_outbox_error\]'/)
})

test('outbox worker sends the round H member activity emails and the hourly messages digest (H3)', () => {
  assert.match(publisher, /import \{ createNotificationEmailWorker \} from '\.\.\/\.\.\/src\/features\/notification-emails\/sending'/)
  assert.match(publisher, /NOTIFICATION_EMAIL_SWEEP_MS = 60 \* 1000/)
  assert.match(publisher, /notificationEmailWorker\.runSweep\(10\)/)
  assert.match(publisher, /notificationEmailWorker\.runDigestSweep\(50\)/)
  assert.match(publisher, /await runNotificationEmailSweepIfDue\(\)/)
  // Counts only: the logged results never carry addresses, names or message text.
  assert.doesNotMatch(publisher, /console\.(info|error)\('\[(notification_email|message_digest)_sweep[^\n]*(email|address|name|body)/i)
})

test('outbox worker sends the round H account security notices (H3)', () => {
  assert.match(publisher, /import \{ createProductionAccountSecurityEmailWorker \} from '\.\.\/\.\.\/src\/features\/account-security\/security-email-runtime'/)
  assert.match(publisher, /ACCOUNT_SECURITY_EMAIL_SWEEP_MS = 60 \* 1000/)
  assert.match(publisher, /accountSecurityEmailWorker\.runSweep\(10\)/)
  assert.match(publisher, /await runAccountSecurityEmailSweepIfDue\(\)/)
  assert.doesNotMatch(publisher, /console\.(info|error)\('\[account_security_email_sweep[^\n]*(email|address|recipient)/i)
})
