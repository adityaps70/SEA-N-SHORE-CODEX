import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft, Receipt, RotateCcw, Wallet } from 'lucide-react'
import { canAccessPlatformAdmin } from '@/features/admin/access'
import { MobilePageBar } from '@/components/navigation/mobile-page-bar'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { CourseRefundButton } from '@/features/learning/components/course-refund-button'
import { coursePaymentRepository, type CourseSaleRow } from '@/features/learning/course-payment-repository'
import { courseOrderReference, coursePurchaseStatusLabel, courseRefundReasonLabel } from '@/features/learning/course-payment-rules'
import { learningRepository } from '@/features/learning/repository'
import { organizationRepository } from '@/features/organizations/repository'
import { formatMoney } from '@/features/payments/currency'

export const metadata: Metadata = { title: 'Course sales' }

function formatDate(value: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }).format(date)
}

/** Totals per currency, so rupees and dollars are never added together. */
function totals(sales: CourseSaleRow[]) {
  const byCurrency = new Map<string, { paid: number; refunded: number; count: number }>()
  for (const sale of sales) {
    const entry = byCurrency.get(sale.currency) ?? { paid: 0, refunded: 0, count: 0 }
    if (sale.status === 'paid') {
      entry.paid += sale.amountMinor
      entry.count += 1
    } else if (sale.status === 'refunded') {
      entry.refunded += sale.amountMinor
    }
    byCurrency.set(sale.currency, entry)
  }
  return [...byCurrency.entries()]
}

function canRefund(sale: CourseSaleRow) {
  if (!sale.providerPaymentId || !sale.providerOrderId) return false
  if (sale.refundStatus === 'requested') return false
  return sale.status === 'paid' || (sale.status === 'refunded' && sale.refundStatus === 'failed')
}

