'use server'

import { headers } from 'next/headers'
import { after } from 'next/server'
import { getNewsletterConfig } from './config'
import { clientIpFromHeaders, hashClientIp, summarizeUserAgent } from './privacy'
import { getNewsletterViewer } from './queries'
import { newsletterRepository } from './repository'
import { formTopics, newsletterSignupSchema, newsletterTopicsSchema } from './schemas'
import { createNewsletterSender } from './sending'
import { createNewsletterService } from './service'
import { createNewsletterSesSync } from './ses-sync'

export type NewsletterFormState = {
  status: 'idle' | 'success' | 'error'
  message?: string
  outcome?: string
  fieldErrors?: Partial<Record<'email' | 'topics' | 'consent', string>>
  /** `consent` is echoed back only on errors, so a successful form never comes back pre-ticked. */
  values?: { email: string; topics: string[]; consent?: boolean }
}

const SAVE_FAILED = "We couldn't save your newsletter choice just now, so nothing was changed. Please try again in a minute."

async function requestContext() {
  const requestHeaders = await headers()
  const config = getNewsletterConfig()
  return {
    ipHash: hashClientIp(clientIpFromHeaders(requestHeaders), config.tokenSecret),
    userAgentSummary: summarizeUserAgent(requestHeaders.get('user-agent')),
  }
}

/**
 * SES sync and confirmation email run after the response. If either fails the
 * database row keeps its pending state and the outbox worker retries it.
 */
function scheduleFollowUp(kind: 'sync' | 'confirm' | 'none', subscriberId: string) {
  if (kind === 'none') return
  after(async () => {
    try {
      if (kind === 'sync') await createNewsletterSesSync().syncById(subscriberId)
      else await createNewsletterSender().sendConfirmation(subscriberId)
    } catch (error) {
      console.error('[newsletter_follow_up_failed]', { kind, subscriberId, error: error instanceof Error ? error.name : 'unknown' })
    }
  })
}

export async function subscribeToNewsletter(_previous: NewsletterFormState, formData: FormData): Promise<NewsletterFormState> {
  const values = { email: String(formData.get('email') ?? '').trim(), topics: formTopics(formData) }
  const parsed = newsletterSignupSchema.safeParse({
    email: values.email,
    topics: values.topics,
    consent: formData.get('consent') ?? undefined,
    source: formData.get('source') ?? undefined,
    company_website: String(formData.get('company_website') ?? ''),
  })

  if (!parsed.success) {
    const fieldErrors: NewsletterFormState['fieldErrors'] = {}
    for (const issue of parsed.error.issues) {
      const field = issue.path[0]
      if ((field === 'email' || field === 'topics' || field === 'consent') && !fieldErrors[field]) fieldErrors[field] = issue.message
    }
    return {
      status: 'error',
      message: 'Please fix the highlighted fields and try again.',
      fieldErrors,
      values: { ...values, consent: formData.get('consent') === 'yes' },
    }
  }

  // A filled honeypot means an automated submission: accept quietly, store nothing.
  if (parsed.data.company_website === 'filled') {
    return { status: 'success', outcome: 'confirmation_required', message: 'Thanks. Check your inbox for a confirmation link.', values }
  }

  try {
    const [viewer, context] = await Promise.all([getNewsletterViewer(), requestContext()])
    const result = await createNewsletterService().subscribe({
      email: parsed.data.email,
      topics: parsed.data.topics,
      source: parsed.data.source,
      viewer,
      ipHash: context.ipHash,
      userAgentSummary: context.userAgentSummary,
    })
    if (!result.ok) return { status: 'error', message: result.message, values: { ...values, consent: true } }
    scheduleFollowUp(result.followUp, result.subscriber.id)
    return { status: 'success', outcome: result.outcome, message: result.message, values }
  } catch (error) {
    console.error('[newsletter_signup_failed]', { error: error instanceof Error ? error.name : 'unknown' })
    return { status: 'error', message: SAVE_FAILED, values: { ...values, consent: true } }
  }
}

