import { z } from 'zod'
import { NEWSLETTER_TOPIC_IDS } from './topics'

export const newsletterEmailSchema = z
  .string({ error: 'Enter your email address.' })
  .trim()
  .toLowerCase()
  .min(1, { error: 'Enter your email address.' })
  .max(254, { error: 'That email address is too long.' })
  .pipe(z.email({ error: 'Enter a valid email address, like name@example.com.' }))

export const newsletterTopicsSchema = z
  .array(z.enum(NEWSLETTER_TOPIC_IDS), { error: 'Choose at least one topic.' })
  .min(1, { error: 'Choose at least one topic.' })
  .max(NEWSLETTER_TOPIC_IDS.length)
  .transform((topics) => [...new Set(topics)])

export const newsletterSignupSchema = z.object({
  email: newsletterEmailSchema,
  topics: newsletterTopicsSchema,
  consent: z.literal('yes', { error: 'Tick the consent box to subscribe. We only email people who have agreed.' }),
  source: z.enum(['newsletter_page', 'public_footer']).catch('newsletter_page'),
  // Honeypot: real people never see or fill this field.
  company_website: z.string().max(0).optional().catch('filled'),
})

export const newsletterCampaignSchema = z.object({
  topic: z.enum(NEWSLETTER_TOPIC_IDS, { error: 'Choose which topic this campaign is for.' }),
  subject: z
    .string()
    .trim()
    .min(3, { error: 'Write a subject of at least 3 characters.' })
    .max(150, { error: 'Keep the subject under 150 characters.' }),
  bodyText: z
    .string()
    .trim()
    .min(10, { error: 'Write the email text (at least 10 characters).' })
    .max(20000, { error: 'The email text is too long (20,000 characters maximum).' }),
})

export function formTopics(formData: FormData) {
  return formData.getAll('topics').filter((value): value is string => typeof value === 'string')
}
