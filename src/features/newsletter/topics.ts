/**
 * Newsletter topics. Each maps to an Amazon SES contact-list topic whose name can
 * be overridden with the environment variable shown (see config.ts).
 * Adding a topic requires updating the check constraints in migration 0036.
 */
export const NEWSLETTER_TOPICS = [
  {
    id: 'product_updates',
    label: 'Sea N Shore news',
    description: 'Product updates, new features and community announcements. Roughly once a month.',
    sesTopicEnv: 'NEWSLETTER_SES_TOPIC_PRODUCT_UPDATES',
    defaultSesTopicName: 'product-updates',
  },
  {
    id: 'jobs_digest',
    label: 'Maritime jobs digest',
    description: 'A roundup of new sea and shore vacancies posted on Sea N Shore.',
    sesTopicEnv: 'NEWSLETTER_SES_TOPIC_JOBS_DIGEST',
    defaultSesTopicName: 'jobs-digest',
  },
  {
    id: 'learning_events',
    label: 'Learning & events',
    description: 'New courses, webinars, masterclasses and industry events.',
    sesTopicEnv: 'NEWSLETTER_SES_TOPIC_LEARNING_EVENTS',
    defaultSesTopicName: 'learning-events',
  },
] as const

export type NewsletterTopic = (typeof NEWSLETTER_TOPICS)[number]['id']

export const NEWSLETTER_TOPIC_IDS = NEWSLETTER_TOPICS.map((topic) => topic.id) as [NewsletterTopic, ...NewsletterTopic[]]

export function isNewsletterTopic(value: unknown): value is NewsletterTopic {
  return typeof value === 'string' && (NEWSLETTER_TOPIC_IDS as readonly string[]).includes(value)
}

export function newsletterTopicLabel(topic: string) {
  return NEWSLETTER_TOPICS.find((entry) => entry.id === topic)?.label ?? topic
}

/**
 * Bump the version whenever the consent wording changes. Every consent event
 * stores the version the person agreed to.
 */
export const NEWSLETTER_CONSENT_VERSION = '2026-09-27'

export const NEWSLETTER_CONSENT_TEXT =
  'Yes, email me the Sea N Shore newsletter for the topics I selected. I can unsubscribe at any time using the link in every email or on the newsletter page.'

export type NewsletterStatus = 'pending' | 'subscribed' | 'unsubscribed'
export const NEWSLETTER_STATUSES: NewsletterStatus[] = ['pending', 'subscribed', 'unsubscribed']

export type NewsletterSource =
  | 'newsletter_page'
  | 'public_footer'
  | 'unsubscribe_page'
  | 'one_click'
  | 'ses_subscription_management'
  | 'member_settings'
  | 'admin'
  | 'confirmation_link'

export const NEWSLETTER_STATUS_LABELS: Record<NewsletterStatus, string> = {
  pending: 'Awaiting confirmation',
  subscribed: 'Subscribed',
  unsubscribed: 'Unsubscribed',
}
