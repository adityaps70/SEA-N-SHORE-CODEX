import { z } from 'zod'

/**
 * Round H (H7): Contact page tickets. Topics, statuses and the form schemas, shared by the form, the
 * server actions and the admin pages. Pure, safe to import from client and server code. The topic and
 * status lists match the checks in migration 0089.
 */

export const SUPPORT_TOPICS = [
  { id: 'account', label: 'Account and sign-in (including a lost two-step verification device)' },
  { id: 'payments', label: 'Payments, refunds and plans' },
  { id: 'jobs', label: 'Jobs and applications' },
  { id: 'learning', label: 'Courses and certificates' },
  { id: 'events', label: 'Events and tickets' },
  { id: 'organizations', label: 'Organization pages' },
  { id: 'privacy', label: 'Privacy and your data' },
  { id: 'grievance', label: 'A complaint (grievance)' },
  { id: 'partnership', label: 'Global partnership' },
  { id: 'technical', label: 'Something is not working' },
  { id: 'other', label: 'Something else' },
] as const

export type SupportTopic = (typeof SUPPORT_TOPICS)[number]['id']
export const SUPPORT_TOPIC_IDS = SUPPORT_TOPICS.map((topic) => topic.id) as [SupportTopic, ...SupportTopic[]]

export function supportTopicLabel(topic: string) {
  return SUPPORT_TOPICS.find((entry) => entry.id === topic)?.label ?? 'Something else'
}

/** Short labels for lists and email subjects. */
export const SUPPORT_TOPIC_SHORT_LABELS: Record<SupportTopic, string> = {
  account: 'Account and sign-in',
  payments: 'Payments',
  jobs: 'Jobs',
  learning: 'Courses',
  events: 'Events',
  organizations: 'Organizations',
  privacy: 'Privacy',
  grievance: 'Grievance',
  partnership: 'Partnership',
  technical: 'Not working',
  other: 'Other',
}

export function supportTopicShortLabel(topic: string) {
  return SUPPORT_TOPIC_SHORT_LABELS[topic as SupportTopic] ?? 'Other'
}

export const SUPPORT_TICKET_STATUSES = ['open', 'answered', 'closed'] as const
export type SupportTicketStatus = (typeof SUPPORT_TICKET_STATUSES)[number]

export const SUPPORT_STATUS_LABELS: Record<SupportTicketStatus, string> = {
  open: 'Open',
  answered: 'Answered',
  closed: 'Closed',
}

export function isSupportTicketStatus(value: unknown): value is SupportTicketStatus {
  return (SUPPORT_TICKET_STATUSES as readonly unknown[]).includes(value)
}

export const SUPPORT_MESSAGE_MAX = 5000
export const SUPPORT_NAME_MAX = 120

export const supportMessageSchema = z
  .string({ error: 'Write your message.' })
  .trim()
  .min(10, { error: 'Write a little more, at least 10 characters, so we can help.' })
  .max(SUPPORT_MESSAGE_MAX, { error: `Keep the message under ${SUPPORT_MESSAGE_MAX.toLocaleString('en-IN')} characters.` })

export const contactFormSchema = z.object({
  name: z
    .string({ error: 'Enter your name.' })
    .trim()
    .min(1, { error: 'Enter your name.' })
    .max(SUPPORT_NAME_MAX, { error: `Keep your name under ${SUPPORT_NAME_MAX} characters.` }),
  email: z
    .string({ error: 'Enter your email address.' })
    .trim()
    .toLowerCase()
    .min(1, { error: 'Enter your email address.' })
    .max(254, { error: 'That email address is too long.' })
    .pipe(z.email({ error: 'Enter a valid email address, like name@example.com.' })),
  topic: z.enum(SUPPORT_TOPIC_IDS, { error: 'Choose what your message is about.' }),
  message: supportMessageSchema,
  /** Honeypot: hidden from people; automated form fillers tend to fill it. */
  website: z.string().max(500).optional().default(''),
})

export type ContactFormInput = z.infer<typeof contactFormSchema>

export const ticketReplySchema = z.object({
  body: z
    .string({ error: 'Write your reply.' })
    .trim()
    .min(1, { error: 'Write your reply.' })
    .max(SUPPORT_MESSAGE_MAX, { error: `Keep the reply under ${SUPPORT_MESSAGE_MAX.toLocaleString('en-IN')} characters.` }),
})

/** The operations inbox that receives every new ticket and member reply. */
export const SUPPORT_OPERATIONS_EMAIL = 'info@beaufortmarine.in'

/** "SNS-1A2B3C4D": a short, readable reference for emails and the member's list (the start of the ticket id). */
export function supportTicketReference(ticketId: string) {
  return `SNS-${ticketId.replace(/-/g, '').slice(0, 8).toUpperCase()}`
}
