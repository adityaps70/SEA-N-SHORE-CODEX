'use client'

import { CheckCircle2, Lock } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { confirmEventPaymentAction, startEventCheckoutAction } from '../event-payment-actions'
import { CHECKOUT_TIMEOUT_SECONDS, PAYMENTS_NOT_CONFIGURED_MESSAGE } from '../event-payment-rules'
import { loadRazorpayCheckout, type RazorpaySuccessResponse } from './load-razorpay-checkout'

type Props = {
  eventId: string
  eventTitle: string
  priceLabel: string
  paymentsConfigured: boolean
  disabled?: boolean
  /** Shown on the button instead of the price while registration is unavailable, e.g. "Event full". */
  unavailableLabel?: string
}

type Phase = 'idle' | 'preparing' | 'checkout' | 'confirming' | 'paid'

export function EventCheckoutButton({ eventId, eventTitle, priceLabel, paymentsConfigured, disabled = false, unavailableLabel }: Props) {
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  if (!paymentsConfigured) {
    return (
      <div className="space-y-2">
        <button
          type="button"
          disabled
          className="min-h-12 w-full cursor-not-allowed rounded-xl bg-mist-100 px-5 py-3 text-sm font-bold text-navy-700"
        >
          {PAYMENTS_NOT_CONFIGURED_MESSAGE}
        </button>
        <p className="text-xs leading-5 text-muted">This is a paid event. You&apos;ll be able to buy a ticket here as soon as payments are switched on.</p>
      </div>
    )
  }

  async function confirm(response: RazorpaySuccessResponse, orderId: string) {
    setPhase('confirming')
    const result = await confirmEventPaymentAction({
      eventId,
      orderId,
      providerOrderId: response.razorpay_order_id,
      providerPaymentId: response.razorpay_payment_id,
      signature: response.razorpay_signature,
    })
    if (result.ok) {
      setPhase('paid')
      setNotice('Payment received. Your seat is confirmed.')
      startTransition(() => router.refresh())
      return
    }
    setPhase('idle')
    setError(result.error)
    startTransition(() => router.refresh())
  }

  async function begin() {
    setError(null)
    setNotice(null)
    setPhase('preparing')
    const started = await startEventCheckoutAction(eventId)
    if (!started.ok) {
      setPhase('idle')
      setError(started.error)
      return
    }

    let Razorpay
    try {
      Razorpay = await loadRazorpayCheckout()
    } catch {
      setPhase('idle')
      setError('The secure payment window could not load. Check your connection or turn off content blockers for this site, then try again. No money was taken.')
      return
    }

    const { checkout } = started
    const instance = new Razorpay({
      key: checkout.keyId,
      amount: checkout.amountMinor,
      currency: checkout.currency,
      name: 'Sea N Shore',
      description: eventTitle.slice(0, 250),
      order_id: checkout.providerOrderId,
      prefill: checkout.prefill.email ? { email: checkout.prefill.email } : undefined,
      notes: { sns_order_id: checkout.orderId, sns_event_id: eventId },
      theme: { color: '#0d9488' },
      timeout: CHECKOUT_TIMEOUT_SECONDS,
      handler: (response) => { void confirm(response, checkout.orderId) },
      modal: {
        escape: true,
        confirm_close: true,
        ondismiss: () => {
          setPhase((current) => (current === 'checkout' ? 'idle' : current))
          setNotice((current) => current ?? 'Payment window closed. No money was taken. You can try again whenever you are ready.')
        },
      },
    })
    instance.on('payment.failed', (response) => {
      const reason = response.error?.description
      setError(`The payment didn't go through${reason ? `: ${reason.replace(/\.$/, '')}` : ''}. You can try again in the payment window or use a different method.`)
    })
    setPhase('checkout')
    instance.open()
  }

  const busy = phase === 'preparing' || phase === 'checkout' || phase === 'confirming'
  const label = phase === 'preparing'
    ? 'Opening secure checkout…'
    : phase === 'checkout'
      ? 'Complete payment in the window…'
      : phase === 'confirming'
        ? 'Confirming your seat…'
        : disabled && unavailableLabel
          ? unavailableLabel
          : `Pay ${priceLabel} and register`

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

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => { void begin() }}
        disabled={disabled || busy}
        aria-busy={busy || undefined}
        className={`inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-bold transition disabled:cursor-not-allowed ${disabled ? 'bg-mist-100 text-navy-700' : 'bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-60'}`}
      >
        {disabled && unavailableLabel ? null : <Lock aria-hidden="true" className="size-4" />}
        {label}
      </button>
      {disabled && unavailableLabel ? null : (
        <p className="text-xs leading-5 text-muted">Secure payment by card, UPI or net banking through Razorpay. Your seat is confirmed as soon as the payment succeeds.</p>
      )}
      <div aria-live="polite">
        {error ? <p className="text-sm font-medium text-rose-700">{error}</p> : null}
        {!error && notice ? <p className="text-sm text-navy-700">{notice}</p> : null}
      </div>
    </div>
  )
}
