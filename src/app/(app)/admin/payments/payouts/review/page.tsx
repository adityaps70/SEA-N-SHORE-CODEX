import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { withTransaction } from '@/lib/db/client'
import { backLinkClass, textLinkClass } from '@/components/ui/interactive-styles'
import { AdminChip, AdminPageHeader, AdminPanel, formatAdminDate } from '@/features/admin/components/admin-ui'
import { releaseAvailableEarnings } from '@/features/payments/earnings'
import { requirePaymentsAdmin } from '@/features/payouts/admin-guard'
import { SendPayoutPanel } from '@/features/payouts/components/admin/send-payout-panel'
import { getSellerIdentity, listAwaitingInvoiceLines, listPayableEarningLines } from '@/features/payouts/payout-queries'
import { findOpenPayout, getActivePayoutAccount, getPayoutSettings } from '@/features/payouts/payout-repository'
import { planPayoutTax } from '@/features/payouts/payout-tax'
import { listPeriods } from '@/features/payouts/seller-invoice-rules'
import { formatRateBasisPoints } from '@/features/payouts/tds'
import { formatExactMoney, formatPercentLabel, maskPayoutAccount, parseSellerKey, SOURCE_TYPE_LABELS } from '@/features/payouts/payout-rules'
import { arePayoutsConfigured } from '@/features/payouts/payout-runtime'
import { single } from '@/features/payouts/seller-context'
import { requireAdminAccess } from '@/features/admin/admin-access'

export const metadata: Metadata = { title: 'Review payout · Payments · Admin' }
export const dynamic = 'force-dynamic'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

