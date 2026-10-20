'use client'

import { useActionState, useId, useState } from 'react'
import { primaryButtonClass } from '@/components/ui/interactive-styles'
import { PasswordField } from '@/features/auth/components/password-field'
import { adminStepUpAction, type AdminStepUpState } from '../admin-step-up-actions'

const inputClass = 'mt-1.5 min-h-11 w-full rounded-xl border border-mist-200 bg-white px-3 text-base font-medium text-ink outline-none focus:border-ocean-500 aria-[invalid=true]:border-red-500'

/**
 * Hotfix P1: a platform administrator signed in with Google confirms it is them to open admin pages: their
 * password, then the authenticator app code (or one backup code). Lasts for this sign-in.
 */
export function AdminStepUpForm({ returnTo }: { returnTo: string | null }) {
  const [state, action, pending] = useActionState<AdminStepUpState, FormData>(adminStepUpAction, {})
  const [method, setMethod] = useState<'authenticator' | 'backup_code'>('authenticator')
  const id = useId()
  const codeError = state.field === 'code' ? state.error : undefined
  const passwordError = state.field === 'password' ? state.error : undefined

  return (
    <form action={action} aria-labelledby={`${id}-title`} className="grid gap-4 rounded-xl border border-mist-100 bg-white p-4 sm:p-5">
      <div>
        <h2 id={`${id}-title`} className="text-base font-semibold text-navy-950">Confirm it’s you to open admin pages</h2>
        <p className="mt-1 text-sm leading-6 text-muted">
          Google sign-in doesn’t ask for your authenticator code, so confirm once with your Sea N Shore password and your
          authenticator app. Admin pages then stay open until you sign out.
        </p>
      </div>
      <input type="hidden" name="method" value={method} />
      {returnTo ? <input type="hidden" name="next" value={returnTo} /> : null}
      <PasswordField label="Password" name="password" id={`${id}-password`} autoComplete="current-password" required error={passwordError} />
      <fieldset className="grid gap-2">
        <legend className="text-sm font-medium text-navy-900">Second step</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-navy-900">
          <label className="inline-flex min-h-11 cursor-pointer items-center gap-2">
            <input type="radio" name={`${id}-method`} checked={method === 'authenticator'} onChange={() => setMethod('authenticator')} className="size-4 accent-ocean-700" />
            Authenticator app code
          </label>
          <label className="inline-flex min-h-11 cursor-pointer items-center gap-2">
            <input type="radio" name={`${id}-method`} checked={method === 'backup_code'} onChange={() => setMethod('backup_code')} className="size-4 accent-ocean-700" />
            Backup code
          </label>
        </div>
      </fieldset>
      <div className="text-sm font-medium text-navy-900">
        <label htmlFor={`${id}-code`}>{method === 'authenticator' ? '6-digit code' : 'Backup code'}</label>
        <input
          key={method}
          id={`${id}-code`}
          name="code"
          required
          autoComplete={method === 'authenticator' ? 'one-time-code' : 'off'}
          inputMode={method === 'authenticator' ? 'numeric' : 'text'}
          maxLength={method === 'authenticator' ? 6 : 12}
          autoCapitalize={method === 'authenticator' ? undefined : 'characters'}
          aria-invalid={Boolean(codeError)}
          aria-describedby={codeError ? `${id}-code-error` : undefined}
          className={`${inputClass} max-w-56 tracking-[0.2em]`}
        />
        {codeError ? <p id={`${id}-code-error`} className="mt-1.5 text-sm font-medium text-red-700">{codeError}</p> : null}
      </div>
      {state.error && !state.field ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm font-medium text-red-800">{state.error}</p> : null}
      {state.error && state.field ? <p role="alert" className="sr-only">{state.error}</p> : null}
      <div>
        <button type="submit" disabled={pending} aria-busy={pending || undefined} className={primaryButtonClass}>
          {pending ? 'Checking…' : 'Confirm and continue'}
        </button>
      </div>
    </form>
  )
}
