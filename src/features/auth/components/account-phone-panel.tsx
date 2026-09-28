'use client'

import { useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Smartphone } from 'lucide-react'
import {
  cancelPhoneLink,
  confirmPhoneLinkCode,
  removeLinkedPhone,
  requestPhoneLinkCode,
} from '@/features/auth/phone-link-actions'
import { displayPhoneNumber, type AccountPhoneSummary, type PhoneLinkState } from '@/features/auth/phone-link'

/** Common country codes for seafarers and maritime employers. A number typed with its own + code also works. */
export const PHONE_COUNTRY_CODES = [
  { code: '+91', label: 'India (+91)' },
  { code: '+971', label: 'United Arab Emirates (+971)' },
  { code: '+65', label: 'Singapore (+65)' },
  { code: '+63', label: 'Philippines (+63)' },
  { code: '+94', label: 'Sri Lanka (+94)' },
  { code: '+880', label: 'Bangladesh (+880)' },
  { code: '+62', label: 'Indonesia (+62)' },
  { code: '+60', label: 'Malaysia (+60)' },
  { code: '+852', label: 'Hong Kong (+852)' },
  { code: '+966', label: 'Saudi Arabia (+966)' },
  { code: '+974', label: 'Qatar (+974)' },
  { code: '+44', label: 'United Kingdom (+44)' },
  { code: '+1', label: 'United States / Canada (+1)' },
  { code: '+30', label: 'Greece (+30)' },
  { code: '+357', label: 'Cyprus (+357)' },
  { code: '+31', label: 'Netherlands (+31)' },
  { code: '+49', label: 'Germany (+49)' },
  { code: '+47', label: 'Norway (+47)' },
  { code: '+380', label: 'Ukraine (+380)' },
] as const

const inputClass = 'mt-1.5 min-h-11 w-full rounded-xl border border-mist-200 bg-white px-3 text-sm font-medium text-ink outline-none focus:border-ocean-500 focus-visible:ring-2 focus-visible:ring-ocean-500/30'
const primaryButton = 'inline-flex min-h-11 items-center justify-center rounded-xl bg-ocean-700 px-4 text-sm font-semibold text-white transition hover:bg-navy-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ocean-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60'
const secondaryButton = 'inline-flex min-h-11 items-center justify-center rounded-xl border border-mist-200 bg-white px-4 text-sm font-semibold text-navy-950 transition hover:bg-mist-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ocean-500 focus-visible:ring-offset-2 disabled:opacity-50'

type Step = 'view' | 'request' | 'confirm'

