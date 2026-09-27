import Link from 'next/link'
import { Receipt } from 'lucide-react'
import { formatMoney } from '@/features/payments/currency'
import type { LearnerCoursePurchase } from '../course-payment-repository'
import { courseOrderReference, coursePurchaseStatusLabel } from '../course-payment-rules'

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

/** Receipt-like list of the learner's course purchases (My Learning → Purchases). */
export function CoursePurchasesList({ purchases }: { purchases: LearnerCoursePurchase[] }) {
  return (
    <section id="purchases" aria-labelledby="purchases-title" className="mt-10 scroll-mt-24">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.15em] text-teal-700">Receipts</p>
          <h2 id="purchases-title" className="mt-1 text-2xl font-bold tracking-tight text-navy-950">Purchases</h2>
        </div>
        <p className="max-w-lg text-sm leading-6 text-muted">Paid courses you bought on Sea N Shore. Quote the order ID if you contact us about a payment.</p>
      </div>

      {purchases.length ? (
        <ul className="mt-5 space-y-3">
          {purchases.map((purchase) => {
            const status = coursePurchaseStatusLabel(purchase)
            const note = refundLine(purchase)
            const discounted = purchase.discountPriceMinor !== null && purchase.discountPriceMinor < purchase.listPriceMinor
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
