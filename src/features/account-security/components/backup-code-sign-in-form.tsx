'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { signInWithBackupCodeAction } from '../actions'
import type { BackupSignInState } from '../backup-code-flows'

/** Round H (H3): "Use a backup code" on the 2FA sign-in step. */
export function BackupCodeSignInForm() {
  const [state, action, pending] = useActionState<BackupSignInState, FormData>(signInWithBackupCodeAction, {})
  return (
    <form action={action} className="mt-7 grid gap-5 max-md:mt-5 max-md:gap-4" noValidate>
      <Field
        id="backup-code"
        name="code"
        label="Backup code"
        autoComplete="one-time-code"
        autoCapitalize="characters"
        spellCheck={false}
        maxLength={12}
        placeholder="ABCDE-23456"
        required
        className="tracking-[0.15em]"
        error={state.error}
        hint="Each code works once. Using one turns two-step verification off until you set it up again."
      />
      <Button type="submit" disabled={pending}>{pending ? 'Checking…' : 'Use backup code'}</Button>
    </form>
  )
}
