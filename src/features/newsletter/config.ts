import { NEWSLETTER_TOPICS, type NewsletterTopic } from './topics'

/**
 * Newsletter configuration, read from environment variables at call time.
 *
 * NEWSLETTER_TOKEN_SECRET               Secret (32+ chars) that signs unsubscribe/confirm links and hashes IPs. Required.
 * NEWSLETTER_SES_REGION                 SES region. Defaults to AWS_REGION, then ap-south-1.
 * NEWSLETTER_SES_CONTACT_LIST           SES contact list name. When empty, SES sync is skipped and rows stay "pending sync".
 * NEWSLETTER_SES_TOPIC_PRODUCT_UPDATES  SES topic name for "Sea N Shore news"      (default product-updates)
 * NEWSLETTER_SES_TOPIC_JOBS_DIGEST      SES topic name for "Maritime jobs digest"  (default jobs-digest)
 * NEWSLETTER_SES_TOPIC_LEARNING_EVENTS  SES topic name for "Learning & events"     (default learning-events)
 * NEWSLETTER_FROM_ADDRESS               Verified SES sender, e.g. "Sea N Shore <newsletter@example.com>".
 * NEWSLETTER_SES_CONFIGURATION_SET      Optional SES configuration set for sending.
 * NEWSLETTER_SES_PRODUCTION_ACCESS      "true" only after AWS grants SES production access. Enables confirmation
 *                                       emails and campaign sending. Anything else keeps sending disabled.
 * NEWSLETTER_LIST_UNSUBSCRIBE           "ses" (default): SES subscription management adds the List-Unsubscribe
 *                                       one-click headers. "app": Sea N Shore adds its own RFC 8058 headers.
 * NEXT_PUBLIC_SITE_URL                  Used to build absolute links in emails.
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
    fromAddress: clean(env.NEWSLETTER_FROM_ADDRESS),
    configurationSetName: clean(env.NEWSLETTER_SES_CONFIGURATION_SET),
    productionAccess: clean(env.NEWSLETTER_SES_PRODUCTION_ACCESS) === 'true',
    listUnsubscribeMode: clean(env.NEWSLETTER_LIST_UNSUBSCRIBE) === 'app' ? 'app' : 'ses',
    siteUrl: (clean(env.NEXT_PUBLIC_SITE_URL) ?? 'http://localhost:3000').replace(/\/+$/g, ''),
  }
}

export type NewsletterSendingStatus =
  | { enabled: true }
  | { enabled: false; reason: 'production_access' | 'sender' | 'contact_list' | 'secret' }

/** Campaign and confirmation-email sending stays off until every prerequisite is configured. */
export function newsletterSendingStatus(config: NewsletterConfig): NewsletterSendingStatus {
  if (!config.tokenSecret) return { enabled: false, reason: 'secret' }
  if (!config.contactListName) return { enabled: false, reason: 'contact_list' }
  if (!config.fromAddress) return { enabled: false, reason: 'sender' }
  if (!config.productionAccess) return { enabled: false, reason: 'production_access' }
  return { enabled: true }
}

export const SENDING_DISABLED_MESSAGES: Record<Exclude<NewsletterSendingStatus, { enabled: true }>['reason'], string> = {
  production_access:
    'Sending is turned off until Amazon SES production access is approved for this account. Set NEWSLETTER_SES_PRODUCTION_ACCESS=true once AWS confirms it.',
  sender: 'Sending is turned off because no verified sender address is configured (NEWSLETTER_FROM_ADDRESS).',
  contact_list: 'Sending is turned off because no SES contact list is configured (NEWSLETTER_SES_CONTACT_LIST).',
  secret: 'Sending is turned off because the newsletter link-signing secret is missing (NEWSLETTER_TOKEN_SECRET).',
}
