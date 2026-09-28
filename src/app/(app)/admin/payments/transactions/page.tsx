import type { Metadata } from 'next'
import Link from 'next/link'
import { textLinkClass } from '@/components/ui/interactive-styles'
import { AdminChip, AdminEmptyState, AdminFilterBar, AdminPageHeader, AdminPanel, formatAdminDate, type AdminChipTone } from '@/features/admin/components/admin-ui'
import { requirePaymentsAdmin } from '@/features/payouts/admin-guard'
import { PaymentsAdminTabs } from '@/features/payouts/components/admin/payments-admin-tabs'
import {
  listRecentPayments,
  PAYMENT_STATUSES,
  PAYMENT_TYPES,
  type NormalizedPaymentStatus,
  type PaymentType,
} from '@/features/payouts/payout-queries'
import { formatExactMoney } from '@/features/payouts/payout-rules'
import { readClient } from '@/features/payouts/payout-runtime'
import { single } from '@/features/payouts/seller-context'

export const metadata: Metadata = { title: 'Payments list · Payments · Admin' }
export const dynamic = 'force-dynamic'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

const TYPE_LABELS: Record<PaymentType, string> = { event: 'Event ticket', course: 'Course', plan: 'Plan' }
const TYPE_FILTER_LABELS: Record<PaymentType, string> = { event: 'Events', course: 'Courses', plan: 'Plans' }
const STATUS_LABELS: Record<NormalizedPaymentStatus, { label: string; tone: AdminChipTone }> = {
  paid: { label: 'Paid', tone: 'success' },
  refunded: { label: 'Refunded', tone: 'neutral' },
  pending: { label: 'Not paid yet', tone: 'info' },
  failed: { label: 'Failed', tone: 'danger' },
  cancelled: { label: 'Expired / closed', tone: 'neutral' },
}

function href(type: string, status: string) {
  const params = new URLSearchParams()
  if (type !== 'all') params.set('type', type)
  if (status !== 'all') params.set('status', status)
  const query = params.toString()
  return `/admin/payments/transactions${query ? `?${query}` : ''}`
}

export default async function AdminPaymentsListPage({ searchParams }: { searchParams: SearchParams }) {
  await requirePaymentsAdmin()
  const params = await searchParams
  const typeParam = single(params.type)
  const statusParam = single(params.status)
  const type = (PAYMENT_TYPES as string[]).includes(typeParam) ? typeParam as PaymentType : 'all'
  const status = (PAYMENT_STATUSES as string[]).includes(statusParam) ? statusParam as NormalizedPaymentStatus : 'all'
  const { lines, unavailable } = await listRecentPayments(readClient, { type, status, limit: 100 })

  return (
    <main className="space-y-6">
      <AdminPageHeader title="Payments" meta="Latest 100 payments, for reconciliation with Cashfree and Razorpay" />
      <PaymentsAdminTabs />

      <div className="space-y-2">
        <AdminFilterBar
          label="Payment type"
          options={[
            { href: href('all', status), label: 'All types', active: type === 'all' },
            ...PAYMENT_TYPES.map((value) => ({ href: href(value, status), label: TYPE_FILTER_LABELS[value], active: type === value })),
          ]}
        />
        <AdminFilterBar
          label="Payment status"
          options={[
            { href: href(type, 'all'), label: 'Any status', active: status === 'all' },
            ...PAYMENT_STATUSES.map((value) => ({ href: href(type, value), label: STATUS_LABELS[value].label, active: status === value })),
          ]}
        />
      </div>

      {unavailable.length ? (
        <p className="text-xs leading-5 text-muted">
          {unavailable.map((value) => TYPE_FILTER_LABELS[value]).join(' and ')}: no payments are recorded yet, so none are listed.
        </p>
      ) : null}

      <AdminPanel>
        {lines.length ? (
          <ul className="divide-y divide-mist-100">
            {lines.map((line) => {
              const chip = STATUS_LABELS[line.status] ?? { label: line.status, tone: 'neutral' as const }
              return (
                <li key={`${line.type}-${line.id}`} className="grid gap-1.5 px-5 py-3 text-sm md:grid-cols-[9.5rem_minmax(0,1fr)_8.5rem_7.5rem] md:items-center md:gap-4">
                  <time dateTime={line.occurredAt} className="text-xs text-muted">{formatAdminDate(line.occurredAt, true)}</time>
                  <div className="min-w-0">
                    <p className="break-words font-semibold text-navy-950">{line.title}</p>
                    <p className="break-words text-xs text-muted">
                      {TYPE_LABELS[line.type]}
                      {line.payerName ? <> · {line.payerSlug ? <Link href={`/people/${line.payerSlug}`} className={textLinkClass}>{line.payerName}</Link> : line.payerName}</> : null}
                      {line.provider ? ` · ${line.provider === 'cashfree' ? 'Cashfree' : line.provider === 'razorpay' ? 'Razorpay' : line.provider}` : ''}
                      {line.reference ? <> · <span className="break-all">{line.reference}</span></> : null}
                    </p>
                  </div>
                  <p className="font-bold tabular-nums text-navy-950 md:text-right">{formatExactMoney(line.amountMinor, line.currency)}</p>
                  <div className="md:text-right"><AdminChip tone={chip.tone}>{chip.label}</AdminChip></div>
                </li>
              )
            })}
          </ul>
        ) : (
          <AdminEmptyState title="No payments match these filters" description="Try another type or status." />
        )}
      </AdminPanel>
    </main>
  )
}
