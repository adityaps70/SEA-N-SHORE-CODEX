'use client'

import { useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, KeyRound } from 'lucide-react'
import { primaryButtonClass, secondaryButtonClass } from '@/components/ui/interactive-styles'
import {
  confirmAuthenticatorSetup,
  disableAuthenticator,
  startAuthenticatorSetup,
} from '@/features/auth/mfa-actions'
import type { MfaAccountKind, MfaChangeState } from '@/features/auth/mfa'

export type TwoStepPanelStatus = {
  kind: MfaAccountKind
  enabled: boolean
}

type Setup = { secret: string; otpauthUri: string; qrDataUrl: string }
type Step = 'view' | 'setup' | 'confirm-disable'

const inputClass = 'mt-1.5 min-h-11 w-full rounded-xl border border-mist-200 bg-white px-3 text-sm font-medium text-ink outline-none focus:border-ocean-500 focus-visible:ring-2 focus-visible:ring-ocean-500/30'
const NETWORK_ERROR = 'We could not reach Sea N Shore. Check your connection and try again.'

/** Groups the setup key in fours so it is easier to type into an authenticator app. */
function groupedKey(secret: string) {
  return secret.replace(/(.{4})/g, '$1 ').trim()
}

/**
 * Round 14 (2.11): Settings → Two-step verification. Email/password members can turn on an
 * authenticator app (TOTP); platform administrators cannot turn it off.
 */
