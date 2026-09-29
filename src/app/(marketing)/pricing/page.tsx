import type { Metadata } from 'next'
import Link from 'next/link'
import { CalendarDays, GraduationCap, Info, ShieldCheck } from 'lucide-react'
import { TextLink } from '@/components/legal/legal-page'
import { BUSINESS, OPERATOR_LINE } from '@/config/business'
import { getVerifiedUser } from '@/features/auth/queries'
import {
  PLAN_ACTION_CLASS,
  PLAN_DARK_ACTION_CLASS,
  PLAN_SECONDARY_ACTION_CLASS,
  PlanCards,
} from '@/features/billing/components/plan-cards'
import { ORGANIZATION_PRO_CHOOSER_HREF } from '@/features/billing/organization-pro-path'
import { loadPublicPlanPrices } from '@/features/billing/public-prices'

export const metadata: Metadata = {
  title: 'Pricing',
  description: `${BUSINESS.brandName} plans and prices in Indian rupees: free membership, Creator Pro and Organization Pro.`,
}
// Prices come from the database (plan_prices) on every request.
export const dynamic = 'force-dynamic'

async function isSignedIn() {
  try {
    return Boolean(await getVerifiedUser())
  } catch {
    return false
  }
}

export default async function PricingPage() {
  const [{ prices, available }, signedIn] = await Promise.all([loadPublicPlanPrices(), isSignedIn()])

  const creatorAction = signedIn ? (
    <Link href="/settings/billing?plan=creator_pro#creator-pro" className={PLAN_ACTION_CLASS}>Get Creator Pro</Link>
  ) : (
    <>
      <p className="text-sm leading-6 text-muted">
        New here? <TextLink href="/auth/sign-up">Create a free account</TextLink> first, then buy.
      </p>
      <Link href="/auth/sign-in" className={`mt-3 ${PLAN_ACTION_CLASS}`}>Sign in to buy</Link>
    </>
  )

  const organizationAction = signedIn ? (
    <>
      <p className="text-sm leading-6 text-white/80">Bought for a verified organization page. Choose the organization on the next screen.</p>
      <Link href={ORGANIZATION_PRO_CHOOSER_HREF} className={`mt-3 ${PLAN_DARK_ACTION_CLASS}`}>Get Organization Pro</Link>
    </>
  ) : (
    <>
      <p className="text-sm leading-6 text-white/80">Bought for a verified organization page. Sign in, then choose the organization to upgrade.</p>
      <Link href="/auth/sign-in" className={`mt-3 ${PLAN_DARK_ACTION_CLASS}`}>Sign in to buy</Link>
    </>
  )

  const memberAction = signedIn ? (
    <Link href="/home" className={PLAN_SECONDARY_ACTION_CLASS}>Go to Home</Link>
  ) : (
    <Link href="/auth/sign-up" className={PLAN_SECONDARY_ACTION_CLASS}>Create free account</Link>
  )

  return (
    <main className="mx-auto w-full max-w-6xl space-y-8 px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
      <header className="mx-auto max-w-3xl text-center">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-700">Pricing</p>
        <h1 className="mt-2 text-4xl font-bold tracking-tight text-navy-950 sm:text-5xl">Plans and prices</h1>
        <p className="mt-4 text-base leading-7 text-muted">
          Joining {BUSINESS.brandName} is free. Paid plans unlock tools for creators and maritime organizations. All prices are in Indian rupees (INR), and you see the exact amount before you pay.
        </p>
      </header>

      {!available ? (
        <div role="status" className="mx-auto flex max-w-3xl gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
          <Info aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-amber-700" />
          <p>
            Current plan prices could not be loaded just now. Refresh this page in a minute. After you sign in, the exact price is always shown before you pay.
          </p>
        </div>
      ) : null}

      <PlanCards
        prices={prices}
        memberAction={memberAction}
        creatorAction={creatorAction}
        organizationAction={organizationAction}
        unavailablePriceText="Price shown before you pay"
      />

      <section aria-labelledby="events-courses" className="rounded-[1.75rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-8">
        <h2 id="events-courses" className="text-2xl font-bold text-navy-950">Paid events and courses</h2>
        <p className="mt-2 max-w-3xl text-sm leading-7 text-muted">
          Event organisers and trainers set their own prices in Indian rupees (INR). {BUSINESS.brandName} collects the payment and pays them their share.
        </p>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-mist-100 bg-mist-50 p-5">
            <CalendarDays aria-hidden="true" className="size-5 text-ocean-700" />
            <h3 className="mt-3 font-bold text-navy-950">Event tickets</h3>
            <p className="mt-1 text-sm leading-6 text-muted">
              The ticket price is shown on the event page and again before checkout. Your ticket appears in My events as soon as the payment is confirmed.
            </p>
          </div>
          <div className="rounded-2xl border border-mist-100 bg-mist-50 p-5">
            <GraduationCap aria-hidden="true" className="size-5 text-ocean-700" />
            <h3 className="mt-3 font-bold text-navy-950">Online courses</h3>
            <p className="mt-1 text-sm leading-6 text-muted">
              The course price is shown on the course page and again before checkout. The course opens in My learning as soon as the payment is confirmed.
            </p>
          </div>
        </div>
      </section>

      <section aria-labelledby="how-payment-works" className="rounded-[1.75rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-8">
        <div className="flex items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-teal-50 text-teal-700">
            <ShieldCheck aria-hidden="true" className="size-5" />
          </span>
          <h2 id="how-payment-works" className="text-2xl font-bold text-navy-950">How payment works</h2>
        </div>
        <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-7 text-muted marker:text-ocean-700">
          <li>Payments are processed securely by our payment gateway, Cashfree Payments.</li>
          <li>
            Plans renew automatically each month, six months or year. Cancel auto-renew any time in Settings → Membership &amp; billing; access continues until the end of the period you paid for.
          </li>
          <li>
            Everything is delivered online, straight after the payment is confirmed. See the <TextLink href="/shipping">Shipping &amp; delivery policy</TextLink>.
          </li>
          <li>
            Cancellations and refunds follow the <TextLink href="/refunds">Refund &amp; cancellation policy</TextLink>.
          </li>
          <li>
            A paid plan never replaces verification: recruiter, trainer, event-host and company verification still apply.
          </li>
        </ul>
      </section>

      <p className="text-center text-sm leading-6 text-muted">
        {OPERATOR_LINE}. Questions about prices or a payment? <TextLink href="/contact">Contact us</TextLink>.
      </p>
    </main>
  )
}
