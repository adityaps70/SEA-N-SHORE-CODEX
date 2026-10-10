import { createResendEmailClient, loadResendApiKey, ResendApiError, type ResendEmailClient } from '@/lib/email/resend'
import { withEmailSuppression } from '@/lib/email/suppression'
import { LEGACY_INVITE_FROM } from './email'
import { legacyReminderEmail } from './reminder-email'
import { legacyReminderRepository, type LegacyReminderDelivery } from './reminder-repository'

type Sender = Pick<ResendEmailClient, 'sendEmail'>

function errorText(error: unknown) {
  if (error instanceof ResendApiError) return `${error.code}: ${error.message}`.slice(0, 500)
  return error instanceof Error ? error.message.slice(0, 500) : 'unknown_error'
}

/** Sends queued second reminders, a few per sweep, re-checking every eligibility rule just before each one. */
export function createLegacyReminderWorker(input: {
  repository?: typeof legacyReminderRepository
  resend?: Sender | null
  loadApiKey?: () => Promise<string | null>
  siteUrl?: string
} = {}) {
  const repository = input.repository ?? legacyReminderRepository
  let client: Sender | null | undefined = input.resend

  async function resolveClient() {
    if (client !== undefined) return client
    const key = await (input.loadApiKey ?? loadResendApiKey)()
    client = key ? withEmailSuppression(createResendEmailClient({ apiKey: key })) : null
    return client
  }

  async function sendOne(delivery: LegacyReminderDelivery, sender: Sender) {
    if (!delivery.stillEligible) {
      await repository.markSkipped(delivery.id, 'no_longer_eligible_for_reminder')
      return 'skipped' as const
    }

    const email = legacyReminderEmail({
      fullName: delivery.fullName,
      email: delivery.email,
      claimToken: delivery.claimToken,
      unsubscribeToken: delivery.unsubscribeToken,
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
        idempotencyKey: `legacy-profile-reminder/${delivery.id}`,
        tags: [{ name: 'category', value: 'legacy_profile_reminder' }],
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
    async runSweep(limit = 5) {
      const sender = await resolveClient()
      if (!sender) return { claimed: 0, sent: 0, failed: 0, skipped: 0, retrying: 0, disabled: true }
      const deliveries = await repository.claimBatch(limit)
      let sent = 0
      let failed = 0
      let skipped = 0
      let retrying = 0
      for (const [index, delivery] of deliveries.entries()) {
        const result = await sendOne(delivery, sender)
        if (result === 'sent') sent += 1
        if (result === 'failed') failed += 1
        if (result === 'skipped') skipped += 1
        if (result === 'retry') {
          retrying += 1
          // Resend is struggling: put the claimed-but-untried reminders back in the queue for the next sweep.
          for (const rest of deliveries.slice(index + 1)) await repository.release(rest.id)
          break
        }
      }
      return { claimed: deliveries.length, sent, failed, skipped, retrying, disabled: false }
    },
  }
}
