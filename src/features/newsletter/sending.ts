import { createResendEmailClient, loadResendApiKey, ResendApiError, type ResendEmailClient } from '@/lib/email/resend'
import { getNewsletterConfig, newsletterSendingStatus, type NewsletterConfig, type NewsletterSendingStatus } from './config'
import { campaignEmail, confirmationEmail } from './emails'
import { newsletterRepository, type NewsletterRepository, type NewsletterSubscriber } from './repository'
import type { NewsletterTopic } from './topics'

type ResendSender = Pick<ResendEmailClient, 'sendEmail'>

type Deps = {
  repository?: Pick<
    NewsletterRepository,
    'claimConfirmation' | 'claimPendingConfirmations' | 'clearConfirmationSent' | 'createCampaign' | 'claimDeliveries' | 'markDelivery' | 'finalizeCampaigns'
  >
  resend?: ResendSender | null
  loadApiKey?: () => Promise<string | null>
  config?: NewsletterConfig
}

function errorText(error: unknown) {
  if (error instanceof ResendApiError) return (error.code + ': ' + error.message).slice(0, 500)
  return error instanceof Error ? error.message.slice(0, 500) : 'unknown_error'
}

function confirmationMarker(subscriber: NewsletterSubscriber) {
  const value = subscriber.confirmationSentAt ?? subscriber.updatedAt
  const day = value?.slice(0, 10) ?? ''
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : 'current'
}

/**
 * Newsletter confirmation and campaign email through Resend. The API key stays
 * server-side and is loaded from AWS Secrets Manager in production.
 */
export function createNewsletterSender(deps: Deps = {}) {
  const config = deps.config ?? getNewsletterConfig()
  const repository = deps.repository ?? newsletterRepository
  let cachedClient: ResendSender | null = null

  async function resolveClient(): Promise<ResendSender | null> {
    if (deps.resend !== undefined) return deps.resend
    if (cachedClient) return cachedClient
    const apiKey = await (deps.loadApiKey ?? loadResendApiKey)()
    if (!apiKey) return null
    cachedClient = createResendEmailClient({ apiKey })
    return cachedClient
  }

  async function readiness(): Promise<{ status: NewsletterSendingStatus; client: ResendSender | null }> {
    const configured = newsletterSendingStatus(config)
    if (!configured.enabled) return { status: configured, client: null }
    const client = await resolveClient()
    return {
      status: client ? { enabled: true } : { enabled: false, reason: 'resend_api_key' },
      client,
    }
  }

  async function deliverConfirmation(subscriber: NewsletterSubscriber, client: ResendSender) {
    const marker = confirmationMarker(subscriber)
    const stableNow = marker === 'current' ? undefined : new Date(marker + 'T00:00:00.000Z')
    const email = confirmationEmail(config, {
      subscriberId: subscriber.id,
      topics: subscriber.topics,
      now: stableNow,
    })
    try {
      await client.sendEmail({
        from: config.fromAddress!,
        to: subscriber.email,
        subject: email.subject,
        text: email.text,
        html: email.html,
        idempotencyKey: 'newsletter-confirmation/' + subscriber.id + '/' + marker,
        tags: [{ name: 'category', value: 'newsletter_confirmation' }],
      })
      return true
    } catch (error) {
      console.error('[newsletter_confirmation_failed]', { subscriberId: subscriber.id, error: errorText(error) })
      await repository.clearConfirmationSent(subscriber.id)
      return false
    }
  }

  return {
    async sendingStatus() {
      return (await readiness()).status
    },

    /** Sends the double opt-in email for one pending subscriber, if sending is enabled. */
    async sendConfirmation(subscriberId: string) {
      const ready = await readiness()
      if (!ready.status.enabled || !ready.client) return 'disabled' as const
      const claimed = await repository.claimConfirmation(subscriberId)
      if (!claimed) return 'not_due' as const
      return (await deliverConfirmation(claimed, ready.client)) ? 'sent' as const : 'failed' as const
    },

    async runConfirmationSweep(limit = 25) {
      const ready = await readiness()
      if (!ready.status.enabled || !ready.client) return { claimed: 0, sent: 0 }
      const pending = await repository.claimPendingConfirmations(limit)
      let sent = 0
      for (const subscriber of pending) if (await deliverConfirmation(subscriber, ready.client)) sent += 1
      return { claimed: pending.length, sent }
    },

    async queueCampaign(input: { adminId: string; topic: NewsletterTopic; subject: string; bodyText: string }) {
      const ready = await readiness()
      if (!ready.status.enabled || !ready.client) throw new Error('newsletter_sending_disabled')
      return repository.createCampaign(input)
    },

    /** Sends queued campaign deliveries in bounded batches; safe to resume after a crash. */
    async runCampaignSweep(limit = 50) {
      const ready = await readiness()
      if (!ready.status.enabled || !ready.client) return { claimed: 0, sent: 0, failed: 0, skipped: 0 }
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
          // Resend does not manage the Sea N Shore subscription database, so the
          // application always emits its own RFC 8058 one-click unsubscribe headers.
          const email = campaignEmail({ ...config, listUnsubscribeMode: 'app' }, {
            subscriberId: delivery.subscriberId,
            topic: delivery.topic,
            subject: delivery.subject,
            bodyText: delivery.bodyText,
          })
          const result = await ready.client.sendEmail({
            from: config.fromAddress!,
            to: delivery.email,
            subject: email.subject,
            text: email.text,
            html: email.html,
            headers: email.headers,
            idempotencyKey: 'newsletter-campaign/' + delivery.campaignId + '/' + delivery.subscriberId,
            tags: [{ name: 'category', value: 'newsletter_campaign' }],
          })
          await repository.markDelivery(delivery, { status: 'sent', messageId: result.messageId })
          sent += 1
        } catch (error) {
          const retryable = error instanceof ResendApiError && error.retryable
          await repository.markDelivery(delivery, { status: retryable ? 'queued' : 'failed', error: errorText(error) })
          if (!retryable) failed += 1
          if (retryable) break
        }
      }
      if (deliveries.length) await repository.finalizeCampaigns()
      return { claimed: deliveries.length, sent, failed, skipped }
    },
  }
}