export default async function ReviewPayoutPage({ searchParams }: { searchParams: SearchParams }) {
  // Round GP (Part C): platform administrators only (default deny for country admins).
  await requireAdminAccess('platform')
  await requirePaymentsAdmin()
  const params = await searchParams
  const seller = parseSellerKey(single(params.seller))
  if (!seller) notFound()

  const data = await withTransaction(async (tx) => {
    await releaseAvailableEarnings(tx)
    const identity = await getSellerIdentity(tx, seller)
    if (!identity) return null
    const [lines, awaiting, account, open, settings] = await Promise.all([
      listPayableEarningLines(tx, seller),
      listAwaitingInvoiceLines(tx, seller),
      getActivePayoutAccount(tx, seller),
      findOpenPayout(tx, seller),
      getPayoutSettings(tx),
    ])
    const grossMinor = lines.reduce((sum, line) => sum + line.netMinor, 0)
    const coursePartMinor = lines.filter((line) => line.baseSourceType === 'course_purchase').reduce((sum, line) => sum + line.netMinor, 0)
    // The same TDS createPayout will deduct (it refuses to send if this changes in between).
    const tax = await planPayoutTax(tx, { seller, grossMinor, coursePartMinor, now: new Date() })
    return { identity, lines, awaiting, account, open, settings, tax }
  })
  if (!data) notFound()
  const configured = await arePayoutsConfigured()

  const total = data.lines.reduce((sum, line) => sum + line.netMinor, 0)
  const awaitingPeriods = [...new Set(data.awaiting.map((line) => line.period).filter((period): period is string => Boolean(period)))].sort()
  const awaitingMinor = data.awaiting.reduce((sum, line) => sum + line.netMinor, 0)
  const tax = data.tax
  const net = tax.netMinor
  const gross = data.lines.filter((line) => line.sourceType !== 'adjustment').reduce((sum, line) => sum + line.grossMinor, 0)
  const saleFees = data.lines.filter((line) => line.sourceType !== 'adjustment').reduce((sum, line) => sum + line.feeMinor, 0)
  const deductions = data.lines.filter((line) => line.sourceType === 'adjustment').reduce((sum, line) => sum + line.netMinor, 0)
  const masked = data.account ? maskPayoutAccount(data.account) : null

  const blocker = data.open
    ? { text: 'This seller already has a payout in progress. Finish or check that one first.', link: `/admin/payments/payouts/${data.open.id}`, linkLabel: 'Open the payout in progress' }
    : !configured
      ? { text: 'Cashfree Payouts is not set up, so this payout cannot be sent yet.', link: null, linkLabel: null }
      : !data.account
        ? { text: "This seller hasn't added payout details yet. Ask them to add a bank account or UPI ID under Settings → Payout details.", link: null, linkLabel: null }
        : (!data.lines.length || total <= 0) && awaitingPeriods.length
          ? { text: `The seller's course earnings can't be paid until their invoice for ${listPeriods(awaitingPeriods)} is approved.`, link: '/admin/payments/seller-invoices', linkLabel: 'Review seller invoices' }
          : !data.lines.length
            ? { text: 'Nothing is ready for payout for this seller right now.', link: null, linkLabel: null }
            : total <= 0
              ? { text: 'Refunds after an earlier payout cancel out the new earnings, so there is nothing to pay.', link: null, linkLabel: null }
              : total < data.settings.minPayoutMinor
                ? { text: `The total is below the minimum payout of ${formatExactMoney(data.settings.minPayoutMinor)}.`, link: null, linkLabel: null }
                : tax.blocker === 'tds_rate_unset'
                  ? { text: 'The TDS rate for course payouts is not set yet, so course earnings cannot be paid. Set it first.', link: '/admin/payments/tax', linkLabel: 'Tax settings' }
                  : tax.blocker === 'pan_missing'
                    ? { text: "This seller hasn't added their PAN yet, so course earnings can't be paid (TDS needs it). Ask them to add their tax details under Settings → Payout details.", link: null, linkLabel: null }
                    : net <= 0
                      ? { text: 'After TDS there is nothing left to transfer.', link: null, linkLabel: null }
                      : null

  return (
    <div className="space-y-6">
      <Link href="/admin/payments/payouts" className={backLinkClass}>
        <ArrowLeft aria-hidden="true" className="size-4" /> Payouts queue
      </Link>
      <AdminPageHeader
        title={`Payout to ${data.identity.name}`}
        meta={data.identity.kind === 'organization' ? 'Organization' : 'Member'}
        description="Check the sales included and the account the money goes to, then send it through Cashfree."
      />

      <AdminPanel>
        <dl className="grid gap-px bg-mist-100 sm:grid-cols-3">
          <div className="bg-white px-5 py-3">
            <dt className="text-xs font-semibold text-muted">Amount to send</dt>
            <dd className="mt-1 text-2xl font-bold tabular-nums tracking-tight text-navy-950">{formatExactMoney(net)}</dd>
            <dd className="text-xs text-muted">
              {data.lines.length} item{data.lines.length === 1 ? '' : 's'}
              {tax.tdsMinor > 0 ? <> · {formatExactMoney(total)} earnings − {formatExactMoney(tax.tdsMinor)} TDS</> : null}
            </dd>
          </div>
          <div className="bg-white px-5 py-3">
            <dt className="text-xs font-semibold text-muted">Sales minus platform fee</dt>
            <dd className="mt-1 text-sm leading-6 text-navy-900">
              <span className="tabular-nums">{formatExactMoney(gross)}</span> sales − <span className="tabular-nums">{formatExactMoney(saleFees)}</span> platform fees
              {deductions ? <> − <span className="tabular-nums">{formatExactMoney(-deductions)}</span> refunds after payout</> : null}
            </dd>
          </div>
          <div className="bg-white px-5 py-3">
            <dt className="text-xs font-semibold text-muted">Paid to</dt>
            {data.account && masked ? (
              <>
                <dd className="mt-1 break-words text-sm font-semibold text-navy-950">{masked.summary}</dd>
                <dd className="break-words text-xs text-muted">
                  {data.account.holderName} · added {formatAdminDate(data.account.createdAt)}{' '}
                  {data.account.providerVerified ? <AdminChip tone="success">Bank verified</AdminChip> : null}
                </dd>
              </>
            ) : <dd className="mt-1 text-sm font-semibold text-amber-900">No payout details</dd>}
          </div>
        </dl>
      </AdminPanel>

      {tax.applies ? (
        <AdminPanel>
          <div className="border-b border-mist-100 px-5 py-3">
            <h3 className="text-sm font-bold text-navy-950">TDS on course earnings</h3>
            <p className="text-xs text-muted">
              Section {tax.section} at {formatRateBasisPoints(tax.rateBasisPoints)}
              {tax.thresholdMinor !== null ? `, once the seller's course total for ${tax.financialYear} passes ${formatExactMoney(tax.thresholdMinor)}` : ', from the first rupee (no threshold set)'}.
              {' '}The year&apos;s TDS is caught up on each course payout.
            </p>
          </div>
          <dl className="grid gap-px bg-mist-100 sm:grid-cols-4">
            {[
              ['Gross (all earnings)', formatExactMoney(total)],
              ['Course part (TDS base)', formatExactMoney(Math.max(tax.coursePartMinor, 0))],
              ['TDS deducted', tax.blocker ? '—' : formatExactMoney(tax.tdsMinor)],
              ['Net transferred', tax.blocker ? '—' : formatExactMoney(net)],
            ].map(([label, value]) => (
              <div key={label} className="bg-white px-5 py-3">
                <dt className="text-xs font-semibold text-muted">{label}</dt>
                <dd className="mt-0.5 text-sm font-semibold tabular-nums text-navy-950">{value}</dd>
              </div>
            ))}
          </dl>
          {tax.tds ? (
            <p className="border-t border-mist-100 px-5 py-2.5 text-xs leading-5 text-muted">
              Course total this financial year with this payout: {formatExactMoney(tax.tds.fyGrossMinor)}{tax.tds.thresholdCrossed ? ` · TDS due on it: ${formatExactMoney(tax.tds.targetMinor)}` : ' · below the threshold, no TDS yet'}.
            </p>
          ) : null}
        </AdminPanel>
      ) : null}

      {awaitingPeriods.length ? (
        <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-3 text-sm leading-6 text-amber-950">
          Not included: {formatExactMoney(awaitingMinor)} of course earnings for {listPeriods(awaitingPeriods)}, waiting for the seller&apos;s approved invoice.{' '}
          <Link href="/admin/payments/seller-invoices" className={textLinkClass}>Seller invoices</Link>
        </p>
      ) : null}

      <AdminPanel>
        <div className="border-b border-mist-100 px-5 py-3">
          <h3 className="text-sm font-bold text-navy-950">Included in this payout</h3>
        </div>
        {data.lines.length ? (
          <>
            <div aria-hidden="true" className="hidden grid-cols-[minmax(0,1fr)_7rem_8.5rem_7.5rem] gap-4 bg-mist-50/60 px-5 py-2 text-xs font-bold uppercase tracking-[0.08em] text-muted md:grid">
              <span>Sale</span><span className="text-right">Price paid</span><span className="text-right">Fee</span><span className="text-right">Seller gets</span>
            </div>
            <ul aria-label="Sales included" className="divide-y divide-mist-100">
              {data.lines.map((line) => (
                <li key={line.id} className="grid gap-1.5 px-5 py-2.5 text-sm md:grid-cols-[minmax(0,1fr)_7rem_8.5rem_7.5rem] md:items-center md:gap-4">
                  <div className="min-w-0">
                    <p className="break-words font-semibold text-navy-950">{line.title}</p>
                    <p className="text-xs text-muted">{line.sourceType === 'adjustment' ? 'Refund after an earlier payout' : SOURCE_TYPE_LABELS[line.baseSourceType]} · {formatAdminDate(line.soldAt)}</p>
                  </div>
                  <dl className="contents">
                    <div className="flex justify-between gap-3 md:block md:text-right">
                      <dt className="text-xs text-muted md:sr-only">Price paid</dt>
                      <dd className="tabular-nums">{formatExactMoney(line.grossMinor, line.currency)}</dd>
                    </div>
                    <div className="flex justify-between gap-3 md:block md:text-right">
                      <dt className="text-xs text-muted md:sr-only">Fee</dt>
                      <dd className="tabular-nums">{formatExactMoney(line.feeMinor, line.currency)} <span className="text-xs text-muted">({formatPercentLabel(line.feePercent)})</span></dd>
                    </div>
                    <div className="flex justify-between gap-3 md:block md:text-right">
                      <dt className="text-xs text-muted md:sr-only">Seller gets</dt>
                      <dd className={`font-semibold tabular-nums ${line.netMinor < 0 ? 'text-red-700' : 'text-navy-950'}`}>{formatExactMoney(line.netMinor, line.currency)}</dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>
            <p className="flex items-baseline justify-between gap-4 border-t border-mist-200 px-5 py-3">
              <span className="font-semibold text-navy-950">Total</span>
              <span className="text-base font-bold tabular-nums text-navy-950">{formatExactMoney(total)}</span>
            </p>
          </>
        ) : <p className="px-5 py-6 text-sm text-muted">No sales are ready for payout.</p>}
      </AdminPanel>

      <AdminPanel className="p-5">
        {blocker ? (
          <p role="status" className="text-sm leading-6 text-amber-950">
            {blocker.text}{' '}
            {blocker.link ? <Link href={blocker.link} className={textLinkClass}>{blocker.linkLabel}</Link> : null}
          </p>
        ) : (
          <SendPayoutPanel
            sellerKey={single(params.seller)}
            sellerName={data.identity.name}
            earningIds={data.lines.map((line) => line.id)}
            totalMinor={total}
            tdsMinor={tax.tdsMinor}
            amountLabel={formatExactMoney(net)}
            tdsLabel={tax.tdsMinor > 0 ? formatExactMoney(tax.tdsMinor) : null}
            accountSummary={masked!.summary}
          />
        )}
      </AdminPanel>
    </div>
  )
}
