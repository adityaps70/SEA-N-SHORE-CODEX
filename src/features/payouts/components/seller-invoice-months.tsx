'use client'

import Link from 'next/link'
import { FileUp, Receipt } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { primaryButtonClass, secondaryButtonClass, textLinkClass } from '@/components/ui/interactive-styles'
import { uploadLearningMediaFile } from '@/features/learning/components/upload-learning-media'
import { GST_SUPPLIER } from '@/features/tax/gst'
import { formatExactMoney, parseRupeesToMinor, type Tone } from '../payout-rules'
import {
  checkSellerInvoiceFile,
  periodLabel,
  SELLER_INVOICE_ACCEPT,
  SELLER_INVOICE_KIND_LABELS,
  sellerInvoiceFileRoute,
  type SellerInvoiceKind,
} from '../seller-invoice-rules'
import type { SellerInvoiceMonth, SellerInvoiceMonthState } from '../seller-invoices'
import { startSellerInvoiceUploadAction, submitSellerInvoiceAction } from '../seller-tax-actions'
import { formatDay, StatusChip } from './money-ui'

type Props = {
  sellerKey: string
  kind: 'profile' | 'organization'
  months: SellerInvoiceMonth[]
  /** Null until the seller saves their tax details (PAN and GST registration). */
  gstRegistered: boolean | null
  taxDetailsHref: string
}

const inputClass = 'min-h-11 w-full rounded-xl border border-mist-200 bg-white px-3.5 text-base text-ink shadow-sm placeholder:text-muted focus:border-ocean-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-ocean-500 aria-[invalid=true]:border-red-500'

const STATE_LABELS: Record<SellerInvoiceMonthState, { label: string; tone: Tone }> = {
  not_needed: { label: 'No invoice needed', tone: 'neutral' },
  open: { label: 'Month in progress', tone: 'neutral' },
  due: { label: 'Invoice needed', tone: 'warning' },
  submitted: { label: 'Waiting for review', tone: 'info' },
  approved: { label: 'Approved', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'danger' },
}

type Field = 'documentNumber' | 'amount' | 'file'

