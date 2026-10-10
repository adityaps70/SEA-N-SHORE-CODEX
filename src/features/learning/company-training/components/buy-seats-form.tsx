'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useId, useMemo, useState, useTransition } from 'react'
import { CHECKOUT_TIMEOUT_SECONDS } from '@/features/payments/event-payment-rules'
import { GatewayCheckoutButton } from '@/features/payments/components/gateway-checkout-button'
import { GST_STATES } from '@/features/tax/gst'
import { COURSE_PAYMENTS_NOT_CONFIGURED_HELP, COURSE_PAYMENTS_NOT_CONFIGURED_LABEL } from '../../course-payment-rules'
import { confirmSeatPaymentAction, previewSeatPackAction, startSeatCheckoutAction, type SeatPackPreviewResult } from '../seat-actions'
import { SEAT_PACK_MAX, SEAT_REFUND_DAYS, SEAT_VALIDITY_MONTHS } from '../seat-rules'

export type BuyableCourseOption = {
  id: string
  title: string
  plans: Array<{ id: string | null; name: string; priceLabel: string; accessLabel: string }>
}

const fieldClass = 'mt-1.5 min-h-11 w-full rounded-xl border border-mist-200 bg-white px-3 text-sm text-navy-950 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100'

/**
 * D3: buy a pack of seats of one course. The total (with the volume discount) is worked out on the server as the
 * buyer types; checkout re-checks everything. The business GST details are required for the B2B invoice.
 */
