'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { resetMemberTwoStepAction, type MfaResetActionState } from '../mfa-reset-actions'

const idle: MfaResetActionState = { status: 'idle', revision: 0 }
const fieldClass = 'mt-1 w-full rounded-lg border border-mist-200 bg-white px-3 py-2 text-sm text-navy-950 outline-none focus:border-ocean-400 focus:ring-2 focus:ring-ocean-100'

/**
 * Admin two-step (owner, 21 Nov): reset a locked-out member's two-step verification. It turns their authenticator
 * app off, deletes unused backup codes, signs them out everywhere and emails them; an admin or country admin must
 * set up a new app before any admin page opens. Check the person's identity another way first.
 */
export function MfaResetPanel({ profileId, username }: { profileId: string; username: string | null }) {
  const [state, formAction, pending] = useActionState(resetMemberTwoStepAction, idle)
  return (
    <section aria-labelledby="mfa-reset-heading" className="rounded-xl border border-mist-100 bg-white p-4">
      <h3 id="mfa-reset-heading" className="text-base font-semibold text-navy-950">Reset two-step verification</h3>
      <p className="mt-1 text-sm text-muted">
        For a member who lost their phone and has no backup codes. Confirm who they are another way first (for example a call to a number you already know). This turns their authenticator app off, deletes their unused backup codes, signs them out on every device and emails them. Admins and country admins must set up a new app before they can open admin pages again.
      </p>
      {username ? (
        <form
          action={formAction}
          onSubmit={(event) => {
            if (!window.confirm('Reset this member’s two-step verification and sign them out everywhere?')) event.preventDefault()
          }}
          className="mt-3 grid gap-3"
        >
          <input type="hidden" name="profileId" value={profileId} />
          <label className="text-sm font-medium text-navy-900">
            Reason (for the audit log)
            <textarea name="reason" required minLength={10} maxLength={1000} rows={2} className={fieldClass} />
          </label>
          <label className="text-sm font-medium text-navy-900">
            Type <span className="font-mono">@{username}</span> to confirm
            <input name="confirmUsername" required autoComplete="off" className={`${fieldClass} min-h-10`} />
          </label>
          <div>
            <Button type="submit" size="sm" disabled={pending} className="bg-red-700 hover:bg-red-800 disabled:bg-red-700">
              {pending ? 'Resetting…' : 'Reset two-step verification'}
            </Button>
          </div>
          <p role="status" aria-live="polite" className={`text-sm ${state.status === 'error' ? 'text-red-700' : 'text-emerald-800'}`}>
            {state.status === 'idle' ? '' : state.message}
          </p>
        </form>
      ) : (
        <p className="mt-3 text-sm text-muted">This member has no public username, so the reset cannot be confirmed here.</p>
      )}
    </section>
  )
}
