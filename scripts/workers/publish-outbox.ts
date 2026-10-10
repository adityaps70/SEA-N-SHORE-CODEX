import { createEventBridgePublisher } from '../../src/lib/aws/eventbridge'
import { createOutboxPublisher } from '../../src/features/events/outbox-publisher'
import { outboxIdleDelayMs } from '../../src/features/events/outbox-backoff'
import { deletedPostRetention } from '../../src/features/feed/deleted-post-retention'
import { createNewsletterWorker } from '../../src/features/newsletter/worker'
import { createLegacyInviteWorker } from '../../src/features/legacy-invites/sending'
import { subscriptionService } from '../../src/features/billing/subscription-service'
import { createUnconfirmedUserCleanup } from '../../src/features/auth/unconfirmed-user-cleanup'
import { createLearningDigestSweep, createLearningEmailWorker } from '../../src/features/learning/learning-email-sending'
import { createCourseInvitationWorker } from '../../src/features/learning/course-invitation-email'
import { createTaxDocumentEmailWorker } from '../../src/features/tax/tax-document-email'
import { issueMissingTaxDocuments } from '../../src/features/tax/tax-document-repository'
import { withTransaction } from '../../src/lib/db/client'
import { batchRepository } from '../../src/features/learning/batches/batch-repository'

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
// Round 14 (2.7): abandoned sign-ups older than 24 h, once a day (needs the Cognito pool id).
const UNCONFIRMED_USER_SWEEP_MS = 24 * 60 * 60 * 1000
let nextUnconfirmedUserSweepAt = 0
const unconfirmedUserCleanup = process.env.AWS_COGNITO_USER_POOL_ID ? createUnconfirmedUserCleanup() : null
// Learning round A (A6): queued learning emails every minute; the released-materials and
// submissions-to-grade digests hourly. Both are idempotent.
const LEARNING_EMAIL_SWEEP_MS = 60 * 1000
const LEARNING_DIGEST_SWEEP_MS = 60 * 60 * 1000
let nextLearningEmailSweepAt = 0
let nextLearningDigestSweepAt = 0
let learningEmailDisabledLogged = false
const learningEmailWorker = createLearningEmailWorker()
const learningDigestSweep = createLearningDigestSweep()
// Learning round C (C1): enrol people who signed up with an invited address, then send pending
// course invitation emails. Every minute; both steps are idempotent.
const COURSE_INVITATION_SWEEP_MS = 60 * 1000
let nextCourseInvitationSweepAt = 0
const courseInvitationWorker = createCourseInvitationWorker()
// C4: email issued GST invoices and credit notes to their buyers every minute; every 10 minutes,
// issue any invoice or credit note a payment or refund had to leave for later. Both are idempotent.
const TAX_DOCUMENT_EMAIL_SWEEP_MS = 60 * 1000
const TAX_DOCUMENT_ISSUE_SWEEP_MS = 10 * 60 * 1000
let nextTaxDocumentEmailSweepAt = 0
let nextTaxDocumentIssueSweepAt = 0
let taxDocumentEmailDisabledLogged = false
const taxDocumentEmailWorker = createTaxDocumentEmailWorker()
// Round D: move course batches along (upcoming → running → completed) once an hour.
const BATCH_STATUS_SWEEP_MS = 60 * 60 * 1000
let nextBatchStatusSweepAt = 0
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
    const result = await legacyInviteWorker.runSweep(5)
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

async function runUnconfirmedUserSweepIfDue() {
  const now = Date.now()
  if (!unconfirmedUserCleanup || now < nextUnconfirmedUserSweepAt) return
  nextUnconfirmedUserSweepAt = now + UNCONFIRMED_USER_SWEEP_MS

  try {
    const result = await unconfirmedUserCleanup.run()
    console.info('[unconfirmed_user_sweep]', result)
  } catch (error) {
    console.error('[unconfirmed_user_sweep_error]', error instanceof Error ? error.message : 'unknown_error')
  }
}

async function runLearningDigestSweepIfDue() {
  const now = Date.now()
  if (now < nextLearningDigestSweepAt) return
  nextLearningDigestSweepAt = now + LEARNING_DIGEST_SWEEP_MS

  try {
    const result = await learningDigestSweep.run()
    console.info('[learning_digest_sweep]', result)
  } catch (error) {
    console.error('[learning_digest_sweep_error]', error instanceof Error ? error.message : 'unknown_error')
  }
}

