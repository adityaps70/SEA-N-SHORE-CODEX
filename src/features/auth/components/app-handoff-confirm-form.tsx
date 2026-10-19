'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { confirmAppHandoff, type AppHandoffConfirmState } from '../app-handoff-actions'

const INITIAL: AppHandoffConfirmState = { status: 'idle' }

/** Round I (I3): the code the Home Screen app shows, typed in the Safari window Google came back to. */
export function AppHandoffConfirmForm() {
  const [state, action, pending] = useActionState(confirmAppHandoff, INITIAL)

  if (state.status === 'ready') {
    return (
      <div role="status" className="mt-4 grid gap-3 leading-7 text-navy-950">
        <p className="font-semibold">Done. Go back to the Sea N Shore app on your Home Screen.</p>
        <p className="text-muted">It finishes signing you in by itself. You can close this Safari window.</p>
      </div>
    )
  }
  if (state.status === 'closed') {
    return <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{state.error}</p>
  }

  return (
    <form action={action} className="mt-4 grid gap-4" noValidate>
      <p className="leading-7 text-muted">
        You signed in with Google here, in Safari. To bring the sign-in to the app, enter the 6-digit code the
        Sea N Shore app is showing now.
      </p>
      <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-navy-950">
        Only enter a code from your own app, started on this phone in the last 10 minutes. Sea N Shore will never ask
        you for it by message, email or phone.
      </p>
      <div className="grid gap-2">
        <label htmlFor="app-handoff-code" className="text-sm font-semibold text-navy-950">Code from the app</label>
        <input
          id="app-handoff-code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]*"
          maxLength={7}
          required
          aria-invalid={state.status === 'error' ? true : undefined}
          aria-describedby={state.status === 'error' ? 'app-handoff-code-error' : undefined}
          className="min-h-12 rounded-xl border border-mist-300 px-4 text-lg tracking-[0.3em] text-navy-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-500"
        />
        {state.status === 'error' ? (
          <p id="app-handoff-code-error" role="alert" className="text-sm text-red-700">{state.error}</p>
        ) : null}
      </div>
      <Button type="submit" disabled={pending}>{pending ? 'Checking…' : 'Sign in on the app'}</Button>
    </form>
  )
}
