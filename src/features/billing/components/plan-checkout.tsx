'use client'

import { useRouter } from 'next/navigation'
import { CheckCircle2, Clock3, ExternalLink, Info, Lock, RefreshCw, Smartphone, XCircle } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState, useTransition } from 'react'
import { checkPlanCheckoutAction, startPlanCheckoutAction } from '../actions'
import {
  BILLING_NOT_CONFIGURED_MESSAGE,
  BILLING_NOT_CONFIGURED_TITLE,
  type CheckPlanCheckoutResult,
  type PlanCheckoutTarget,
} from '../checkout-messages'
import { INTERVAL_LABELS, formatRupees, type BillingInterval } from '../plans'
import { openSubscriptionCheckout, type SubscriptionRedirectTarget } from './subscription-sdk'

/**
 * Choose monthly or yearly, then approve an auto-pay mandate in Cashfree's window.
 * start (server action creates the Cashfree subscription) → optional mobile / email step
 * → Cashfree approval (new tab) → this page asks the server every few seconds until the
 * mandate is approved, waiting for the bank, or failed. The browser never decides.
 */

export type PlanCheckoutProps = {
  target: PlanCheckoutTarget
  planLabel: string
  prices: { month: number | null; year: number | null }
  yearlySavingLabel: string | null
  defaultInterval?: BillingInterval
  /** Only this interval can be chosen (e.g. "Switch to yearly"). */
  onlyInterval?: BillingInterval
  configured: boolean
  /** Why buying is not possible for this account right now (shown instead of the button). */
  blockedMessage?: string | null
  /** The new plan starts when the current one ends, on this date. */
  startsOn?: string | null
  submitLabel?: string
  /** Called when the person closes the panel (e.g. the "Switch to yearly" drawer). */
  onCancel?: () => void
  /** How often to ask the server while the customer approves (tests shorten it). */
  pollIntervalMs?: number
}

type Phase = 'choose' | 'starting' | 'contact' | 'opening' | 'approving' | 'done'

const POLL_MS = 5_000
const POLL_LIMIT = 120

const inputClass = 'min-h-11 w-full rounded-xl border border-mist-200 bg-white px-4 text-[15px] text-navy-950 outline-none transition placeholder:text-muted focus:border-teal-500 focus-visible:ring-2 focus-visible:ring-teal-500/30 aria-[invalid=true]:border-rose-400'
const primaryButton = 'inline-flex min-h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-teal-600 px-5 py-3 text-sm font-bold text-white transition hover:bg-teal-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 disabled:cursor-not-allowed disabled:opacity-60'
const secondaryButton = 'inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-mist-200 bg-white px-4 text-sm font-bold text-navy-900 transition hover:border-teal-300 hover:bg-teal-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 disabled:cursor-not-allowed disabled:opacity-60'

const SCRIPT_BLOCKED = 'The secure Cashfree window could not load. Check your connection or turn off content blockers for this site, then try again. No money was taken.'

