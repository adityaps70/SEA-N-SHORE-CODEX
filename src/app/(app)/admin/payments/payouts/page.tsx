import type { Metadata } from 'next'
import Link from 'next/link'
import { withTransaction } from '@/lib/db/client'
import { textLinkClass } from '@/components/ui/interactive-styles'
import { AdminChip, AdminEmptyState, AdminPageHeader, AdminPanel, formatAdminDate } from '@/features/admin/components/admin-ui'
import { releaseAvailableEarnings } from '@/features/payments/earnings'
import { requirePaymentsAdmin } from '@/features/payouts/admin-guard'
import { PaymentsAdminTabs } from '@/features/payouts/components/admin/payments-admin-tabs'
import { PayoutStatusActions } from '@/features/payouts/components/admin/payout-status-actions'
import { listPayoutQueue, listPayouts, type PayoutLine, type PayoutQueueLine } from '@/features/payouts/payout-queries'
import { getPayoutSettings } from '@/features/payouts/payout-repository'
import { formatExactMoney, PAYOUT_STATUS_LABELS, sellerKey } from '@/features/payouts/payout-rules'
import { arePayoutsConfigured } from '@/features/payouts/payout-runtime'

export const metadata: Metadata = { title: 'Payouts · Payments · Admin' }
export const dynamic = 'force-dynamic'

function sellerHref(line: { sellerIdentity: PayoutLine['sellerIdentity'] }) {
  const { slug, kind } = line.sellerIdentity
  if (!slug) return null
  return kind === 'organization' ? `/organizations/${slug}` : `/profile/${slug}`
}

function SellerName({ line }: { line: { sellerIdentity: PayoutLine['sellerIdentity'] } }) {
  const href = sellerHref(line)
  return (
    <span className="min-w-0">
      {href ? <Link href={href} className={`${textLinkClass} break-words`}>{line.sellerIdentity.name}</Link> : <span className="break-words font-semibold text-navy-950">{line.sellerIdentity.name}</span>}
      <span className="ml-1.5 text-xs text-muted">{line.sellerIdentity.kind === 'organization' ? 'Organization' : 'Member'}</span>
    </span>
  )
}

function QueueAction({ line, minPayoutMinor, configured }: { line: PayoutQueueLine; minPayoutMinor: number; configured: boolean }) {
  if (line.openPayout) return <AdminChip tone="info">Payout in progress</AdminChip>
  if (line.currency !== 'INR') return <span className="text-xs leading-5 text-muted">USD balance: pay outside Cashfree</span>
  if (line.availableMinor <= 0) return <span className="text-xs leading-5 text-muted">Owes {formatExactMoney(-line.availableMinor)} from refunds; deducted from future sales</span>
  if (line.availableMinor < minPayoutMinor) return <span className="text-xs leading-5 text-muted">Below the {formatExactMoney(minPayoutMinor)} minimum</span>
  if (!line.account) return <span className="text-xs leading-5 text-amber-900">Waiting for payout details</span>
  if (!configured) return <span className="text-xs leading-5 text-muted">Cashfree Payouts not set up</span>
  return (
    <Link
      href={`/admin/payments/payouts/review?seller=${encodeURIComponent(sellerKey(line.sellerIdentity.seller))}`}
      className="inline-flex min-h-9 cursor-pointer items-center rounded-lg bg-navy-950 px-3 text-sm font-semibold text-white transition hover:bg-navy-900"
    >
      Create payout
    </Link>
  )
}

function PayoutRow({ payout, withActions }: { payout: PayoutLine; withActions: boolean }) {
  const status = PAYOUT_STATUS_LABELS[payout.status]
  return (
    <li className="grid gap-2 px-5 py-3 text-sm md:grid-cols-[minmax(0,1fr)_auto] md:items-start md:gap-4">
      <div className="min-w-0 space-y-0.5">
        <p className="flex flex-wrap items-baseline gap-x-2"><SellerName line={payout} /></p>
        <p className="break-words text-xs text-muted">
          {formatAdminDate(payout.createdAt, true)}{payout.account ? ` · ${payout.account.summary}` : ''}
          {payout.utr ? <> · UTR <span className="font-semibold text-navy-900">{payout.utr}</span></> : null}
        </p>
        {payout.failureReason && payout.status !== 'success'
          ? <p className={`break-words text-xs leading-5 ${payout.status === 'draft' ? 'text-amber-900' : 'text-red-700'}`}>{payout.failureReason}</p>
          : null}
        <Link href={`/admin/payments/payouts/${payout.id}`} className={`${textLinkClass} text-xs`}>View details</Link>
      </div>
      <div className="flex flex-col gap-2 md:items-end">
        <div className="flex items-center gap-2 md:justify-end">
          <p className="font-bold tabular-nums text-navy-950">{formatExactMoney(payout.amountMinor)}</p>
          <AdminChip tone={status.tone}>{status.label}</AdminChip>
        </div>
        {withActions ? <PayoutStatusActions payoutId={payout.id} status={payout.status} amountLabel={formatExactMoney(payout.amountMinor)} compact /> : null}
      </div>
    </li>
  )
}

