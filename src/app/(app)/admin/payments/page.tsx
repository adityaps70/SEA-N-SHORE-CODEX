import type { Metadata } from 'next'
import Link from 'next/link'
import { AlertTriangle, ArrowRight } from 'lucide-react'
import { AdminChip, AdminPageHeader, AdminPanel } from '@/features/admin/components/admin-ui'
import { getPaymentCapabilities } from '@/features/payments/provider'
import { requirePaymentsAdmin } from '@/features/payouts/admin-guard'
import { PaymentsAdminTabs } from '@/features/payouts/components/admin/payments-admin-tabs'
import { getPaymentsOverview, type PaymentType } from '@/features/payouts/payout-queries'
import { formatExactMoney } from '@/features/payouts/payout-rules'
import { payoutsEnvironment, readClient } from '@/features/payouts/payout-runtime'

export const metadata: Metadata = { title: 'Payments · Admin' }
export const dynamic = 'force-dynamic'

const TYPE_LABELS: Record<PaymentType, string> = { event: 'Event tickets', course: 'Courses', plan: 'Pro plans' }

function Money({ minor, currency }: { minor: number; currency: string }) {
  return <span className="tabular-nums">{formatExactMoney(minor, currency)}</span>
}

export default async function AdminPaymentsOverviewPage() {
  await requirePaymentsAdmin()
  const [overview, capabilities, payoutsMode] = await Promise.all([
    getPaymentsOverview(readClient),
    getPaymentCapabilities().catch(() => ({ configured: false, provider: null, currencies: [] as string[] })),
    payoutsEnvironment(),
  ])

  const collectedRows = (['event', 'course', 'plan'] as PaymentType[]).flatMap((type) => {
    const rows = overview.collected.filter((row) => row.type === type)
    return rows.length ? rows : [{ type, currency: 'INR', payments: 0, collectedMinor: 0, refundedMinor: 0 }]
  })
  const ledger = overview.ledger.length ? overview.ledger : [{ currency: 'INR', feesMinor: 0, availableMinor: 0, pendingMinor: 0, inPayoutMinor: 0, paidMinor: 0 }]
  const attention = overview.payouts.unconfirmedCount + overview.payouts.failedCount

  return (
    <main className="space-y-6">
      <AdminPageHeader
        title="Payments"
        meta="Money collected, fees earned and what Sea N Shore owes sellers"
        actions={<Link href="/admin/payments/payouts" className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg bg-navy-950 px-3 text-sm font-semibold text-white hover:bg-navy-900">Payouts queue <ArrowRight aria-hidden="true" className="size-4" /></Link>}
      />
      <PaymentsAdminTabs />

      <AdminPanel>
        <div className="grid gap-px bg-mist-100 sm:grid-cols-2">
          <div className="bg-white px-5 py-4">
            <p className="text-xs font-semibold text-muted">Taking payments</p>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm font-semibold text-navy-950">
              {capabilities.configured
                ? <><AdminChip tone="success">On</AdminChip> {capabilities.provider === 'cashfree' ? 'Cashfree' : 'Razorpay'} · {capabilities.currencies.join(', ')}</>
                : <><AdminChip tone="warning">Not set up</AdminChip> Buyers see “opens soon” on paid events and courses.</>}
            </p>
          </div>
          <div className="bg-white px-5 py-4">
            <p className="text-xs font-semibold text-muted">Seller payouts</p>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm font-semibold text-navy-950">
              {payoutsMode
                ? <><AdminChip tone={payoutsMode === 'production' ? 'success' : 'info'}>{payoutsMode === 'production' ? 'Live' : 'Sandbox (test money)'}</AdminChip> Cashfree Payouts</>
                : <><AdminChip tone="warning">Not set up</AdminChip> Add the Cashfree Payouts keys to send payouts.</>}
            </p>
          </div>
        </div>
      </AdminPanel>

      {attention ? (
        <Link href="/admin/payments/payouts" className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-950 transition hover:bg-amber-100">
          <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-amber-800" />
          <span className="flex-1">
            {overview.payouts.unconfirmedCount ? `${overview.payouts.unconfirmedCount} payout${overview.payouts.unconfirmedCount === 1 ? ' was' : 's were'} not confirmed by Cashfree. ` : ''}
            {overview.payouts.failedCount ? `${overview.payouts.failedCount} payout${overview.payouts.failedCount === 1 ? '' : 's'} failed or bounced in the last 30 days. ` : ''}
            <span className="font-semibold underline-offset-2 hover:underline">Review payouts</span>
          </span>
        </Link>
      ) : null}

      <AdminPanel>
        <div className="border-b border-mist-100 px-5 py-3">
          <h3 className="text-sm font-bold text-navy-950">Collected from buyers</h3>
          <p className="text-xs text-muted">Every payment received, including ones refunded later.</p>
        </div>
        <div aria-hidden="true" className="hidden grid-cols-[minmax(0,1fr)_6rem_8.5rem_8.5rem_8.5rem] gap-4 bg-mist-50/60 px-5 py-2 text-xs font-bold uppercase tracking-[0.08em] text-muted md:grid">
          <span>Type</span><span className="text-right">Payments</span><span className="text-right">Collected</span><span className="text-right">Refunded</span><span className="text-right">Kept</span>
        </div>
        <ul aria-label="Collected by type" className="divide-y divide-mist-100">
          {collectedRows.map((row) => (
            <li key={`${row.type}-${row.currency}`} className="grid gap-1.5 px-5 py-2.5 text-sm md:grid-cols-[minmax(0,1fr)_6rem_8.5rem_8.5rem_8.5rem] md:items-center md:gap-4">
              <p className="font-semibold text-navy-950">
                {TYPE_LABELS[row.type]}{row.currency !== 'INR' ? ` (${row.currency})` : ''}
                {overview.unavailable.includes(row.type) ? <span className="block text-xs font-normal text-muted">Not recorded yet</span> : null}
              </p>
              <dl className="contents">
                {[
                  { label: 'Payments', value: <span className="tabular-nums">{row.payments}</span> },
                  { label: 'Collected', value: <Money minor={row.collectedMinor} currency={row.currency} /> },
                  { label: 'Refunded', value: <Money minor={row.refundedMinor} currency={row.currency} /> },
                  { label: 'Kept', value: <span className="font-semibold"><Money minor={row.collectedMinor - row.refundedMinor} currency={row.currency} /></span> },
                ].map((cell) => (
                  <div key={cell.label} className="flex justify-between gap-3 md:block md:text-right">
                    <dt className="text-xs text-muted md:sr-only">{cell.label}</dt>
                    <dd>{cell.value}</dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
      </AdminPanel>

      <AdminPanel>
        <div className="border-b border-mist-100 px-5 py-3">
          <h3 className="text-sm font-bold text-navy-950">Seller earnings and platform fees</h3>
          <p className="text-xs text-muted">From event ticket and course sales. Plans have no seller share.</p>
        </div>
        {ledger.map((row) => (
          <dl key={row.currency} className="grid grid-cols-1 gap-px bg-mist-100 min-[420px]:grid-cols-2 lg:grid-cols-5">
            {[
              { label: 'Platform fees earned', value: row.feesMinor, hint: 'Net of refunds' },
              { label: 'Owed: ready for payout', value: row.availableMinor, hint: 'Hold period over' },
              { label: 'Owed: on hold', value: row.pendingMinor, hint: 'Still inside the hold period' },
              { label: 'In payouts now', value: row.inPayoutMinor, hint: 'Sent, waiting for the bank' },
              { label: 'Paid out', value: row.paidMinor, hint: `${overview.payouts.paidOutCount} payout${overview.payouts.paidOutCount === 1 ? '' : 's'} completed` },
            ].map((stat) => (
              <div key={stat.label} className="bg-white px-5 py-3">
                <dt className="text-xs font-semibold text-muted">{stat.label}{ledger.length > 1 ? ` (${row.currency})` : ''}</dt>
                <dd className="mt-1 text-xl font-bold tracking-tight text-navy-950"><Money minor={stat.value} currency={row.currency} /></dd>
                <dd className="text-xs text-muted">{stat.hint}</dd>
              </div>
            ))}
          </dl>
        ))}
      </AdminPanel>

      {overview.unavailable.length ? (
        <p className="text-xs leading-5 text-muted">
          {overview.unavailable.map((type) => TYPE_LABELS[type]).join(' and ')}: no payments table is available yet, so they show as zero here.
        </p>
      ) : null}
    </main>
  )
}