export function AccountPhonePanel({ summary }: { summary: AccountPhoneSummary | null }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const phones = summary?.phones ?? []
  const [step, setStep] = useState<Step>(summary?.pendingPhoneNumber ? 'confirm' : 'view')
  const [pendingNumber, setPendingNumber] = useState<string | null>(summary?.pendingPhoneNumber ?? null)
  const [state, setState] = useState<PhoneLinkState>({ status: 'idle' })

  function run(action: () => Promise<PhoneLinkState>) {
    startTransition(async () => {
      let result: PhoneLinkState
      try {
        result = await action()
      } catch {
        result = { status: 'error', step: step === 'confirm' ? 'confirm' : 'request', error: 'We could not reach Sea N Shore. Check your connection and try again.' }
      }
      setState(result)
      if (result.status === 'code_sent') {
        setPendingNumber(result.phoneNumber)
        setStep('confirm')
      } else if (result.status === 'verified' || result.status === 'removed') {
        setPendingNumber(null)
        setStep('view')
        router.refresh()
      } else if (result.status === 'error' && result.step === 'request' && step === 'confirm') {
        setPendingNumber(null)
        setStep('request')
      }
    })
  }

  function submit(event: FormEvent<HTMLFormElement>, action: (state: PhoneLinkState, data: FormData) => Promise<PhoneLinkState>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    run(() => action(state, data))
  }

  function cancel(next: Step) {
    setStep(next)
    setPendingNumber(null)
    setState({ status: 'idle' })
    startTransition(async () => {
      try {
        await cancelPhoneLink()
      } catch {
        // Nothing to undo: the unused code simply expires.
      }
    })
  }

  const error = state.status === 'error' ? state.error : null
  const notice = state.status === 'code_sent' || state.status === 'verified' || state.status === 'removed' ? state.message : null

  return (
    <section aria-labelledby="account-phone-heading" className="rounded-2xl border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
      <div className="flex gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-ocean-50 text-ocean-700">
          <Smartphone aria-hidden="true" className="size-5" />
        </span>
        <div>
          <h2 id="account-phone-heading" className="text-lg font-semibold text-navy-950">Mobile number</h2>
          <p className="mt-1 text-sm leading-6 text-muted">
            Add a verified mobile number to sign in with “Continue with mobile number”. We only use it for sign-in codes and payment notices.
          </p>
        </div>
      </div>

      {summary === null ? (
        <p className="mt-4 rounded-xl bg-mist-50 px-3 py-2 text-sm text-muted">
          We couldn’t load your mobile number right now. Refresh the page to try again.
        </p>
      ) : (
        <>
          {phones.length ? (
            <ul className="mt-4 grid gap-2" aria-label="Mobile numbers on your account">
              {phones.map((phone) => (
                <li key={phone.identityId} className="flex flex-col gap-3 rounded-xl border border-mist-200 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="flex items-center gap-2 font-semibold text-navy-950">
                      {displayPhoneNumber(phone.phoneNumber)}
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                        <CheckCircle2 aria-hidden="true" className="size-3.5" />
                        Verified
                      </span>
                    </p>
                    {phone.removeBlockedReason ? (
                      <p className="mt-1 text-xs leading-5 text-muted">{phone.removeBlockedReason}</p>
                    ) : null}
                  </div>
                  {phone.removable ? (
                    <form onSubmit={(event) => submit(event, removeLinkedPhone)}>
                      <input type="hidden" name="identityId" value={phone.identityId} />
                      <button type="submit" disabled={pending} className={secondaryButton}>
                        Remove
                      </button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-sm text-muted">No mobile number on your account yet.</p>
          )}

          {notice ? (
            <p role="status" className="mt-4 rounded-xl bg-ocean-50 px-3 py-2 text-sm font-medium text-ocean-700">{notice}</p>
          ) : null}
          {error ? (
            <p role="alert" className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>
          ) : null}

          {step === 'view' ? (
            <div className="mt-4">
              <button type="button" className={primaryButton} onClick={() => { setState({ status: 'idle' }); setStep('request') }}>
                {phones.length ? 'Change mobile number' : 'Add mobile number'}
              </button>
            </div>
          ) : null}

          {step === 'request' ? (
            <form className="mt-4 grid gap-4 rounded-xl border border-mist-100 bg-mist-50/60 p-4" onSubmit={(event) => submit(event, requestPhoneLinkCode)} noValidate>
              <div className="grid gap-4 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
                <label className="text-sm font-semibold text-navy-950">
                  Country code
                  <select name="countryCode" defaultValue="+91" className={inputClass}>
                    {PHONE_COUNTRY_CODES.map((entry) => (
                      <option key={entry.code} value={entry.code}>{entry.label}</option>
                    ))}
                  </select>
                </label>
                <label className="text-sm font-semibold text-navy-950">
                  Mobile number
                  <input
                    name="phoneNumber"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel-national"
                    placeholder="98765 43210"
                    required
                    aria-describedby="account-phone-hint"
                    className={inputClass}
                  />
                </label>
              </div>
              <p id="account-phone-hint" className="-mt-2 text-xs leading-5 text-muted">
                {phones.length
                  ? 'We’ll text a 6-digit code to the new number. Your current number keeps working until the new one is verified.'
                  : 'We’ll text a 6-digit code to this number. Standard SMS rates may apply.'}
              </p>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button type="button" onClick={() => cancel('view')} disabled={pending} className={secondaryButton}>Cancel</button>
                <button type="submit" disabled={pending} className={primaryButton}>
                  {pending ? 'Sending code…' : 'Send code'}
                </button>
              </div>
            </form>
          ) : null}

          {step === 'confirm' ? (
            <form className="mt-4 grid gap-4 rounded-xl border border-mist-100 bg-mist-50/60 p-4" onSubmit={(event) => submit(event, confirmPhoneLinkCode)} noValidate>
              <label className="text-sm font-semibold text-navy-950">
                {pendingNumber ? `Code sent to ${displayPhoneNumber(pendingNumber)}` : 'Verification code'}
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
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button type="button" onClick={() => cancel('request')} disabled={pending} className={secondaryButton}>Use a different number</button>
                <button type="submit" disabled={pending} className={primaryButton}>
                  {pending ? 'Checking…' : 'Verify number'}
                </button>
              </div>
            </form>
          ) : null}
        </>
      )}
    </section>
  )
}
