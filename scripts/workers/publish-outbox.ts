import { createEventBridgePublisher } from '../../src/lib/aws/eventbridge'
import { createOutboxPublisher } from '../../src/features/events/outbox-publisher'
import { deletedPostRetention } from '../../src/features/feed/deleted-post-retention'
import { createNewsletterWorker } from '../../src/features/newsletter/worker'
import { createLegacyInviteWorker } from '../../src/features/legacy-invites/sending'
import { subscriptionService } from '../../src/features/billing/subscription-service'

const busName = process.env.SOCIAL_EVENT_BUS_NAME
if (!busName) throw new Error('SOCIAL_EVENT_BUS_NAME is required')

const publisher = createOutboxPublisher({
  publisher: createEventBridgePublisher({ busName }),
})

const DELETED_POST_RETENTION_SWEEP_MS = 60 * 60 * 1000
let nextRetentionSweepAt = 0
const NEWSLETTER_SWEEP_MS = 60 * 1000
const LEGACY_INVITE_SWEEP_MS = 60 * 1000
let nextNewsletterSweepAt = 0
let nextLegacyInviteSweepAt = 0
const newsletterWorker = createNewsletterWorker()
const legacyInviteWorker = createLegacyInviteWorker()
// Plan subscriptions: expire lapsed plans, reconcile open Cashfree mandates, raise due
// charges in merchant charge mode. Hourly; the job is idempotent.
const BILLING_SWEEP_MS = 60 * 60 * 1000
let nextBillingSweepAt = 0
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

async function runNewsletterSweepIfDue() {
  const now = Date.now()
  if (now < nextNewsletterSweepAt) return
  nextNewsletterSweepAt = now + NEWSLETTER_SWEEP_MS

  try {
    const result = await newsletterWorker.runOnce()
    console.info('[newsletter_sweep]', {
      synced: result.sync.synced,
      syncFailed: result.sync.failed,
      reconciled: result.reconcile.updated,
      confirmationsSent: result.confirmations.sent,
      campaignSent: result.campaigns.sent,
      campaignFailed: result.campaigns.failed,
    })
  } catch (error) {
    console.error('[newsletter_sweep_error]', error instanceof Error ? error.message : 'unknown_error')
  }
}

async function runLegacyInviteSweepIfDue() {
  const now = Date.now()
  if (now < nextLegacyInviteSweepAt) return
  nextLegacyInviteSweepAt = now + LEGACY_INVITE_SWEEP_MS

  try {
    const result = await legacyInviteWorker.runSweep(25)
    console.info('[legacy_invite_sweep]', {
      claimed: result.claimed,
      sent: result.sent,
      failed: result.failed,
      skipped: result.skipped,
      retrying: result.retrying,
      disabled: result.disabled,
    })
  } catch (error) {
    console.error('[legacy_invite_sweep_error]', error instanceof Error ? error.message : 'unknown_error')
  }
}

async function runBillingSweepIfDue() {
  const now = Date.now()
  if (now < nextBillingSweepAt) return
  nextBillingSweepAt = now + BILLING_SWEEP_MS

  try {
    const result = await subscriptionService.runSweep()
    console.info('[billing_sweep]', result)
  } catch (error) {
    console.error('[billing_sweep_error]', error instanceof Error ? error.message : 'unknown_error')
  }
}

async function main() {
  while (!stopping) {
    try {
      const result = await publisher.publishBatch(10)
      console.info('[social_outbox_batch]', result)
      await runRetentionSweepIfDue()
      await runNewsletterSweepIfDue()
      await runLegacyInviteSweepIfDue()
      await runBillingSweepIfDue()
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
