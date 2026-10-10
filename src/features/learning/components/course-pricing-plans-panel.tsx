'use client'

import { useState, useTransition } from 'react'
import { CheckCircle2, Layers, Loader2, Plus, Save, Trash2 } from 'lucide-react'
import { formatMoney, minorToPriceInput, parsePriceToMinor } from '@/features/payments/currency'
import { PAYMENT_CURRENCIES, type PaymentCurrency } from '@/features/payments/types'
import { saveCoursePlans } from '../course-plan-actions'
import { ACCESS_PERIODS, accessPeriodLabel, COURSE_PLAN_LIMITS, type AccessMonths, type CoursePlan } from '../course-plans'

const fieldClass = 'mt-1.5 min-h-11 w-full rounded-xl border border-mist-200 bg-white px-3.5 py-2.5 text-sm text-navy-950 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100 disabled:bg-mist-50'

type Row = {
  id: string | null
  name: string
  price: string
  sale: string
  currency: PaymentCurrency
  accessMonths: AccessMonths
}

function toRow(plan: CoursePlan): Row {
  return {
    id: plan.id,
    name: plan.name,
    price: minorToPriceInput(plan.priceMinor, plan.currency),
    sale: minorToPriceInput(plan.discountPriceMinor, plan.currency),
    currency: plan.currency,
    accessMonths: plan.accessMonths,
  }
}

/**
 * Round C (C3): a paid course's pricing plans in Learning Studio. The first plan sells the price set in the course
 * details above (the trainer names it and chooses its access period here); up to three more plans have their own
 * price, sale price, currency and access period. Saved on the draft, so live changes go through review.
 */
