'use server'

import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { getNewsletterConfig } from '@/features/newsletter/config'
import { firstPlainIssue, plainFieldErrors } from '@/lib/validation/plain-messages'
import { supportRepository } from './repository'
import { supportIpHashFromHeaders } from './request-context'
import { contactFormSchema, supportTicketReference, ticketReplySchema } from './topics'
import { getSupportViewer } from './viewer'

/**
 * Round H (H7): the Contact page form and a member's reply to their own ticket. Nothing is emailed
 * here: the ticket and its queued email are saved together and the outbox worker sends the email.
 * Logs carry error codes only, never a name, address or message.
 */
export type ContactFormField = 'name' | 'email' | 'topic' | 'message'

export type ContactFormState = {
  status: 'idle' | 'success' | 'error'
  message?: string
  fieldErrors?: Partial<Record<ContactFormField, string>>
  values?: Partial<Record<ContactFormField, string>>
  /** Set on success for a signed-in member, so the form can link to the ticket. */
  ticketId?: string
  reference?: string
}

const FIELD_LABELS: Record<ContactFormField, string> = { name: 'Name', email: 'Email address', topic: 'Topic', message: 'Message' }
const RATE_LIMITED = 'You have sent several messages in a short time. Please wait an hour and try again, or email us directly.'
const SAVE_FAILED = 'Your message could not be sent just now. It is still here; please try again in a minute.'

function errorCode(error: unknown) {
  return (error as { code?: string } | null)?.code ?? (error instanceof Error ? error.name : 'unknown')
}

export async function submitContactForm(_previous: ContactFormState, formData: FormData): Promise<ContactFormState> {
  const values = {
    name: String(formData.get('name') ?? '').trim(),
    email: String(formData.get('email') ?? '').trim(),
    topic: String(formData.get('topic') ?? ''),
    message: String(formData.get('message') ?? ''),
  }
  const parsed = contactFormSchema.safeParse({ ...values, website: String(formData.get('website') ?? '') })
  if (!parsed.success) {
    const errors = plainFieldErrors(parsed.error, FIELD_LABELS)
    const fieldErrors: ContactFormState['fieldErrors'] = {}
    for (const field of ['name', 'email', 'topic', 'message'] as const) {
      if (errors[field]?.[0]) fieldErrors[field] = errors[field][0]
    }
    return { status: 'error', message: 'Please fix the highlighted fields and try again.', fieldErrors, values }
  }

  // A filled honeypot means an automated submission: answer as if sent, store and send nothing.
  if (parsed.data.website.trim()) {
    return { status: 'success', message: 'Thanks, your message has been sent. We will reply by email.' }
  }

  try {
    const [viewer, requestHeaders] = await Promise.all([getSupportViewer(), headers()])
    const ipHash = supportIpHashFromHeaders(requestHeaders, getNewsletterConfig().tokenSecret)
    const result = await supportRepository.createTicket({
      senderProfileId: viewer?.profileId ?? null,
      senderName: parsed.data.name,
      senderEmail: parsed.data.email,
      ipHash,
      topic: parsed.data.topic,
      body: parsed.data.message,
    })
    if (!result.ok) return { status: 'error', message: RATE_LIMITED, values }
    const reference = supportTicketReference(result.ticketId)
    if (viewer) {
      revalidatePath('/help/requests')
      return {
        status: 'success',
        message: `Thanks, your message has been sent (reference ${reference}). We reply by email and you can follow it under Help › My requests.`,
        ticketId: result.ticketId,
        reference,
      }
    }
    return { status: 'success', message: `Thanks, your message has been sent (reference ${reference}). We will reply to ${parsed.data.email}.`, reference }
  } catch (error) {
    console.error('[support_ticket_create_failed]', { code: errorCode(error) })
    return { status: 'error', message: SAVE_FAILED, values }
  }
}

export type TicketReplyState = {
  status: 'idle' | 'success' | 'error'
  message?: string
  fieldError?: string
  body?: string
}

const MEMBER_REPLY_MESSAGES = {
  not_found: 'This request could not be found. Open it again from Help › My requests.',
  closed: 'This request is closed. Send a new message from the Contact page if you still need help.',
  rate_limited: 'You have sent many replies in a short time. Please wait an hour and try again.',
} as const

/** A signed-in member answers their own open or answered ticket. */
export async function replyToMyTicket(ticketId: string, _previous: TicketReplyState, formData: FormData): Promise<TicketReplyState> {
  const body = String(formData.get('body') ?? '')
  const parsed = ticketReplySchema.safeParse({ body })
  if (!parsed.success) return { status: 'error', fieldError: firstPlainIssue(parsed.error, 'Write your reply.'), body }
  let profileId: string
  try {
    profileId = (await requireAwsUser()).id
  } catch {
    return { status: 'error', message: 'Your session has ended. Sign in again, then send your reply.', body }
  }
  try {
    const result = await supportRepository.replyAsMember(profileId, ticketId, parsed.data.body)
    if (!result.ok) return { status: 'error', message: MEMBER_REPLY_MESSAGES[result.reason], body }
    revalidatePath('/help/requests')
    revalidatePath(`/help/requests/${ticketId}`)
    return { status: 'success', message: 'Your reply has been sent. We will answer by email and here.' }
  } catch (error) {
    console.error('[support_ticket_reply_failed]', { code: errorCode(error) })
    return { status: 'error', message: 'Your reply could not be sent just now. It is still here; please try again in a minute.', body }
  }
}
