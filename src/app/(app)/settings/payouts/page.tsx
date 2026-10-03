import type { Metadata } from 'next'
import Link from 'next/link'
import { MobilePageBar } from '@/components/navigation/mobile-page-bar'
import { ArrowLeft, Clock3 } from 'lucide-react'
import { backLinkClass, textLinkClass } from '@/components/ui/interactive-styles'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { PayoutAccountPanel } from '@/features/payouts/components/payout-account-panel'
import { getActivePayoutAccount, hasOpenPayout } from '@/features/payouts/payout-repository'
import { maskPayoutAccount } from '@/features/payouts/payout-rules'
import { arePayoutsConfigured, readClient } from '@/features/payouts/payout-runtime'
import { loadSellerOptions } from '@/features/payouts/seller-context'

export const metadata: Metadata = { title: 'Payout details · Settings' }
export const dynamic = 'force-dynamic'

export default async function PayoutSettingsPage() {
  const user = await requireAwsUser()
  const [{ options }, configured] = await Promise.all([
    loadSellerOptions(readClient, user.id, null),
    arePayoutsConfigured(),
  ])
  const sellers = configured
    ? await Promise.all(options.map(async (option) => ({
        option,
        account: await getActivePayoutAccount(readClient, option.seller),
        busy: await hasOpenPayout(readClient, option.seller),
      })))
    : []

  return (
    <main className="mx-auto w-full max-w-4xl space-y-6 py-2 max-md:space-y-4 max-md:pt-0 sm:py-5">
      <MobilePageBar backHref="/settings" title="Payout details" />
      {/* Phones: title in the page bar; Earnings is its own row in Settings. */}
      <header className="max-md:hidden">
        <Link href="/settings" className={backLinkClass}>
          <ArrowLeft aria-hidden="true" className="size-4" /> Settings
        </Link>
        <p className="mt-2 text-xs font-bold uppercase tracking-[0.16em] text-ocean-700">Account</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-navy-950">Payout details</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
          Where Sea N Shore sends your share of event ticket and course sales{options.length > 1 ? ', for you and for the organizations you own or administer' : ''}.{' '}
          <Link href="/settings/earnings" className={textLinkClass}>See your earnings</Link>
        </p>
      </header>

      {!configured ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 sm:p-6">
          <div className="flex gap-3">
            <Clock3 aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-amber-800" />
            <div>
              <h2 className="font-semibold text-amber-950">Payouts are not switched on yet</h2>
              <p className="mt-1 text-sm leading-6 text-amber-900">
                Sea N Shore is still setting up payouts with its payment partner, so payout details can&apos;t be added yet.
                You can keep selling: every sale is recorded in your earnings with the platform fee and your share, and it will be paid out once payouts open.
                We&apos;ll ask for your bank account or UPI ID here when they do.
              </p>
            </div>
          </div>
        </section>
      ) : (
        <div className="space-y-5">
          {sellers.map(({ option, account, busy }) => {
            const masked = account ? maskPayoutAccount(account) : null
            return (
              <PayoutAccountPanel
                key={option.key}
                sellerKey={option.key}
                sellerName={option.name}
                kind={option.kind}
                account={account && masked ? {
                  method: account.method,
                  summary: masked.summary,
                  holderName: account.holderName,
                  savedAt: account.createdAt,
                  verified: account.providerVerified,
                } : null}
                lockedReason={busy ? 'A payout is on its way to these details. You can change or remove them once it completes.' : null}
              />
            )
          })}
        </div>
      )}
    </main>
  )
}