export function CoursePricingPlansPanel({
  courseId,
  paid,
  plans,
  readOnly = false,
}: {
  courseId: string
  paid: boolean
  plans: CoursePlan[]
  readOnly?: boolean
}) {
  const [rows, setRows] = useState<Row[]>(() => plans.map(toRow))
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  const [pending, startTransition] = useTransition()

  if (!paid || !rows.length) {
    return (
      <section aria-labelledby="pricing-plans-heading" className="rounded-[1.75rem] border border-mist-100 bg-white p-6 shadow-[var(--shadow-card)] sm:p-8">
        <h2 id="pricing-plans-heading" className="flex items-center gap-2 text-lg font-bold text-navy-950">
          <Layers aria-hidden="true" className="size-5 text-teal-700" /> Pricing plans
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted">
          A paid course can sell more than one plan, for example lifetime access and a 6-month plan. Set the course to paid with a price and save the course details to add plans.
        </p>
      </section>
    )
  }

  const update = (index: number, patch: Partial<Row>) => setRows((current) => current.map((row, at) => (at === index ? { ...row, ...patch } : row)))

  function save() {
    setMessage(null)
    const payload = rows.map((row) => ({
      id: row.id,
      name: row.name,
      priceMinor: parsePriceToMinor(row.price, row.currency) ?? Number.NaN,
      discountPriceMinor: row.sale.trim() ? parsePriceToMinor(row.sale, row.currency) ?? Number.NaN : null,
      currency: row.currency,
      accessMonths: row.accessMonths,
    }))
    const invalid = payload.findIndex((plan) => !Number.isSafeInteger(plan.priceMinor) || (plan.discountPriceMinor !== null && !Number.isSafeInteger(plan.discountPriceMinor)))
    if (invalid >= 0) {
      setMessage({ tone: 'error', text: `Plan ${invalid + 1}: enter prices as numbers, for example 4999 or 4999.50.` })
      return
    }
    startTransition(async () => {
      const result = await saveCoursePlans(courseId, payload)
      if (!result.ok) {
        setMessage({ tone: 'error', text: result.error })
        return
      }
      setRows(result.plans.map(toRow))
      setMessage({ tone: 'success', text: 'Plans saved. Changes to a published course go live when the review is approved.' })
    })
  }

  return (
    <section aria-labelledby="pricing-plans-heading" className="rounded-[1.75rem] border border-mist-100 bg-white p-6 shadow-[var(--shadow-card)] sm:p-8">
      <h2 id="pricing-plans-heading" className="flex items-center gap-2 text-lg font-bold text-navy-950">
        <Layers aria-hidden="true" className="size-5 text-teal-700" /> Pricing plans
      </h2>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
        Learners choose a plan when they buy. When time-limited access ends the course becomes read-only until they renew; their progress and certificate are kept.
      </p>

      <ol className="mt-5 space-y-4">
        {rows.map((row, index) => (
          <li key={row.id ?? `new-${index}`} className="rounded-2xl border border-mist-200 p-4">
            <div className="flex items-start justify-between gap-3">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">{index === 0 ? 'Main plan' : `Plan ${index + 1}`}</p>
              {index > 0 && !readOnly ? (
                <button
                  type="button"
                  onClick={() => setRows((current) => current.filter((_, at) => at !== index))}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-xs font-bold text-rose-700 hover:bg-rose-50"
                >
                  <Trash2 aria-hidden="true" className="size-4" /> Remove
                </button>
              ) : null}
            </div>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <label className="text-sm font-semibold text-navy-950">Plan name
                <input className={fieldClass} value={row.name} maxLength={COURSE_PLAN_LIMITS.name} disabled={readOnly} onChange={(event) => update(index, { name: event.target.value })} />
              </label>
              <label className="text-sm font-semibold text-navy-950">Access
                <select
                  className={fieldClass}
                  value={row.accessMonths === null ? 'lifetime' : String(row.accessMonths)}
                  disabled={readOnly}
                  onChange={(event) => update(index, { accessMonths: event.target.value === 'lifetime' ? null : (Number(event.target.value) as AccessMonths) })}
                >
                  {ACCESS_PERIODS.map((months) => (
                    <option key={months ?? 'lifetime'} value={months === null ? 'lifetime' : String(months)}>{accessPeriodLabel(months)}</option>
                  ))}
                </select>
              </label>
              {index === 0 ? (
                <p className="text-sm leading-6 text-navy-700 sm:col-span-2">
                  Price: <span className="font-bold text-navy-950">{formatMoney(plans[0]?.discountPriceMinor ?? plans[0]?.priceMinor ?? 0, row.currency)}</span>
                  {plans[0]?.discountPriceMinor ? <s className="ml-1.5 text-muted">{formatMoney(plans[0].priceMinor, row.currency)}</s> : null}
                  <span className="block text-xs text-muted">Set the main price in the course details above.</span>
                </p>
              ) : (
                <>
                  <label className="text-sm font-semibold text-navy-950">Price
                    <input className={fieldClass} inputMode="decimal" value={row.price} disabled={readOnly} onChange={(event) => update(index, { price: event.target.value })} placeholder="4999" />
                  </label>
                  <label className="text-sm font-semibold text-navy-950">Sale price <span className="font-normal text-muted">(optional)</span>
                    <input className={fieldClass} inputMode="decimal" value={row.sale} disabled={readOnly} onChange={(event) => update(index, { sale: event.target.value })} placeholder="3999" />
                  </label>
                  <label className="text-sm font-semibold text-navy-950">Currency
                    <select className={fieldClass} value={row.currency} disabled={readOnly} onChange={(event) => update(index, { currency: event.target.value as PaymentCurrency })}>
                      {PAYMENT_CURRENCIES.map((currency) => <option key={currency} value={currency}>{currency}</option>)}
                    </select>
                  </label>
                </>
              )}
            </div>
          </li>
        ))}
      </ol>

      {readOnly ? null : (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {rows.length < COURSE_PLAN_LIMITS.plans ? (
            <button
              type="button"
              onClick={() => setRows((current) => [...current, { id: null, name: '', price: '', sale: '', currency: current[0]?.currency ?? 'INR', accessMonths: 6 }])}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-mist-200 px-4 text-sm font-bold text-navy-950 hover:bg-mist-50"
            >
              <Plus aria-hidden="true" className="size-4" /> Add a plan
            </button>
          ) : null}
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-navy-950 px-5 text-sm font-bold text-white hover:bg-navy-900 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : <Save aria-hidden="true" className="size-4" />}
            Save plans
          </button>
        </div>
      )}
      {message ? (
        <p role={message.tone === 'error' ? 'alert' : 'status'} className={`mt-3 flex items-start gap-2 text-sm ${message.tone === 'error' ? 'text-rose-700' : 'text-emerald-800'}`}>
          {message.tone === 'success' ? <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0" /> : null}
          {message.text}
        </p>
      ) : null}
    </section>
  )
}
