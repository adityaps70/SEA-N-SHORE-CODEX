'use client'

import { CheckCircle2, Lock, Smartphone } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { PHONE_REQUIRED_MESSAGE, type ConfirmCheckoutAction, type ConfirmCheckoutResult, type StartCheckoutAction } from '../checkout-types'
import { openGatewayCheckout, shouldConfirmWithServer } from './gateway-checkout'

/**
 * One "Pay" button for any checkout (event tickets now; courses and plans later).
 * Flow: start (server action creates the order) → optional mobile number step →
 * the gateway's own checkout window → confirm (server action asks the gateway) →
 * a clear result. The browser never decides that something is paid.
 */

export type GatewayCheckoutButtonProps = {
  /** Button text, e.g. "Pay ₹499 and register". */
  actionLabel: string
  /** Shown in the Razorpay window, e.g. the event title. */
  description: string
  /** Small print under the button. */
  hint?: string
  /** False while no gateway is set up: shows notConfiguredLabel on a disabled button. */
  configured: boolean
  notConfiguredLabel: string
  notConfiguredHelp?: string
  /** Paying is not possible right now (full, closed, unsupported currency…). */
  disabled?: boolean
  /** Replaces the button text while disabled, e.g. "Event full". */
  unavailableLabel?: string
  /** Explains a disabled button, e.g. why the currency cannot be paid yet. */
  unavailableHelp?: string
  successFallback?: string
  start: StartCheckoutAction
  confirm: ConfirmCheckoutAction
  /** Called after the server has answered (refresh the page data). */
  onSettled?: (result: ConfirmCheckoutResult | null) => void
  timeoutSeconds?: number
}

type Phase = 'idle' | 'preparing' | 'phone' | 'checkout' | 'redirecting' | 'confirming' | 'paid'

const SCRIPT_BLOCKED_MESSAGE = 'The secure payment window could not load. Check your connection or turn off content blockers for this site, then try again. No money was taken.'
const RAZORPAY_CLOSED_MESSAGE = 'Payment window closed. No money was taken. You can try again whenever you are ready.'

