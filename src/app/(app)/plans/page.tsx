import type { Metadata } from 'next'
import Link from 'next/link'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { loadOrganizationProPath } from '@/features/billing/organization-pro-data'
import { ORGANIZATION_PRO_CHOOSER_HREF, organizationProCallToAction } from '@/features/billing/organization-pro-path'
import { PLAN_ACTION_CLASS, PLAN_DARK_ACTION_CLASS, PlanCards } from '@/features/billing/components/plan-cards'
import { subscriptionRepository } from '@/features/billing/subscription-repository'
import type { PlanPrice } from '@/features/billing/subscription-types'

export const metadata: Metadata = { title: 'Plans' }
// Prices come from the database (plan_prices) on every request.
export const dynamic = 'force-dynamic'

/** Used when the member's organizations cannot be read: the billing page sorts it out. */
const FALLBACK_ORGANIZATION_ACTION = {
  href: ORGANIZATION_PRO_CHOOSER_HREF,
  label: 'Get Organization Pro',
  note: 'Choose the organization to upgrade on the next screen.',
}

export default async function PlansPage() {
  const user = await requireAwsUser()
  const [prices, organizationAction] = await Promise.all([
    subscriptionRepository.listActivePrices().catch((error: unknown) => {
      console.error('plans_prices_unavailable', { message: error instanceof Error ? error.message : null })
      return [] as PlanPrice[]
    }),
    // "Get Organization Pro" goes straight to the right organization, decided here on the server.
    loadOrganizationProPath(user.id)
      .then(({ path }) => organizationProCallToAction(path))
      .catch((error: unknown) => {
        console.error('plans_organization_path_unavailable', { message: error instanceof Error ? error.message : null })
        return FALLBACK_ORGANIZATION_ACTION
      }),
  ])

  return (
    <main className="mx-auto w-full max-w-6xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
      <header className="mx-auto max-w-3xl text-center">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-700">Sea N Shore plans</p>
        <h1 className="mt-2 text-4xl font-bold tracking-tight text-navy-950 sm:text-5xl">
          Simple access for members, creators and maritime organizations
        </h1>
        <p className="mt-4 text-base leading-7 text-muted">
          Everyone can participate in the community for free. Paid plans unlock creator tools; trust-sensitive publishing still requires the relevant verification.
        </p>
      </header>

      <PlanCards
        prices={prices}
        creatorAction={
          <Link href="/settings/billing?plan=creator_pro#creator-pro" className={PLAN_ACTION_CLASS}>
            Get Creator Pro
          </Link>
        }
        organizationAction={
          <>
            <p className="text-sm leading-6 text-white/80">{organizationAction.note}</p>
            <Link href={organizationAction.href} className={`mt-3 ${PLAN_DARK_ACTION_CLASS}`}>
              {organizationAction.label}
            </Link>
            <Link href="/organizations" className="mt-3 inline-flex w-full justify-center text-sm font-semibold text-teal-200 hover:text-white hover:underline">
              Go to Organizations
            </Link>
          </>
        }
      />

      <section className="rounded-[1.5rem] border border-amber-200 bg-amber-50 p-5 sm:p-6">
        <h2 className="font-bold text-amber-950">Verification and payment are separate</h2>
        <p className="mt-2 text-sm leading-6 text-amber-900">
          A paid plan unlocks the commercial capability. Sea N Shore verification determines whether a person or organization is trusted to use that capability. Paying never bypasses recruiter, trainer, event-host or company verification.
        </p>
      </section>
    </main>
  )
}
