import { getNewsletterConfig, newsletterSendingStatus, type NewsletterConfig } from './config'
import { newsletterRepository, type ConsentContext, type NewsletterRepository, type NewsletterSubscriber, type SignupOutcome } from './repository'
import { verifyNewsletterToken, type NewsletterTokenPurpose } from './tokens'
import { NEWSLETTER_CONSENT_VERSION, newsletterTopicLabel, type NewsletterSource, type NewsletterTopic } from './topics'

/** Abuse limits: consent events per hashed IP per hour, and per address per 10 minutes. */
export const NEWSLETTER_IP_LIMIT_PER_HOUR = 20
export const NEWSLETTER_EMAIL_LIMIT_PER_10_MIN = 5

export type NewsletterViewer = { profileId: string; verifiedEmail: string | null } | null

export type SubscribeResult =
  | { ok: true; outcome: SignupOutcome; message: string; subscriber: NewsletterSubscriber; followUp: 'sync' | 'confirm' | 'none' }
  | { ok: false; code: 'rate_limited'; message: string }

export type TokenActionResult =
  | { ok: true; outcome: string; message: string; subscriber: NewsletterSubscriber }
  | { ok: false; reason: 'invalid' | 'expired' | 'not_found' | 'unavailable'; message: string }

type Repository = Pick<
  NewsletterRepository,
  'recordSignup' | 'countRecentEventsForIp' | 'countRecentEventsForEmail' | 'confirm' | 'unsubscribe' | 'updateTopics' | 'getById'
>

function topicList(topics: NewsletterTopic[]) {
  return topics.map(newsletterTopicLabel).join(', ')
}

export function signupMessage(outcome: SignupOutcome, email: string, topics: NewsletterTopic[], sendingEnabled: boolean) {
  switch (outcome) {
    case 'subscribed':
      return `You're subscribed. We'll send ${topicList(topics)} to ${email}.`
    case 'topics_updated':
      return `Your newsletter topics are updated. You'll receive: ${topicList(topics)}.`
    case 'already_subscribed':
      return `${email} is already subscribed, so nothing has changed. To change topics, sign in with this address or use the link in any newsletter email.`
    case 'already_pending':
      return sendingEnabled
        ? `We already sent a confirmation link to ${email}. Check your inbox and spam folder; you'll be subscribed once you confirm.`
        : `Your request for ${email} is saved. We'll email a confirmation link before sending any newsletter, and nothing is sent until you confirm.`
    case 'confirmation_required':
      return sendingEnabled
        ? `Almost done: we sent a confirmation link to ${email}. You'll be subscribed once you confirm.`
        : `Your request for ${email} is saved. We'll email a confirmation link before sending any newsletter, and nothing is sent until you confirm.`
  }
}

const TOKEN_MESSAGES = {
  invalid: 'This link is not valid. It may have been copied incompletely. Open the link from the email again, or manage your subscription on the newsletter page.',
  expired: 'This link has expired. Use the link in a more recent Sea N Shore email, or manage your subscription on the newsletter page.',
  not_found: 'We could not find this subscription. It may already have been removed.',
  unavailable: 'Newsletter links are not available right now because the service is not fully configured. Please try again later.',
}

