'use client'

import { useId, useState, type FormEvent } from 'react'
import { primaryButtonClass } from '@/components/ui/interactive-styles'
import { saveLutAction, updateTdsSettingsAction, type TaxAdminResult } from '../admin-actions'

const inputClass = 'min-h-10 w-full rounded-lg border border-mist-200 bg-white px-3 text-sm text-ink shadow-sm placeholder:text-muted focus:border-ocean-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-ocean-500 aria-[invalid=true]:border-red-500'

function Result({ result }: { result: TaxAdminResult | null }) {
  if (!result) return null
  return (
    <p role={result.ok ? 'status' : 'alert'} className={`rounded-lg border px-3 py-2 text-sm font-medium ${result.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-red-200 bg-red-50 text-red-800'}`}>
      {result.ok ? result.message : result.error}
    </p>
  )
}

function useSubmit(action: (data: FormData) => Promise<TaxAdminResult>) {
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState<TaxAdminResult | null>(null)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    const data = new FormData(event.currentTarget)
    setPending(true)
    setResult(null)
    try {
      setResult(await action(data))
    } catch {
      setResult({ ok: false, error: "We couldn't reach Sea N Shore. Nothing was saved. Check your connection and try again." })
    }
    setPending(false)
  }
  return { pending, result, submit }
}

/** Admin: TDS section, rate and yearly threshold for course-seller payouts. */
export function TdsSettingsForm({ section, rate, threshold }: { section: string; rate: string; threshold: string }) {
  const id = useId()
  const { pending, result, submit } = useSubmit((data) => updateTdsSettingsAction({
    section: String(data.get('section') ?? ''),
    rate: String(data.get('rate') ?? ''),
    threshold: String(data.get('threshold') ?? ''),
  }))
  const invalid = (field: string) => Boolean(result && !result.ok && result.field === field)
  return (
    <form onSubmit={(event) => { void submit(event) }} noValidate className="space-y-4 p-5">
      <div className="grid gap-4 md:grid-cols-3">
        <div className="grid content-start gap-1.5">
          <label htmlFor={`${id}-section`} className="text-sm font-semibold text-navy-900">TDS section</label>
          <input id={`${id}-section`} name="section" defaultValue={section} className={`${inputClass} max-w-[10rem] uppercase`} aria-invalid={invalid('section')} autoComplete="off" />
          <p className="text-xs leading-5 text-muted">Default 194J (fees for professional or technical services).</p>
        </div>
        <div className="grid content-start gap-1.5">
          <label htmlFor={`${id}-rate`} className="text-sm font-semibold text-navy-900">TDS rate</label>
          <div className="flex items-center gap-2">
            <input id={`${id}-rate`} name="rate" defaultValue={rate} inputMode="decimal" className={`${inputClass} max-w-[8rem]`} aria-invalid={invalid('rate')} autoComplete="off" placeholder="Not set" />
            <span aria-hidden="true" className="text-sm font-semibold text-muted">%</span>
          </div>
          <p className="text-xs leading-5 text-muted">While empty, no course payout can be sent.</p>
        </div>
        <div className="grid content-start gap-1.5">
          <label htmlFor={`${id}-threshold`} className="text-sm font-semibold text-navy-900">Yearly threshold</label>
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="text-sm font-semibold text-muted">₹</span>
            <input id={`${id}-threshold`} name="threshold" defaultValue={threshold} inputMode="decimal" className={`${inputClass} max-w-[10rem]`} aria-invalid={invalid('threshold')} autoComplete="off" placeholder="Not set" />
          </div>
          <p className="text-xs leading-5 text-muted">Per seller per financial year. Once passed, TDS is deducted on the year&apos;s total (catch-up). Empty means TDS from the first rupee.</p>
        </div>
      </div>
      <Result result={result} />
      <button type="submit" disabled={pending} className={primaryButtonClass}>{pending ? 'Saving…' : 'Save TDS settings'}</button>
    </form>
  )
}

/** Admin: the GST LUT ARN for a financial year (exports of courses to buyers outside India, paid in USD). */
export function LutForm({ financialYear }: { financialYear: string }) {
  const id = useId()
  const { pending, result, submit } = useSubmit((data) => saveLutAction({
    financialYear: String(data.get('financialYear') ?? ''),
    arn: String(data.get('arn') ?? ''),
  }))
  const invalid = (field: string) => Boolean(result && !result.ok && result.field === field)
  return (
    <form onSubmit={(event) => { void submit(event) }} noValidate className="space-y-4 p-5">
      <div className="grid gap-4 md:grid-cols-[10rem_1fr]">
        <div className="grid content-start gap-1.5">
          <label htmlFor={`${id}-year`} className="text-sm font-semibold text-navy-900">Financial year</label>
          <input id={`${id}-year`} name="financialYear" defaultValue={financialYear} className={inputClass} aria-invalid={invalid('financialYear')} autoComplete="off" placeholder="2026-27" />
        </div>
        <div className="grid content-start gap-1.5">
          <label htmlFor={`${id}-arn`} className="text-sm font-semibold text-navy-900">LUT ARN</label>
          <input id={`${id}-arn`} name="arn" className={`${inputClass} uppercase`} aria-invalid={invalid('arn')} autoComplete="off" placeholder="AD2704260012345" />
          <p className="text-xs leading-5 text-muted">From the LUT acknowledgement on the GST portal (form RFD-11). It is printed on every export invoice.</p>
        </div>
      </div>
      <Result result={result} />
      <button type="submit" disabled={pending} className={primaryButtonClass}>{pending ? 'Saving…' : 'Save LUT'}</button>
    </form>
  )
}
