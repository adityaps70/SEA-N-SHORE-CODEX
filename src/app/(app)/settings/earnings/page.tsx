import type { Metadata } from 'next'
import Link from 'next/link'
import { MobilePageBar } from '@/components/navigation/mobile-page-bar'
import { ArrowLeft } from 'lucide-react'
import { withTransaction } from '@/lib/db/client'
import { backLinkClass, textLinkClass } from '@/components/ui/interactive-styles'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { getPlatformFeeSettings, getSellerBalance, releaseAvailableEarnings } from '@/features/payments/earnings'
import { EarningsView } from '@/features/payouts/components/earnings-view'
import { SellerSwitcher } from '@/features/payouts/components/money-ui'
import { getSellerFeePercent, listSellerEarnings, listSellerPayouts } from '@/features/payouts/payout-queries'
import { SellerInvoiceMonths } from '@/features/payouts/components/seller-invoice-months'
import { getActivePayoutAccount, getPayoutSettings } from '@/features/payouts/payout-repository'
import { getPayoutTaxProfile } from '@/features/payouts/payout-tax'
import { listSellerInvoiceMonths } from '@/features/payouts/seller-invoices'
import { arePayoutsConfigured, readClient } from '@/features/payouts/payout-runtime'
import { loadSellerOptions, single } from '@/features/payouts/seller-context'

export const metadata: Metadata = { title: 'Earnings · Settings' }
export const dynamic = 'force-dynamic'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

export default async function EarningsPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireAwsUser()
  const params = await searchParams
  const { options, active } = await loadSellerOptions(readClient, user.id, single(params.for))

  // Sales whose hold period has passed become "ready for payout" before we read.
  const data = await withTransaction(async (tx) => {
    await releaseAvailableEarnings(tx)
    const [balances, sales, payouts, feeSettings, override, payoutSettings, account, invoiceMonths, taxProfile] = await Promise.all([
      getSellerBalance(active.seller, { client: tx }),
      listSellerEarnings(tx, active.seller, { limit: 100 }),
      listSellerPayouts(tx, active.seller, 50),
      getPlatformFeeSettings(tx),
      getSellerFeePercent(tx, active.seller),
      getPayoutSettings(tx),
      getActivePayoutAccount(tx, active.seller),
      listSellerInvoiceMonths(tx, active.seller),
      getPayoutTaxProfile(tx, active.seller),
    ])
    return { balances, sales, payouts, feeSettings, override, payoutSettings, account, invoiceMonths, taxProfile }
  })
  const configured = await arePayoutsConfigured()
  const payoutDetailsHref = '/settings/payouts'

  return (
    <div className="mx-auto w-full max-w-page-narrow space-y-6 py-2 max-md:space-y-4 max-md:pt-0 sm:py-5">
      <MobilePageBar backHref="/settings" title={active.kind === 'organization' ? `Earnings · ${active.name}` : 'Earnings'} />
      <header className="space-y-3">
        <Link href="/settings" className={`${backLinkClass} max-md:hidden`}>
          <ArrowLeft aria-hidden="true" className="size-4" /> Settings
        </Link>
        {/* Phones: title in the page bar; Payout details is its own row in Settings. */}
        <div className="max-md:hidden">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-ocean-700">Account</p>
          <h1 className="mt-1 break-words text-3xl font-semibold tracking-tight text-navy-950">
            {active.kind === 'organization' ? `Earnings · ${active.name}` : 'Earnings'}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
            What {active.kind === 'organization' ? 'this organization has' : 'you have'} earned from paid event tickets and courses, after the Sea N Shore platform fee.{' '}
            <Link href={payoutDetailsHref} className={textLinkClass}>Payout details</Link>
          </p>
        </div>
        <SellerSwitcher
          label="Whose earnings"
          options={options.map((option) => ({
            key: option.key,
            label: option.name,
            href: option.kind === 'profile' ? '/settings/earnings' : `/settings/earnings?for=${encodeURIComponent(option.key)}`,
            active: option.key === active.key,
          }))}
        />
      </header>

      <EarningsView
        sellerName={active.name}
        kind={active.kind}
        balances={data.balances}
        feePercent={data.override ?? data.feeSettings.defaultPercent}
        feeIsOverride={Boolean(data.override)}
        holdDays={data.feeSettings.holdDays}
        minPayoutMinor={data.payoutSettings.minPayoutMinor}
        sales={data.sales.lines}
        salesHasMore={data.sales.hasMore}
        payouts={data.payouts}
        payoutsConfigured={configured}
        hasPayoutAccount={Boolean(data.account)}
        payoutDetailsHref={payoutDetailsHref}
        invoiceSection={data.invoiceMonths.length || data.taxProfile ? (
          <SellerInvoiceMonths
            sellerKey={active.key}
            kind={active.kind}
            months={data.invoiceMonths}
            gstRegistered={data.taxProfile ? data.taxProfile.gstRegistered : null}
            taxDetailsHref={payoutDetailsHref}
          />
        ) : null}
      />
    </div>
  )
}