export function createNewsletterService(deps: { repository?: Repository; config?: NewsletterConfig } = {}) {
  const repository = deps.repository ?? newsletterRepository
  const config = deps.config ?? getNewsletterConfig()

  function verify(token: unknown, purpose: NewsletterTokenPurpose) {
    if (!config.tokenSecret) return { ok: false as const, reason: 'unavailable' as const }
    return verifyNewsletterToken(token, { purpose, secret: config.tokenSecret })
  }

  return {
    async subscribe(input: {
      email: string
      topics: NewsletterTopic[]
      source: NewsletterSource
      viewer: NewsletterViewer
      ipHash: string | null
      userAgentSummary: string | null
    }): Promise<SubscribeResult> {
      const rateLimited: SubscribeResult = {
        ok: false,
        code: 'rate_limited',
        message: 'Too many sign-up attempts in a short time. Please wait a few minutes and try again.',
      }
      if (input.ipHash && (await repository.countRecentEventsForIp(input.ipHash, 60)) >= NEWSLETTER_IP_LIMIT_PER_HOUR) return rateLimited
      if ((await repository.countRecentEventsForEmail(input.email, 10)) >= NEWSLETTER_EMAIL_LIMIT_PER_10_MIN) return rateLimited

      // Only the signed-in member's Cognito-verified address skips confirmation.
      const ownershipVerified = Boolean(input.viewer?.verifiedEmail && input.viewer.verifiedEmail === input.email)
      const context: ConsentContext = {
        source: input.source,
        ipHash: input.ipHash,
        userAgentSummary: input.userAgentSummary,
        actorProfileId: input.viewer?.profileId ?? null,
        consentTextVersion: NEWSLETTER_CONSENT_VERSION,
      }
      const { outcome, subscriber } = await repository.recordSignup({
        email: input.email,
        topics: input.topics,
        profileId: input.viewer?.profileId ?? null,
        ownershipVerified,
        context,
      })
      const sendingEnabled = newsletterSendingStatus(config).enabled
      const followUp = outcome === 'subscribed' || outcome === 'topics_updated'
        ? 'sync'
        : outcome === 'confirmation_required' || outcome === 'already_pending'
          ? 'confirm'
          : 'none'
      return {
        ok: true,
        outcome,
        subscriber,
        followUp,
        message: signupMessage(outcome, input.email, outcome === 'already_subscribed' ? subscriber.topics : input.topics, sendingEnabled),
      }
    },

    async confirmWithToken(token: unknown, context: Omit<ConsentContext, 'source'>): Promise<TokenActionResult> {
      const verified = verify(token, 'confirm')
      if (!verified.ok) return { ok: false, reason: verified.reason, message: TOKEN_MESSAGES[verified.reason] }
      const result = await repository.confirm(verified.subscriberId, { ...context, source: 'confirmation_link' })
      if (!result.subscriber) return { ok: false, reason: 'not_found', message: TOKEN_MESSAGES.not_found }
      const message = result.outcome === 'confirmed'
        ? `Thanks, your subscription is confirmed. We'll send ${topicList(result.subscriber.topics)} to ${result.subscriber.email}.`
        : result.outcome === 'already_subscribed'
          ? 'Your subscription was already confirmed. Nothing more to do.'
          : 'This address has unsubscribed since this link was sent, so we did not subscribe it again. Sign up on the newsletter page if you want to rejoin.'
      return { ok: true, outcome: result.outcome, message, subscriber: result.subscriber }
    },

    /** Checks a link without changing anything (used to render the confirmation screens). */
    async inspectToken(token: unknown, purpose: NewsletterTokenPurpose): Promise<TokenActionResult> {
      const verified = verify(token, purpose)
      if (!verified.ok) return { ok: false, reason: verified.reason, message: TOKEN_MESSAGES[verified.reason] }
      const subscriber = await repository.getById(verified.subscriberId)
      if (!subscriber) return { ok: false, reason: 'not_found', message: TOKEN_MESSAGES.not_found }
      return { ok: true, outcome: subscriber.status, message: '', subscriber }
    },

    async unsubscribeWithToken(token: unknown, context: ConsentContext): Promise<TokenActionResult> {
      const verified = verify(token, 'unsubscribe')
      if (!verified.ok) return { ok: false, reason: verified.reason, message: TOKEN_MESSAGES[verified.reason] }
      const result = await repository.unsubscribe(verified.subscriberId, context)
      if (!result.subscriber) return { ok: false, reason: 'not_found', message: TOKEN_MESSAGES.not_found }
      const message = result.outcome === 'unsubscribed'
        ? `${result.subscriber.email} is unsubscribed. You won't receive Sea N Shore newsletters any more.`
        : `${result.subscriber.email} was already unsubscribed. You won't receive Sea N Shore newsletters.`
      return { ok: true, outcome: result.outcome, message, subscriber: result.subscriber }
    },
  }
}

export const tokenMessages = TOKEN_MESSAGES
