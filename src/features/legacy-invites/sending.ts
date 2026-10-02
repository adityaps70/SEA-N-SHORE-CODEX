import { createResendEmailClient, loadResendApiKey, ResendApiError, type ResendEmailClient } from '@/lib/email/resend'
import { LEGACY_INVITE_FROM, legacyInviteEmail } from './email'
import { legacyInviteRepository, type LegacyInviteDelivery } from './repository'

type Sender = Pick<ResendEmailClient, 'sendEmail'>

function errorText(error: unknown) {
  if (error instanceof ResendApiError) return `${error.code}: ${error.message}`.slice(0, 500)
  return error instanceof Error ? error.message.slice(0, 500) : 'unknown_error'
}

export function createLegacyInviteWorker(input: {
  repository?: typeof legacyInviteRepository
  resend?: Sender | null
  loadApiKey?: () => Promise<string | null>
  siteUrl?: string
} = {}) {
  const repository = input.repository ?? legacyInviteRepository
  let client: Sender | null | undefined = input.resend

  async function resolveClient() {
    if (client !== undefined) return client
    const key = await (input.loadApiKey ?? loadResendApiKey)()
    client = key ? createResendEmailClient({ apiKey: key }) : null
    return client
  }

  async function sendOne(delivery: LegacyInviteDelivery, sender: Sender) {
    if (!delivery.stillEligible) {
      await repository.markSkipped(delivery.id, 'legacy_profile_no_longer_eligible')
      return 'skipped' as const
    }

    const email = legacyInviteEmail({
      fullName: delivery.fullName,
      claimToken: delivery.claimToken,
      siteUrl: input.siteUrl,
    })

    try {
      const result = await sender.sendEmail({
        from: LEGACY_INVITE_FROM,
        to: delivery.email,
        subject: email.subject,
        text: email.text,
        html: email.html,
        idempotencyKey: `legacy-profile-invite/${delivery.id}`,
        tags: [{ name: 'category', value: 'legacy_profile_invite' }],
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
    async runSweep(limit = 25) {
      const sender = await resolveClient()
      if (!sender) return { claimed: 0, sent: 0, failed: 0, skipped: 0, retrying: 0, disabled: true }
      const deliveries = await repository.claimBatch(limit)
      let sent = 0
      let failed = 0
      let skipped = 0
      let retrying = 0
      for (const delivery of deliveries) {
        const result = await sendOne(delivery, sender)
        if (result === 'sent') sent += 1
        if (result === 'failed') failed += 1
        if (result === 'skipped') skipped += 1
        if (result === 'retry') {
          retrying += 1
          break
        }
      }
      return { claimed: deliveries.length, sent, failed, skipped, retrying, disabled: false }
    },
  }
}
