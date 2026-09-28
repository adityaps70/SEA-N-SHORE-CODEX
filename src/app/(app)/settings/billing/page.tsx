import type { Metadata } from 'next'
import Link from 'next/link'
import { ShieldCheck } from 'lucide-react'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { getAccessContext } from '@/features/access/server'
import { planPriceLine } from '@/features/billing/billing-view'
import { CollapsiblePlanSection } from '@/features/billing/components/collapsible-plan-section'
import { OrganizationProChooser } from '@/features/billing/components/organization-pro-chooser'
import { BillingHistory, CheckoutNotice, PlanBillingPanel } from '@/features/billing/components/plan-billing-panel'
import { organizationProCandidates, resolveOrganizationProPath } from '@/features/billing/organization-pro-path'
import { loadCheckoutNotice, loadPlanBillingView } from '@/features/billing/page-data'
import { subscriptionRepository } from '@/features/billing/subscription-repository'
import type { PlanPrice } from '@/features/billing/subscription-types'
import { organizationRepository } from '@/features/organizations/repository'

export const metadata: Metadata = { title: 'Membership & billing · Settings' }

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

const CREATOR_PRO_DESCRIPTION = 'Creator Pro is for independent recruiters, trainers, consultants, coaches and event organizers: post jobs, create events and publish courses.'

/**
 * Personal plan (Creator Pro) and the organization plans this member manages, both
 * renewing through the payment provider Cashfree.
 * - ?plan=organization_pro (from /plans): the organizations first, each with its plan and
 *   "Upgrade to Organization Pro"; Creator Pro stays a summary card until asked for.
 * - ?plan=creator_pro: the Creator Pro checkout first, as before.
 * - no plan: both as summaries; Creator Pro opens by itself when the member has no
 *   organization, or when it needs attention (a payment problem or a mandate in progress).
 * Cashfree's return route adds ?checkout=<id>. The organization checkout itself lives on
 * /settings/billing/organizations/<id> (canManageOrganizationBilling is checked there and
 * in every billing action).
 */
export default async function BillingSettingsPage({ searchParams }: { searchParams?: SearchParams }) {
  const user = await requireAwsUser()
  const params = (await searchParams) ?? {}
  const requestedPlan = first(params.plan)
  const subject = { kind: 'profile' as const, profileId: user.id }
  const [access, organizationData, view, checkoutNotice, prices] = await Promise.all([
    getAccessContext(user.id),
    Promise.all([
      organizationRepository.listUserOrganizations(user.id),
      organizationRepository.getUserOrganizationState(user.id),
    ]).catch((error: unknown) => {
      console.error('billing_organizations_unavailable', { message: error instanceof Error ? error.message : null })
      return null
    }),
    loadPlanBillingView(subject),
    loadCheckoutNotice(first(params.checkout), subject),
    subscriptionRepository.listActivePrices().catch(() => [] as PlanPrice[]),
  ])
  const [organizations, application] = organizationData ?? [[], { kind: 'none' as const }]
  const organizationPath = organizationData ? resolveOrganizationProPath({ access, organizations, application }) : null
  const candidates = organizationProCandidates(access, organizations)

  const wantsOrganizationPro = requestedPlan === 'organization_pro'
  const wantsCreatorPro = requestedPlan === 'creator_pro'
  const hasOrganizations = organizations.length > 0 || (application.kind === 'application' && application.status !== 'approved')
  const personalNeedsAttention = view.state === 'past_due' || Boolean(view.pending)
  const creatorOpen = Boolean(checkoutNotice)
    || wantsCreatorPro
    || (!wantsOrganizationPro && (!hasOrganizations || personalNeedsAttention))

  const creatorPanel = (
    <PlanBillingPanel
      view={view}
      target={{ kind: 'personal' }}
      eyebrow="Personal plan"
      description={CREATOR_PRO_DESCRIPTION}
      highlight={wantsCreatorPro}
      blockedMessage={access.accountActive ? null : 'Your account is restricted right now, so plans can’t be bought. Contact the Sea N Shore team for help.'}
      noticeCheckoutId={checkoutNotice?.checkoutId ?? null}
      anchorId="creator-pro"
    />
  )
  const creatorSection = (
    <CollapsiblePlanSection
      anchorId="creator-pro"
      eyebrow="Personal plan"
      title={view.planLabel}
      statusLabel={view.statusLabel}
      summary="For independent recruiters, trainers, consultants, coaches and event organizers who publish under their own name."
      priceLine={view.state === 'free' ? planPriceLine(prices, 'creator_pro') : view.current?.priceLabel ?? null}
      openLabel={view.state === 'free' ? 'Get Creator Pro' : 'Manage Creator Pro'}
      defaultOpen={creatorOpen}
    >
      {creatorPanel}
    </CollapsiblePlanSection>
  )
  const organizationSection = (
    <OrganizationProChooser
      path={organizationPath}
      candidates={candidates}
      priceLine={planPriceLine(prices, 'organization_pro')}
      highlight={wantsOrganizationPro}
    />
  )
  const history = view.history.length ? <BillingHistory rows={view.history} /> : null

  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 py-2 sm:py-5">
      <header>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-ocean-700">Account</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-navy-950">Membership & billing</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
          Your personal plan and the organization plans you manage. Paid plans renew automatically through our payment provider, Cashfree, until you cancel auto-renew.
        </p>
      </header>

      {checkoutNotice ? <CheckoutNotice notice={checkoutNotice.notice} checkoutId={checkoutNotice.checkoutId} /> : null}

      {wantsOrganizationPro ? (
        <>
          {organizationSection}
          {creatorSection}
          {history}
        </>
      ) : (
        <>
          {creatorSection}
          {history}
          {organizationSection}
        </>
      )}

      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
        <div className="flex gap-3">
          <ShieldCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-amber-800" />
          <div>
            <h2 className="font-bold text-amber-950">Payment does not replace verification</h2>
            <p className="mt-1 text-sm leading-6 text-amber-900">
              A paid plan can unlock a capability, but recruiter, trainer, event-host and organization verification still determine whether that capability can actually be used.
            </p>
            <Link href="/plans" className="mt-2 inline-flex text-sm font-bold text-amber-950 hover:underline">
              Compare plans →
            </Link>
          </div>
        </div>
      </section>
    </main>
  )
}