function UploadForm({ sellerKey, month, kind, onDone, onCancel }: {
  sellerKey: string
  month: SellerInvoiceMonth
  kind: SellerInvoiceKind
  onDone: (message: string) => void
  onCancel: () => void
}) {
  const [pending, setPending] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<{ message: string; field?: Field } | null>(null)
  const firstRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const id = useId()

  useEffect(() => { firstRef.current?.focus() }, [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    const data = new FormData(event.currentTarget)
    const documentNumber = String(data.get('documentNumber') ?? '')
    const amount = String(data.get('amount') ?? '')
    const file = fileRef.current?.files?.[0] ?? null
    setError(null)
    if (!documentNumber.trim()) return setError({ field: 'documentNumber', message: 'Enter your invoice number as it appears on the invoice.' })
    const amountMinor = parseRupeesToMinor(amount)
    if (amountMinor === null) return setError({ field: 'amount', message: 'Enter the invoice total in rupees, for example 4237.50.' })
    if (amountMinor !== month.expectedMinor) {
      return setError({ field: 'amount', message: `The invoice amount must be exactly ${formatExactMoney(month.expectedMinor)}, your course earnings for ${periodLabel(month.period)} after the platform fee. Correct your invoice and enter that amount.` })
    }
    if (!file || !file.size) return setError({ field: 'file', message: 'Choose the invoice file (PDF, JPG, PNG or WebP, up to 10 MB).' })
    const checked = checkSellerInvoiceFile({ name: file.name, mimeType: file.type, size: file.size })
    if (!checked.ok) return setError({ field: 'file', message: checked.error })

    const fields = { period: month.period, documentNumber, amount, name: file.name, mimeType: checked.contentType, size: file.size }
    setPending(true)
    try {
      const started = await startSellerInvoiceUploadAction(sellerKey, fields)
      if (!started.ok) {
        setError({ message: started.error, field: started.field })
        return
      }
      setProgress(0)
      try {
        await uploadLearningMediaFile({ uploadUrl: started.uploadUrl, file, contentType: started.contentType, onProgress: setProgress })
      } catch {
        setError({ field: 'file', message: "The file didn't upload. Check your connection and try again. Nothing was saved." })
        return
      }
      const saved = await submitSellerInvoiceAction(sellerKey, { ...fields, storagePath: started.storagePath })
      if (!saved.ok) {
        setError({ message: saved.error, field: saved.field })
        return
      }
      onDone(saved.message)
    } catch {
      setError({ message: "We couldn't reach Sea N Shore. Nothing was saved. Check your connection and try again." })
    } finally {
      setPending(false)
      setProgress(null)
    }
  }

  const errorId = `${id}-error`
  const invalid = (field: Field) => error?.field === field
  return (
    <form onSubmit={(event) => { void submit(event) }} onKeyDown={(event) => { if (event.key === 'Escape' && !pending) onCancel() }} noValidate aria-label={`Upload invoice for ${periodLabel(month.period)}`} className="mt-3 space-y-4 rounded-xl border border-mist-200 p-4">
      <p className="text-sm leading-6 text-navy-800">
        Upload a <span className="font-semibold">{SELLER_INVOICE_KIND_LABELS[kind].toLowerCase()}</span> addressed to {GST_SUPPLIER.legalName} ({GST_SUPPLIER.tradeName}, GSTIN {GST_SUPPLIER.gstin}) for <span className="font-semibold">{formatExactMoney(month.expectedMinor)}</span>, your course earnings for {periodLabel(month.period)}.
        {kind === 'bill_of_supply' ? ' As you are not GST registered, the bill carries no GST.' : ''}
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid content-start gap-1.5">
          <label htmlFor={`${id}-number`} className="text-sm font-semibold text-navy-900">Your invoice number</label>
          <input ref={firstRef} id={`${id}-number`} name="documentNumber" maxLength={40} autoComplete="off" aria-invalid={invalid('documentNumber')} aria-describedby={invalid('documentNumber') ? errorId : undefined} className={inputClass} />
        </div>
        <div className="grid content-start gap-1.5">
          <label htmlFor={`${id}-amount`} className="text-sm font-semibold text-navy-900">Invoice total (₹)</label>
          <input id={`${id}-amount`} name="amount" inputMode="decimal" autoComplete="off" placeholder={(month.expectedMinor / 100).toFixed(2)} aria-invalid={invalid('amount')} aria-describedby={invalid('amount') ? errorId : `${id}-amount-hint`} className={inputClass} />
          <p id={`${id}-amount-hint`} className="text-xs leading-5 text-muted">Must be exactly {formatExactMoney(month.expectedMinor)}.</p>
        </div>
      </div>
      <div className="grid gap-1.5">
        <label htmlFor={`${id}-file`} className="text-sm font-semibold text-navy-900">Invoice file</label>
        <input ref={fileRef} id={`${id}-file`} name="file" type="file" accept={SELLER_INVOICE_ACCEPT} aria-invalid={invalid('file')} aria-describedby={invalid('file') ? errorId : `${id}-file-hint`} className="block w-full cursor-pointer text-sm text-navy-900 file:mr-3 file:cursor-pointer file:rounded-lg file:border file:border-mist-200 file:bg-white file:px-3 file:py-2 file:text-sm file:font-semibold file:text-navy-950 hover:file:bg-mist-50" />
        <p id={`${id}-file-hint`} className="text-xs leading-5 text-muted">PDF, JPG, PNG or WebP, up to 10 MB. Only you and the Sea N Shore payments team can open it.</p>
      </div>
      {progress !== null ? <p role="status" className="text-sm text-navy-800">Uploading… {progress}%</p> : null}
      {error ? <p id={errorId} role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm font-medium text-red-800">{error.message}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} aria-busy={pending || undefined} className={primaryButtonClass}>
          <FileUp aria-hidden="true" className="size-4" /> {pending ? 'Uploading…' : 'Upload invoice'}
        </button>
        <button type="button" onClick={onCancel} disabled={pending} className={secondaryButtonClass}>Cancel</button>
      </div>
    </form>
  )
}

/**
 * The seller's statement of monthly invoices for course earnings: for each month, the exact amount to invoice, the
 * invoice status (and a rejection note), and an upload form when an invoice is needed.
 */
export function SellerInvoiceMonths({ sellerKey, kind, months, gstRegistered, taxDetailsHref }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState<Record<string, string>>({})
  const invoiceKind: SellerInvoiceKind = gstRegistered ? 'tax_invoice' : 'bill_of_supply'
  const who = kind === 'organization' ? 'this organization' : 'you'

  return (
    <section aria-labelledby="seller-invoices-title" className="overflow-hidden rounded-2xl border border-mist-100 bg-white shadow-[var(--shadow-card)]">
      <div className="border-b border-mist-100 px-5 py-4">
        <h2 id="seller-invoices-title" className="flex items-center gap-2 text-lg font-semibold text-navy-950">
          <Receipt aria-hidden="true" className="size-5 text-ocean-700" /> Monthly invoices for course earnings
        </h2>
        <p className="mt-1 text-sm leading-6 text-muted">
          Course sellers invoice Sea N Shore once a month for their course earnings. A month&apos;s course earnings are paid once its invoice is approved; event-ticket earnings don&apos;t need an invoice.
          {gstRegistered === null ? null : gstRegistered ? ' As a GST-registered seller, upload a tax invoice.' : ' As a seller who is not GST registered, upload a bill of supply (no GST).'}
        </p>
        {gstRegistered === null ? (
          <p role="status" className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm leading-6 text-amber-950">
            <span className="font-semibold">Add tax details first.</span> We need {who === 'you' ? 'your' : 'the organization’s'} PAN and GST registration before {who} can invoice and be paid for courses.{' '}
            <Link href={taxDetailsHref} className={textLinkClass}>Add tax details</Link>
          </p>
        ) : null}
      </div>
      {months.length ? (
        <ul className="divide-y divide-mist-100">
          {months.map((month) => {
            const justSent = submitted[month.period]
            const state: SellerInvoiceMonthState = justSent ? 'submitted' : month.state
            const status = STATE_LABELS[state]
            const canUpload = gstRegistered !== null && (state === 'due' || state === 'rejected')
            return (
              <li key={month.period} className="px-5 py-3.5 text-sm">
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_9rem_11rem] sm:items-center sm:gap-4">
                  <div className="min-w-0">
                    <p className="font-semibold text-navy-950">{periodLabel(month.period)}</p>
                    {month.invoice && !justSent ? (
                      <p className="break-words text-xs text-muted">
                        {SELLER_INVOICE_KIND_LABELS[month.invoice.kind]} {month.invoice.documentNumber} · {formatExactMoney(month.invoice.amountMinor)} · sent {formatDay(month.invoice.createdAt)} ·{' '}
                        <a href={sellerInvoiceFileRoute(month.invoice.id)} className={textLinkClass}>{month.invoice.fileName}</a>
                      </p>
                    ) : null}
                  </div>
                  <div className="flex justify-between gap-3 sm:block sm:text-right">
                    <span className="text-xs text-muted sm:sr-only">Amount to invoice</span>
                    <span className={`font-bold tabular-nums ${month.expectedMinor < 0 ? 'text-red-700' : 'text-navy-950'}`}>{formatExactMoney(month.expectedMinor)}</span>
                  </div>
                  <div className="sm:text-right"><StatusChip tone={status.tone}>{status.label}</StatusChip></div>
                </div>
                {justSent ? <p role="status" className="mt-2 text-sm text-emerald-900">{justSent}</p> : null}
                {state === 'rejected' && month.invoice?.reviewNote ? (
                  <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm leading-6 text-red-800">
                    <span className="font-semibold">Why it was rejected:</span> {month.invoice.reviewNote} Upload a corrected invoice.
                  </p>
                ) : null}
                {state === 'open' ? <p className="mt-1 text-xs text-muted">Invoice this month once it ends; the amount may still change with new sales or refunds.</p> : null}
                {canUpload && open !== month.period ? (
                  <button type="button" onClick={() => setOpen(month.period)} className={`${state === 'rejected' ? secondaryButtonClass : primaryButtonClass} mt-3`}>
                    <FileUp aria-hidden="true" className="size-4" /> {state === 'rejected' ? 'Upload a new invoice' : 'Upload invoice'}
                  </button>
                ) : null}
                {canUpload && open === month.period ? (
                  <UploadForm
                    sellerKey={sellerKey}
                    month={month}
                    kind={invoiceKind}
                    onCancel={() => setOpen(null)}
                    onDone={(message) => {
                      setOpen(null)
                      setSubmitted((current) => ({ ...current, [month.period]: message }))
                      router.refresh()
                    }}
                  />
                ) : null}
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="px-5 py-8 text-center text-sm text-muted">No course earnings yet. Each month with course sales appears here with the amount to invoice.</p>
      )}
    </section>
  )
}
