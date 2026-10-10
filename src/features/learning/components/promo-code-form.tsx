'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Loader2, Plus } from 'lucide-react'
import { parsePriceToMinor } from '@/features/payments/currency'
import type { PaymentCurrency } from '@/features/payments/types'
import type { PlainFieldErrors } from '@/lib/validation/plain-messages'
import { createPromoCode } from '../promo-code-actions'

const fieldClass = (invalid: boolean) =>
  `mt-1.5 min-h-11 w-full rounded-xl border bg-white px-3.5 py-2.5 text-sm text-navy-950 outline-none focus:ring-2 ${
    invalid ? 'border-red-400 focus:ring-red-100' : 'border-mist-200 focus:border-teal-500 focus:ring-teal-100'
  }`

type Form = {
  code: string
  courseId: string
  discountType: 'percent' | 'fixed'
  percentOff: string
  amountOff: string
  currency: PaymentCurrency
  maxDiscount: string
  usageLimit: string
  perMemberLimit: string
  validFrom: string
  validUntil: string
}

const EMPTY: Form = {
  code: '', courseId: '', discountType: 'percent', percentOff: '20', amountOff: '', currency: 'INR', maxDiscount: '',
  usageLimit: '', perMemberLimit: '1', validFrom: '', validUntil: '',
}

/** "2026-11-01" (a date input) -> the start of that day in India, as an ISO time. */
function startOfDayIst(value: string) {
  return value ? new Date(`${value}T00:00:00+05:30`).toISOString() : null
}

function endOfDayIst(value: string) {
  return value ? new Date(`${value}T23:59:59+05:30`).toISOString() : null
}

function wholeNumber(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return null
  return /^\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN
}

