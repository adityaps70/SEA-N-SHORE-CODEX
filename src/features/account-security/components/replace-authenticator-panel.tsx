'use client'

import { useActionState, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { confirmReplacementAction, finishReplacementAction, startReplacementAction } from '../authenticator-replacement-actions'
import type { ReplacementStartResult } from '../authenticator-replacement'

const fieldClass = 'mt-1 w-full rounded-lg border border-mist-200 bg-white px-3 py-2 text-sm text-navy-950 outline-none focus:border-ocean-400 focus:ring-2 focus:ring-ocean-100'

/**
 * Admin two-step (owner, 21 Nov): replace the authenticator app (a new phone) without turning two-step verification
 * off. 1. Confirm it's you (password and a code from the current app, or a backup code). 2. Scan the new QR code.
 * 3. Enter a code from the new app. The page tells the member to finish once the new app is started.
 */
export function ReplaceAuthenticatorPanel() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [method, setMethod] = useState<'authenticator' | 'backup_code'>('authenticator')
  const [confirmState, confirmAction, confirming] = useActionState(confirmReplacementAction, null)
  const [setup, setSetup] = useState<Extract<ReplacementStartResult, { status: 'ready' }> | null>(null)
  const [startError, setStartError] = useState<string | null>(null)
  const [starting, startTransition] = useTransition()
  const [finishState, finishAction, finishing] = useActionState(finishReplacementAction, null)
  const pass = confirmState?.status === 'confirmed' ? confirmState.pass : null

  if (finishState?.status === 'replaced') {
    return (
      <section aria-labelledby="replace-app-heading" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
        <h2 id="replace-app-heading" className="text-base font-semibold text-emerald-900">Authenticator app replaced</h2>
        <p role="status" className="mt-1 text-sm text-emerald-900">{finishState.message}</p>
      </section>
    )
  }

  return (
    <section aria-labelledby="replace-app-heading" className="rounded-xl border border-mist-100 bg-white p-4">
      <h2 id="replace-app-heading" className="text-base font-semibold text-navy-950">Replace authenticator app</h2>
      <p className="mt-1 text-sm text-muted">New phone? Move Sea N Shore to a new authenticator app without turning two-step verification off.</p>

      {!open ? (
        <Button type="button" size="sm" variant="secondary" className="mt-3" onClick={() => setOpen(true)}>Replace authenticator app</Button>
      ) : !pass ? (
        <form action={confirmAction} className="mt-3 grid gap-3" aria-label="Confirm it’s you to replace your authenticator app">
          <p className="text-sm font-semibold text-navy-950">1. Confirm it’s you</p>
          <label className="text-sm font-medium text-navy-900">
            Password
            <input name="password" type="password" autoComplete="current-password" required className={`${fieldClass} min-h-10`} />
          </label>
          <fieldset className="flex flex-wrap gap-4 text-sm text-navy-900">
            <legend className="sr-only">How to confirm</legend>
            <label className="flex items-center gap-2"><input type="radio" name="method" value="authenticator" checked={method === 'authenticator'} onChange={() => setMethod('authenticator')} /> Code from your current app</label>
            <label className="flex items-center gap-2"><input type="radio" name="method" value="backup_code" checked={method === 'backup_code'} onChange={() => setMethod('backup_code')} /> Backup code</label>
          </fieldset>
          <label className="text-sm font-medium text-navy-900">
            {method === 'authenticator' ? '6-digit code' : 'Backup code'}
            <input name="code" required autoComplete="one-time-code" inputMode={method === 'authenticator' ? 'numeric' : 'text'} className={`${fieldClass} min-h-10`} />
          </label>
          <div><Button type="submit" size="sm" disabled={confirming}>{confirming ? 'Checking…' : 'Continue'}</Button></div>
          {confirmState?.status === 'error' ? <p role="alert" className="text-sm text-red-700">{confirmState.error}</p> : null}
        </form>
      ) : !setup ? (
        <div className="mt-3 grid gap-3">
          <p className="text-sm font-semibold text-navy-950">2. Add Sea N Shore to your new authenticator app</p>
          <p role="note" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Finish all the steps now. Once you continue, your old app may stop working straight away.
          </p>
          <div>
            <Button
              type="button"
              size="sm"
              disabled={starting}
              onClick={() => startTransition(async () => {
                setStartError(null)
                const result = await startReplacementAction(pass)
                if (result.status === 'ready') setSetup(result)
                else setStartError(result.error)
              })}
            >
              {starting ? 'Preparing…' : 'Show the new QR code'}
            </Button>
          </div>
          {startError ? <p role="alert" className="text-sm text-red-700">{startError}</p> : null}
        </div>
      ) : (
        <form action={finishAction} className="mt-3 grid gap-3" onSubmit={() => router.refresh()}>
          <input type="hidden" name="pass" value={pass} />
          <p className="text-sm font-semibold text-navy-950">3. Scan this with your new app, then enter the code it shows</p>
          {/* eslint-disable-next-line @next/next/no-img-element -- a generated data: URL, not a static asset */}
          <img src={setup.qrDataUrl} alt="QR code to add Sea N Shore to your new authenticator app" width={180} height={180} className="size-45 rounded-xl border border-mist-200 bg-white p-2" />
          <p className="break-all rounded-xl border border-mist-200 bg-mist-50 px-3 py-2 font-mono text-sm text-navy-950" aria-label="Setup key">{setup.secret}</p>
          <label className="text-sm font-medium text-navy-900">
            6-digit code from the new app
            <input name="code" required autoComplete="one-time-code" inputMode="numeric" className={`${fieldClass} min-h-10`} />
          </label>
          <div><Button type="submit" size="sm" disabled={finishing}>{finishing ? 'Checking…' : 'Use the new app'}</Button></div>
          {finishState?.status === 'error' ? <p role="alert" className="text-sm text-red-700">{finishState.error}</p> : null}
        </form>
      )}
    </section>
  )
}
