import type { Metadata } from 'next'
import Link from 'next/link'
import { Building2, ShieldCheck } from 'lucide-react'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { getAccessContext } from '@/features/access/server'
import { canManageOrganizationBilling } from '@/features/billing/billing-access'
import { BillingHistory, CheckoutNotice, PlanBillingPanel } from '@/features/billing/components/plan-billing-panel'
import { loadCheckoutNotice, loadPlanBillingView } from '@/features/billing/page-data'
import { organizationRepository } from '@/features/organizations/repository'

export const metadata: Metadata = { title: 'Membership & billing · Settings' }

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function roleLabel(role: string) {
  return role === 'owner' ? 'Owner' : role === 'administrator' ? 'Administrator' : role
}

/**
 * Personal plan (Creator Pro, auto-renewing through the payment provider Cashfree) and
 * links to the organization plans this member can manage. /plans "Get Creator Pro" lands
 * here with ?plan=creator_pro; Cashfree's return route adds ?checkout=<id>.
 */
export default async function BillingSettingsPage({ searchParams }: { searchParams?: SearchParams }) {
  const user = await requireAwsUser()
  const params = (await searchParams) ?? {}
  const requestedPlan = first(params.plan)
  const subject = { kind: 'profile' as const, profileId: user.id }
  const [access, organizations, view, checkoutNotice] = await Promise.all([
    getAccessContext(user.id),
    organizationRepository.listUserOrganizations(user.id),
    loadPlanBillingView(subject),
    loadCheckoutNotice(first(params.checkout), subject),
  ])
  const organizationProCount = access.organizationMemberships.filter(
    (membership) => membership.plan === 'organization_pro',
  ).length
  const managedBillingOrganizations = organizations.filter((organization) => canManageOrganizationBilling(access, organization.id))
  const planByOrganization = new Map(access.organizationMemberships.map((membership) => [membership.companyId, membership.plan]))
  const wantsOrganizationPro = requestedPlan === 'organization_pro'

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

      <PlanBillingPanel
        view={view}
        target={{ kind: 'personal' }}
        eyebrow="Personal plan"
        description="Creator Pro is for independent recruiters, trainers, consultants, coaches and event organizers: post jobs, create events and publish courses."
        highlight={requestedPlan === 'creator_pro'}
        blockedMessage={access.accountActive ? null : 'Your account is restricted right now, so plans can’t be bought. Contact the Sea N Shore team for help.'}
        noticeCheckoutId={checkoutNotice?.checkoutId ?? null}
        anchorId="creator-pro"
      />

      {view.history.length ? <BillingHistory rows={view.history} /> : null}

      <section
        id="organization-pro"
        className={`scroll-mt-24 rounded-2xl border bg-white p-5 shadow-[var(--shadow-card)] sm:p-6 ${wantsOrganizationPro ? 'border-teal-300 ring-2 ring-teal-100' : 'border-mist-100'}`}
      >
        <div className="flex gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-ocean-50 text-ocean-700">
            <Building2 aria-hidden="true" className="size-5" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Organization access</p>
            <h2 className="mt-0.5 text-xl font-bold text-navy-950">
              {organizationProCount > 0
                ? organizationProCount + ' Organization Pro workspace' + (organizationProCount === 1 ? '' : 's')
                : 'Organization Pro'}
            </h2>
            <p className="mt-1 text-sm leading-6 text-muted">
              Organization Pro belongs to the organization workspace and is paid for by its owner or an administrator. Members get access through their workspace role.
            </p>
          </div>
        </div>
        {managedBillingOrganizations.length ? (
          <ul className="mt-4 space-y-2 border-t border-mist-100 pt-4">
            {managedBillingOrganizations.map((organization) => {
              const pro = planByOrganization.get(organization.id) === 'organization_pro'
              return (
                <li key={organization.id}>
                  <Link
                    href={`/settings/billing/organizations/${organization.id}`}
                    className="flex cursor-pointer flex-col gap-1 rounded-xl border border-mist-200 bg-mist-50/50 px-3 py-3 text-sm transition hover:border-ocean-300 hover:bg-ocean-50/40 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-semibold text-navy-950">{organization.name}</span>
                      <span className="text-xs text-muted">{roleLabel(organization.role)} · {pro ? 'Organization Pro' : 'Free plan'}</span>
                    </span>
                    <span className="shrink-0 text-xs font-bold text-ocean-700">{pro ? 'Manage plan →' : 'Get Organization Pro →'}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        ) : (
          <div className="mt-4 border-t border-mist-100 pt-4 text-sm leading-6 text-muted">
            <p>Only an organization’s owner or administrators can buy or manage Organization Pro, and you aren’t one for any organization yet.</p>
            <Link href="/organizations" className="mt-2 inline-flex font-bold text-ocean-700 hover:underline">
              Create or join an organization →
            </Link>
          </div>
        )}
      </section>

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