export function PlanCheckout(props: PlanCheckoutProps) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const fieldId = useId()
  const available: BillingInterval[] = props.onlyInterval
    ? [props.onlyInterval]
    : (['month', 'year'] as const).filter((interval) => props.prices[interval] !== null)
  const [interval, setChosenInterval] = useState<BillingInterval>(
    props.onlyInterval ?? (props.defaultInterval && props.prices[props.defaultInterval] !== null ? props.defaultInterval : available[0] ?? 'month'),
  )
  const [phase, setPhase] = useState<Phase>('choose')
  const [error, setError] = useState<string | null>(null)
  const [needs, setNeeds] = useState<{ phone: boolean; email: boolean }>({ phone: false, email: false })
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [checkout, setCheckout] = useState<{ id: string; session: string; mode: 'sandbox' | 'production' } | null>(null)
  const [status, setStatus] = useState<CheckPlanCheckoutResult | null>(null)
  const [checking, setChecking] = useState(false)
  const [windowProblem, setWindowProblem] = useState<string | null>(null)
  const firstFieldRef = useRef<HTMLInputElement>(null)
  const pollCount = useRef(0)

  useEffect(() => {
    if (phase === 'contact') firstFieldRef.current?.focus()
  }, [phase])

  const check = useCallback(async (checkoutId: string) => {
    setChecking(true)
    try {
      const result = await checkPlanCheckoutAction(checkoutId)
      setStatus(result)
      if (result.state !== 'waiting' && result.state !== 'unknown') {
        setPhase('done')
        startTransition(() => router.refresh())
      }
      return result
    } catch {
      const fallback: CheckPlanCheckoutResult = {
        state: 'unknown',
        title: 'We couldn’t check the status yet',
        message: 'Check your connection and select “Check status”. If you approved the mandate, your plan switches on automatically within a few minutes.',
      }
      setStatus(fallback)
      return fallback
    } finally {
      setChecking(false)
    }
  }, [router])

  const pollMs = props.pollIntervalMs ?? POLL_MS

  // While the customer approves in Cashfree's tab, ask the server every few seconds.
  useEffect(() => {
    if (phase !== 'approving' || !checkout) return
    pollCount.current = 0
    const timer = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      pollCount.current += 1
      if (pollCount.current > POLL_LIMIT) {
        window.clearInterval(timer)
        return
      }
      void check(checkout.id)
    }, pollMs)
    return () => window.clearInterval(timer)
  }, [phase, checkout, check, pollMs])

  if (!props.configured) {
    return (
      <div className="space-y-2 rounded-2xl border border-mist-200 bg-mist-50/60 p-4">
        <p className="text-sm font-bold text-navy-950">{BILLING_NOT_CONFIGURED_TITLE}</p>
        <p className="text-sm leading-6 text-navy-700">{BILLING_NOT_CONFIGURED_MESSAGE}</p>
        {props.prices.month !== null || props.prices.year !== null ? (
          <p className="text-sm font-semibold text-navy-900">
            {props.planLabel}: {[
              props.prices.month !== null ? `${formatRupees(props.prices.month)} per month` : null,
              props.prices.year !== null ? `${formatRupees(props.prices.year)} per year` : null,
            ].filter(Boolean).join(' or ')}
          </p>
        ) : null}
        <button type="button" disabled className="mt-1 min-h-11 w-full cursor-not-allowed rounded-xl border border-mist-200 bg-mist-100 px-5 text-sm font-bold text-navy-700">
          Auto-pay not available yet
        </button>
      </div>
    )
  }

  async function open(target: SubscriptionRedirectTarget, current = checkout) {
    if (!current) return
    setPhase('opening')
    setWindowProblem(null)
    const opened = await openSubscriptionCheckout({ subscriptionSessionId: current.session, mode: current.mode, target })
    if (opened.outcome === 'unavailable') {
      setPhase('choose')
      setError(SCRIPT_BLOCKED)
      return
    }
    if (opened.outcome === 'error') {
      setWindowProblem(`The Cashfree window didn’t open${opened.message ? ` (${opened.message.replace(/\.$/, '')})` : ''}. Allow pop-ups for this site, or open it in this tab instead. No money was taken.`)
    }
    if (target === '_self' && opened.outcome === 'opened') return
    setStatus({ state: 'waiting', title: 'Finish approving auto-pay', message: 'Complete the approval in the Cashfree tab. This page updates on its own once you’re done.' })
    setPhase('approving')
  }

  async function begin(contact?: { phone?: string; email?: string }) {
    setError(null)
    setPhase('starting')
    let result: Awaited<ReturnType<typeof startPlanCheckoutAction>>
    try {
      result = await startPlanCheckoutAction({ target: props.target, interval, ...(contact ?? {}) })
    } catch {
      result = { ok: false, error: 'We couldn’t reach Sea N Shore. Check your connection and try again. No money was taken.' }
    }
    if (!result.ok) {
      if (result.needsContact && (result.needsContact.phone || result.needsContact.email)) {
        setNeeds(result.needsContact)
        setPhase('contact')
        if (contact) setError(result.error)
        return
      }
      setPhase(needs.phone || needs.email ? 'contact' : 'choose')
      setError(result.error)
      return
    }
    const next = { id: result.checkoutId, session: result.subscriptionSessionId, mode: result.mode }
    setCheckout(next)
    await open('_blank', next)
  }

  function submitContact(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (needs.phone && !phone.trim()) {
      setError('Enter your mobile number to continue.')
      firstFieldRef.current?.focus()
      return
    }
    if (needs.email && !email.trim()) {
      setError('Enter your email address to continue.')
      return
    }
    void begin({ ...(needs.phone ? { phone: phone.trim() } : {}), ...(needs.email ? { email: email.trim() } : {}) })
  }

  const amount = props.prices[interval]
  const priceText = amount !== null ? `${formatRupees(amount)} ${INTERVAL_LABELS[interval].per}` : null

  if (phase === 'done' && status) {
    const tone = status.state === 'active'
      ? { icon: CheckCircle2, box: 'border-emerald-200 bg-emerald-50', title: 'text-emerald-900', text: 'text-emerald-900' }
      : status.state === 'pending_approval'
        ? { icon: Clock3, box: 'border-ocean-200 bg-ocean-50', title: 'text-navy-950', text: 'text-navy-800' }
        : { icon: XCircle, box: 'border-rose-200 bg-rose-50', title: 'text-rose-900', text: 'text-rose-900' }
    const Icon = tone.icon
    return (
      <div className={`rounded-2xl border p-4 ${tone.box}`} role="status">
        <div className="flex items-start gap-3">
          <Icon aria-hidden="true" className={`mt-0.5 size-5 shrink-0 ${tone.title}`} />
          <div className="min-w-0 space-y-1">
            <p className={`text-sm font-bold ${tone.title}`}>{status.title}</p>
            <p className={`text-sm leading-6 ${tone.text}`}>{status.message}</p>
            {status.state === 'failed' || status.state === 'closed' ? (
              <button type="button" onClick={() => { setStatus(null); setCheckout(null); setPhase('choose') }} className={`${secondaryButton} mt-2`}>
                Try again
              </button>
            ) : null}
          </div>
        </div>
      </div>
    )
  }

  if (phase === 'approving' || (phase === 'opening' && checkout)) {
    return (
      <div className="space-y-3 rounded-2xl border border-ocean-200 bg-ocean-50/60 p-4" aria-live="polite">
        <div className="flex items-start gap-3">
          <Clock3 aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-ocean-700" />
          <div className="min-w-0">
            <p className="text-sm font-bold text-navy-950">{status?.title ?? 'Opening Cashfree…'}</p>
            <p className="mt-1 text-sm leading-6 text-navy-800">{status?.message ?? 'Approve the auto-pay mandate in the Cashfree window.'}</p>
          </div>
        </div>
        {windowProblem ? <p className="text-sm font-medium text-rose-700">{windowProblem}</p> : null}
        <div className="flex flex-col gap-2 sm:flex-row">
          <button type="button" onClick={() => { if (checkout) void check(checkout.id) }} disabled={checking || !checkout} aria-busy={checking || undefined} className={secondaryButton}>
            <RefreshCw aria-hidden="true" className={`size-4 ${checking ? 'animate-spin' : ''}`} />
            {checking ? 'Checking…' : 'Check status'}
          </button>
          <button type="button" onClick={() => { void open('_blank') }} disabled={phase === 'opening'} className={secondaryButton}>
            <ExternalLink aria-hidden="true" className="size-4" />
            Reopen Cashfree window
          </button>
          {windowProblem ? (
            <button type="button" onClick={() => { void open('_self') }} className={secondaryButton}>
              Open in this tab
            </button>
          ) : null}
        </div>
      </div>
    )
  }

  if (phase === 'contact' || (phase === 'starting' && (needs.phone || needs.email))) {
    const submitting = phase === 'starting'
    return (
      <form
        onSubmit={submitContact}
        onKeyDown={(event) => { if (event.key === 'Escape' && !submitting) { setPhase('choose'); setError(null) } }}
        className="space-y-3 rounded-2xl border border-mist-200 bg-white p-4"
        aria-labelledby={`${fieldId}-contact-title`}
        noValidate
      >
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-teal-50 text-teal-700">
            <Smartphone aria-hidden="true" className="size-4" />
          </span>
          <div className="min-w-0">
            <p id={`${fieldId}-contact-title`} className="text-sm font-bold text-navy-950">Add your contact details</p>
            <p className="text-xs leading-5 text-muted">Our payment partner, Cashfree, sends the auto-pay approval and a notice before each payment to these. We save your mobile number for next time.</p>
          </div>
        </div>
        {needs.phone ? (
          <div className="space-y-1.5">
            <label htmlFor={`${fieldId}-phone`} className="text-sm font-semibold text-navy-900">Mobile number</label>
            <input
              ref={firstFieldRef}
              id={`${fieldId}-phone`}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={phone}
              onChange={(event) => { setPhone(event.target.value); setError(null) }}
              placeholder="98765 43210"
              className={inputClass}
            />
            <p className="text-xs leading-5 text-muted">Indian numbers: 10 digits. Other countries: start with + and the country code.</p>
          </div>
        ) : null}
        {needs.email ? (
          <div className="space-y-1.5">
            <label htmlFor={`${fieldId}-email`} className="text-sm font-semibold text-navy-900">Email address</label>
            <input
              ref={needs.phone ? undefined : firstFieldRef}
              id={`${fieldId}-email`}
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => { setEmail(event.target.value); setError(null) }}
              placeholder="name@example.com"
              className={inputClass}
            />
          </div>
        ) : null}
        {error ? <p className="text-sm font-medium text-rose-700" role="alert">{error}</p> : null}
        <div className="flex flex-col gap-2">
          <button type="submit" disabled={submitting} aria-busy={submitting || undefined} className={primaryButton}>
            <Lock aria-hidden="true" className="size-4" />
            {submitting ? 'Setting up auto-pay…' : 'Continue to Cashfree'}
          </button>
          <button type="button" onClick={() => { setPhase('choose'); setError(null) }} disabled={submitting} className={`${secondaryButton} w-full`}>
            Back
          </button>
        </div>
      </form>
    )
  }

  const busy = phase === 'starting' || phase === 'opening'
  return (
    <div className="space-y-4">
      {available.length > 1 ? (
        <fieldset>
          <legend className="text-sm font-bold text-navy-950">How often do you want to pay?</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {available.map((option) => {
              const optionAmount = props.prices[option]!
              return (
                <label
                  key={option}
                  className="relative flex min-h-20 cursor-pointer flex-col justify-center rounded-2xl border border-mist-200 bg-white p-4 transition hover:border-teal-300 hover:bg-teal-50/40 has-[:checked]:border-teal-600 has-[:checked]:bg-teal-50 has-[:checked]:ring-1 has-[:checked]:ring-teal-600 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-teal-600"
                >
                  <input
                    type="radio"
                    name={`${fieldId}-interval`}
                    value={option}
                    checked={interval === option}
                    onChange={() => setChosenInterval(option)}
                    className="sr-only"
                  />
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-sm font-bold text-navy-950">{INTERVAL_LABELS[option].adjective}</span>
                    {option === 'year' && props.yearlySavingLabel ? (
                      <span className="rounded-full bg-teal-600 px-2 py-0.5 text-[11px] font-bold text-white">Best value</span>
                    ) : null}
                  </span>
                  <span className="mt-1 text-lg font-bold text-navy-950">
                    {formatRupees(optionAmount)} <span className="text-sm font-semibold text-muted">{INTERVAL_LABELS[option].per}</span>
                  </span>
                  {option === 'year' && props.yearlySavingLabel ? (
                    <span className="mt-0.5 text-xs font-semibold text-teal-800">{props.yearlySavingLabel}</span>
                  ) : null}
                </label>
              )
            })}
          </div>
        </fieldset>
      ) : null}

      {props.blockedMessage ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950">{props.blockedMessage}</p>
      ) : (
        <div className="space-y-2">
          <button type="button" onClick={() => { void begin() }} disabled={busy || amount === null} aria-busy={busy || undefined} className={primaryButton}>
            <Lock aria-hidden="true" className="size-4" />
            {phase === 'starting'
              ? 'Setting up auto-pay…'
              : phase === 'opening'
                ? 'Opening Cashfree…'
                : props.submitLabel ?? `Set up auto-pay${priceText ? ` · ${priceText}` : ''}`}
          </button>
          <p className="text-xs leading-5 text-muted">
            {props.startsOn
              ? `Nothing is charged today. Your ${INTERVAL_LABELS[interval].adjective.toLowerCase()} plan starts on ${props.startsOn}, when your current period ends, and renews automatically.`
              : `You approve a secure auto-pay mandate with UPI AutoPay, a card or your bank account through our payment partner, Cashfree.${amount !== null ? ` ${formatRupees(amount)} is charged every ${INTERVAL_LABELS[interval].noun} until you cancel.` : ''} Cancel auto-renew any time; your plan stays active until the end of the period you paid for.`}
          </p>
          {amount !== null && amount > 1500000 ? (
            <p className="flex items-start gap-2 text-xs leading-5 text-navy-700">
              <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
              Payments above ₹15,000 may need your approval in your UPI app each time. A card or bank account mandate renews without that step.
            </p>
          ) : null}
        </div>
      )}
      {props.onCancel ? (
        <button type="button" onClick={props.onCancel} disabled={busy} className={`${secondaryButton} w-full`}>
          Not now
        </button>
      ) : null}
      <div aria-live="polite">{error ? <p className="text-sm font-medium text-rose-700">{error}</p> : null}</div>
    </div>
  )
}
