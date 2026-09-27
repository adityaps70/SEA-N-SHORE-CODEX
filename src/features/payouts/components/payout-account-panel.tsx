'use client'

import { Building2, Landmark, LockKeyhole, Smartphone, UserRound } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useId, useRef, useState, useTransition, type FormEvent } from 'react'
import { primaryButtonClass, secondaryButtonClass } from '@/components/ui/interactive-styles'
import { removePayoutAccountAction, savePayoutAccountAction } from '../actions'
import type { PayoutAccountFieldErrors, PayoutMethod } from '../payout-rules'

export type PayoutAccountView = {
  method: PayoutMethod
  summary: string
  holderName: string
  savedAt: string
  verified: boolean
}

type Props = {
  sellerKey: string
  /** "You" or the organization name. */
  sellerName: string
  kind: 'profile' | 'organization'
  account: PayoutAccountView | null
  /** Set when a payout is on its way: details cannot change until it completes. */
  lockedReason?: string | null
}

const inputClass = 'min-h-11 w-full rounded-xl border border-mist-200 bg-white px-3.5 text-base text-ink shadow-sm placeholder:text-muted focus:border-ocean-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-ocean-500 aria-[invalid=true]:border-red-500'
const dangerButtonClass = 'inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-xl bg-rose-700 px-4 text-sm font-semibold text-white transition-colors hover:bg-rose-800 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ocean-500 focus-visible:ring-offset-2'

function dateLabel(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(date)
}

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? <p id={id} className="text-sm font-medium text-red-700">{message}</p> : null
}

/**
 * A seller's payout details: the masked account on file, and an inline form to add,
 * replace or remove it. The full account number is only ever sent to the server action,
 * which passes it to Cashfree; the page never shows it again.
 */
