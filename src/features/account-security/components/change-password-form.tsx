'use client'

import { useActionState, useState } from 'react'
import { primaryButtonClass } from '@/components/ui/interactive-styles'
import { PasswordField } from '@/features/auth/components/password-field'
import { PASSWORD_RULES } from '@/features/auth/password-rules'
import { changePasswordAction } from '../actions'
import type { PasswordChangeState } from '../password-change'
import { alertClass, statusClass } from './styles'

/** Round H (H3): Settings › Account › Password. Signs out the member's other devices on success. */
export function ChangePasswordForm({ email }: { email: string | null }) {
  const [state, action, pending] = useActionState<PasswordChangeState, FormData>(changePasswordAction, { status: 'idle' })
  const [newPassword, setNewPassword] = useState('')
  const fieldError = (field: 'currentPassword' | 'newPassword' | 'newPasswordConfirmation') =>
    state.status === 'error' && state.field === field ? state.error : undefined
  const generalError = state.status === 'error' && !state.field ? state.error : null
  // A fresh, empty form after a successful change.
  const formKey = state.status === 'changed' ? `changed-${state.message}` : 'form'

  return (
    <form key={formKey} action={action} className="mt-4 grid max-w-md gap-4" noValidate>
      {email ? <input type="email" name="username" autoComplete="username" value={email} readOnly hidden /> : null}
      {state.status === 'changed' ? <p role="status" className={statusClass}>{state.message}</p> : null}
      {generalError ? <p role="alert" className={alertClass}>{generalError}</p> : null}
      <PasswordField
        id="current-password"
        name="currentPassword"
        label="Current password"
        autoComplete="current-password"
        maxLength={72}
        required
        error={fieldError('currentPassword')}
      />
      <PasswordField
        id="new-password"
        name="newPassword"
        label="New password"
        autoComplete="new-password"
        maxLength={72}
        required
        error={fieldError('newPassword')}
        onChange={(event) => setNewPassword(event.target.value)}
        requirements={PASSWORD_RULES.map((rule) => ({ id: rule.id, label: rule.label, met: rule.test(newPassword) }))}
      />
      <PasswordField
        id="new-password-confirmation"
        name="newPasswordConfirmation"
        label="Confirm new password"
        autoComplete="new-password"
        maxLength={72}
        required
        error={fieldError('newPasswordConfirmation')}
      />
      <p className="text-sm leading-6 text-muted">Changing your password signs you out on your other devices. You stay signed in here.</p>
      <div>
        <button type="submit" disabled={pending} className={primaryButtonClass}>
          {pending ? 'Changing password…' : 'Change password'}
        </button>
      </div>
    </form>
  )
}
