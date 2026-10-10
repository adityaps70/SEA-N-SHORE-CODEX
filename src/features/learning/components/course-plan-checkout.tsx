'use client'

import { useId, useState, useTransition } from 'react'
import { CheckCircle2, Loader2, Tag } from 'lucide-react'
import { previewCoursePriceAction, type CoursePriceQuoteResult } from '../course-payment-actions'
import { CourseCheckoutButton } from './course-checkout-button'

/** A plan as the course page shows it; every amount comes from the server. */
export type CoursePlanOffer = {
  /** Null for a course that has not had plans saved yet (it sells its own price). */
  id: string | null
  name: string
  /** What the plan costs now (its sale price when it has one). */
  priceLabel: string
  /** The price before the plan's sale price, shown struck through. */
  listLabel: string | null
  accessLabel: string
  currency: string | null
}

type Props = {
  courseId: string
  courseSlug: string
  courseTitle: string
  plans: CoursePlanOffer[]
  paymentsConfigured: boolean
  blockedMessage?: string
  /** Renewing ended access (the button says Renew). */
  renewal?: boolean
}

type AppliedCode = Extract<CoursePriceQuoteResult, { ok: true }>

/**
 * Round C (C2, C3): choose a plan, optionally apply a promo code, then pay. "Apply" asks the server for the price
 * (the same rules checkout uses); the checkout re-checks the plan and the code when it starts.
 */
export function CoursePlanCheckout({ courseId, courseSlug, courseTitle, plans, paymentsConfigured, blockedMessage, renewal = false }: Props) {
  const [planIndex, setPlanIndex] = useState(0)
  const [codeOpen, setCodeOpen] = useState(false)
  const [codeText, setCodeText] = useState('')
  const [applied, setApplied] = useState<AppliedCode | null>(null)
  const [codeError, setCodeError] = useState<string | null>(null)
  const [checking, startChecking] = useTransition()
  const name = useId()
  const codeId = useId()
  const plan = plans[planIndex] ?? plans[0]!

  function choosePlan(index: number) {
    setPlanIndex(index)
    // A code was priced for one plan; it is applied again for the new one.
    if (applied) applyCode(plans[index]?.id ?? null, applied.codeLabel ?? codeText)
  }

  function applyCode(planId: string | null, text: string) {
    const typed = text.trim()
    setCodeError(null)
    if (!typed) {
      setApplied(null)
      return
    }
    startChecking(async () => {
      const result = await previewCoursePriceAction(courseId, { planId, promoCode: typed })
      if (!result.ok) {
        setApplied(null)
        setCodeError(result.error)
        return
      }
      setApplied(result.codeLabel ? result : null)
    })
  }

  const priceLabel = applied?.totalLabel ?? plan.priceLabel
  const disabled = Boolean(blockedMessage)

  return (
    <div className="space-y-4" id="course-access">
      {plans.length > 1 ? (
        <fieldset className="space-y-2">
          <legend className="text-sm font-bold text-navy-950">{renewal ? 'Choose a plan to renew' : 'Choose a plan'}</legend>
          {plans.map((offer, index) => (
            <label
              key={offer.id ?? offer.name}
              className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition ${
                index === planIndex ? 'border-ocean-600 bg-ocean-50/60 ring-1 ring-ocean-600' : 'border-mist-200 hover:border-mist-300'
              }`}
            >
              <input
                type="radio"
                name={name}
                className="mt-1 size-4 accent-ocean-700"
                checked={index === planIndex}
                onChange={() => choosePlan(index)}
              />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="font-bold text-navy-950">{offer.name}</span>
                  <span className="text-sm font-bold text-navy-950">
                    {offer.listLabel ? <s className="mr-1.5 font-medium text-muted">{offer.listLabel}</s> : null}
                    {offer.priceLabel}
                  </span>
                </span>
                <span className="mt-0.5 block text-xs text-muted">{offer.accessLabel}</span>
              </span>
            </label>
          ))}
        </fieldset>
      ) : (
        <p className="text-sm text-navy-700">
          <span className="font-semibold text-navy-950">{plan.name}</span> · {plan.accessLabel}
        </p>
      )}

      {disabled ? null : codeOpen ? (
        <div>
          <label htmlFor={codeId} className="text-sm font-semibold text-navy-950">Promo code</label>
          <div className="mt-1.5 flex gap-2">
            <input
              id={codeId}
              value={codeText}
              onChange={(event) => {
                setCodeText(event.target.value)
                setCodeError(null)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  applyCode(plan.id, codeText)
                }
              }}
              autoCapitalize="characters"
              autoComplete="off"
              maxLength={32}
              aria-invalid={Boolean(codeError)}
              aria-describedby={codeError ? `${codeId}-error` : undefined}
              className={`min-h-11 min-w-0 flex-1 rounded-xl border bg-white px-3 text-sm uppercase text-navy-950 outline-none focus:ring-2 ${
                codeError ? 'border-red-400 focus:ring-red-100' : 'border-mist-200 focus:border-teal-500 focus:ring-teal-100'
              }`}
            />
            <button
              type="button"
              onClick={() => applyCode(plan.id, codeText)}
              disabled={checking || !codeText.trim()}
              className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl border border-navy-950 px-4 text-sm font-bold text-navy-950 transition hover:bg-navy-950 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {checking ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
              Apply
            </button>
          </div>
          {codeError ? <p id={`${codeId}-error`} role="alert" className="mt-1.5 text-xs font-medium text-red-700">{codeError}</p> : null}
          {applied ? (
            <div className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950" role="status">
              <p className="flex items-center gap-2 font-semibold">
                <CheckCircle2 aria-hidden="true" className="size-4" /> {applied.codeLabel} applied
              </p>
              <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
                <dt>{applied.planName}</dt>
                <dd className="text-right">{applied.saleLabel ?? applied.listLabel}</dd>
                <dt>Code {applied.codeLabel}</dt>
                <dd className="text-right">{applied.discountLabel}</dd>
                <dt className="font-bold">You pay</dt>
                <dd className="text-right font-bold">{applied.totalLabel}</dd>
              </dl>
              <button
                type="button"
                className="mt-2 text-xs font-bold text-emerald-900 underline-offset-2 hover:underline"
                onClick={() => {
                  setApplied(null)
                  setCodeText('')
                }}
              >
                Remove code
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setCodeOpen(true)}
          className="inline-flex items-center gap-1.5 text-sm font-bold text-ocean-700 underline-offset-2 hover:underline"
        >
          <Tag aria-hidden="true" className="size-4" /> Have a promo code?
        </button>
      )}

      <CourseCheckoutButton
        courseId={courseId}
        courseSlug={courseSlug}
        courseTitle={courseTitle}
        priceLabel={priceLabel}
        paymentsConfigured={paymentsConfigured}
        blockedMessage={blockedMessage}
        planId={plan.id}
        promoCode={applied?.codeLabel ?? null}
        actionVerb={renewal ? 'Renew' : 'Buy course'}
      />
    </div>
  )
}