export function TwoStepPanel({
  status,
  isAdministrator,
  returnTo,
}: {
  status: TwoStepPanelStatus | null
  isAdministrator: boolean
  returnTo: string | null
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [step, setStep] = useState<Step>('view')
  const [setup, setSetup] = useState<Setup | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  function begin() {
    setError(null)
    setNotice(null)
    startTransition(async () => {
      try {
        const result = await startAuthenticatorSetup()
        if (result.status === 'ready') {
          setSetup({ secret: result.secret, otpauthUri: result.otpauthUri, qrDataUrl: result.qrDataUrl })
          setStep('setup')
        } else {
          setError(result.error)
        }
      } catch {
        setError(NETWORK_ERROR)
      }
    })
  }

  function finish(result: MfaChangeState) {
    if (result.status === 'error') {
      setError(result.error)
      return
    }
    if (result.status === 'enabled' || result.status === 'disabled') {
      setSetup(null)
      setStep('view')
      setNotice(result.message)
      if (result.status === 'enabled' && result.redirectTo) {
        router.replace(result.redirectTo)
        return
      }
      router.refresh()
    }
  }

  function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    setError(null)
    startTransition(async () => {
      try {
        finish(await confirmAuthenticatorSetup({ status: 'idle' }, data))
      } catch {
        setError(NETWORK_ERROR)
      }
    })
  }

  function turnOff() {
    setError(null)
    startTransition(async () => {
      try {
        finish(await disableAuthenticator())
      } catch {
        setError(NETWORK_ERROR)
      }
    })
  }

  function cancel() {
    setSetup(null)
    setError(null)
    setStep('view')
  }

  const enabled = status?.enabled === true

  return (
    <section aria-labelledby="two-step-heading" className="rounded-2xl border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
      <div className="flex gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-ocean-50 text-ocean-700">
          <KeyRound aria-hidden="true" className="size-5" />
        </span>
        <div>
          <h2 id="two-step-heading" className="flex flex-wrap items-center gap-2 text-lg font-semibold text-navy-950">
            Authenticator app
            {status?.kind === 'eligible' ? (
              enabled ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                  <CheckCircle2 aria-hidden="true" className="size-3.5" />
                  On
                </span>
              ) : (
                <span className="inline-flex items-center rounded-full bg-mist-100 px-2 py-0.5 text-xs font-semibold text-muted">Off</span>
              )
            ) : null}
          </h2>
          <p className="mt-1 text-sm leading-6 text-muted">
            After your password, enter a 6-digit code from an app such as Google Authenticator, Microsoft Authenticator or 1Password.
          </p>
        </div>
      </div>

      {status === null ? (
        <p className="mt-4 rounded-xl bg-mist-50 px-3 py-2 text-sm text-muted">
          We couldn’t load your two-step verification settings right now. Refresh the page to try again.
        </p>
      ) : status.kind === 'federated' ? (
        <p className="mt-4 rounded-xl bg-mist-50 px-3 py-2 text-sm leading-6 text-muted">
          You sign in with Google, so Google protects your sign-in. Turn on 2-Step Verification in your Google account. Authenticator codes here are for email and password sign-in.
        </p>
      ) : status.kind === 'phone' ? (
        <p className="mt-4 rounded-xl bg-mist-50 px-3 py-2 text-sm leading-6 text-muted">
          You signed in with a mobile number code. Authenticator apps are for email and password sign-in: sign in with your email and password to set one up.
        </p>
      ) : (
        <>
          {notice ? (
            <p role="status" className="mt-4 rounded-xl bg-ocean-50 px-3 py-2 text-sm font-medium text-ocean-700">{notice}</p>
          ) : null}
          {error ? (
            <p role="alert" className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>
          ) : null}

          {step === 'view' && !enabled ? (
            <div className="mt-4">
              <button type="button" className={primaryButtonClass} disabled={pending} onClick={begin}>
                {pending ? 'Preparing…' : 'Set up authenticator app'}
              </button>
            </div>
          ) : null}

          {step === 'view' && enabled ? (
            isAdministrator ? (
              <p className="mt-4 text-sm leading-6 text-muted">
                Platform administrators must keep two-step verification on, so it can’t be turned off here.
              </p>
            ) : (
              <div className="mt-4">
                <button type="button" className={secondaryButtonClass} disabled={pending} onClick={() => { setError(null); setNotice(null); setStep('confirm-disable') }}>
                  Turn off
                </button>
              </div>
            )
          ) : null}

          {step === 'confirm-disable' ? (
            <div className="mt-4 grid gap-4 rounded-xl border border-mist-100 bg-mist-50/60 p-4">
              <p className="text-sm leading-6 text-navy-950">
                Turn off two-step verification? You’ll sign in with your password only.
              </p>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button type="button" onClick={cancel} disabled={pending} className={secondaryButtonClass}>Keep it on</button>
                <button type="button" onClick={turnOff} disabled={pending} className={primaryButtonClass}>
                  {pending ? 'Turning off…' : 'Turn off'}
                </button>
              </div>
            </div>
          ) : null}

          {step === 'setup' && setup ? (
            <form className="mt-4 grid gap-4 rounded-xl border border-mist-100 bg-mist-50/60 p-4" onSubmit={confirm} noValidate>
              <ol className="grid gap-4 text-sm leading-6 text-navy-950">
                <li>
                  <p className="font-semibold">1. Scan this QR code with your authenticator app</p>
                  {/* eslint-disable-next-line @next/next/no-img-element -- a generated data: URL, not a static asset */}
                  <img
                    src={setup.qrDataUrl}
                    alt="QR code to add Sea N Shore to your authenticator app"
                    width={180}
                    height={180}
                    className="mt-2 size-45 rounded-xl border border-mist-200 bg-white p-2"
                  />
                </li>
                <li>
                  <p className="font-semibold">Can’t scan it? Enter this key instead</p>
                  <p className="mt-1 break-all rounded-xl border border-mist-200 bg-white px-3 py-2 font-mono text-sm tracking-wide text-navy-950" aria-label="Setup key">
                    {groupedKey(setup.secret)}
                  </p>
                  <a href={setup.otpauthUri} className="mt-1 inline-flex min-h-10 items-center text-sm font-semibold text-ocean-700 underline-offset-2 hover:text-navy-950 hover:underline md:hidden">
                    Open in an authenticator app on this phone
                  </a>
                </li>
                <li>
                  <label className="font-semibold">
                    2. Enter the 6-digit code the app shows
                    <input
                      name="code"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      placeholder="123456"
                      required
                      className={`${inputClass} max-w-48 tracking-[0.2em]`}
                    />
                  </label>
                </li>
              </ol>
              {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button type="button" onClick={cancel} disabled={pending} className={secondaryButtonClass}>Cancel</button>
                <button type="submit" disabled={pending} className={primaryButtonClass}>
                  {pending ? 'Checking…' : 'Verify and turn on'}
                </button>
              </div>
            </form>
          ) : null}
        </>
      )}
    </section>
  )
}