/** Round C (C2): create a promo code for one course, or for all of a trainer's own courses. */
export function PromoCodeForm({ courses, canCodeAllCourses }: { courses: Array<{ id: string; title: string }>; canCodeAllCourses: boolean }) {
  const router = useRouter()
  const [form, setForm] = useState<Form>({ ...EMPTY, courseId: canCodeAllCourses ? '' : courses[0]?.id ?? '' })
  const [errors, setErrors] = useState<PlainFieldErrors>({})
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  const [pending, startTransition] = useTransition()
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((current) => ({ ...current, [key]: value }))
  const error = (name: string) => errors[name]?.[0]

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage(null)
    setErrors({})
    const amountOffMinor = form.discountType === 'fixed' ? parsePriceToMinor(form.amountOff, form.currency) : null
    const maxDiscountMinor = form.maxDiscount.trim() ? parsePriceToMinor(form.maxDiscount, form.currency) : null
    startTransition(async () => {
      const result = await createPromoCode({
        code: form.code,
        courseId: form.courseId || null,
        discountType: form.discountType,
        percentOff: form.discountType === 'percent' ? form.percentOff.trim() || null : null,
        amountOffMinor: amountOffMinor === null ? null : Number.isFinite(amountOffMinor) ? amountOffMinor : -1,
        currency: form.discountType === 'fixed' || maxDiscountMinor !== null ? form.currency : null,
        maxDiscountMinor: maxDiscountMinor === null ? null : Number.isFinite(maxDiscountMinor) ? maxDiscountMinor : -1,
        usageLimit: wholeNumber(form.usageLimit),
        perMemberLimit: wholeNumber(form.perMemberLimit),
        validFrom: startOfDayIst(form.validFrom),
        validUntil: endOfDayIst(form.validUntil),
      })
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {})
        setMessage({ tone: 'error', text: result.error })
        return
      }
      setForm({ ...EMPTY, courseId: form.courseId })
      setMessage({ tone: 'success', text: 'Code created. Buyers can enter it at checkout.' })
      router.refresh()
    })
  }

  return (
    <form onSubmit={submit} noValidate className="rounded-[1.75rem] border border-mist-100 bg-white p-6 shadow-[var(--shadow-card)] sm:p-8">
      <h2 className="text-lg font-bold text-navy-950">New promo code</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-semibold text-navy-950">Code
          <input className={`${fieldClass(Boolean(error('code')))} uppercase`} value={form.code} onChange={(event) => set('code', event.target.value)} placeholder="SIRE20" maxLength={32} aria-invalid={Boolean(error('code'))} autoCapitalize="characters" />
          {error('code') ? <span className="mt-1 block text-xs font-medium text-red-700">{error('code')}</span> : null}
        </label>
        <label className="text-sm font-semibold text-navy-950">Course
          <select className={fieldClass(Boolean(error('courseId')))} value={form.courseId} onChange={(event) => set('courseId', event.target.value)}>
            {canCodeAllCourses ? <option value="">All my courses</option> : null}
            {courses.map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}
          </select>
          {error('courseId') ? <span className="mt-1 block text-xs font-medium text-red-700">{error('courseId')}</span> : null}
        </label>
        <fieldset className="text-sm font-semibold text-navy-950 sm:col-span-2">
          <legend>Discount</legend>
          <div className="mt-1.5 flex flex-wrap gap-4 font-normal">
            {(['percent', 'fixed'] as const).map((type) => (
              <label key={type} className="inline-flex items-center gap-2">
                <input type="radio" name="discountType" className="size-4 accent-ocean-700" checked={form.discountType === type} onChange={() => set('discountType', type)} />
                {type === 'percent' ? 'Percentage' : 'Fixed amount'}
              </label>
            ))}
          </div>
        </fieldset>
        {form.discountType === 'percent' ? (
          <label className="text-sm font-semibold text-navy-950">Percentage off
            <input className={fieldClass(Boolean(error('percentOff')))} inputMode="decimal" value={form.percentOff} onChange={(event) => set('percentOff', event.target.value)} placeholder="20" />
            {error('percentOff') ? <span className="mt-1 block text-xs font-medium text-red-700">{error('percentOff')}</span> : null}
          </label>
        ) : (
          <label className="text-sm font-semibold text-navy-950">Amount off
            <input className={fieldClass(Boolean(error('amountOffMinor')))} inputMode="decimal" value={form.amountOff} onChange={(event) => set('amountOff', event.target.value)} placeholder="500" />
            {error('amountOffMinor') ? <span className="mt-1 block text-xs font-medium text-red-700">{error('amountOffMinor')}</span> : null}
          </label>
        )}
        <label className="text-sm font-semibold text-navy-950">Currency <span className="font-normal text-muted">(for amounts)</span>
          <select className={fieldClass(Boolean(error('currency')))} value={form.currency} onChange={(event) => set('currency', event.target.value as PaymentCurrency)}>
            <option value="INR">INR</option>
            <option value="USD">USD</option>
          </select>
          {error('currency') ? <span className="mt-1 block text-xs font-medium text-red-700">{error('currency')}</span> : null}
        </label>
        <label className="text-sm font-semibold text-navy-950">Maximum discount <span className="font-normal text-muted">(optional)</span>
          <input className={fieldClass(Boolean(error('maxDiscountMinor')))} inputMode="decimal" value={form.maxDiscount} onChange={(event) => set('maxDiscount', event.target.value)} placeholder="1000" />
          {error('maxDiscountMinor') ? <span className="mt-1 block text-xs font-medium text-red-700">{error('maxDiscountMinor')}</span> : null}
        </label>
        <label className="text-sm font-semibold text-navy-950">Total uses <span className="font-normal text-muted">(empty = no limit)</span>
          <input className={fieldClass(Boolean(error('usageLimit')))} inputMode="numeric" value={form.usageLimit} onChange={(event) => set('usageLimit', event.target.value)} placeholder="100" />
          {error('usageLimit') ? <span className="mt-1 block text-xs font-medium text-red-700">{error('usageLimit')}</span> : null}
        </label>
        <label className="text-sm font-semibold text-navy-950">Uses per member <span className="font-normal text-muted">(empty = no limit)</span>
          <input className={fieldClass(Boolean(error('perMemberLimit')))} inputMode="numeric" value={form.perMemberLimit} onChange={(event) => set('perMemberLimit', event.target.value)} />
          {error('perMemberLimit') ? <span className="mt-1 block text-xs font-medium text-red-700">{error('perMemberLimit')}</span> : null}
        </label>
        <label className="text-sm font-semibold text-navy-950">Valid from <span className="font-normal text-muted">(optional)</span>
          <input type="date" className={fieldClass(Boolean(error('validFrom')))} value={form.validFrom} onChange={(event) => set('validFrom', event.target.value)} />
          {error('validFrom') ? <span className="mt-1 block text-xs font-medium text-red-700">{error('validFrom')}</span> : null}
        </label>
        <label className="text-sm font-semibold text-navy-950">Valid until <span className="font-normal text-muted">(optional)</span>
          <input type="date" className={fieldClass(Boolean(error('validUntil')))} value={form.validUntil} onChange={(event) => set('validUntil', event.target.value)} />
          {error('validUntil') ? <span className="mt-1 block text-xs font-medium text-red-700">{error('validUntil')}</span> : null}
        </label>
      </div>
      <p className="mt-4 text-xs leading-5 text-muted">
        A code applies to the current price (the sale price when one is set) and never brings it below ₹1 or $1. Sea N Shore&apos;s fee is charged on what the buyer actually pays.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-navy-950 px-5 text-sm font-bold text-white hover:bg-navy-900 disabled:cursor-not-allowed disabled:opacity-60">
          {pending ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : <Plus aria-hidden="true" className="size-4" />}
          Create code
        </button>
        {message ? <p role={message.tone === 'error' ? 'alert' : 'status'} className={`text-sm ${message.tone === 'error' ? 'text-rose-700' : 'text-emerald-800'}`}>{message.text}</p> : null}
      </div>
    </form>
  )
}
