import { NEWSLETTER_TOPICS, type NewsletterTopic } from './topics'

export const DEFAULT_NEWSLETTER_FROM_ADDRESS = 'Sea N Shore <newsletter@mail.seanshore.in>'

/**
 * Newsletter configuration, read from environment variables at call time.
 *
 * NEWSLETTER_TOKEN_SECRET               Secret (32+ chars) that signs unsubscribe/confirm links and hashes IPs. Required.
 * NEWSLETTER_FROM_ADDRESS               Resend sender. Defaults to the verified mail.seanshore.in subdomain.
 * NEWSLETTER_LIST_UNSUBSCRIBE           "app" by default: Sea N Shore adds RFC 8058 one-click headers.
 * NEXT_PUBLIC_SITE_URL                  Used to build absolute links in emails.
 *
 * The SES settings remain only for the legacy contact-list sync path while the
 * database stays the source of truth. They are not prerequisites for Resend.
 */
export type NewsletterConfig = {
  tokenSecret: string | null
  region: string
  contactListName: string | null
  sesTopicNames: Record<NewsletterTopic, string>
  fromAddress: string | null
  configurationSetName: string | null
  productionAccess: boolean
  listUnsubscribeMode: 'ses' | 'app'
  siteUrl: string
}

type Env = Record<string, string | undefined>

function clean(value: string | undefined) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

export function getNewsletterConfig(env: Env = process.env): NewsletterConfig {
  const secret = clean(env.NEWSLETTER_TOKEN_SECRET)
  const sesTopicNames = Object.fromEntries(
    NEWSLETTER_TOPICS.map((topic) => [topic.id, clean(env[topic.sesTopicEnv]) ?? topic.defaultSesTopicName]),
  ) as Record<NewsletterTopic, string>

  return {
    tokenSecret: secret && secret.length >= 32 ? secret : null,
    region: clean(env.NEWSLETTER_SES_REGION) ?? clean(env.AWS_REGION) ?? 'ap-south-1',
    contactListName: clean(env.NEWSLETTER_SES_CONTACT_LIST),
    sesTopicNames,
    fromAddress: clean(env.NEWSLETTER_FROM_ADDRESS) ?? DEFAULT_NEWSLETTER_FROM_ADDRESS,
    configurationSetName: clean(env.NEWSLETTER_SES_CONFIGURATION_SET),
    productionAccess: clean(env.NEWSLETTER_SES_PRODUCTION_ACCESS) === 'true',
    listUnsubscribeMode: clean(env.NEWSLETTER_LIST_UNSUBSCRIBE) === 'ses' ? 'ses' : 'app',
    siteUrl: (clean(env.NEXT_PUBLIC_SITE_URL) ?? 'http://localhost:3000').replace(/\/+$/g, ''),
  }
}

export type NewsletterSendingDisabledReason = 'resend_api_key' | 'sender' | 'secret'
export type NewsletterSendingStatus =
  | { enabled: true }
  | { enabled: false; reason: NewsletterSendingDisabledReason }

/** Synchronous prerequisites. Resend API-key readiness is checked by createNewsletterSender(). */
export function newsletterSendingStatus(config: NewsletterConfig): NewsletterSendingStatus {
  if (!config.tokenSecret) return { enabled: false, reason: 'secret' }
  if (!config.fromAddress) return { enabled: false, reason: 'sender' }
  return { enabled: true }
}

export const SENDING_DISABLED_MESSAGES: Record<NewsletterSendingDisabledReason, string> = {
  resend_api_key: 'Sending is turned off because the Resend API key is not available to this service.',
  sender: 'Sending is turned off because the Resend sender address is not configured.',
  secret: 'Sending is turned off because the newsletter link-signing secret is missing (NEWSLETTER_TOKEN_SECRET).',
}
