'use client'

import Link from 'next/link'
import { useActionState, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Copy, Download } from 'lucide-react'
import { primaryButtonClass, secondaryButtonClass, textLinkClass } from '@/components/ui/interactive-styles'
import { PasswordField } from '@/features/auth/components/password-field'
import { generateBackupCodesAction } from '../actions'
import type { BackupCodesState } from '../backup-code-flows'
import { alertClass, buttonRowClass, confirmBoxClass, statusClass } from './styles'

export type BackupCodesSummary = {
  /** An email and password account with the authenticator app on. */
  available: boolean
  remaining: number
  createdLabel: string | null
}

/**
 * Round H (H3): Settings › Account › 2FA backup codes. Codes are shown once, right after they are made, with copy
 * and download; the server keeps only their hashes. Making new codes needs the current password and stops the old
 * ones working.
 */
export function BackupCodesPanel({ summary }: { summary: BackupCodesSummary }) {
  const router = useRouter()
  const [state, action, pending] = useActionState<BackupCodesState, FormData>(generateBackupCodesAction, { status: 'idle' })
  const [asking, setAsking] = useState(false)
  const [dismissed, setDismissed] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  if (!summary.available) {
    return (
      <p className="mt-4 rounded-xl bg-mist-50 px-3 py-2 text-sm leading-6 text-muted">
        Backup codes work with an authenticator app. <Link href="/settings/security" className={textLinkClass}>Set up two-step verification</Link> first.
      </p>
    )
  }

  const codes = state.status === 'ready' ? state.codes : null
  const codesKey = codes?.join(',') ?? null
  const showCodes = Boolean(codes && codesKey !== dismissed)

  async function copyCodes() {
    if (!codes) return
    try {
      await navigator.clipboard.writeText(codes.join('\n'))
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  function downloadCodes() {
    if (!codes) return
    const text = ['Sea N Shore two-step verification backup codes', 'Each code works once.', '', ...codes, ''].join('\n')
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'sea-n-shore-backup-codes.txt'
    link.click()
    URL.revokeObjectURL(url)
  }

  if (showCodes && codes) {
    return (
      <div className="mt-4 grid gap-4">
        <p role="status" className={statusClass}>
          {state.status === 'ready' && state.regenerated ? 'New backup codes are ready. Your old codes no longer work.' : 'Your backup codes are ready.'}
        </p>
        <p className="text-sm leading-6 text-navy-950">
          Save these codes somewhere safe now. This is the only time we show them. Each code works once, if you can’t use your authenticator app.
        </p>
        <ol aria-label="Backup codes" className="grid grid-cols-1 gap-2 rounded-xl border border-mist-200 bg-mist-50 p-4 font-mono text-base tracking-wider text-navy-950 sm:grid-cols-2">
          {codes.map((code) => <li key={code}>{code}</li>)}
        </ol>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={copyCodes} className={secondaryButtonClass}>
            <Copy aria-hidden="true" className="size-4" /> {copied ? 'Copied' : 'Copy codes'}
          </button>
          <button type="button" onClick={downloadCodes} className={secondaryButtonClass}>
            <Download aria-hidden="true" className="size-4" /> Download
          </button>
          <button type="button" onClick={() => { setDismissed(codesKey); setAsking(false); setCopied(false); router.refresh() }} className={primaryButtonClass}>
            I’ve saved my codes
          </button>
        </div>
      </div>
    )
  }

  const passwordError = state.status === 'error' && state.field === 'currentPassword' ? state.error : undefined
  const generalError = state.status === 'error' && !state.field ? state.error : null
  const hasCodes = summary.remaining > 0 || summary.createdLabel !== null

  return (
    <div className="mt-4 grid gap-4">
      <p className="text-sm leading-6 text-navy-950">
        {hasCodes
          ? `${summary.remaining} of 10 codes left${summary.createdLabel ? `, created ${summary.createdLabel}` : ''}.`
          : 'You have no backup codes yet.'}
      </p>
      {dismissed ? <p role="status" className={statusClass}>Your new codes are saved. Keep them somewhere safe.</p> : null}
      {asking ? (
        <form action={action} className={`${confirmBoxClass} max-w-md`} noValidate>
          {generalError ? <p role="alert" className={alertClass}>{generalError}</p> : null}
          <p className="text-sm leading-6 text-navy-950">
            {hasCodes ? 'Enter your password to make new codes. Your old codes will stop working.' : 'Enter your password to make your backup codes.'}
          </p>
          <PasswordField
            id="backup-codes-password"
            name="currentPassword"
            label="Current password"
            autoComplete="current-password"
            maxLength={72}
            required
            error={passwordError}
          />
          <div className={buttonRowClass}>
            <button type="button" disabled={pending} onClick={() => setAsking(false)} className={secondaryButtonClass}>Cancel</button>
            <button type="submit" disabled={pending} className={primaryButtonClass}>
              {pending ? 'Creating…' : hasCodes ? 'Create new codes' : 'Create backup codes'}
            </button>
          </div>
        </form>
      ) : (
        <div>
          <button type="button" onClick={() => setAsking(true)} className={hasCodes ? secondaryButtonClass : primaryButtonClass}>
            {hasCodes ? 'Create new codes' : 'Create backup codes'}
          </button>
        </div>
      )}
    </div>
  )
}
