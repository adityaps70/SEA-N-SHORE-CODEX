import type { Metadata } from 'next'
import Link from 'next/link'
import { Building2, CreditCard, ShieldCheck, UserRound } from 'lucide-react'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { canUseCapability } from '@/features/access/policy'
import { getAccessContext } from '@/features/access/server'
import { organizationRepository } from '@/features/organizations/repository'

export const metadata: Metadata = { title: 'Membership & billing · Settings' }

function planLabel(plan: string) {
  if (plan === 'creator_pro') return 'Creator Pro'
  if (plan === 'organization_pro') return 'Organization Pro'
  return 'Sea N Shore Member — FREE'
}

export default async function BillingSettingsPage() {
  const user = await requireAwsUser()
  const [access, organizations] = await Promise.all([
    getAccessContext(user.id),
    organizationRepository.listUserOrganizations(user.id),
  ])
  const organizationProCount = access.organizationMemberships.filter(
    (membership) => membership.plan === 'organization_pro',
  ).length
  const managedBillingOrganizations = organizations.filter((organization) =>
    canUseCapability(access, 'billing.manage', { companyId: organization.id }))

  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 py-2 sm:py-5">
      <header>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-ocean-700">Account</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-navy-950">Membership & billing</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
          Review your personal plan and organization plan access. Verification and payment remain separate security checks.
        </p>
      </header>

      <section className="grid gap-4 md:grid-cols-2">
        <article className="rounded-2xl border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)]">
          <span className="grid size-10 place-items-center rounded-xl bg-ocean-50 text-ocean-700">
            <UserRound aria-hidden="true" className="size-5" />
          </span>
          <p className="mt-4 text-xs font-bold uppercase tracking-[0.14em] text-muted">Personal membership</p>
          <h2 className="mt-1 text-xl font-bold text-navy-950">{planLabel(access.personalPlan)}</h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            Creator Pro is for independent recruiters, trainers, consultants, coaches and event organizers.
          </p>
        </article>

        <article className="rounded-2xl border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)]">
          <span className="grid size-10 place-items-center rounded-xl bg-ocean-50 text-ocean-700">
            <Building2 aria-hidden="true" className="size-5" />
          </span>
          <p className="mt-4 text-xs font-bold uppercase tracking-[0.14em] text-muted">Organization access</p>
          <h2 className="mt-1 text-xl font-bold text-navy-950">
            {organizationProCount > 0
              ? organizationProCount + ' Organization Pro workspace' + (organizationProCount === 1 ? '' : 's')
              : 'No Organization Pro workspace'}
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            Organization Pro belongs to the organization workspace; individual members receive access through their approved workspace role.
          </p>
          {managedBillingOrganizations.length ? (
            <div className="mt-4 space-y-2 border-t border-mist-100 pt-4">
              {managedBillingOrganizations.map((organization) => (
                <Link
                  key={organization.id}
                  href={`/settings/billing/organizations/${organization.id}`}
                  className="flex items-center justify-between gap-3 rounded-xl border border-mist-100 bg-mist-50/50 px-3 py-3 text-sm transition hover:border-ocean-300 hover:bg-ocean-50/40"
                >
                  <span className="min-w-0 truncate font-semibold text-navy-950">{organization.name}</span>
                  <span className="shrink-0 text-xs font-bold text-ocean-700">Manage organization billing →</span>
                </Link>
              ))}
            </div>
          ) : (
            <p className="mt-4 border-t border-mist-100 pt-4 text-xs leading-5 text-muted">
              No organization workspace is currently available for billing management under your role and plan.
            </p>
          )}
        </article>
      </section>

      <section className="rounded-2xl border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
        <div className="flex gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-mist-50 text-ocean-700">
            <CreditCard aria-hidden="true" className="size-5" />
          </span>
          <div>
            <h2 className="text-lg font-semibold text-navy-950">Paid plan checkout</h2>
            <p className="mt-1 text-sm leading-6 text-muted">
              The access model is payment-provider neutral. Checkout will only be enabled after Sea N Shore configures an approved payment provider and plan prices; until then, no payment is collected and no fake checkout is shown.
            </p>
          </div>
        </div>
        <Link
          href="/plans"
          className="mt-5 inline-flex min-h-11 items-center justify-center rounded-xl bg-navy-950 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-navy-900"
        >
          Compare plans
        </Link>
      </section>

      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
        <div className="flex gap-3">
          <ShieldCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-amber-800" />
          <div>
            <h2 className="font-bold text-amber-950">Payment does not replace verification</h2>
            <p className="mt-1 text-sm leading-6 text-amber-900">
              A paid plan can unlock a capability, but recruiter, trainer, event-host and organization verification still determine whether that capability can actually be used.
            </p>
          </div>
        </div>
      </section>
    </main>
  )
}