export async function confirmNewsletterSubscription(_previous: NewsletterFormState, formData: FormData): Promise<NewsletterFormState> {
  try {
    const context = await requestContext()
    const result = await createNewsletterService().confirmWithToken(formData.get('token'), context)
    if (!result.ok) return { status: 'error', message: result.message }
    if (result.outcome === 'confirmed') scheduleFollowUp('sync', result.subscriber.id)
    return { status: 'success', outcome: result.outcome, message: result.message }
  } catch (error) {
    console.error('[newsletter_confirm_failed]', { error: error instanceof Error ? error.name : 'unknown' })
    return { status: 'error', message: "We couldn't confirm your subscription just now. Please try the link again in a minute." }
  }
}

export async function unsubscribeWithNewsletterToken(_previous: NewsletterFormState, formData: FormData): Promise<NewsletterFormState> {
  try {
    const context = await requestContext()
    const result = await createNewsletterService().unsubscribeWithToken(formData.get('token'), { ...context, source: 'unsubscribe_page' })
    if (!result.ok) return { status: 'error', message: result.message }
    if (result.outcome === 'unsubscribed') scheduleFollowUp('sync', result.subscriber.id)
    return { status: 'success', outcome: result.outcome, message: result.message }
  } catch (error) {
    console.error('[newsletter_unsubscribe_failed]', { error: error instanceof Error ? error.name : 'unknown' })
    return { status: 'error', message: "We couldn't unsubscribe you just now, and nothing was changed. Please try again in a minute." }
  }
}

/** Signed-in members manage the subscription for their own verified email. */
export async function updateMyNewsletterPreferences(_previous: NewsletterFormState, formData: FormData): Promise<NewsletterFormState> {
  const viewer = await getNewsletterViewer()
  if (!viewer) return { status: 'error', message: 'Your session has expired. Sign in again, then retry.' }
  if (!viewer.verifiedEmail) return { status: 'error', message: 'Your account has no verified email address, so there is no subscription to manage.' }

  const intent = formData.get('intent') === 'unsubscribe' ? 'unsubscribe' : 'save'
  const topics = formTopics(formData)

  try {
    const subscriber = await newsletterRepository.getByEmail(viewer.verifiedEmail)
    if (!subscriber || subscriber.status !== 'subscribed') {
      return { status: 'error', message: 'This address is not subscribed right now. Use the sign-up form to subscribe.' }
    }
    const context = { ...(await requestContext()), source: 'member_settings' as const, actorProfileId: viewer.profileId }

    if (intent === 'unsubscribe') {
      const result = await newsletterRepository.unsubscribe(subscriber.id, context)
      if (result.subscriber) scheduleFollowUp('sync', result.subscriber.id)
      return { status: 'success', outcome: 'unsubscribed', message: `${subscriber.email} is unsubscribed. You won't receive Sea N Shore newsletters any more.` }
    }

    const parsed = newsletterTopicsSchema.safeParse(topics)
    if (!parsed.success) {
      return {
        status: 'error',
        message: 'Choose at least one topic, or unsubscribe if you no longer want the newsletter.',
        fieldErrors: { topics: 'Choose at least one topic.' },
        values: { email: subscriber.email, topics },
      }
    }
    const result = await newsletterRepository.updateTopics(subscriber.id, parsed.data, context)
    if (result.outcome === 'updated') scheduleFollowUp('sync', subscriber.id)
    return {
      status: 'success',
      outcome: result.outcome,
      message: result.outcome === 'unchanged' ? 'No changes to save. Your topics are already set this way.' : 'Your newsletter topics are saved.',
      values: { email: subscriber.email, topics: parsed.data },
    }
  } catch (error) {
    console.error('[newsletter_preferences_failed]', { error: error instanceof Error ? error.name : 'unknown' })
    return { status: 'error', message: SAVE_FAILED }
  }
}
