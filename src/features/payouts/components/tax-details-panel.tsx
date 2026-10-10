'use client'

import { FileText, LockKeyhole } from 'lucide-react'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { primaryButtonClass, secondaryButtonClass } from '@/components/ui/interactive-styles'
import type { MaskedPayoutTaxProfile, TaxProfileFieldErrors } from '../payout-tax'
import { saveTaxDetailsAction } from '../seller-tax-actions'

type Props = {
  sellerKey: string
  sellerName: string
  kind: 'profile' | 'organization'
  profile: MaskedPayoutTaxProfile | null
}

const inputClass = 'min-h-11 w-full rounded-xl border border-mist-200 bg-white px-3.5 text-base text-ink shadow-sm placeholder:text-muted focus:border-ocean-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-ocean-500 aria-[invalid=true]:border-red-500'

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? <p id={id} className="text-sm font-medium text-red-700">{message}</p> : null
}

/**
 * A course seller's tax details: legal name, PAN and GST registration. Needed before the first course payout (TDS
 * is deducted against the PAN) and to know which document the seller invoices with. Once saved the PAN is only
 * ever shown masked; the form never receives it back.
 */
export function TaxDetailsPanel({ sellerKey, sellerName, kind, profile: initial }: Props) {
  const [profile, setProfile] = useState(initial)
  const [editing, setEditing] = useState(false)
  const [registered, setRegistered] = useState<boolean | null>(initial ? initial.gstRegistered : null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<TaxProfileFieldErrors>({})
  const [notice, setNotice] = useState<string | null>(null)
  const firstFieldRef = useRef<HTMLInputElement>(null)
  const openRef = useRef<HTMLButtonElement>(null)
  const returnFocus = useRef(false)
  const id = useId()
  const titleId = `${id}-title`

  useEffect(() => {
    if (editing) firstFieldRef.current?.focus()
    else if (returnFocus.current) {
      returnFocus.current = false
      openRef.current?.focus()
    }
  }, [editing])

  function close() {
    if (pending) return
    setEditing(false)
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
    let result: Awaited<ReturnType<typeof saveTaxDetailsAction>>
    try {
      result = await saveTaxDetailsAction(sellerKey, {
        legalName: String(data.get('legalName') ?? ''),
        pan: String(data.get('pan') ?? ''),
        gstRegistered: registered === null ? '' : registered ? 'yes' : 'no',
        gstin: String(data.get('gstin') ?? ''),
      })
    } catch {
      result = { ok: false, error: "We couldn't reach Sea N Shore. Nothing was saved. Check your connection and try again." }
    }
    setPending(false)
    if (result.ok) {
      setProfile(result.profile)
      setEditing(false)
      setNotice(result.message)
      returnFocus.current = true
      return
    }
    setError(result.error)
    setFieldErrors(result.fieldErrors ?? {})
  }

  const describedBy = (field: keyof TaxProfileFieldErrors, hint?: string) => (fieldErrors[field] ? `${id}-${field}-error` : hint)

  return (
    <section aria-labelledby={titleId} className="rounded-2xl border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
      <div className="flex gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-ocean-50 text-ocean-700">
          <FileText aria-hidden="true" className="size-5" />
        </span>
        <div className="min-w-0">
          <h2 id={titleId} className="break-words text-lg font-semibold text-navy-950">
            {kind === 'organization' ? `Tax details · ${sellerName}` : 'Your tax details'}
          </h2>
          <p className="mt-1 text-sm leading-6 text-muted">
            Needed before {kind === 'organization' ? 'this organization’s' : 'your'} first course payout. Sea N Shore deducts TDS from course payouts against this PAN, and asks for a monthly invoice: a tax invoice if you are GST registered, otherwise a bill of supply.
          </p>
        </div>
      </div>

      {notice ? <p role="status" className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-sm font-medium text-emerald-900">{notice}</p> : null}

      {profile && !editing ? (
        <dl className="mt-4 grid gap-3 rounded-xl border border-mist-200 bg-mist-50/60 p-4 text-sm sm:grid-cols-3">
          <div className="min-w-0">
            <dt className="text-xs font-semibold text-muted">Legal name</dt>
            <dd className="mt-0.5 break-words font-semibold text-navy-950">{profile.legalName}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-muted">PAN</dt>
            <dd className="mt-0.5 font-semibold tabular-nums tracking-wide text-navy-950">{profile.maskedPan}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs font-semibold text-muted">GST</dt>
            <dd className="mt-0.5 break-words font-semibold text-navy-950">{profile.gstRegistered ? `Registered · ${profile.maskedGstin ?? ''}` : 'Not registered'}</dd>
          </div>
        </dl>
      ) : !profile && !editing ? (
        <p className="mt-4 rounded-xl border border-dashed border-amber-200 bg-amber-50/60 p-4 text-sm leading-6 text-amber-950">
          No tax details yet. Course earnings can&apos;t be paid out until you add your PAN.
        </p>
      ) : null}

      {!editing ? (
        <div className="mt-4">
          <button ref={openRef} type="button" onClick={() => { setNotice(null); setError(null); setRegistered(profile ? profile.gstRegistered : null); setEditing(true) }} className={profile ? secondaryButtonClass : primaryButtonClass}>
            {profile ? 'Change tax details' : 'Add tax details'}
          </button>
        </div>
      ) : (
        <form
          onSubmit={(event) => { void submit(event) }}
          onKeyDown={(event) => { if (event.key === 'Escape') close() }}
          noValidate
          aria-label={profile ? 'Change tax details' : 'Add tax details'}
          className="mt-4 space-y-4 rounded-xl border border-mist-200 p-4"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid content-start gap-1.5">
              <label htmlFor={`${id}-legal`} className="text-sm font-semibold text-navy-900">Legal name (as on the PAN)</label>
              <input ref={firstFieldRef} id={`${id}-legal`} name="legalName" defaultValue={profile?.legalName ?? ''} maxLength={180} autoComplete="off" aria-invalid={Boolean(fieldErrors.legalName)} aria-describedby={describedBy('legalName')} className={inputClass} />
              <FieldError id={`${id}-legalName-error`} message={fieldErrors.legalName} />
            </div>
            <div className="grid content-start gap-1.5">
              <label htmlFor={`${id}-pan`} className="text-sm font-semibold text-navy-900">PAN</label>
              <input id={`${id}-pan`} name="pan" maxLength={12} autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="ABCDE1234F" aria-invalid={Boolean(fieldErrors.pan)} aria-describedby={describedBy('pan', `${id}-pan-hint`)} className={`${inputClass} uppercase`} />
              {fieldErrors.pan
                ? <FieldError id={`${id}-pan-error`} message={fieldErrors.pan} />
                : <p id={`${id}-pan-hint`} className="text-xs leading-5 text-muted">{profile ? `Saved: ${profile.maskedPan}. Type the full PAN again to save changes.` : '10 characters: 5 letters, 4 digits, a letter.'}</p>}
            </div>
          </div>

          <fieldset aria-describedby={fieldErrors.gstRegistered ? `${id}-gstRegistered-error` : undefined}>
            <legend className="text-sm font-semibold text-navy-900">Are you registered for GST?</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {([[true, 'Yes, GST registered', 'You upload a tax invoice each month.'], [false, 'No, not registered', 'You upload a bill of supply (no GST) each month.']] as const).map(([value, label, hint]) => (
                <label key={String(value)} htmlFor={`${id}-gst-${value}`} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition hover:border-ocean-300 hover:bg-ocean-50/40 ${registered === value ? 'border-ocean-600 bg-ocean-50/60' : 'border-mist-200 bg-white'}`}>
                  <input id={`${id}-gst-${value}`} type="radio" name="gstRegistered" checked={registered === value} onChange={() => { setRegistered(value); setFieldErrors({}) }} className="mt-1 size-4 accent-ocean-700" />
                  <span>
                    <span className="block text-sm font-semibold text-navy-950">{label}</span>
                    <span className="block text-xs leading-5 text-muted">{hint}</span>
                  </span>
                </label>
              ))}
            </div>
            <FieldError id={`${id}-gstRegistered-error`} message={fieldErrors.gstRegistered} />
          </fieldset>

          {registered ? (
            <div className="grid gap-1.5 sm:max-w-sm">
              <label htmlFor={`${id}-gstin`} className="text-sm font-semibold text-navy-900">GSTIN</label>
              <input id={`${id}-gstin`} name="gstin" maxLength={18} autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="27ABCDE1234F1Z5" aria-invalid={Boolean(fieldErrors.gstin)} aria-describedby={describedBy('gstin')} className={`${inputClass} uppercase`} />
              <FieldError id={`${id}-gstin-error`} message={fieldErrors.gstin} />
            </div>
          ) : null}

          <p className="flex gap-2 text-xs leading-5 text-muted">
            <LockKeyhole aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-ocean-700" />
            <span>Only you{kind === 'organization' ? ', the organization’s owners and administrators' : ''} and the Sea N Shore payments team can see these details. We show the PAN masked after saving.</span>
          </p>

          {error ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm font-medium text-red-800">{error}</p> : null}

          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={pending} aria-busy={pending || undefined} className={primaryButtonClass}>{pending ? 'Saving…' : 'Save tax details'}</button>
            <button type="button" onClick={close} disabled={pending} className={secondaryButtonClass}>Cancel</button>
          </div>
        </form>
      )}
    </section>
  )
}