function SaleItem({ sale }: { sale: CourseSaleRow }) {
  const status = coursePurchaseStatusLabel(sale)
  const amount = formatMoney(sale.amountMinor, sale.currency)
  const learner = sale.buyerName ?? 'Former member'
  const refundDue = sale.status === 'paid' && !sale.enrollmentConfirmedAt
  return (
    <li className="rounded-[1.4rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)]">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-lg font-extrabold text-navy-950">{amount}</p>
            <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${status.tone}`}>{status.label}</span>
          </div>
          <p className="break-words text-sm font-bold text-navy-950">
            {sale.courseSlug ? (
              <Link href={`/learn/courses/${sale.courseSlug}`} className="text-ocean-700 underline-offset-2 hover:underline">{sale.courseTitle}</Link>
            ) : sale.courseTitle}
          </p>
          <p className="text-sm text-navy-700">
            Learner:{' '}
            {sale.buyerSlug ? (
              <Link href={`/people/${sale.buyerSlug}`} className="font-semibold text-ocean-700 underline-offset-2 hover:underline">{learner}</Link>
            ) : <span className="font-semibold">{learner}</span>}
          </p>
          <dl className="grid gap-x-5 gap-y-0.5 pt-1 text-xs text-muted sm:grid-cols-[auto_1fr]">
            <dt className="font-semibold text-navy-700">Paid</dt>
            <dd>{formatDate(sale.paidAt)}</dd>
            {sale.refundedAt ? (
              <>
                <dt className="font-semibold text-navy-700">Refunded</dt>
                <dd>{formatDate(sale.refundedAt)}</dd>
              </>
            ) : null}
            <dt className="font-semibold text-navy-700">Order ID</dt>
            <dd className="break-all font-mono text-[11px] text-navy-900">{courseOrderReference(sale)}</dd>
          </dl>
          {refundDue ? (
            <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-950">
              {courseRefundReasonLabel(sale.refundDueReason)} This learner paid but did not get access — refund them.
            </p>
          ) : null}
        </div>
        {canRefund(sale) ? (
          <div className="shrink-0">
            <CourseRefundButton
              orderId={sale.id}
              amountLabel={amount}
              learnerName={learner}
              courseTitle={sale.courseTitle}
              hasAccess={Boolean(sale.enrollmentConfirmedAt) && sale.status === 'paid'}
              retry={sale.refundStatus === 'failed'}
            />
          </div>
        ) : null}
      </div>
    </li>
  )
}

export default async function CourseSalesPage() {
  const user = await requireAwsUser()
  const [mentorState, organizations, isAdmin] = await Promise.all([
    learningRepository.getMentorApplicationState(user.id),
    organizationRepository.listUserOrganizations(user.id),
    canAccessPlatformAdmin(user.id),
  ])
  const hasActiveMentor = mentorState.kind === 'mentor' && mentorState.mentorStatus === 'active'
  const hasOrganizationLmsAccess = organizations.some((organization) =>
    organization.role === 'owner'
    || organization.role === 'administrator'
    || organization.role === 'lms_manager')
  if (!hasActiveMentor && !hasOrganizationLmsAccess && !isAdmin) return redirect('/learn/teach')

  let sales: CourseSaleRow[] | null = null
  try {
    sales = await coursePaymentRepository.listCourseSales({ managerId: user.id, allCourses: isAdmin })
  } catch (error) {
    console.error('course_sales_load_failed', { message: error instanceof Error ? error.message : null })
  }
  const summary = sales ? totals(sales) : []

  return (
    <div className="mx-auto w-full max-w-6xl py-6 max-md:pt-0 sm:px-6 lg:px-8">
      <MobilePageBar backHref="/learn/studio" title="Course sales" />
      <Link href="/learn/studio" className="inline-flex items-center gap-2 text-sm font-bold text-ocean-700 underline-offset-2 transition-colors hover:text-navy-950 hover:underline max-md:hidden">
        <ArrowLeft className="size-4" aria-hidden="true" /> Learning Studio
      </Link>

      <section className="mt-5 overflow-hidden rounded-[1.8rem] bg-navy-950 p-6 text-white shadow-[var(--shadow-card)] sm:p-8">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-200">{isAdmin ? 'Sea N Shore team · all courses' : 'Your paid courses'}</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">Course sales</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-white/70">
          Every purchase of {isAdmin ? 'a paid course on Sea N Shore' : 'the courses you manage'}, with its payment status. Refund a purchase here: the learner gets the full amount back, their access ends, and the earning is removed from the seller&apos;s balance.
        </p>
      </section>

      {summary.length ? (
        <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Sales totals">
          {summary.map(([currency, entry]) => (
            <article key={currency} className="rounded-[1.4rem] border border-mist-200 bg-white p-5 shadow-[var(--shadow-card)]">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-bold text-muted">Paid sales ({currency})</p>
                <span className="grid size-9 place-items-center rounded-xl bg-teal-50 text-teal-800">
                  <Wallet className="size-4" aria-hidden="true" />
                </span>
              </div>
              <p className="mt-3 text-3xl font-bold tracking-tight text-navy-950">{formatMoney(entry.paid, currency)}</p>
              <p className="mt-1 text-xs font-semibold text-muted">
                {entry.count} {entry.count === 1 ? 'purchase' : 'purchases'} · <RotateCcw className="inline size-3" aria-hidden="true" /> {formatMoney(entry.refunded, currency)} refunded
              </p>
            </article>
          ))}
        </section>
      ) : null}

      <section className="mt-8" aria-labelledby="sales-list-title">
        <h2 id="sales-list-title" className="text-2xl font-bold tracking-tight text-navy-950">Purchases</h2>
        {sales === null ? (
          <p role="status" className="mt-4 rounded-[1.4rem] border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-950">
            We couldn&apos;t load course sales just now. Refresh the page to try again.
          </p>
        ) : sales.length ? (
          <ul className="mt-4 space-y-3">
            {sales.map((sale) => <SaleItem key={sale.id} sale={sale} />)}
          </ul>
        ) : (
          <div className="mt-4 rounded-[1.5rem] border border-dashed border-mist-200 bg-white p-7 text-center sm:p-10">
            <Receipt className="mx-auto size-7 text-teal-800" aria-hidden="true" />
            <h3 className="mt-3 text-lg font-bold text-navy-950">No course sales yet</h3>
            <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted">When a learner buys one of your paid courses, the purchase appears here with its amount, date and order ID.</p>
          </div>
        )}
      </section>
    </div>
  )
}
