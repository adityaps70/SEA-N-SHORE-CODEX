'use client'

import { useActionState, useState } from 'react'
import { Field } from '@/components/ui/field'
import { primaryButtonClass, secondaryButtonClass } from '@/components/ui/interactive-styles'
import { confirmEmailChangeAction, requestEmailChangeAction } from '../actions'
import type { EmailChangeState } from '../email-change'
import { alertClass, statusClass } from './styles'

/**
 * Round H (H3): Settings › Account › Email. The new address gets a code; the current one stays active until the
 * code is entered. The old address is told once the change is made.
 */
export function ChangeEmailForm({ currentEmail, unavailableReason }: { currentEmail: string | null; unavailableReason: string | null }) {
  const [pendingEmail, setPendingEmail] = useState<string | null>(null)
  const [changedEmail, setChangedEmail] = useState<string | null>(null)

  const [requestState, requestAction, requesting] = useActionState<EmailChangeState, FormData>(async (previous, formData) => {
    const result = await requestEmailChangeAction(previous, formData)
    if (result.status === 'code-sent') setPendingEmail(result.pendingEmail)
    return result
  }, { status: 'idle' })

  const [confirmState, confirmAction, confirming] = useActionState<EmailChangeState, FormData>(async (previous, formData) => {
    const result = await confirmEmailChangeAction(previous, formData)
    if (result.status === 'changed') {
      setPendingEmail(null)
      setChangedEmail(result.email)
    }
    return result
  }, { status: 'idle' })

  const shownEmail = changedEmail ?? currentEmail

  if (unavailableReason) {
    return (
      <div className="mt-4 grid gap-2 text-sm leading-6">
        {shownEmail ? <p className="text-navy-950">Current email: <span className="font-semibold break-all">{shownEmail}</span></p> : null}
        <p className="rounded-xl bg-mist-50 px-3 py-2 text-muted">{unavailableReason}</p>
      </div>
    )
  }

  const requestError = requestState.status === 'error' ? requestState : null
  const confirmError = confirmState.status === 'error' ? confirmState : null

  return (
    <div className="mt-4 grid max-w-md gap-4">
      {shownEmail ? (
        <p className="text-sm leading-6 text-navy-950">Current email: <span className="font-semibold break-all">{shownEmail}</span></p>
      ) : null}
      {confirmState.status === 'changed' && !pendingEmail ? <p role="status" className={statusClass}>{confirmState.message}</p> : null}

      {pendingEmail ? (
        <>
          <p role="status" className={statusClass}>
            We sent a 6-digit code to <span className="break-all">{pendingEmail}</span>. Your current address stays active until you enter it.
          </p>
          {confirmError && !confirmError.field ? <p role="alert" className={alertClass}>{confirmError.error}</p> : null}
          {requestError ? <p role="alert" className={alertClass}>{requestError.error}</p> : null}
          <form action={confirmAction} className="grid gap-4" noValidate>
            <input type="hidden" name="pendingEmail" value={pendingEmail} />
            <Field
              id="email-change-code"
              name="code"
              label="Code from the email"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              pattern="[0-9]{6}"
              required
              className="max-w-48 tracking-[0.2em]"
              error={confirmError?.field === 'code' ? confirmError.error : undefined}
            />
            <div className="flex flex-wrap gap-2">
              <button type="submit" disabled={confirming} className={primaryButtonClass}>
                {confirming ? 'Checking…' : 'Confirm new email'}
              </button>
              <button type="button" disabled={confirming} onClick={() => setPendingEmail(null)} className={secondaryButtonClass}>
                Use a different address
              </button>
            </div>
          </form>
          <form action={requestAction}>
            <input type="hidden" name="email" value={pendingEmail} />
            <button type="submit" disabled={requesting} className="inline-flex min-h-10 cursor-pointer items-center text-sm font-semibold text-ocean-700 underline-offset-2 hover:text-navy-950 hover:underline disabled:cursor-not-allowed disabled:opacity-60">
              {requesting ? 'Sending…' : 'Send a new code'}
            </button>
          </form>
        </>
      ) : (
        <form action={requestAction} className="grid gap-4" noValidate>
          {requestError && !requestError.field ? <p role="alert" className={alertClass}>{requestError.error}</p> : null}
          <Field
            id="new-email"
            name="email"
            type="email"
            label="New email address"
            autoComplete="email"
            maxLength={254}
            required
            error={requestError?.field === 'email' ? requestError.error : undefined}
            hint="We’ll send a code to this address. Nothing changes until you enter it."
          />
          <div>
            <button type="submit" disabled={requesting} className={primaryButtonClass}>
              {requesting ? 'Sending code…' : 'Send code'}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
