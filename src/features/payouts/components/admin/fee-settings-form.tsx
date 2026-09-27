'use client'

import { useRouter } from 'next/navigation'
import { useId, useState, useTransition, type FormEvent } from 'react'
import { primaryButtonClass } from '@/components/ui/interactive-styles'
import { updateFeeSettingsAction } from '../../admin-actions'

export const adminInputClass = 'min-h-10 w-full rounded-lg border border-mist-200 bg-white px-3 text-sm text-ink shadow-sm placeholder:text-muted focus:border-ocean-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-ocean-500 aria-[invalid=true]:border-red-500'

type Props = { defaultPercent: string; holdDays: number; minPayout: string }

/** Admin: platform default fee, hold period and minimum payout. */
export function FeeSettingsForm({ defaultPercent, holdDays, minPayout }: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const id = useId()

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    const data = new FormData(event.currentTarget)
    setPending(true)
    setResult(null)
    setFieldErrors({})
    let outcome: Awaited<ReturnType<typeof updateFeeSettingsAction>>
    try {
      outcome = await updateFeeSettingsAction({
        defaultPercent: String(data.get('defaultPercent') ?? ''),
        holdDays: String(data.get('holdDays') ?? ''),
        minPayout: String(data.get('minPayout') ?? ''),
      })
    } catch {
      outcome = { ok: false, error: "We couldn't reach Sea N Shore. Nothing was saved. Check your connection and try again." }
    }
    setPending(false)
    if (outcome.ok) {
      setResult({ ok: true, message: outcome.message })
      startTransition(() => router.refresh())
    } else {
      setResult({ ok: false, message: outcome.error })
      setFieldErrors(outcome.fieldErrors ?? {})
    }
  }

  const fields = [
    { name: 'defaultPercent', label: 'Default platform fee', suffix: '%', value: defaultPercent, hint: 'Kept by Sea N Shore on every sale, unless a seller has their own rate below.', inputMode: 'decimal' as const },
    { name: 'holdDays', label: 'Hold period', suffix: 'days', value: String(holdDays), hint: 'Days after the event ends (or the course is bought) before a sale can be paid out.', inputMode: 'numeric' as const },
    { name: 'minPayout', label: 'Minimum payout', prefix: '₹', value: minPayout, hint: 'Balances below this wait until they grow.', inputMode: 'decimal' as const },
  ]

  return (
    <form onSubmit={(event) => { void submit(event) }} noValidate className="space-y-4 p-5">
      <div className="grid gap-4 md:grid-cols-3">
        {fields.map((field) => (
          <div key={field.name} className="grid content-start gap-1.5">
            <label htmlFor={`${id}-${field.name}`} className="text-sm font-semibold text-navy-900">{field.label}</label>
            <div className="flex items-center gap-2">
              {field.prefix ? <span aria-hidden="true" className="text-sm font-semibold text-muted">{field.prefix}</span> : null}
              <input
                id={`${id}-${field.name}`}
                name={field.name}
                defaultValue={field.value}
                inputMode={field.inputMode}
                autoComplete="off"
                aria-invalid={Boolean(fieldErrors[field.name])}
                aria-describedby={`${id}-${field.name}-hint`}
                className={`${adminInputClass} max-w-[10rem]`}
              />
              {field.suffix ? <span aria-hidden="true" className="text-sm font-semibold text-muted">{field.suffix}</span> : null}
            </div>
            <p id={`${id}-${field.name}-hint`} className={`text-xs leading-5 ${fieldErrors[field.name] ? 'font-medium text-red-700' : 'text-muted'}`}>
              {fieldErrors[field.name] ?? field.hint}
            </p>
          </div>
        ))}
      </div>
      <p className="text-xs leading-5 text-muted">Changes apply to new sales only. Past sales keep the fee and hold period they were sold with.</p>
      {result ? (
        <p role={result.ok ? 'status' : 'alert'} className={`rounded-lg border px-3 py-2 text-sm font-medium ${result.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-red-200 bg-red-50 text-red-800'}`}>
          {result.message}
        </p>
      ) : null}
      <button type="submit" disabled={pending} aria-busy={pending || undefined} className={primaryButtonClass}>
        {pending ? 'Saving…' : 'Save fee settings'}
      </button>
    </form>
  )
}