export function PayoutAccountPanel({ sellerKey, sellerName, kind, account, lockedReason = null }: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [mode, setMode] = useState<'view' | 'edit' | 'remove'>('view')
  const [method, setMethod] = useState<PayoutMethod>(account?.method ?? 'bank')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<PayoutAccountFieldErrors>({})
  const [notice, setNotice] = useState<string | null>(null)
  const openRef = useRef<HTMLButtonElement>(null)
  const firstFieldRef = useRef<HTMLInputElement>(null)
  const confirmRemoveRef = useRef<HTMLButtonElement>(null)
  const returnFocus = useRef(false)
  const id = useId()
  const titleId = `${id}-title`

  useEffect(() => {
    if (mode === 'edit') firstFieldRef.current?.focus()
    if (mode === 'remove') confirmRemoveRef.current?.focus()
    if (mode === 'view' && returnFocus.current) {
      returnFocus.current = false
      openRef.current?.focus()
    }
  }, [mode])

  function close() {
    if (pending) return
    setMode('view')
    setError(null)
    setFieldErrors({})
    returnFocus.current = true
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    const data = new FormData(event.currentTarget)
    setPending(true)
    setError(null)
    setFieldErrors({})
    setNotice(null)
    let result: Awaited<ReturnType<typeof savePayoutAccountAction>>
    try {
      result = await savePayoutAccountAction(sellerKey, {
        method,
        holderName: String(data.get('holderName') ?? ''),
        accountNumber: String(data.get('accountNumber') ?? ''),
        confirmAccountNumber: String(data.get('confirmAccountNumber') ?? ''),
        ifsc: String(data.get('ifsc') ?? ''),
        vpa: String(data.get('vpa') ?? ''),
      })
    } catch {
      result = { ok: false, error: "We couldn't reach Sea N Shore. Nothing was saved. Check your connection and try again." }
    }
    setPending(false)
    if (result.ok) {
      setMode('view')
      setNotice(result.message)
      startTransition(() => router.refresh())
      return
    }
    setError(result.error)
    setFieldErrors(result.fieldErrors ?? {})
  }

  async function remove() {
    if (pending) return
    setPending(true)
    setError(null)
    let result: Awaited<ReturnType<typeof removePayoutAccountAction>>
    try {
      result = await removePayoutAccountAction(sellerKey)
    } catch {
      result = { ok: false, error: "We couldn't reach Sea N Shore. Nothing was removed. Check your connection and try again." }
    }
    setPending(false)
    if (result.ok) {
      setMode('view')
      setNotice(result.message)
      startTransition(() => router.refresh())
      return
    }
    setError(result.error)
  }

  const Icon = kind === 'organization' ? Building2 : UserRound
  const describedBy = (field: keyof PayoutAccountFieldErrors) => (fieldErrors[field] ? `${id}-${field}-error` : undefined)

  return (
    <section aria-labelledby={titleId} className="rounded-2xl border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
      <div className="flex gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-ocean-50 text-ocean-700">
          <Icon aria-hidden="true" className="size-5" />
        </span>
        <div className="min-w-0">
          <h2 id={titleId} className="break-words text-lg font-semibold text-navy-950">
            {kind === 'organization' ? sellerName : 'Your payout details'}
          </h2>
          <p className="mt-1 text-sm leading-6 text-muted">
            {kind === 'organization'
              ? 'Where Sea N Shore pays this organization’s share of ticket and course sales.'
              : 'Where Sea N Shore pays your share of the tickets and courses you sell yourself.'}
          </p>
        </div>
      </div>

      {notice ? <p role="status" className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-sm font-medium text-emerald-900">{notice}</p> : null}

      {account ? (
        <div className="mt-4 rounded-xl border border-mist-200 bg-mist-50/60 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 gap-3">
              {account.method === 'upi'
                ? <Smartphone aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-ocean-700" />
                : <Landmark aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-ocean-700" />}
              <div className="min-w-0">
                <p className="break-words font-semibold text-navy-950">{account.summary}</p>
                <p className="mt-0.5 break-words text-sm text-muted">In the name of {account.holderName} · added {dateLabel(account.savedAt)}</p>
              </div>
            </div>
            <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold ${account.verified ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-mist-200 bg-white text-navy-900'}`}>
              {account.verified ? 'Verified by the bank' : 'Saved with Cashfree'}
            </span>
          </div>
        </div>
      ) : mode !== 'edit' ? (
        <p className="mt-4 rounded-xl border border-dashed border-mist-200 bg-mist-50/50 p-4 text-sm leading-6 text-navy-800">
          No payout details yet. Add a bank account or UPI ID so your earnings can be paid out once they are ready.
        </p>
      ) : null}

      {lockedReason ? <p className="mt-4 text-sm leading-6 text-amber-900">{lockedReason}</p> : null}

      {mode === 'view' && !lockedReason ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            ref={openRef}
            type="button"
            onClick={() => { setNotice(null); setError(null); setMode('edit') }}
            className={account ? secondaryButtonClass : primaryButtonClass}
          >
            {account ? 'Replace details' : 'Add payout details'}
          </button>
          {account ? (
            <button type="button" onClick={() => { setNotice(null); setError(null); setMode('remove') }} className={`${secondaryButtonClass} hover:border-rose-300 hover:bg-rose-50 hover:text-rose-800`}>
              Remove
            </button>
          ) : null}
        </div>
      ) : null}

      {mode === 'remove' ? (
        <div
          role="group"
          aria-labelledby={`${id}-remove-title`}
          onKeyDown={(event) => { if (event.key === 'Escape') close() }}
          className="mt-4 space-y-3 rounded-xl border border-rose-200 bg-rose-50/60 p-4"
        >
          <p id={`${id}-remove-title`} className="font-semibold text-navy-950">Remove {account?.summary}?</p>
          <p className="text-sm leading-6 text-navy-800">Your earnings stay safe, but nothing can be paid out until you add new payout details.</p>
          {error ? <p role="alert" className="text-sm font-medium text-red-700">{error}</p> : null}
          <div className="flex flex-wrap gap-2">
            <button ref={confirmRemoveRef} type="button" onClick={() => { void remove() }} disabled={pending} aria-busy={pending || undefined} className={dangerButtonClass}>
              {pending ? 'Removing…' : 'Yes, remove details'}
            </button>
            <button type="button" onClick={close} disabled={pending} className={secondaryButtonClass}>Keep details</button>
          </div>
        </div>
      ) : null}

      {mode === 'edit' ? (
        <form
          onSubmit={(event) => { void submit(event) }}
          onKeyDown={(event) => { if (event.key === 'Escape') close() }}
          noValidate
          aria-label={account ? 'Replace payout details' : 'Add payout details'}
          className="mt-4 space-y-4 rounded-xl border border-mist-200 p-4"
        >
          <fieldset>
            <legend className="text-sm font-semibold text-navy-900">How should we pay {kind === 'organization' ? 'this organization' : 'you'}?</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {([['bank', 'Bank account', 'NEFT / IMPS to any Indian bank account'], ['upi', 'UPI ID', 'Instant transfer to a UPI address']] as const).map(([value, label, hint]) => (
                <label
                  key={value}
                  htmlFor={`${id}-method-${value}`}
                  className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition hover:border-ocean-300 hover:bg-ocean-50/40 ${method === value ? 'border-ocean-600 bg-ocean-50/60' : 'border-mist-200 bg-white'}`}
                >
                  <input
                    id={`${id}-method-${value}`}
                    type="radio"
                    name="method"
                    value={value}
                    checked={method === value}
                    onChange={() => { setMethod(value); setFieldErrors({}) }}
                    className="mt-1 size-4 accent-ocean-700"
                  />
                  <span>
                    <span className="block text-sm font-semibold text-navy-950">{label}</span>
                    <span className="block text-xs leading-5 text-muted">{hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="grid gap-1.5">
            <label htmlFor={`${id}-holder`} className="text-sm font-semibold text-navy-900">Account holder name</label>
            <input
              ref={firstFieldRef}
              id={`${id}-holder`}
              name="holderName"
              autoComplete="name"
              maxLength={100}
              aria-invalid={Boolean(fieldErrors.holderName)}
              aria-describedby={describedBy('holderName') ?? `${id}-holder-hint`}
              className={inputClass}
            />
            {fieldErrors.holderName
              ? <FieldError id={`${id}-holderName-error`} message={fieldErrors.holderName} />
              : <p id={`${id}-holder-hint`} className="text-xs leading-5 text-muted">Exactly as the bank has it, letters and spaces only.</p>}
          </div>

          {method === 'bank' ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <label htmlFor={`${id}-account`} className="text-sm font-semibold text-navy-900">Account number</label>
                  <input id={`${id}-account`} name="accountNumber" inputMode="numeric" autoComplete="off" maxLength={24} aria-invalid={Boolean(fieldErrors.accountNumber)} aria-describedby={describedBy('accountNumber')} className={inputClass} />
                  <FieldError id={`${id}-accountNumber-error`} message={fieldErrors.accountNumber} />
                </div>
                <div className="grid gap-1.5">
                  <label htmlFor={`${id}-confirm`} className="text-sm font-semibold text-navy-900">Account number again</label>
                  <input id={`${id}-confirm`} name="confirmAccountNumber" inputMode="numeric" autoComplete="off" maxLength={24} onPaste={(event) => event.preventDefault()} aria-invalid={Boolean(fieldErrors.confirmAccountNumber)} aria-describedby={describedBy('confirmAccountNumber')} className={inputClass} />
                  <FieldError id={`${id}-confirmAccountNumber-error`} message={fieldErrors.confirmAccountNumber} />
                </div>
              </div>
              <div className="grid gap-1.5 sm:max-w-xs">
                <label htmlFor={`${id}-ifsc`} className="text-sm font-semibold text-navy-900">IFSC</label>
                <input id={`${id}-ifsc`} name="ifsc" autoComplete="off" autoCapitalize="characters" maxLength={11} placeholder="e.g. HDFC0001234" aria-invalid={Boolean(fieldErrors.ifsc)} aria-describedby={describedBy('ifsc')} className={`${inputClass} uppercase`} />
                <FieldError id={`${id}-ifsc-error`} message={fieldErrors.ifsc} />
              </div>
            </>
          ) : (
            <div className="grid gap-1.5 sm:max-w-sm">
              <label htmlFor={`${id}-vpa`} className="text-sm font-semibold text-navy-900">UPI ID</label>
              <input id={`${id}-vpa`} name="vpa" autoComplete="off" autoCapitalize="none" maxLength={100} placeholder="e.g. name@okhdfc" aria-invalid={Boolean(fieldErrors.vpa)} aria-describedby={describedBy('vpa')} className={inputClass} />
              <FieldError id={`${id}-vpa-error`} message={fieldErrors.vpa} />
            </div>
          )}

          <p className="flex gap-2 text-xs leading-5 text-muted">
            <LockKeyhole aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-ocean-700" />
            <span>Your details go straight to Cashfree, our payout partner. Sea N Shore keeps only {method === 'bank' ? 'the last 4 digits and the IFSC' : 'the UPI ID'} so you can recognise them.</span>
          </p>

          {error ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm font-medium text-red-800">{error}</p> : null}

          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={pending} aria-busy={pending || undefined} className={primaryButtonClass}>
              {pending ? 'Saving with Cashfree…' : 'Save payout details'}
            </button>
            <button type="button" onClick={close} disabled={pending} className={secondaryButtonClass}>Cancel</button>
          </div>
        </form>
      ) : null}
    </section>
  )
}
