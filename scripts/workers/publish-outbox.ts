import { createEventBridgePublisher } from '../../src/lib/aws/eventbridge'
import { createOutboxPublisher } from '../../src/features/events/outbox-publisher'
import { deletedPostRetention } from '../../src/features/feed/deleted-post-retention'

const busName = process.env.SOCIAL_EVENT_BUS_NAME
if (!busName) throw new Error('SOCIAL_EVENT_BUS_NAME is required')

const publisher = createOutboxPublisher({
  publisher: createEventBridgePublisher({ busName }),
})

const DELETED_POST_RETENTION_SWEEP_MS = 60 * 60 * 1000
let nextRetentionSweepAt = 0
let stopping = false
process.on('SIGTERM', () => { stopping = true })
process.on('SIGINT', () => { stopping = true })

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function runRetentionSweepIfDue() {
  const now = Date.now()
  if (now < nextRetentionSweepAt) return
  nextRetentionSweepAt = now + DELETED_POST_RETENTION_SWEEP_MS

  try {
    const result = await deletedPostRetention.purgeExpiredDeletedPosts(200)
    console.info('[deleted_post_retention_sweep]', { purged: result.purged })
  } catch (error) {
    console.error('[deleted_post_retention_error]', error instanceof Error ? error.message : 'unknown_error')
  }
}

async function main() {
  while (!stopping) {
    try {
      const result = await publisher.publishBatch(10)
      console.info('[social_outbox_batch]', result)
      await runRetentionSweepIfDue()
      if (result.claimed === 0) await sleep(1000)
      if (result.failed > 0) await sleep(2000)
    } catch (error) {
      console.error('[social_outbox_error]', error instanceof Error ? error.message : 'unknown_error')
      await sleep(3000)
    }
  }
}

main().catch((error) => {
  console.error('[social_outbox_fatal]', error instanceof Error ? error.message : 'unknown_error')
  process.exitCode = 1
})