export default async function AdminPayoutsQueuePage() {
  await requirePaymentsAdmin()
  const data = await withTransaction(async (tx) => {
    await releaseAvailableEarnings(tx)
    const [queue, open, recent, settings] = await Promise.all([
      listPayoutQueue(tx),
      listPayouts(tx, { statuses: ['draft', 'processing'], limit: 100 }),
      listPayouts(tx, { statuses: ['success', 'failed', 'reversed', 'cancelled'], limit: 30 }),
      getPayoutSettings(tx),
    ])
    return { queue, open, recent, settings }
  })
  const configured = await arePayoutsConfigured()
  const payable = data.queue.filter((line) => line.currency === 'INR' && line.availableMinor >= data.settings.minPayoutMinor && line.account && !line.openPayout)
  const payableTotal = payable.reduce((sum, line) => sum + line.availableMinor, 0)

  return (
    <main className="space-y-6">
      <AdminPageHeader
        title="Payments"
        meta={payable.length ? `${payable.length} seller${payable.length === 1 ? '' : 's'} ready · ${formatExactMoney(payableTotal)}` : 'No payouts ready to send'}
        description="Sellers are paid their share after the hold period. Create a payout, check what it includes, then send it through Cashfree."
      />
      <PaymentsAdminTabs />

      {!configured ? (
        <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-3 text-sm leading-6 text-amber-950">
          <span className="font-semibold">Cashfree Payouts is not set up.</span> You can see what each seller is owed, but payouts can&apos;t be sent until the Cashfree Payouts API keys are added to the Cashfree secret.
        </p>
      ) : null}

      {data.open.length ? (
        <AdminPanel>
          <div className="border-b border-mist-100 px-5 py-3">
            <h3 className="text-sm font-bold text-navy-950">In progress</h3>
            <p className="text-xs text-muted">Payouts that Cashfree has not finished yet. Status updates arrive automatically; Check status asks Cashfree now.</p>
          </div>
          <ul className="divide-y divide-mist-100">{data.open.map((payout) => <PayoutRow key={payout.id} payout={payout} withActions />)}</ul>
        </AdminPanel>
      ) : null}

      <AdminPanel>
        <div className="border-b border-mist-100 px-5 py-3">
          <h3 className="text-sm font-bold text-navy-950">Balances owed to sellers</h3>
          <p className="text-xs text-muted">Minimum payout {formatExactMoney(data.settings.minPayoutMinor)}. Refunds after an earlier payout are already deducted.</p>
        </div>
        {data.queue.length ? (
          <ul className="divide-y divide-mist-100">
            {data.queue.map((line) => (
              <li key={`${sellerKey(line.sellerIdentity.seller)}-${line.currency}`} className="grid gap-2 px-5 py-3 text-sm md:grid-cols-[minmax(0,1fr)_9rem_12rem] md:items-center md:gap-4">
                <div className="min-w-0 space-y-0.5">
                  <p className="flex flex-wrap items-baseline gap-x-2"><SellerName line={line} /></p>
                  <p className="break-words text-xs text-muted">
                    {line.earningCount} item{line.earningCount === 1 ? '' : 's'} · {line.account ? line.account.masked.summary : 'No payout details yet'}
                  </p>
                </div>
                <p className={`font-bold tabular-nums md:text-right ${line.availableMinor < 0 ? 'text-red-700' : 'text-navy-950'}`}>{formatExactMoney(line.availableMinor, line.currency)}</p>
                <div className="md:text-right"><QueueAction line={line} minPayoutMinor={data.settings.minPayoutMinor} configured={configured} /></div>
              </li>
            ))}
          </ul>
        ) : (
          <AdminEmptyState title="Nobody is owed a payout right now" description="Sales appear here once their hold period is over." />
        )}
      </AdminPanel>

      <AdminPanel>
        <div className="border-b border-mist-100 px-5 py-3">
          <h3 className="text-sm font-bold text-navy-950">Recent payouts</h3>
        </div>
        {data.recent.length ? (
          <ul className="divide-y divide-mist-100">{data.recent.map((payout) => <PayoutRow key={payout.id} payout={payout} withActions={payout.status === 'success'} />)}</ul>
        ) : (
          <AdminEmptyState title="No payouts yet" description="Completed, failed and cancelled payouts are listed here with their bank reference." />
        )}
      </AdminPanel>
    </main>
  )
}
