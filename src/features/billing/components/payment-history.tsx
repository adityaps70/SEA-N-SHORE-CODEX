import { FileDown, ReceiptText } from 'lucide-react'
import type { PaymentHistoryRow, PaymentStatusTone } from '../payment-history'

const TONES: Record<PaymentStatusTone, string> = {
  success: 'bg-emerald-50 text-emerald-800',
  pending: 'bg-ocean-50 text-ocean-800',
  failed: 'bg-rose-50 text-rose-800',
  neutral: 'bg-mist-100 text-navy-700',
}

/**
 * Round H (H7): Payment history with a PDF for each payment: the GST tax invoice (and credit note) for course
 * purchases and seat packs, a payment receipt for subscriptions and event tickets.
 */
export function PaymentHistory({
  rows,
  description,
  title = 'Payment history',
  unavailable = false,
}: {
  rows: PaymentHistoryRow[]
  description: string
  title?: string
  /** The payments could not be read right now. */
  unavailable?: boolean
}) {
  return (
    <section aria-labelledby="payment-history-title" className="rounded-2xl border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-mist-50 text-ocean-700">
          <ReceiptText aria-hidden="true" className="size-5" />
        </span>
        <div className="min-w-0">
          <h2 id="payment-history-title" className="text-lg font-semibold text-navy-950">{title}</h2>
          <p className="mt-1 text-sm leading-6 text-muted">{description}</p>
        </div>
      </div>
      {unavailable ? (
        <p role="status" className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">Your payments can’t be shown right now. Please try again in a few minutes.</p>
      ) : rows.length ? (
        <ul className="mt-4 divide-y divide-mist-100 border-y border-mist-100">
          {rows.map((row) => (
            <li key={row.id} className="grid gap-1.5 py-3 sm:grid-cols-[7.5rem_minmax(0,1fr)_auto] sm:items-start sm:gap-x-4">
              <span className="text-sm font-semibold text-navy-950">{row.date}</span>
              <div className="min-w-0">
                <p className="break-words text-sm leading-6 text-navy-800">{row.item}</p>
                {row.documents.length ? (
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                    {row.documents.map((document) => (
                      <a
                        key={document.href}
                        href={document.href}
                        className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-ocean-700 underline-offset-2 hover:text-navy-950 hover:underline sm:min-h-9"
                      >
                        <FileDown aria-hidden="true" className="size-4 shrink-0" />
                        <span>{document.label} (PDF)</span>
                        <span className="sr-only">, {row.item}, {row.date}</span>
                      </a>
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="flex items-center gap-3 sm:flex-col sm:items-end sm:gap-1">
                <span className="text-sm font-bold text-navy-950">{row.amount}</span>
                <span className={`inline-flex w-fit items-center rounded-full px-2.5 py-1 text-xs font-bold ${TONES[row.tone]}`}>{row.status}</span>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 rounded-xl bg-mist-50 px-4 py-3 text-sm text-muted">No payments yet.</p>
      )}
    </section>
  )
}
