'use client'

import Link from '@/components/navigation/intent-link'
import { useActionState, useEffect, useId, useRef, useState } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { FormErrorSummary, focusFirstFormError } from '@/components/ui/form-error-summary'
import { submitContactForm, type ContactFormField, type ContactFormState } from '../actions'
import { SUPPORT_MESSAGE_MAX, SUPPORT_NAME_MAX, SUPPORT_TOPICS } from '../topics'
import { supportInputClass as inputClass, supportPrimaryButtonClass } from './form-styles'

const FIELD_LABELS: Record<ContactFormField, string> = { name: 'Your name', email: 'Email address', topic: 'Topic', message: 'Message' }

/**
 * Round H (H7): the Contact page form. Every field has a label; an error is linked to its field with
 * aria-describedby and listed in the summary, which takes focus. Signed-in members get their name and
 * account email filled in (both can be changed) and can follow the request under Help › My requests.
 * The hidden "website" field is a honeypot for automated form fillers.
 */
export function ContactForm({
  defaultName = '',
  defaultEmail = '',
  signedIn = false,
  initialTopic = '',
}: {
  defaultName?: string
  defaultEmail?: string
  signedIn?: boolean
  initialTopic?: string
}) {
  const [state, formAction, pending] = useActionState<ContactFormState, FormData>(submitContactForm, { status: 'idle' })
  const [another, setAnother] = useState(false)
  const [lastState, setLastState] = useState(state)
  const formRef = useRef<HTMLFormElement | null>(null)
  const id = useId()

  const initialTopicValue = SUPPORT_TOPICS.some((topic) => topic.id === initialTopic) ? initialTopic : ''
  // Controlled, so the choice survives React's form reset after the action returns.
  const [topic, setTopic] = useState(initialTopicValue)

  if (lastState !== state) {
    setLastState(state)
    setAnother(false)
    if (state.values?.topic !== undefined) setTopic(state.values.topic)
  }

  useEffect(() => {
    if (state.status === 'error') focusFirstFormError(formRef.current)
  }, [state])

  const errors = state.fieldErrors ?? {}
  const values = state.values ?? {}
  const describedBy = (field: ContactFormField, hint?: string) => [errors[field] ? `${id}-${field}-error` : null, hint ?? null].filter(Boolean).join(' ') || undefined

  if (state.status === 'success' && !another) {
    return (
      <div role="status" className="rounded-2xl border border-teal-500/30 bg-white p-5">
        <div className="flex items-start gap-3">
          <CheckCircle2 aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-teal-500" />
          <div className="min-w-0">
            <p className="font-semibold text-navy-950">Message sent</p>
            <p className="mt-1 text-sm leading-6 text-muted max-md:text-base">{state.message}</p>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
              {state.ticketId ? (
                <Link href={`/help/requests/${state.ticketId}`} className="inline-flex min-h-11 items-center text-sm font-semibold text-ocean-700 hover:text-navy-950 hover:underline">
                  Open my request
                </Link>
              ) : null}
              <button type="button" onClick={() => setAnother(true)} className="inline-flex min-h-11 cursor-pointer items-center text-sm font-semibold text-ocean-700 hover:text-navy-950 hover:underline">
                Send another message
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const summaryErrors = Object.fromEntries(Object.entries(errors).map(([field, message]) => [field, message ? [message] : []]))

  return (
    <form ref={formRef} action={formAction} noValidate aria-labelledby={`${id}-title`} className="grid gap-4">
      <div>
        <h2 id={`${id}-title`} className="text-lg font-bold text-navy-950">Send us a message</h2>
        <p className="mt-1 text-sm leading-6 text-muted max-md:text-base">
          {signedIn
            ? 'We reply by email, and you can follow your request under Help › My requests.'
            : 'We reply by email to the address you give.'}{' '}
          All fields are required.
        </p>
      </div>

      {state.status === 'error' ? <FormErrorSummary error={state.fieldErrors && Object.keys(state.fieldErrors).length ? null : state.message} fieldErrors={summaryErrors} fieldLabels={FIELD_LABELS} /> : null}

      <div aria-hidden="true" className="absolute -left-[10000px] top-auto size-px overflow-hidden">
        <label htmlFor={`${id}-website`}>Leave this field empty</label>
        <input id={`${id}-website`} name="website" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <label htmlFor={`${id}-name`} className="text-sm font-medium text-navy-900">{FIELD_LABELS.name}</label>
          <input
            id={`${id}-name`}
            name="name"
            type="text"
            autoComplete="name"
            required
            maxLength={SUPPORT_NAME_MAX}
            defaultValue={values.name ?? defaultName}
            aria-invalid={Boolean(errors.name)}
            aria-describedby={describedBy('name')}
            className={inputClass}
          />
          {errors.name ? <p id={`${id}-name-error`} className="text-sm text-red-700">{errors.name}</p> : null}
        </div>
        <div className="grid gap-1.5">
          <label htmlFor={`${id}-email`} className="text-sm font-medium text-navy-900">{FIELD_LABELS.email}</label>
          <input
            id={`${id}-email`}
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            maxLength={254}
            defaultValue={values.email ?? defaultEmail}
            aria-invalid={Boolean(errors.email)}
            aria-describedby={describedBy('email', signedIn && defaultEmail ? `${id}-email-hint` : undefined)}
            className={inputClass}
          />
          {errors.email ? <p id={`${id}-email-error`} className="text-sm text-red-700">{errors.email}</p> : null}
          {signedIn && defaultEmail ? <p id={`${id}-email-hint`} className="text-xs text-muted">Your account email. You can change it.</p> : null}
        </div>
      </div>

      <div className="grid gap-1.5">
        <label htmlFor={`${id}-topic`} className="text-sm font-medium text-navy-900">{FIELD_LABELS.topic}</label>
        <select
          id={`${id}-topic`}
          name="topic"
          required
          value={topic}
          onChange={(event) => setTopic(event.target.value)}
          aria-invalid={Boolean(errors.topic)}
          aria-describedby={describedBy('topic')}
          className={inputClass}
        >
          <option value="" disabled>Choose what your message is about</option>
          {SUPPORT_TOPICS.map((topic) => <option key={topic.id} value={topic.id}>{topic.label}</option>)}
        </select>
        {errors.topic ? <p id={`${id}-topic-error`} className="text-sm text-red-700">{errors.topic}</p> : null}
      </div>

      <div className="grid gap-1.5">
        <label htmlFor={`${id}-message`} className="text-sm font-medium text-navy-900">{FIELD_LABELS.message}</label>
        <textarea
          id={`${id}-message`}
          name="message"
          required
          rows={6}
          maxLength={SUPPORT_MESSAGE_MAX}
          defaultValue={values.message ?? ''}
          aria-invalid={Boolean(errors.message)}
          aria-describedby={describedBy('message', `${id}-message-hint`)}
          className={`${inputClass} min-h-36 py-2.5 leading-6`}
        />
        {errors.message ? <p id={`${id}-message-error`} className="text-sm text-red-700">{errors.message}</p> : null}
        <p id={`${id}-message-hint`} className="text-xs text-muted">Include the page, what you were trying to do and any message you saw. For a payment, add the order ID. Never send your password or a verification code.</p>
      </div>

      <div>
        <button
          type="submit"
          disabled={pending}
          className={`${supportPrimaryButtonClass} max-md:w-full`}
        >
          {pending ? 'Sending…' : 'Send message'}
        </button>
      </div>
    </form>
  )
}
