'use client'

import Link from 'next/link'
import { useActionState, useEffect, useId, useRef, useState } from 'react'
import { CheckCircle2, Mail } from 'lucide-react'
import { focusFirstFormError } from '@/components/ui/form-error-summary'
import { subscribeToNewsletter, type NewsletterFormState } from '../actions'
import { NEWSLETTER_CONSENT_TEXT, NEWSLETTER_TOPICS } from '../topics'

const DEFAULT_TOPICS = ['product_updates']

function successTitle(outcome: string | undefined) {
  if (outcome === 'confirmation_required' || outcome === 'already_pending') return 'Check your inbox'
  if (outcome === 'already_subscribed') return 'Already subscribed'
  if (outcome === 'topics_updated') return 'Topics updated'
  return "You're subscribed"
}

export function NewsletterSignupForm({
  defaultEmail = null,
  source = 'newsletter_page',
  variant = 'full',
}: {
  /** The signed-in member's verified email. Prefills the field only; nothing is submitted automatically. */
  defaultEmail?: string | null
  source?: 'newsletter_page' | 'public_footer'
  variant?: 'full' | 'compact'
}) {
  const [state, formAction, pending] = useActionState<NewsletterFormState, FormData>(subscribeToNewsletter, { status: 'idle' })
  const [dismissedSuccess, setDismissedSuccess] = useState(false)
  const [lastState, setLastState] = useState(state)
  const formRef = useRef<HTMLFormElement | null>(null)
  const id = useId()
  const compact = variant === 'compact'

  if (lastState !== state) {
    setLastState(state)
    setDismissedSuccess(false)
  }

  useEffect(() => {
    if (state.status === 'error' && state.fieldErrors) focusFirstFormError(formRef.current)
  }, [state])

  const values = state.values
  const email = values?.email ?? defaultEmail ?? ''
  const topics = values?.topics ?? DEFAULT_TOPICS
  const errors = state.fieldErrors ?? {}
  const describedBy = (field: 'email' | 'topics' | 'consent') => (errors[field] ? `${id}-${field}-error` : undefined)

  if (state.status === 'success' && !dismissedSuccess) {
    return (
      <div role="status" className={`rounded-2xl border border-teal-500/30 bg-white ${compact ? 'p-4' : 'p-5 sm:p-6'}`}>
        <div className="flex items-start gap-3">
          <CheckCircle2 aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-teal-500" />
          <div className="min-w-0">
            <p className="font-semibold text-navy-950">
              {successTitle(state.outcome)}
            </p>
            <p className="mt-1 text-sm leading-6 text-muted">{state.message}</p>
            <button
              type="button"
              onClick={() => setDismissedSuccess(true)}
              className="mt-3 text-sm font-semibold text-ocean-700 hover:text-navy-950"
            >
              Use a different email address
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <form
      ref={formRef}
      action={formAction}
      noValidate
      aria-labelledby={`${id}-title`}
      className={compact ? 'grid gap-3' : 'grid gap-5'}
    >
      <div>
        <p id={`${id}-title`} className={`flex items-center gap-2 font-semibold text-navy-950 ${compact ? 'text-sm' : 'text-lg'}`}>
          <Mail aria-hidden="true" className="size-4 text-ocean-700" />
          Get the Sea N Shore newsletter
        </p>
        {!compact ? (
          <p className="mt-1 text-sm leading-6 text-muted">Maritime news, opportunities and learning, only for the topics you choose.</p>
        ) : null}
      </div>

      <input type="hidden" name="source" value={source} />
      <div aria-hidden="true" className="absolute -left-[10000px] top-auto size-px overflow-hidden">
        <label htmlFor={`${id}-website`}>Leave this field empty</label>
        <input id={`${id}-website`} name="company_website" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
      </div>

      <div className="grid gap-1.5">
        <label htmlFor={`${id}-email`} className="text-sm font-medium text-navy-900">Email address</label>
        <input
          id={`${id}-email`}
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          maxLength={254}
          defaultValue={email}
          aria-invalid={Boolean(errors.email)}
          aria-describedby={describedBy('email') ?? (defaultEmail && !values ? `${id}-email-hint` : undefined)}
          placeholder="name@example.com"
          className="min-h-11 w-full min-w-0 rounded-xl border border-mist-200 bg-white px-3.5 text-base text-ink placeholder:text-muted focus:border-ocean-600 focus:outline-none focus:ring-2 focus:ring-ocean-200 aria-[invalid=true]:border-red-500 sm:text-sm"
        />
        {errors.email ? (
          <p id={`${id}-email-error`} className="text-sm text-red-700">{errors.email}</p>
        ) : defaultEmail && !values ? (
          <p id={`${id}-email-hint`} className="text-xs text-muted">This is your account email. You can change it.</p>
        ) : null}
      </div>

      <fieldset className="grid gap-2" aria-describedby={describedBy('topics')}>
        <legend className="mb-1 text-sm font-medium text-navy-900">Topics</legend>
        {NEWSLETTER_TOPICS.map((topic) => (
          <label key={topic.id} className="flex items-start gap-2.5 text-sm text-navy-950">
            <input
              type="checkbox"
              name="topics"
              value={topic.id}
              defaultChecked={topics.includes(topic.id)}
              aria-invalid={Boolean(errors.topics)}
              className="mt-0.5 size-4 shrink-0 accent-ocean-700"
            />
            <span className="min-w-0">
              <span className="font-semibold">{topic.label}</span>
              {!compact ? <span className="block text-xs leading-5 text-muted">{topic.description}</span> : null}
            </span>
          </label>
        ))}
        {errors.topics ? <p id={`${id}-topics-error`} className="text-sm text-red-700">{errors.topics}</p> : null}
      </fieldset>

      <div className="grid gap-1.5">
        <label className="flex items-start gap-2.5 text-sm leading-6 text-navy-950">
          <input
            type="checkbox"
            name="consent"
            value="yes"
            defaultChecked={state.status === 'error' && Boolean(values?.consent)}
            aria-invalid={Boolean(errors.consent)}
            aria-describedby={describedBy('consent')}
            className="mt-1 size-4 shrink-0 accent-ocean-700 aria-[invalid=true]:outline aria-[invalid=true]:outline-2 aria-[invalid=true]:outline-offset-2 aria-[invalid=true]:outline-red-600"
          />
          <span>
            {NEWSLETTER_CONSENT_TEXT}{' '}
            See our <Link href="/privacy" className="font-semibold text-ocean-700 underline-offset-2 hover:underline">Privacy Policy</Link>.
          </span>
        </label>
        {errors.consent ? <p id={`${id}-consent-error`} className="text-sm text-red-700">{errors.consent}</p> : null}
      </div>

      {state.status === 'error' && state.message ? (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-800">{state.message}</p>
      ) : null}

      <div>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex min-h-11 items-center justify-center rounded-xl bg-ocean-700 px-5 text-sm font-semibold text-white transition hover:bg-navy-900 disabled:cursor-wait disabled:opacity-70"
        >
          {pending ? 'Subscribing…' : 'Subscribe'}
        </button>
      </div>
    </form>
  )
}
