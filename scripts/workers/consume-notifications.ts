import { DeleteMessageCommand, ReceiveMessageCommand, SQSClient } from '@aws-sdk/client-sqs'
import { createProductionNotificationEventConsumer } from '../../src/features/notifications/event-consumer'
import type { NotificationEventMode } from '../../src/features/notifications/repository'
import { parseDomainEvent } from '../../src/features/events/validation'

const queueUrl = process.env.SOCIAL_NOTIFICATION_QUEUE_URL
if (!queueUrl) throw new Error('SOCIAL_NOTIFICATION_QUEUE_URL is required')

const configuredMode = process.env.SOCIAL_NOTIFICATION_MODE ?? 'shadow'
if (configuredMode !== 'shadow' && configuredMode !== 'active') {
  throw new Error('SOCIAL_NOTIFICATION_MODE must be shadow or active')
}
const mode: NotificationEventMode = configuredMode
const consumer = createProductionNotificationEventConsumer(mode)

const sqs = new SQSClient({})
let stopping = false
process.on('SIGTERM', () => { stopping = true })
process.on('SIGINT', () => { stopping = true })

async function processMessage(body: string) {
  const envelope = JSON.parse(body) as { source?: unknown; detail?: unknown }
  if (envelope.source !== 'sea-n-shore.social') throw new Error('notification_event_invalid_source')
  const event = parseDomainEvent(envelope.detail)
  const result = await consumer.consume(event)
  console.info('[social_notification_processed]', {
    eventId: event.id,
    eventType: event.eventType,
    mode,
    processed: result.processed,
    created: result.created,
  })
}

async function main() {
  while (!stopping) {
    const response = await sqs.send(new ReceiveMessageCommand({
      QueueUrl: queueUrl,
      MaxNumberOfMessages: 10,
      WaitTimeSeconds: 20,
      VisibilityTimeout: 60,
    }))

    for (const message of response.Messages ?? []) {
      if (stopping) break
      if (!message.Body || !message.ReceiptHandle) continue

      try {
        await processMessage(message.Body)
        await sqs.send(new DeleteMessageCommand({
          QueueUrl: queueUrl,
          ReceiptHandle: message.ReceiptHandle,
        }))
      } catch (error) {
        console.error('[social_notification_error]', error instanceof Error ? error.message : 'unknown_error')
      }
    }
  }
}

main().catch((error) => {
  console.error('[social_notification_fatal]', error instanceof Error ? error.message : 'unknown_error')
  process.exitCode = 1
})
