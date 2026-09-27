import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { z } from 'zod'
import { backLinkClass } from '@/components/ui/interactive-styles'
import { AdminChip, AdminPageHeader, AdminPanel, formatAdminDate } from '@/features/admin/components/admin-ui'
import { requirePaymentsAdmin } from '@/features/payouts/admin-guard'
import { PayoutStatusActions } from '@/features/payouts/components/admin/payout-status-actions'
import { getPayoutLine, listPayoutAudit, listPayoutEarningLines } from '@/features/payouts/payout-queries'
import { formatExactMoney, formatPercentLabel, PAYOUT_STATUS_LABELS, SOURCE_TYPE_LABELS } from '@/features/payouts/payout-rules'
import { readClient } from '@/features/payouts/payout-runtime'

export const metadata: Metadata = { title: 'Payout · Payments · Admin' }
export const dynamic = 'force-dynamic'

const ACTION_LABELS: Record<string, string> = {
  payout_approved: 'Approved and handed to Cashfree',
  payout_processing: 'Cashfree accepted the transfer',
  payout_success: 'Paid: the bank confirmed',
  payout_failed: 'Transfer failed; earnings released',
  payout_reversed: 'Returned by the bank; earnings released',
  payout_cancelled: 'Cancelled; earnings released',
  payout_send_unconfirmed: 'Cashfree did not confirm the send',
  transfer_amount_mismatch: 'Cashfree reported a different amount (not applied)',
}

export default async function AdminPayoutDetailPage({ params }: { params: Promise<{ payoutId: string }> }) {
  await requirePaymentsAdmin()
  const { payoutId } = await params
  if (!z.string().uuid().safeParse(payoutId).success) notFound()
  const [payout, lines, audit] = await Promise.all([
    getPayoutLine(readClient, payoutId),
    listPayoutEarningLines(readClient, payoutId),
    listPayoutAudit(readClient, payoutId),
  ])
  if (!payout) notFound()
  const status = PAYOUT_STATUS_LABELS[payout.status]

  const facts = [
    { label: 'Amount', value: formatExactMoney(payout.amountMinor) },
    { label: 'Paid to', value: payout.account ? `${payout.account.summary} (${payout.account.holderName})` : '—' },
    { label: 'Bank reference (UTR)', value: payout.utr ?? '—' },
    { label: 'Transfer ID', value: payout.transferId },
    { label: 'Cashfree reference', value: payout.cfTransferId ?? '—' },
    { label: 'Cashfree status', value: [payout.providerStatus, payout.providerStatusCode].filter(Boolean).join(' · ') || '—' },
    { label: 'Created', value: formatAdminDate(payout.createdAt, true) },
    { label: 'Finished', value: formatAdminDate(payout.completedAt, true) },
    { label: 'Last checked with Cashfree', value: formatAdminDate(payout.lastCheckedAt, true) },
  ]

  return (
    <main className="space-y-6">
      <Link href="/admin/payments/payouts" className={backLinkClass}>
        <ArrowLeft aria-hidden="true" className="size-4" /> Payouts queue
      </Link>
      <AdminPageHeader
        title={`Payout to ${payout.sellerIdentity.name}`}
        meta={<AdminChip tone={status.tone}>{status.label}</AdminChip>}
      />

      {payout.failureReason && payout.status !== 'success' ? (
        <p className={`rounded-xl border px-5 py-3 text-sm leading-6 ${payout.status === 'draft' ? 'border-amber-200 bg-amber-50 text-amber-950' : 'border-red-200 bg-red-50 text-red-800'}`}>{payout.failureReason}</p>
      ) : null}

      <AdminPanel>
        <dl className="grid gap-px bg-mist-100 sm:grid-cols-2 lg:grid-cols-3">
          {facts.map((fact) => (
            <div key={fact.label} className="min-w-0 bg-white px-5 py-3">
              <dt className="text-xs font-semibold text-muted">{fact.label}</dt>
              <dd className="mt-0.5 break-words text-sm font-semibold text-navy-950">{fact.value}</dd>
            </div>
          ))}
        </dl>
        {payout.status === 'draft' || payout.status === 'processing' || payout.status === 'success' ? (
          <div className="border-t border-mist-100 px-5 py-4">
            <PayoutStatusActions payoutId={payout.id} status={payout.status} amountLabel={formatExactMoney(payout.amountMinor)} />
          </div>
        ) : null}
      </AdminPanel>

      <AdminPanel>
        <div className="border-b border-mist-100 px-5 py-3">
          <h3 className="text-sm font-bold text-navy-950">Sales in this payout</h3>
          {payout.status === 'failed' || payout.status === 'reversed' || payout.status === 'cancelled'
            ? <p className="text-xs text-muted">These went back to the seller&apos;s available balance and can be paid in a new payout.</p>
            : null}
        </div>
        <ul className="divide-y divide-mist-100">
          {lines.map((line) => (
            <li key={line.id} className="grid gap-1 px-5 py-2.5 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4">
              <div className="min-w-0">
                <p className="break-words font-semibold text-navy-950">{line.title}</p>
                <p className="text-xs text-muted">{line.sourceType === 'adjustment' ? 'Refund after an earlier payout' : SOURCE_TYPE_LABELS[line.baseSourceType]} · {formatAdminDate(line.soldAt)} · fee {formatPercentLabel(line.feePercent)}</p>
              </div>
              <p className={`font-semibold tabular-nums sm:text-right ${line.netMinor < 0 ? 'text-red-700' : 'text-navy-950'}`}>{formatExactMoney(line.netMinor, line.currency)}</p>
            </li>
          ))}
        </ul>
      </AdminPanel>

      <AdminPanel>
        <div className="border-b border-mist-100 px-5 py-3">
          <h3 className="text-sm font-bold text-navy-950">History</h3>
        </div>
        {audit.length ? (
          <ul className="divide-y divide-mist-100 text-sm">
            {audit.map((entry) => (
              <li key={entry.id} className="grid gap-1 px-5 py-2.5 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-4">
                <time dateTime={entry.createdAt} className="text-xs text-muted">{formatAdminDate(entry.createdAt, true)}</time>
                <p className="min-w-0 break-words text-navy-950">
                  {ACTION_LABELS[entry.action] ?? entry.action}
                  <span className="text-muted"> — {entry.actorType === 'provider' ? 'Cashfree' : entry.actorName ?? (entry.actorType === 'system' ? 'Sea N Shore' : 'Administrator')}</span>
                  {entry.note ? <span className="block text-xs text-muted">{entry.note}</span> : null}
                </p>
              </li>
            ))}
          </ul>
        ) : <p className="px-5 py-4 text-sm text-muted">No history recorded.</p>}
      </AdminPanel>
    </main>
  )
}
