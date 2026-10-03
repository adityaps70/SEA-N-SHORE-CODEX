'use client'

import { useActionState, useState } from 'react'
import { adminUnsubscribeSubscriber, queueNewsletterCampaign, type AdminNewsletterState } from '../admin-actions'
import { NEWSLETTER_TOPICS } from '../topics'

function StateMessage({ state }: { state: AdminNewsletterState }) {
  if (!state.message) return null
  return (
    <p
      role={state.status === 'error' ? 'alert' : 'status'}
      className={`rounded-lg px-3 py-2 text-sm ${state.status === 'error' ? 'border border-red-200 bg-red-50 text-red-800' : 'border border-emerald-200 bg-emerald-50 text-emerald-900'}`}
    >
      {state.message}
    </p>
  )
}

/** Manual unsubscribe with an inline confirmation step (no browser dialogs). */
export function AdminUnsubscribeButton({ subscriberId, email }: { subscriberId: string; email: string }) {
  const [state, formAction, pending] = useActionState<AdminNewsletterState, FormData>(adminUnsubscribeSubscriber, { status: 'idle' })
  const [confirming, setConfirming] = useState(false)

  if (state.status === 'success') return <StateMessage state={state} />

  return (
    <form action={formAction} className="grid gap-2">
      <input type="hidden" name="subscriberId" value={subscriberId} />
      <StateMessage state={state} />
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-mist-200 bg-mist-50 px-3 py-2 text-sm">
          <span className="text-navy-950">Unsubscribe {email} from every topic?</span>
          <button type="submit" disabled={pending} className="min-h-8 rounded-lg bg-navy-950 px-3 text-xs font-semibold text-white hover:bg-navy-800 disabled:opacity-70">
            {pending ? 'Unsubscribing…' : 'Yes, unsubscribe'}
          </button>
          <button type="button" onClick={() => setConfirming(false)} className="min-h-8 rounded-lg px-3 text-xs font-semibold text-navy-900 border border-mist-200 bg-white transition-colors hover:border-ocean-300 hover:bg-mist-50">
            Cancel
          </button>
        </div>
      ) : (
        <div>
          <button type="button" onClick={() => setConfirming(true)} className="inline-flex min-h-8 items-center rounded-lg border border-mist-200 px-3 text-xs font-semibold text-navy-950 hover:bg-mist-50">
            Unsubscribe manually
          </button>
        </div>
      )}
    </form>
  )
}

/** Campaign composer. Stays disabled, with the reason shown, until SES sending is enabled. */
export function AdminCampaignComposer({ disabledReason }: { disabledReason: string | null }) {
  const [state, formAction, pending] = useActionState<AdminNewsletterState, FormData>(queueNewsletterCampaign, { status: 'idle' })
  const disabled = Boolean(disabledReason) || pending
  const errors = state.fieldErrors ?? {}

  return (
    <form action={formAction} className="grid gap-3" aria-describedby={disabledReason ? 'campaign-disabled-reason' : undefined}>
      {disabledReason ? (
        <p id="campaign-disabled-reason" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {disabledReason}
        </p>
      ) : null}
      <fieldset disabled={disabled} className="grid gap-3 disabled:opacity-60">
        <label className="grid gap-1 text-sm font-medium text-navy-900">
          Topic
          <select name="topic" defaultValue="product_updates" aria-invalid={Boolean(errors.topic)} className="min-h-10 rounded-lg border border-mist-200 bg-white px-3 text-sm">
            {NEWSLETTER_TOPICS.map((topic) => <option key={topic.id} value={topic.id}>{topic.label}</option>)}
          </select>
          {errors.topic ? <span className="text-sm text-red-700">{errors.topic}</span> : null}
        </label>
        <label className="grid gap-1 text-sm font-medium text-navy-900">
          Subject
          <input name="subject" maxLength={150} aria-invalid={Boolean(errors.subject)} className="min-h-10 rounded-lg border border-mist-200 bg-white px-3 text-sm" />
          {errors.subject ? <span className="text-sm text-red-700">{errors.subject}</span> : null}
        </label>
        <label className="grid gap-1 text-sm font-medium text-navy-900">
          Email text
          <textarea name="bodyText" rows={8} maxLength={20000} aria-invalid={Boolean(errors.bodyText)} className="rounded-lg border border-mist-200 bg-white px-3 py-2 text-sm" />
          <span className="text-xs font-normal text-muted">Plain text. Leave a blank line between paragraphs. The unsubscribe link and the reason the person receives this email are added automatically.</span>
          {errors.bodyText ? <span className="text-sm text-red-700">{errors.bodyText}</span> : null}
        </label>
        <StateMessage state={state} />
        <div>
          <button type="submit" className="inline-flex min-h-10 items-center rounded-lg bg-navy-950 px-4 text-sm font-semibold text-white hover:bg-navy-800 disabled:cursor-not-allowed">
            {pending ? 'Queuing…' : 'Queue campaign'}
          </button>
        </div>
      </fieldset>
    </form>
  )
}