async function runLearningEmailSweepIfDue() {
  const now = Date.now()
  if (now < nextLearningEmailSweepAt) return
  nextLearningEmailSweepAt = now + LEARNING_EMAIL_SWEEP_MS

  try {
    const result = await learningEmailWorker.runSweep(10)
    if (result.claimed > 0) console.info('[learning_email_sweep]', result)
    if (result.disabled && !learningEmailDisabledLogged) {
      learningEmailDisabledLogged = true
      console.info('[learning_email_sweep]', { disabled: true })
    }
  } catch (error) {
    console.error('[learning_email_sweep_error]', error instanceof Error ? error.message : 'unknown_error')
  }
}

async function runCourseInvitationSweepIfDue() {
  const now = Date.now()
  if (now < nextCourseInvitationSweepAt) return
  nextCourseInvitationSweepAt = now + COURSE_INVITATION_SWEEP_MS

  try {
    const result = await courseInvitationWorker.runSweep(10)
    if (result.enrolled > 0 || result.claimed > 0) console.info('[course_invitation_sweep]', result)
  } catch (error) {
    console.error('[course_invitation_sweep_error]', error instanceof Error ? error.message : 'unknown_error')
  }
}

async function runTaxDocumentIssueSweepIfDue() {
  const now = Date.now()
  if (now < nextTaxDocumentIssueSweepAt) return
  nextTaxDocumentIssueSweepAt = now + TAX_DOCUMENT_ISSUE_SWEEP_MS

  try {
    const result = await issueMissingTaxDocuments(withTransaction)
    if (result.checked > 0) console.info('[tax_document_issue_sweep]', result)
  } catch (error) {
    console.error('[tax_document_issue_sweep_error]', error instanceof Error ? error.message : 'unknown_error')
  }
}

async function runTaxDocumentEmailSweepIfDue() {
  const now = Date.now()
  if (now < nextTaxDocumentEmailSweepAt) return
  nextTaxDocumentEmailSweepAt = now + TAX_DOCUMENT_EMAIL_SWEEP_MS

  try {
    // Counts only: no addresses, names or document numbers in the logs.
    const result = await taxDocumentEmailWorker.runSweep(10)
    if (result.claimed > 0) console.info('[tax_document_email_sweep]', result)
    if (result.disabled && !taxDocumentEmailDisabledLogged) {
      taxDocumentEmailDisabledLogged = true
      console.info('[tax_document_email_sweep]', { disabled: true })
    }
  } catch (error) {
    console.error('[tax_document_email_sweep_error]', error instanceof Error ? error.message : 'unknown_error')
  }
}

async function runBatchStatusSweepIfDue() {
  const now = Date.now()
  if (now < nextBatchStatusSweepAt) return
  nextBatchStatusSweepAt = now + BATCH_STATUS_SWEEP_MS

  try {
    const result = await batchRepository.advanceStatuses()
    if (result.moved > 0) console.info('[learning_batch_status_sweep]', result)
  } catch (error) {
    console.error('[learning_batch_status_sweep_error]', error instanceof Error ? error.message : 'unknown_error')
  }
}

async function main() {
  // Round 14 (3.10): loop straight on while batches claim work; when idle, back off from 5 s to
  // 10 s (outboxIdleDelayMs) and log only batches that claimed something.
  let consecutiveIdleBatches = 0
  while (!stopping) {
    try {
      const result = await publisher.publishBatch(10)
      if (result.claimed > 0) console.info('[social_outbox_batch]', result)
      consecutiveIdleBatches = result.claimed === 0 ? consecutiveIdleBatches + 1 : 0
      await runRetentionSweepIfDue()
      await runNewsletterSweepIfDue()
      await runLegacyInviteSweepIfDue()
      await runBillingSweepIfDue()
      await runUnconfirmedUserSweepIfDue()
      await runLearningDigestSweepIfDue()
      await runLearningEmailSweepIfDue()
      await runCourseInvitationSweepIfDue()
      await runTaxDocumentIssueSweepIfDue()
      await runTaxDocumentEmailSweepIfDue()
      await runBatchStatusSweepIfDue()
      if (consecutiveIdleBatches > 0) await sleep(outboxIdleDelayMs(consecutiveIdleBatches))
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
