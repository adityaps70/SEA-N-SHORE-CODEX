'use client'

import { useActionState, useState } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { updateMyNewsletterPreferences, type NewsletterFormState } from '../actions'
import { NEWSLETTER_TOPICS, type NewsletterTopic } from '../topics'

/** Lets a signed-in member change topics or unsubscribe for their own verified email. */
export function NewsletterPreferencesForm({ email, topics }: { email: string; topics: NewsletterTopic[] }) {
  const [state, formAction, pending] = useActionState<NewsletterFormState, FormData>(updateMyNewsletterPreferences, { status: 'idle' })
  const [confirmingUnsubscribe, setConfirmingUnsubscribe] = useState(false)
  const selected = state.values?.topics ?? topics

  if (state.status === 'success' && state.outcome === 'unsubscribed') {
    return (
      <p role="status" className="flex items-start gap-2 rounded-2xl border border-teal-500/30 bg-mist-50 p-4 text-sm leading-6 text-navy-950">
        <CheckCircle2 aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-teal-500" />
        <span>{state.message} Reload this page if you want to subscribe again.</span>
      </p>
    )
  }

  return (
    <form action={formAction} className="grid gap-4">
      <p className="text-sm leading-6 text-muted">
        Subscribed as <span className="font-semibold text-navy-950">{email}</span>.
      </p>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium text-navy-900">Topics you receive</legend>
        {NEWSLETTER_TOPICS.map((topic) => (
          <label key={topic.id} className="flex items-start gap-2.5 text-sm text-navy-950">
            <input type="checkbox" name="topics" value={topic.id} defaultChecked={selected.includes(topic.id)} className="mt-0.5 size-4 shrink-0 accent-ocean-700" />
            <span>
              <span className="font-semibold">{topic.label}</span>
              <span className="block text-xs leading-5 text-muted">{topic.description}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {state.message ? (
        <p role={state.status === 'error' ? 'alert' : 'status'} className={`rounded-xl px-3.5 py-2.5 text-sm ${state.status === 'error' ? 'border border-red-200 bg-red-50 text-red-800' : 'border border-teal-500/30 bg-mist-50 text-navy-950'}`}>
          {state.message}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          name="intent"
          value="save"
          disabled={pending}
          className="inline-flex min-h-11 items-center justify-center rounded-xl bg-ocean-700 px-5 text-sm font-semibold text-white hover:bg-navy-900 disabled:cursor-wait disabled:opacity-70"
        >
          {pending ? 'Saving…' : 'Save topics'}
        </button>
        {confirmingUnsubscribe ? (
          <span className="flex flex-wrap items-center gap-2 rounded-xl border border-mist-200 bg-white px-3 py-1.5 text-sm">
            <span className="text-navy-950">Stop all newsletters?</span>
            <button type="submit" name="intent" value="unsubscribe" disabled={pending} className="min-h-9 rounded-lg bg-navy-950 px-3 font-semibold text-white hover:bg-navy-800 disabled:opacity-70">
              Yes, unsubscribe
            </button>
            <button type="button" onClick={() => setConfirmingUnsubscribe(false)} className="min-h-9 rounded-lg px-3 font-semibold text-navy-900 hover:bg-mist-50">
              Keep subscription
            </button>
          </span>
        ) : (
          <button type="button" onClick={() => setConfirmingUnsubscribe(true)} className="inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-semibold text-navy-900 hover:bg-mist-50">
            Unsubscribe
          </button>
        )}
      </div>
    </form>
  )
}