export function GatewayCheckoutButton(props: GatewayCheckoutButtonProps) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [phone, setPhone] = useState('')
  const [phoneError, setPhoneError] = useState<string | null>(null)
  const [askingPhone, setAskingPhone] = useState(false)
  const phoneInputRef = useRef<HTMLInputElement>(null)
  const phoneId = useId()

  useEffect(() => {
    if (phase === 'phone') phoneInputRef.current?.focus()
  }, [phase])

  if (!props.configured) {
    return (
      <div className="space-y-2">
        <button
          type="button"
          disabled
          className="min-h-12 w-full cursor-not-allowed rounded-xl border border-mist-200 bg-mist-100 px-5 py-3 text-sm font-bold text-navy-700"
        >
          {props.notConfiguredLabel}
        </button>
        {props.notConfiguredHelp ? <p className="text-xs leading-5 text-muted">{props.notConfiguredHelp}</p> : null}
      </div>
    )
  }

  function settle(result: ConfirmCheckoutResult | null) {
    props.onSettled?.(result)
  }

  async function begin(typedPhone?: string) {
    setError(null)
    setNotice(null)
    setPhoneError(null)
    setPhase('preparing')
    const started = await props.start(typedPhone ? { phone: typedPhone } : {})
    if (!started.ok) {
      if (started.needsPhone) {
        setAskingPhone(true)
        setPhase('phone')
        // The first request just means "we need a number"; anything else is a problem to show.
        if (typedPhone || started.error !== PHONE_REQUIRED_MESSAGE) setPhoneError(started.error)
        return
      }
      setPhase('idle')
      setError(started.error)
      return
    }

    const { checkout } = started
    setAskingPhone(false)
    setPhase('checkout')
    const result = await openGatewayCheckout(checkout.client, {
      description: props.description,
      prefill: checkout.prefill,
      notes: { sns_order_id: checkout.orderId },
      timeoutSeconds: props.timeoutSeconds,
      onAttemptFailed: (message) => {
        setError(`The payment didn't go through${message ? `: ${message.replace(/\.$/, '')}` : ''}. You can try again in the payment window or use a different method.`)
      },
    })

    if (result.outcome === 'unavailable') {
      setPhase('idle')
      setError(SCRIPT_BLOCKED_MESSAGE)
      return
    }
    if (result.outcome === 'redirecting') {
      setPhase('redirecting')
      setNotice('Taking you to the secure payment page…')
      return
    }
    if (!shouldConfirmWithServer(checkout.client, result)) {
      setPhase('idle')
      setError(null)
      setNotice(RAZORPAY_CLOSED_MESSAGE)
      return
    }

    setPhase('confirming')
    setError(null)
    let confirmed: ConfirmCheckoutResult
    try {
      confirmed = await props.confirm({ orderId: checkout.orderId, proof: result.outcome === 'completed' ? result.proof : null })
    } catch {
      confirmed = { ok: false, state: 'error', error: 'We could not check your payment just now. If money was taken, it is confirmed automatically within a few minutes. Refresh this page to check.' }
    }
    if (confirmed.ok) {
      setPhase('paid')
      setNotice(confirmed.message || props.successFallback || 'Payment received.')
      settle(confirmed)
      return
    }
    setPhase('idle')
    if (confirmed.state === 'not_paid') setNotice(confirmed.error)
    else setError(confirmed.error)
    settle(confirmed)
  }

  function submitPhone(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = phone.trim()
    if (!value) {
      setPhoneError('Enter your mobile number to continue.')
      phoneInputRef.current?.focus()
      return
    }
    void begin(value)
  }

  function cancelPhone() {
    setAskingPhone(false)
    setPhase('idle')
    setPhoneError(null)
    setNotice('No payment was started. You can continue whenever you are ready.')
  }

  if (phase === 'paid') {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4" role="status">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" aria-hidden="true" />
          <p className="text-sm font-bold text-emerald-900">{notice}</p>
        </div>
      </div>
    )
  }

  if (askingPhone && (phase === 'phone' || phase === 'preparing')) {
    const submitting = phase === 'preparing'
    return (
      <form
        onSubmit={submitPhone}
        onKeyDown={(event) => { if (event.key === 'Escape' && !submitting) cancelPhone() }}
        className="space-y-3 rounded-2xl border border-mist-200 bg-white p-4"
        aria-labelledby={`${phoneId}-title`}
        noValidate
      >
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-teal-50 text-teal-700">
            <Smartphone aria-hidden="true" className="size-4" />
          </span>
          <div className="min-w-0">
            <p id={`${phoneId}-title`} className="text-sm font-bold text-navy-950">Add a mobile number</p>
            <p className="text-xs leading-5 text-muted">Our payment partner needs a mobile number to send your payment receipt. We save it for your next payment.</p>
          </div>
        </div>
        <div className="space-y-1.5">
          <label htmlFor={`${phoneId}-input`} className="text-sm font-semibold text-navy-900">Mobile number</label>
          <input
            ref={phoneInputRef}
            id={`${phoneId}-input`}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            onChange={(event) => { setPhone(event.target.value); setPhoneError(null) }}
            placeholder="98765 43210"
            aria-invalid={phoneError ? true : undefined}
            aria-describedby={phoneError ? `${phoneId}-error` : `${phoneId}-help`}
            className="min-h-11 w-full rounded-xl border border-mist-200 bg-white px-4 text-[15px] text-navy-950 outline-none transition placeholder:text-muted focus:border-teal-500 focus-visible:ring-2 focus-visible:ring-teal-500/30 aria-[invalid=true]:border-rose-400"
          />
          {phoneError
            ? <p id={`${phoneId}-error`} className="text-xs font-semibold leading-5 text-rose-700">{phoneError}</p>
            : <p id={`${phoneId}-help`} className="text-xs leading-5 text-muted">Indian numbers: 10 digits. Other countries: start with + and the country code.</p>}
        </div>
        <div className="flex flex-col gap-2">
          <button
            type="submit"
            disabled={submitting}
            aria-busy={submitting || undefined}
            className="inline-flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-teal-600 px-4 text-sm font-bold text-white transition hover:bg-teal-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Lock aria-hidden="true" className="size-4" />
            {submitting ? 'Opening secure checkout…' : 'Continue to payment'}
          </button>
          <button
            type="button"
            onClick={cancelPhone}
            disabled={submitting}
            className="inline-flex min-h-11 w-full cursor-pointer items-center justify-center rounded-xl border border-mist-200 bg-white px-4 text-sm font-bold text-navy-900 transition hover:border-teal-300 hover:bg-teal-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Cancel
          </button>
        </div>
      </form>
    )
  }

  const busy = phase === 'preparing' || phase === 'checkout' || phase === 'confirming' || phase === 'redirecting'
  const unavailable = Boolean(props.disabled)
  const label = phase === 'preparing'
    ? 'Opening secure checkout…'
    : phase === 'checkout'
      ? 'Complete payment in the window…'
      : phase === 'confirming'
        ? 'Checking your payment…'
        : phase === 'redirecting'
          ? 'Opening the payment page…'
          : unavailable && props.unavailableLabel
            ? props.unavailableLabel
            : props.actionLabel

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => { void begin() }}
        disabled={unavailable || busy}
        aria-busy={busy || undefined}
        className={`inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-bold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 disabled:cursor-not-allowed ${unavailable ? 'border border-mist-200 bg-mist-100 text-navy-700' : 'cursor-pointer bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-60'}`}
      >
        {unavailable ? null : <Lock aria-hidden="true" className="size-4" />}
        {label}
      </button>
      {unavailable && props.unavailableHelp ? <p className="text-xs leading-5 text-navy-700">{props.unavailableHelp}</p> : null}
      {!unavailable && props.hint ? <p className="text-xs leading-5 text-muted">{props.hint}</p> : null}
      <div aria-live="polite">
        {error ? <p className="text-sm font-medium text-rose-700">{error}</p> : null}
        {!error && notice ? <p className="text-sm text-navy-700">{notice}</p> : null}
      </div>
    </div>
  )
}
