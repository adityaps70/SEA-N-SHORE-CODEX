import Link from 'next/link'
import { Info, Wallet } from 'lucide-react'
import { textLinkClass } from '@/components/ui/interactive-styles'
import type { SellerBalance } from '@/features/payments/earnings'
import type { EarningLine, PayoutLine } from '../payout-queries'
import {
  EARNING_STATUS_LABELS,
  formatExactMoney,
  formatPercentLabel,
  PAYOUT_STATUS_LABELS,
  SOURCE_TYPE_LABELS,
} from '../payout-rules'
import { formatDay, StatTile, StatusChip } from './money-ui'

export type EarningsViewProps = {
  sellerName: string
  kind: 'profile' | 'organization'
  balances: SellerBalance[]
  feePercent: string
  feeIsOverride: boolean
  holdDays: number
  minPayoutMinor: number
  sales: EarningLine[]
  salesHasMore: boolean
  payouts: PayoutLine[]
  payoutsConfigured: boolean
  hasPayoutAccount: boolean
  payoutDetailsHref: string
}

function emptyBalance(): SellerBalance {
  return { currency: 'INR', pendingMinor: 0, availableMinor: 0, inPayoutMinor: 0, paidMinor: 0, nextAvailableAt: null }
}

function BalanceTiles({ balance, minPayoutMinor }: { balance: SellerBalance; minPayoutMinor: number }) {
  const currency = balance.currency
  const owes = balance.availableMinor < 0
  return (
    <dl className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-4">
      <StatTile
        label="On hold"
        value={formatExactMoney(balance.pendingMinor, currency)}
        hint={balance.nextAvailableAt ? <>Next release <time dateTime={balance.nextAvailableAt}>{formatDay(balance.nextAvailableAt)}</time></> : 'Nothing waiting'}
      />
      <StatTile
        label="Ready for payout"
        emphasis
        value={formatExactMoney(balance.availableMinor, currency)}
        hint={owes
          ? 'Refunds after an earlier payout. This is deducted from your next sales.'
          : currency !== 'INR'
            ? 'USD earnings are paid by the Sea N Shore team directly.'
            : balance.availableMinor > 0 && balance.availableMinor < minPayoutMinor
              ? `Paid once it reaches ${formatExactMoney(minPayoutMinor)}`
              : 'Sent after a Sea N Shore review'}
      />
      <StatTile label="In a payout" value={formatExactMoney(balance.inPayoutMinor, currency)} hint={balance.inPayoutMinor ? 'On its way to your account' : 'Nothing on its way'} />
      <StatTile label="Paid out" value={formatExactMoney(balance.paidMinor, currency)} hint="All time" />
    </dl>
  )
}

function SaleRow({ line }: { line: EarningLine }) {
  const status = EARNING_STATUS_LABELS[line.status] ?? { label: line.status, tone: 'neutral' as const }
  const isAdjustment = line.sourceType === 'adjustment'
  const statusLabel = line.status === 'pending' ? `On hold until ${formatDay(line.availableAt)}` : isAdjustment && line.status === 'available' ? 'Deducted next payout' : status.label
  return (
    <li className="grid gap-2 px-5 py-3.5 text-sm lg:grid-cols-[minmax(0,1fr)_6.5rem_7.5rem_7rem_12rem] lg:items-center lg:gap-4">
      <div className="min-w-0">
        <p className="break-words font-semibold text-navy-950">{line.title}</p>
        <p className="text-xs text-muted">
          {isAdjustment ? 'Refund after payout' : SOURCE_TYPE_LABELS[line.baseSourceType]} · <time dateTime={line.soldAt}>{formatDay(line.soldAt)}</time>
        </p>
      </div>
      <dl className="contents">
        <div className="flex justify-between gap-3 lg:block lg:text-right">
          <dt className="text-xs text-muted lg:sr-only">Price paid</dt>
          <dd className="tabular-nums text-navy-900">{formatExactMoney(line.grossMinor, line.currency)}</dd>
        </div>
        <div className="flex justify-between gap-3 lg:block lg:text-right">
          <dt className="text-xs text-muted lg:sr-only">Platform fee</dt>
          <dd className="tabular-nums text-navy-900">
            {formatExactMoney(line.feeMinor, line.currency)} <span className="text-xs text-muted">({formatPercentLabel(line.feePercent)})</span>
          </dd>
        </div>
        <div className="flex justify-between gap-3 lg:block lg:text-right">
          <dt className="text-xs text-muted lg:sr-only">You receive</dt>
          <dd className={`font-bold tabular-nums ${line.netMinor < 0 ? 'text-red-700' : 'text-navy-950'}`}>{formatExactMoney(line.netMinor, line.currency)}</dd>
        </div>
        <div className="flex justify-between gap-3 lg:block lg:text-right">
          <dt className="text-xs text-muted lg:sr-only">Status</dt>
          <dd><StatusChip tone={status.tone}>{statusLabel}</StatusChip></dd>
        </div>
      </dl>
    </li>
  )
}

