import Link from 'next/link'
import { FileText, Receipt } from 'lucide-react'
import { formatMoney } from '@/features/payments/currency'
import type { LearnerCoursePurchase } from '../course-payment-repository'
import { courseOrderReference, coursePurchaseStatusLabel } from '../course-payment-rules'
import { orderPlanDetails } from '../course-plans'

function formatDate(value: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(date)
}

function refundLine(purchase: LearnerCoursePurchase) {
  if (purchase.status === 'refunded') {
    return purchase.refundStatus === 'pending'
      ? `Refund of ${formatMoney(purchase.amountMinor, purchase.currency)} started on ${formatDate(purchase.refundedAt)}. It reaches your original payment method in about 5–7 working days.`
      : `Refunded ${formatMoney(purchase.amountMinor, purchase.currency)} on ${formatDate(purchase.refundedAt)} to your original payment method. Course access has ended.`
  }
  if (purchase.status === 'paid' && !purchase.enrollmentConfirmedAt) {
    return 'We could not unlock the course for this payment. The Sea N Shore team will refund the full amount.'
  }
  return null
}

/** C4: the GST tax invoice and, after a refund, the credit note. Plain links: the route sends the PDF as a download. */
function TaxDocumentLinks({ purchase }: { purchase: LearnerCoursePurchase }) {
  if (!purchase.invoiceId && !purchase.creditNoteId) return null
  const linkClass = 'inline-flex min-h-10 items-center gap-2 rounded-xl border border-mist-100 px-3 text-xs font-semibold text-ocean-700 hover:bg-mist-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ocean-500'
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {purchase.invoiceId ? (
        <a href={`/api/learn/invoices/${purchase.invoiceId}`} className={linkClass}>
          <FileText aria-hidden="true" className="size-4" />
          <span>Download invoice</span>
          {purchase.invoiceNumber ? <span className="font-mono text-[11px] font-normal text-navy-700">{purchase.invoiceNumber}</span> : null}
        </a>
      ) : null}
      {purchase.creditNoteId ? (
        <a href={`/api/learn/credit-notes/${purchase.creditNoteId}`} className={linkClass}>
          <FileText aria-hidden="true" className="size-4" />
          <span>Download credit note</span>
          {purchase.creditNoteNumber ? <span className="font-mono text-[11px] font-normal text-navy-700">{purchase.creditNoteNumber}</span> : null}
        </a>
      ) : null}
    </div>
  )
}

/** Receipt-like list of the learner's course purchases (My Learning → Purchases). */
export function CoursePurchasesList({ purchases, className = 'mt-10' }: { purchases: LearnerCoursePurchase[]; className?: string }) {
  return (
    <section id="purchases" aria-labelledby="purchases-title" className={`${className} scroll-mt-24`}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="purchases-title" className="text-section-title font-bold text-navy-950">Purchases</h2>
        </div>
        <p className="max-w-lg text-sm leading-6 text-muted">Paid courses you bought on Sea N Shore. Quote the order ID if you contact us about a payment.</p>
      </div>

      {purchases.length ? (
        <ul className="mt-5 space-y-3">
          {purchases.map((purchase) => {
            const status = coursePurchaseStatusLabel(purchase)
            const note = refundLine(purchase)
            // A sale price or a promo code (round C) brought the amount below the list price.
            const discounted = purchase.amountMinor < purchase.listPriceMinor
            const details = orderPlanDetails(purchase)
            return (
              <li key={purchase.id} className="rounded-[1.4rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)]">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-teal-50 text-teal-800">
                      <Receipt aria-hidden="true" className="size-4" />
                    </span>
                    <div className="min-w-0">
                      {purchase.courseSlug && purchase.status === 'paid' && purchase.enrollmentConfirmedAt ? (
                        <Link href={`/learn/courses/${purchase.courseSlug}/learn`} className="break-words font-bold text-ocean-700 underline-offset-2 hover:underline">
                          {purchase.courseTitle}
                        </Link>
                      ) : (
                        <p className="break-words font-bold text-navy-950">{purchase.courseTitle}</p>
                      )}
                      <dl className="mt-2 grid gap-x-6 gap-y-1 text-xs text-muted sm:grid-cols-[auto_1fr]">
                        <dt className="font-semibold text-navy-700">Paid on</dt>
                        <dd>{formatDate(purchase.paidAt)}</dd>
                        {details.plan ? (
                          <>
                            <dt className="font-semibold text-navy-700">Plan</dt>
                            <dd>{details.plan}</dd>
                          </>
                        ) : null}
                        {details.code ? (
                          <>
                            <dt className="font-semibold text-navy-700">Promo code</dt>
                            <dd>{details.code}</dd>
                          </>
                        ) : null}
                        <dt className="font-semibold text-navy-700">Order ID</dt>
                        <dd className="break-all font-mono text-[11px] text-navy-900">{courseOrderReference(purchase)}</dd>
                      </dl>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center justify-between gap-3 sm:flex-col sm:items-end">
                    <p className="text-lg font-extrabold text-navy-950">
                      {formatMoney(purchase.amountMinor, purchase.currency)}
                      {discounted ? (
                        <span className="ml-2 text-xs font-semibold text-muted line-through">
                          <span className="sr-only">List price </span>{formatMoney(purchase.listPriceMinor, purchase.currency)}
                        </span>
                      ) : null}
                    </p>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${status.tone}`}>{status.label}</span>
                  </div>
                </div>
                {note ? <p className="mt-3 rounded-xl bg-mist-50 px-3 py-2 text-xs leading-5 text-navy-700">{note}</p> : null}
                <TaxDocumentLinks purchase={purchase} />
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="mt-5 rounded-[1.4rem] border border-dashed border-mist-200 bg-white p-6 text-sm leading-6 text-muted">
          You haven&apos;t bought any courses yet. Paid courses you buy appear here with their receipt details.
        </p>
      )}
    </section>
  )
}
