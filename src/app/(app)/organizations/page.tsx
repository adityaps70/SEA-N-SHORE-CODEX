import Link from 'next/link'
import { Building2, CheckCircle2, Clock3, ShieldAlert } from 'lucide-react'
import { getAccessContext } from '@/features/access/server'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { OrganizationAccessPanel } from '@/features/organizations/components/organization-access-panel'
import { OrganizationApplicationForm } from '@/features/organizations/components/organization-application-form'
import { organizationRepository } from '@/features/organizations/repository'

const roleLabel = (role: string) => role.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())

export default async function OrganizationsPage() {
  const user = await requireAwsUser()
  const [state, requests, memberships, access] = await Promise.all([
    organizationRepository.getUserOrganizationState(user.id),
    organizationRepository.listUserAccessRequests(user.id),
    organizationRepository.listUserOrganizations(user.id),
    getAccessContext(user.id),
  ])

  const editable = state.kind === 'application' && (state.status === 'changes_requested' || state.status === 'rejected')
    ? await organizationRepository.getOrganizationApplication(user.id, state.applicationId)
    : null

  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <section className="overflow-hidden rounded-[2rem] bg-navy-950 p-6 text-white shadow-[var(--shadow-card)] sm:p-8">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-200">Organization workspaces</p>
        <h1 className="mt-2 text-3xl font-bold sm:text-4xl">Create, claim and manage organizations</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-white/75">
          Your personal Sea N Shore account stays yours. Organization access is added separately through an approved workspace role, company verification and Organization Pro entitlements.
        </p>
      </section>

      <section className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-xl bg-ocean-50 text-ocean-700"><Building2 className="size-5" aria-hidden="true" /></span>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-ocean-700">Your workspaces</p>
            <h2 className="mt-1 text-xl font-bold text-navy-950">Organization memberships</h2>
          </div>
        </div>

        {memberships.length ? (
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {memberships.map((organization) => {
              const accessMembership = access.organizationMemberships.find((entry) => entry.companyId === organization.id)
              return (
                <article key={organization.id} className="rounded-2xl border border-mist-100 bg-mist-50/50 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-bold text-navy-950">{organization.name}</h3>
                    {organization.verified ? (
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-800">Verified</span>
                    ) : (
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-bold text-amber-900">Verification pending</span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-muted">{roleLabel(organization.role)}</p>
                  <p className="mt-2 text-xs font-semibold text-navy-900">
                    Plan: {accessMembership?.plan === 'organization_pro' ? 'Organization Pro' : 'Free / legacy access'}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Link href="/hiring" className="rounded-lg border border-mist-100 bg-white px-3 py-2 text-xs font-bold text-navy-950">Jobs</Link>
                    <Link href="/events/hosting" className="rounded-lg border border-mist-100 bg-white px-3 py-2 text-xs font-bold text-navy-950">Events</Link>
                    <Link href="/learn/studio" className="rounded-lg border border-mist-100 bg-white px-3 py-2 text-xs font-bold text-navy-950">LMS</Link>
                    {accessMembership?.entitlements.includes('billing.manage') || accessMembership?.role === 'owner' || accessMembership?.role === 'administrator' ? (
                      <Link href={`/settings/billing/organizations/${organization.id}`} className="rounded-lg border border-mist-100 bg-white px-3 py-2 text-xs font-bold text-navy-950">Billing</Link>
                    ) : null}
                  </div>
                </article>
              )
            })}
          </div>
        ) : (
          <p className="mt-4 text-sm leading-6 text-muted">You are not linked to an approved organization workspace yet. Search for an existing organization below before creating a new one.</p>
        )}
      </section>

      {state.kind === 'application' && state.status === 'pending' ? (
        <section className="rounded-[1.5rem] border border-sky-100 bg-sky-50 p-5 text-sky-950">
          <div className="flex gap-3"><Clock3 className="mt-0.5 size-5 shrink-0" aria-hidden="true" /><div><h2 className="font-bold">Organization verification in progress</h2><p className="mt-1 text-sm leading-6">Sea N Shore is reviewing {state.company.name}. Verification and paid Organization Pro access remain separate.</p></div></div>
        </section>
      ) : null}

      {state.kind === 'application' && state.status === 'suspended' ? (
        <section className="rounded-[1.5rem] border border-red-100 bg-red-50 p-5 text-red-950">
          <div className="flex gap-3"><ShieldAlert className="mt-0.5 size-5 shrink-0" aria-hidden="true" /><div><h2 className="font-bold">Organization access suspended</h2><p className="mt-1 text-sm leading-6">The affected workspace cannot use protected organization capabilities until Sea N Shore resolves the review.</p></div></div>
        </section>
      ) : null}

      {state.kind === 'application' && state.status === 'approved' ? (
        <section className="rounded-[1.5rem] border border-emerald-100 bg-emerald-50 p-5 text-emerald-950">
          <div className="flex gap-3"><CheckCircle2 className="mt-0.5 size-5 shrink-0" aria-hidden="true" /><div><h2 className="font-bold">Organization verification approved</h2><p className="mt-1 text-sm leading-6">{state.company.name} is approved. Publishing still follows the workspace role and Organization Pro entitlement rules shown above.</p></div></div>
        </section>
      ) : null}

      <OrganizationAccessPanel initialRequests={requests} />

      {editable ? (
        <section className="space-y-4">
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950">
            <strong>Update requested.</strong>{state.kind === 'application' && state.adminReviewNote ? <> Review note: {state.adminReviewNote}</> : null}
          </div>
          <OrganizationApplicationForm mode="resubmit" applicationId={state.kind === 'application' ? state.applicationId : ''} initial={editable} />
        </section>
      ) : state.kind === 'none' || (state.kind === 'application' && state.status === 'approved') ? (
        <>
          <div className="flex items-center gap-3 py-1"><span className="h-px flex-1 bg-mist-100" /><span className="text-xs font-bold uppercase tracking-[0.14em] text-muted">or create a new organization</span><span className="h-px flex-1 bg-mist-100" /></div>
          <OrganizationApplicationForm mode="create" />
        </>
      ) : null}

      <p className="text-xs leading-5 text-muted">
        Organization verification establishes trust. It does not automatically create an Organization Pro subscription or bypass role-based authorization.
      </p>
    </main>
  )
}
