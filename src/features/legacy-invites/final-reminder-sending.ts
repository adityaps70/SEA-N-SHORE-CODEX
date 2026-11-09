import { createResendEmailClient, loadResendApiKey, ResendApiError, type ResendEmailClient } from '@/lib/email/resend'
import { withEmailSuppression } from '@/lib/email/suppression'
import { LEGACY_INVITE_FROM } from './email'
import { legacyFinalReminderEmail } from './final-reminder-email'
import { legacyFinalReminderRepository, type FinalReminderDelivery } from './final-reminder-repository'
import { legacyLiveCounts, NO_LIVE_COUNTS, type LegacyLiveCounts } from './live-counts'

type Sender = Pick<ResendEmailClient, 'sendEmail'>
type Log = (message: string, details: Record<string, number | boolean>) => void

/** Resend tag on final reminders. */
export const LEGACY_FINAL_REMINDER_CATEGORY = 'legacy_profile_final_reminder'
/** The most final reminders one sweep sends, so the rest of the queue can still be stopped. */
export const FINAL_REMINDER_SWEEP_LIMIT = 5

function errorText(error: unknown) {
  if (error instanceof ResendApiError) return `${error.code}: ${error.message}`.slice(0, 500)
  return error instanceof Error ? error.message.slice(0, 500) : 'unknown_error'
}

/**
 * Sends queued final reminders, at most 5 per sweep, re-checking every eligibility rule just before each one. Before
 * claiming, it pauses the mode by itself when the complaint or bounce rate is too high; a paused mode claims nothing.
 * Logs counts only, never an address or a name.
 */
export function createLegacyFinalReminderWorker(input: {
  repository?: typeof legacyFinalReminderRepository
  liveCounts?: { read(): Promise<LegacyLiveCounts> }
  resend?: Sender | null
  loadApiKey?: () => Promise<string | null>
  siteUrl?: string
  log?: Log
} = {}) {
  const repository = input.repository ?? legacyFinalReminderRepository
  const counts = input.liveCounts ?? legacyLiveCounts
  const log: Log = input.log ?? ((message, details) => console.info(message, details))
  let client: Sender | null | undefined = input.resend

  async function resolveClient() {
    if (client !== undefined) return client
    const key = await (input.loadApiKey ?? loadResendApiKey)()
    client = key ? withEmailSuppression(createResendEmailClient({ apiKey: key })) : null
    return client
  }

  async function sendOne(delivery: FinalReminderDelivery, sender: Sender, live: LegacyLiveCounts) {
    if (!delivery.stillEligible) {
      await repository.markSkipped(delivery.id, 'no_longer_eligible_for_final_reminder')
      return 'skipped' as const
    }

    const email = legacyFinalReminderEmail({
      fullName: delivery.fullName,
      email: delivery.email,
      clickToken: delivery.clickToken,
      unsubscribeToken: delivery.unsubscribeToken,
      counts: live,
      siteUrl: input.siteUrl,
    })

    try {
      const result = await sender.sendEmail({
        from: LEGACY_INVITE_FROM,
        to: delivery.email,
        subject: email.subject,
        text: email.text,
        html: email.html,
        headers: email.headers,
        idempotencyKey: `legacy-profile-final-reminder/${delivery.id}`,
        tags: [{ name: 'category', value: LEGACY_FINAL_REMINDER_CATEGORY }],
      })
      await repository.markSent(delivery.id, result.messageId)
      return 'sent' as const
    } catch (error) {
      const retryable = error instanceof ResendApiError && error.retryable
      await repository.markFailed(delivery.id, errorText(error), retryable)
      return retryable ? 'retry' as const : 'failed' as const
    }
  }

  return {
    async runSweep(limit = FINAL_REMINDER_SWEEP_LIMIT) {
      const empty = { claimed: 0, sent: 0, failed: 0, skipped: 0, retrying: 0 }
      const sender = await resolveClient()
      if (!sender) return { ...empty, paused: false, disabled: true }
      const pause = await repository.autoPauseIfNeeded()
      if (pause.pausedNow) log('[legacy_final_reminder_auto_paused]', { paused: true })
      if (pause.paused) return { ...empty, paused: true, disabled: false }

      const deliveries = await repository.claimBatch(Math.min(FINAL_REMINDER_SWEEP_LIMIT, limit))
      let sent = 0
      let failed = 0
      let skipped = 0
      let retrying = 0
      // The live counts are read once per sweep; a failure leaves the numbers out, never the email.
      const live = deliveries.some((delivery) => delivery.stillEligible)
        ? await counts.read().catch(() => NO_LIVE_COUNTS)
        : NO_LIVE_COUNTS
      for (const [index, delivery] of deliveries.entries()) {
        const result = await sendOne(delivery, sender, live)
        if (result === 'sent') sent += 1
        if (result === 'failed') failed += 1
        if (result === 'skipped') skipped += 1
        if (result === 'retry') {
          retrying += 1
          // Resend is struggling: put the claimed-but-untried final reminders back in the queue for the next sweep.
          for (const rest of deliveries.slice(index + 1)) await repository.release(rest.id)
          break
        }
      }
      const result = { claimed: deliveries.length, sent, failed, skipped, retrying, paused: false, disabled: false }
      if (result.claimed > 0) {
        log('[legacy_final_reminder_sweep]', { claimed: result.claimed, sent, failed, skipped, retrying })
      }
      return result
    },
  }
}
