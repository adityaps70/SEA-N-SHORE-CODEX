'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { CheckCircle2, TriangleAlert } from 'lucide-react'
import { confirmNewsletterSubscription, unsubscribeWithNewsletterToken, type NewsletterFormState } from '../actions'

const COPY = {
  confirm: { button: 'Confirm subscription', pending: 'Confirming…' },
  unsubscribe: { button: 'Unsubscribe', pending: 'Unsubscribing…' },
} as const

/** One-button confirmation for signed newsletter links (no login needed). */
export function NewsletterTokenAction({ token, kind }: { token: string; kind: 'confirm' | 'unsubscribe' }) {
  const action = kind === 'confirm' ? confirmNewsletterSubscription : unsubscribeWithNewsletterToken
  const [state, formAction, pending] = useActionState<NewsletterFormState, FormData>(action, { status: 'idle' })

  if (state.status === 'success') {
    return (
      <div role="status" className="rounded-2xl border border-teal-500/30 bg-mist-50 p-4">
        <p className="flex items-start gap-2 text-sm leading-6 text-navy-950">
          <CheckCircle2 aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-teal-500" />
          <span>{state.message}</span>
        </p>
        <p className="mt-3 text-sm">
          <Link href="/newsletter" className="font-semibold text-ocean-700 hover:text-navy-950">
            {kind === 'unsubscribe' ? 'Changed your mind? Subscribe again' : 'Manage newsletter topics'}
          </Link>
        </p>
      </div>
    )
  }

  return (
    <form action={formAction} className="grid gap-3">
      <input type="hidden" name="token" value={token} />
      {state.status === 'error' && state.message ? (
        <p role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-800">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>{state.message}</span>
        </p>
      ) : null}
      <div>
        <button
          type="submit"
          disabled={pending}
          className={`inline-flex min-h-11 items-center justify-center rounded-xl px-5 text-sm font-semibold text-white transition disabled:cursor-wait disabled:opacity-70 ${kind === 'unsubscribe' ? 'bg-navy-950 hover:bg-navy-800' : 'bg-ocean-700 hover:bg-navy-900'}`}
        >
          {pending ? COPY[kind].pending : COPY[kind].button}
        </button>
      </div>
    </form>
  )
}