function PayoutRow({ payout }: { payout: PayoutLine }) {
  const status = PAYOUT_STATUS_LABELS[payout.status]
  const label = payout.status === 'draft' ? 'Being sent' : status.label
  return (
    <li className="grid gap-2 px-5 py-3.5 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4">
      <div className="min-w-0">
        <p className="font-bold tabular-nums text-navy-950">{formatExactMoney(payout.amountMinor)}</p>
        <p className="break-words text-xs text-muted">
          <time dateTime={payout.createdAt}>{formatDay(payout.createdAt)}</time>
          {payout.account ? ` · to ${payout.account.summary}` : ''}
        </p>
        {payout.utr ? <p className="mt-0.5 break-all text-xs text-navy-800">Bank reference (UTR): <span className="font-semibold">{payout.utr}</span></p> : null}
        {payout.status === 'failed' || payout.status === 'reversed'
          ? <p className="mt-0.5 text-xs leading-5 text-red-700">This payout didn&apos;t reach you, so the amount is back in your ready-for-payout balance. Check your payout details.</p>
          : null}
      </div>
      <div className="sm:text-right"><StatusChip tone={payout.status === 'draft' ? 'info' : status.tone}>{label}</StatusChip></div>
    </li>
  )
}

/** A seller's earnings: balances, how the money flows, each sale, and payout history. */
export function EarningsView(props: EarningsViewProps) {
  const balances = props.balances.length ? props.balances : [emptyBalance()]
  const who = props.kind === 'organization' ? props.sellerName : 'you'
  return (
    <div className="space-y-6">
      {!props.payoutsConfigured ? (
        <p role="status" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
          <span className="font-semibold">Payouts are not switched on yet.</span> Your earnings are recorded with every sale and keep adding up; they will be paid out once Sea N Shore opens payouts.
        </p>
      ) : !props.hasPayoutAccount ? (
        <p role="status" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
          <span className="font-semibold">Add payout details to get paid.</span> We need a bank account or UPI ID for {who === 'you' ? 'you' : who} before any payout can be sent.{' '}
          <Link href={props.payoutDetailsHref} className={textLinkClass}>Add payout details</Link>
        </p>
      ) : null}

      <div className="space-y-4">
        {balances.map((balance) => (
          <section key={balance.currency} aria-label={`Balance in ${balance.currency}`} className="space-y-2">
            {balances.length > 1 ? <h2 className="text-sm font-bold text-navy-950">{balance.currency === 'INR' ? 'Indian rupee (₹)' : 'US dollar ($)'}</h2> : null}
            <BalanceTiles balance={balance} minPayoutMinor={props.minPayoutMinor} />
          </section>
        ))}
      </div>

      <section className="flex gap-3 rounded-2xl border border-ocean-100 bg-ocean-50/50 p-4 text-sm leading-6 text-navy-800">
        <Info aria-hidden="true" className="mt-1 size-4 shrink-0 text-ocean-700" />
        <div>
          <h2 className="font-semibold text-navy-950">How you get paid</h2>
          <p>
            Buyers pay Sea N Shore. For every sale Sea N Shore keeps a platform fee of <span className="font-semibold">{formatPercentLabel(props.feePercent)}</span>
            {props.feeIsOverride ? ' (a rate agreed for this account)' : ''} and the rest is yours. Each sale is held for {props.holdDays} day{props.holdDays === 1 ? '' : 's'} after the event ends or the course is bought, in case of refunds, then it is ready for payout.
            The Sea N Shore team reviews and sends payouts to your saved payout details; the minimum payout is {formatExactMoney(props.minPayoutMinor)}.
            If a buyer is refunded after you were paid, that amount is deducted from your next payout.
          </p>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-mist-100 bg-white shadow-[var(--shadow-card)]">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-mist-100 px-5 py-4">
          <h2 className="text-lg font-semibold text-navy-950">Sales</h2>
          <p className="text-xs text-muted">{props.salesHasMore ? `Latest ${props.sales.length} sales` : `${props.sales.length} sale${props.sales.length === 1 ? '' : 's'}`}</p>
        </div>
        {props.sales.length ? (
          <>
            <div aria-hidden="true" className="hidden grid-cols-[minmax(0,1fr)_6.5rem_7.5rem_7rem_12rem] gap-4 border-b border-mist-100 bg-mist-50/60 px-5 py-2 text-xs font-bold uppercase tracking-[0.08em] text-muted lg:grid">
              <span>Sale</span><span className="text-right">Price paid</span><span className="text-right">Platform fee</span><span className="text-right">You receive</span><span className="text-right">Status</span>
            </div>
            <ul className="divide-y divide-mist-100">{props.sales.map((line) => <SaleRow key={line.id} line={line} />)}</ul>
          </>
        ) : (
          <div className="px-5 py-10 text-center">
            <Wallet aria-hidden="true" className="mx-auto size-6 text-muted" />
            <p className="mt-2 font-semibold text-navy-950">No sales yet</p>
            <p className="mt-1 text-sm text-muted">When someone buys a ticket to {props.kind === 'organization' ? 'this organization’s' : 'your'} paid event or a paid course, it appears here with the fee and your share.</p>
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded-2xl border border-mist-100 bg-white shadow-[var(--shadow-card)]">
        <h2 className="border-b border-mist-100 px-5 py-4 text-lg font-semibold text-navy-950">Payout history</h2>
        {props.payouts.length ? (
          <ul className="divide-y divide-mist-100">{props.payouts.map((payout) => <PayoutRow key={payout.id} payout={payout} />)}</ul>
        ) : (
          <p className="px-5 py-8 text-center text-sm text-muted">No payouts yet. Each payout appears here with its bank reference (UTR) once it is sent.</p>
        )}
      </section>
    </div>
  )
}