export function BuySeatsForm({ companyId, companyName, courses, paymentsConfigured, disabledMessage }: {
  companyId: string
  companyName: string
  courses: BuyableCourseOption[]
  paymentsConfigured: boolean
  disabledMessage?: string | null
}) {
  const id = useId()
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [courseId, setCourseId] = useState(courses[0]?.id ?? '')
  const course = useMemo(() => courses.find((option) => option.id === courseId) ?? null, [courses, courseId])
  const [planId, setPlanId] = useState<string | null>(courses[0]?.plans[0]?.id ?? null)
  const [quantity, setQuantity] = useState('10')
  const [stateCode, setStateCode] = useState('')
  const [company, setCompany] = useState(companyName)
  const [gstin, setGstin] = useState('')
  const [preview, setPreview] = useState<SeatPackPreviewResult | null>(null)
  const seats = Number.parseInt(quantity, 10)

  useEffect(() => {
    if (!courseId || !Number.isInteger(seats) || seats < 1) return
    let live = true
    const timer = setTimeout(() => {
      previewSeatPackAction(companyId, { courseId, planId, quantity: seats }).then((result) => {
        if (live) setPreview(result)
      }, () => undefined)
    }, 300)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [companyId, courseId, planId, seats])

  if (!courses.length) {
    return <p className="text-sm leading-6 text-muted">No paid courses are on sale in rupees right now. Seat packs appear here once one is.</p>
  }

  const validate = () => {
    if (!Number.isInteger(seats) || seats < 1 || seats > SEAT_PACK_MAX) return `Choose between 1 and ${SEAT_PACK_MAX} seats.`
    if (!stateCode) return 'Choose the state of the company’s GST registration.'
    if (company.trim().length < 2 || !gstin.trim()) return 'Enter the company name and GSTIN for the business invoice.'
    return null
  }
  const shownPreview = Number.isInteger(seats) && seats >= 1 ? preview : null

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-semibold text-navy-950" htmlFor={`${id}-course`}>
          Course
          <select
            id={`${id}-course`}
            className={fieldClass}
            value={courseId}
            onChange={(event) => {
              const next = courses.find((option) => option.id === event.target.value)
              setCourseId(event.target.value)
              setPlanId(next?.plans[0]?.id ?? null)
            }}
          >
            {courses.map((option) => <option key={option.id} value={option.id}>{option.title}</option>)}
          </select>
        </label>
        {course && course.plans.length > 1 ? (
          <label className="block text-sm font-semibold text-navy-950" htmlFor={`${id}-plan`}>
            Plan for each learner
            <select id={`${id}-plan`} className={fieldClass} value={planId ?? ''} onChange={(event) => setPlanId(event.target.value || null)}>
              {course.plans.map((plan) => <option key={plan.id ?? 'default'} value={plan.id ?? ''}>{plan.name} · {plan.priceLabel} · {plan.accessLabel}</option>)}
            </select>
          </label>
        ) : course?.plans[0] ? (
          <div className="text-sm">
            <p className="font-semibold text-navy-950">Plan for each learner</p>
            <p className="mt-2.5 text-muted">{course.plans[0].name} · {course.plans[0].priceLabel} per seat · {course.plans[0].accessLabel}</p>
          </div>
        ) : null}
        <label className="block text-sm font-semibold text-navy-950" htmlFor={`${id}-quantity`}>
          Seats
          <input
            id={`${id}-quantity`}
            className={fieldClass}
            type="number"
            inputMode="numeric"
            min={1}
            max={SEAT_PACK_MAX}
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
          />
          <span className="mt-1 block text-xs font-normal text-muted">10+ seats: 10% off · 50+ seats: 20% off</span>
        </label>
      </div>

      <fieldset className="grid gap-3 rounded-xl border border-mist-200 p-3 sm:grid-cols-3">
        <legend className="px-1 text-sm font-bold text-navy-950">Business GST invoice</legend>
        <label className="block text-sm font-semibold text-navy-950" htmlFor={`${id}-state`}>
          GST state
          <select id={`${id}-state`} className={fieldClass} value={stateCode} onChange={(event) => setStateCode(event.target.value)}>
            <option value="">Choose the state</option>
            {GST_STATES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
          </select>
        </label>
        <label className="block text-sm font-semibold text-navy-950" htmlFor={`${id}-company`}>
          Company name
          <input id={`${id}-company`} className={fieldClass} value={company} maxLength={120} autoComplete="organization" onChange={(event) => setCompany(event.target.value)} />
        </label>
        <label className="block text-sm font-semibold text-navy-950" htmlFor={`${id}-gstin`}>
          GSTIN
          <input id={`${id}-gstin`} className={`${fieldClass} uppercase`} value={gstin} maxLength={15} autoCapitalize="characters" autoComplete="off" placeholder="27ABCDE1234F1Z5" onChange={(event) => setGstin(event.target.value)} />
        </label>
      </fieldset>

      <div aria-live="polite" className="rounded-xl bg-mist-50 p-4 text-sm">
        {shownPreview?.ok ? (
          <>
            <p className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-muted">{shownPreview.quantity} {shownPreview.quantity === 1 ? 'seat' : 'seats'} × {shownPreview.unitLabel}{shownPreview.discountLabel ? ` (${shownPreview.baseUnitLabel} less ${shownPreview.discountLabel})` : ''}</span>
              <span className="text-lg font-bold text-navy-950">{shownPreview.totalLabel}</span>
            </p>
            <p className="mt-1 text-xs text-muted">Including GST. Each learner gets the {shownPreview.planName} plan ({shownPreview.accessLabel}) from the day you assign their seat.</p>
          </>
        ) : shownPreview && !shownPreview.ok ? (
          <p role="alert" className="text-sm font-medium text-red-700">{shownPreview.error}</p>
        ) : (
          <p className="text-muted">Choose a course and the number of seats to see the price.</p>
        )}
      </div>

      <GatewayCheckoutButton
        actionLabel={shownPreview?.ok ? `Buy ${shownPreview.quantity} ${shownPreview.quantity === 1 ? 'seat' : 'seats'} — ${shownPreview.totalLabel}` : 'Buy seats'}
        description={course ? `Seats · ${course.title}` : 'Seats'}
        hint={`Seats can be assigned for ${SEAT_VALIDITY_MONTHS} months. Unassigned seats can be refunded within ${SEAT_REFUND_DAYS} days.`}
        configured={paymentsConfigured}
        notConfiguredLabel={COURSE_PAYMENTS_NOT_CONFIGURED_LABEL}
        notConfiguredHelp={COURSE_PAYMENTS_NOT_CONFIGURED_HELP}
        disabled={Boolean(disabledMessage) || !(shownPreview?.ok)}
        unavailableLabel={disabledMessage ? 'Not available yet' : undefined}
        unavailableHelp={disabledMessage ?? undefined}
        successFallback="Payment received. Your seats are ready to assign."
        timeoutSeconds={CHECKOUT_TIMEOUT_SECONDS}
        start={async ({ phone }) => {
          const problem = validate()
          if (problem) return { ok: false, error: problem }
          return startSeatCheckoutAction(companyId, {
            courseId,
            planId,
            quantity: seats,
            billing: { stateCode, company: company.trim(), gstin: gstin.trim() },
            ...(phone ? { phone } : {}),
          })
        }}
        confirm={({ orderId, proof }) => confirmSeatPaymentAction({ companyId, orderId, proof })}
        onSettled={() => startTransition(() => router.refresh())}
      />
    </div>
  )
}
