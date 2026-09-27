import { getNewsletterConfig, newsletterSendingStatus, type NewsletterConfig } from './config'
import { campaignEmail, confirmationEmail } from './emails'
import { newsletterRepository, type NewsletterRepository, type NewsletterSubscriber } from './repository'
import { createSesV2Client, SesApiError, type SesV2Client } from './ses-client'
import type { NewsletterTopic } from './topics'

type Deps = {
  repository?: Pick<
    NewsletterRepository,
    'claimConfirmation' | 'claimPendingConfirmations' | 'clearConfirmationSent' | 'createCampaign' | 'claimDeliveries' | 'markDelivery' | 'finalizeCampaigns'
  >
  ses?: Pick<SesV2Client, 'sendEmail'> | null
  config?: NewsletterConfig
}

function errorText(error: unknown) {
  if (error instanceof SesApiError) return `${error.code}: ${error.message}`.slice(0, 500)
  return error instanceof Error ? error.message.slice(0, 500) : 'unknown_error'
}

/**
 * Confirmation and campaign email through the SES v2 API. Everything here is a
 * no-op until SES production access is configured (NEWSLETTER_SES_PRODUCTION_ACCESS).
 */
export function createNewsletterSender(deps: Deps = {}) {
  const config = deps.config ?? getNewsletterConfig()
  const repository = deps.repository ?? newsletterRepository
  const ses = deps.ses === undefined ? createSesV2Client({ region: config.region }) : deps.ses

  function enabled() {
    return newsletterSendingStatus(config).enabled && Boolean(ses)
  }

  async function deliverConfirmation(subscriber: NewsletterSubscriber) {
    const email = confirmationEmail(config, { subscriberId: subscriber.id, topics: subscriber.topics })
    try {
      await ses!.sendEmail({
        from: config.fromAddress!,
        to: subscriber.email,
        subject: email.subject,
        text: email.text,
        html: email.html,
        configurationSetName: config.configurationSetName,
        tags: [{ Name: 'category', Value: 'newsletter_confirmation' }],
      })
      return true
    } catch (error) {
      console.error('[newsletter_confirmation_failed]', { subscriberId: subscriber.id, error: errorText(error) })
      await repository.clearConfirmationSent(subscriber.id)
      return false
    }
  }

  return {
    sendingStatus: () => newsletterSendingStatus(config),

    /** Sends the double opt-in email for one pending subscriber, if sending is enabled. */
    async sendConfirmation(subscriberId: string) {
      if (!enabled()) return 'disabled' as const
      const claimed = await repository.claimConfirmation(subscriberId)
      if (!claimed) return 'not_due' as const
      return (await deliverConfirmation(claimed)) ? 'sent' as const : 'failed' as const
    },

    async runConfirmationSweep(limit = 25) {
      if (!enabled()) return { claimed: 0, sent: 0 }
      const pending = await repository.claimPendingConfirmations(limit)
      let sent = 0
      for (const subscriber of pending) if (await deliverConfirmation(subscriber)) sent += 1
      return { claimed: pending.length, sent }
    },

    async queueCampaign(input: { adminId: string; topic: NewsletterTopic; subject: string; bodyText: string }) {
      if (!enabled()) throw new Error('newsletter_sending_disabled')
      return repository.createCampaign(input)
    },

    /** Sends queued campaign deliveries in bounded batches; safe to resume after a crash. */
    async runCampaignSweep(limit = 50) {
      if (!enabled()) return { claimed: 0, sent: 0, failed: 0, skipped: 0 }
      const deliveries = await repository.claimDeliveries(limit)
      let sent = 0
      let failed = 0
      let skipped = 0
      for (const delivery of deliveries) {
        if (!delivery.stillSubscribed) {
          await repository.markDelivery(delivery, { status: 'skipped' })
          skipped += 1
          continue
        }
        try {
          const email = campaignEmail(config, {
            subscriberId: delivery.subscriberId,
            topic: delivery.topic,
            subject: delivery.subject,
            bodyText: delivery.bodyText,
          })
          const result = await ses!.sendEmail({
            from: config.fromAddress!,
            to: delivery.email,
            subject: email.subject,
            text: email.text,
            html: email.html,
            headers: email.headers,
            listManagement: config.listUnsubscribeMode === 'ses'
              ? { contactListName: config.contactListName!, topicName: config.sesTopicNames[delivery.topic] }
              : undefined,
            configurationSetName: config.configurationSetName,
            tags: [{ Name: 'category', Value: 'newsletter_campaign' }],
          })
          await repository.markDelivery(delivery, { status: 'sent', messageId: result.messageId })
          sent += 1
        } catch (error) {
          const retryable = error instanceof SesApiError && error.retryable
          await repository.markDelivery(delivery, { status: retryable ? 'queued' : 'failed', error: errorText(error) })
          if (!retryable) failed += 1
          if (retryable) break // Back off: SES is throttling or unavailable.
        }
      }
      if (deliveries.length) await repository.finalizeCampaigns()
      return { claimed: deliveries.length, sent, failed, skipped }
    },
  }
}
