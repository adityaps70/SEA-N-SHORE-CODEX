import type { Metadata } from 'next'
import Link from 'next/link'
import { Building2, CheckCircle2, Clock3, Search, ShieldAlert } from 'lucide-react'
import { canUseCapability } from '@/features/access/policy'
import { getAccessContext } from '@/features/access/server'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { accessRoleLabel } from '@/features/organizations/access-request-labels'
import { organizationAccessRequestRepository } from '@/features/organizations/access-request-repository'
import { OrganizationAccessPanel, StatusChip } from '@/features/organizations/components/organization-access-panel'
import { OrganizationApplicationForm } from '@/features/organizations/components/organization-application-form'
import { NewOrganizationPanel } from '@/features/organizations/components/new-organization-panel'
import { RequestAccessForm, type RequestAccessState } from '@/features/organizations/components/request-access-form'
import { organizationRepository } from '@/features/organizations/repository'
import { organizationWorkspaceRepository } from '@/features/organizations/workspace-repository'

export const metadata: Metadata = { title: 'Organizations' }

function SectionHeader({ id, title, description, meta }: { id: string; title: string; description?: string; meta?: string }) {
  return (
    <div className="mb-3">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h2 id={id} className="text-lg font-bold text-navy-950">{title}</h2>
        {meta ? <p className="text-sm font-medium text-muted">{meta}</p> : null}
      </div>
      {description ? <p className="mt-0.5 max-w-3xl text-sm leading-6 text-muted">{description}</p> : null}
    </div>
  )
}

export default async function OrganizationsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; register?: string | string[] }>
}) {
  const params = await searchParams
  const rawQuery = Array.isArray(params.q) ? params.q[0] : params.q
  const query = rawQuery?.trim().slice(0, 100) ?? ''
  const registerRequested = (Array.isArray(params.register) ? params.register[0] : params.register) === '1'
  const user = await requireAwsUser()
  const [state, requests, memberships, followedOrganizations, searchResults, access, pendingCounts] = await Promise.all([
    organizationRepository.getUserOrganizationState(user.id),
    organizationRepository.listUserAccessRequests(user.id),
    organizationRepository.listUserOrganizations(user.id),
    organizationWorkspaceRepository.listFollowedOrganizations(user.id),
    query.length >= 2 ? organizationRepository.searchCompanies(query) : Promise.resolve([]),
    getAccessContext(user.id),
    organizationAccessRequestRepository.countPendingForManager(user.id),
  ])
  const nowIso = new Date().toISOString()

  const editable = state.kind === 'application' && (state.status === 'changes_requested' || state.status === 'rejected')
    ? await organizationRepository.getOrganizationApplication(user.id, state.applicationId)
    : null
  const canRegister = state.kind === 'none' || (state.kind === 'application' && state.status === 'approved')
  const memberCompanyIds = new Set(memberships.map((organization) => organization.id))
  if (state.kind === 'application') memberCompanyIds.add(state.company.id)
  const pendingCompanyIds = new Set(requests.filter((request) => request.status === 'pending').map((request) => request.company.id))
  const applicationInProgress = state.kind === 'application' && state.status !== 'approved' && !memberships.some((organization) => organization.id === state.company.id)
  const waitingTotal = Object.values(pendingCounts).reduce((sum, value) => sum + value, 0)

  function requestState(companyId: string): RequestAccessState {
    if (memberCompanyIds.has(companyId)) return 'member'
    if (pendingCompanyIds.has(companyId)) return 'pending'
    return 'none'
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8 py-6 sm:px-6 lg:px-8">
      <header className="border-b border-mist-100 pb-4">
        <h1 className="text-2xl font-bold tracking-tight text-navy-950">Organizations</h1>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-muted">
          Join the organizations you work with, or register a new one. Your personal account stays yours: each organization&apos;s owner and administrators decide who joins and with which role.
        </p>
      </header>

      <section aria-labelledby="your-organizations">
        <div className="mb-3 flex flex-wrap items-baseline gap-x-3">
          <h2 id="your-organizations" className="text-lg font-bold text-navy-950">Your organizations</h2>
          {waitingTotal ? <p className="text-sm font-medium text-amber-800">{waitingTotal} {waitingTotal === 1 ? 'request needs' : 'requests need'} your decision</p> : null}
        </div>

        {memberships.length || applicationInProgress ? (
          <ul className="divide-y divide-mist-100 overflow-hidden rounded-xl border border-mist-100 bg-white">
            {memberships.map((organization) => {
              const accessMembership = access.organizationMemberships.find((entry) => entry.companyId === organization.id)
              const waiting = pendingCounts[organization.id] ?? 0
              return (
                <li key={organization.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-mist-50 text-navy-950"><Building2 className="size-4" aria-hidden="true" /></span>
                    <div className="min-w-0">
                      <Link href={'/organizations/' + organization.slug} className="font-semibold text-navy-950 hover:underline">{organization.name}</Link>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        <StatusChip tone="neutral">{accessRoleLabel(organization.role)}</StatusChip>
                        {organization.verified ? <StatusChip tone="success">Verified</StatusChip> : <StatusChip tone="warning">Not verified yet</StatusChip>}
                        <StatusChip tone={accessMembership?.plan === 'organization_pro' ? 'info' : 'neutral'}>
                          {accessMembership?.plan === 'organization_pro' ? 'Organization Pro' : 'Free plan'}
                        </StatusChip>
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {waiting ? (
                      <Link href={`/organizations/${organization.slug}#requests`} className="inline-flex min-h-9 items-center rounded-lg border border-amber-200 bg-amber-50 px-3 text-xs font-semibold text-amber-900 hover:bg-amber-100">
                        {waiting} {waiting === 1 ? 'request' : 'requests'} waiting
                      </Link>
                    ) : null}
                    <Link href={'/organizations/' + organization.slug} className="inline-flex min-h-9 items-center rounded-lg bg-navy-950 px-3 text-xs font-bold text-white hover:bg-navy-900">Open workspace</Link>
                    {canUseCapability(access, 'billing.manage', { companyId: organization.id }) ? (
                      <Link href={`/settings/billing/organizations/${organization.id}`} className="inline-flex min-h-9 items-center rounded-lg border border-mist-100 px-3 text-xs font-semibold text-navy-950 hover:bg-mist-50">Billing</Link>
                    ) : null}
                  </div>
                </li>
              )
            })}

            {applicationInProgress && state.kind === 'application' ? (
              <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-mist-50 text-navy-950"><Building2 className="size-4" aria-hidden="true" /></span>
                  <div className="min-w-0">
                    <p className="font-semibold text-navy-950">{state.company.name}</p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      <StatusChip tone="neutral">Owner</StatusChip>
                      {state.status === 'pending' ? <StatusChip tone="info">Sea N Shore is reviewing</StatusChip> : null}
                      {state.status === 'changes_requested' ? <StatusChip tone="warning">Changes requested</StatusChip> : null}
                      {state.status === 'rejected' ? <StatusChip tone="danger">Not approved</StatusChip> : null}
                      {state.status === 'suspended' ? <StatusChip tone="danger">Suspended</StatusChip> : null}
                    </div>
                  </div>
                </div>
                {editable ? <a href="#update-application" className="inline-flex min-h-9 items-center rounded-lg bg-navy-950 px-3 text-xs font-bold text-white">Update application</a> : null}
              </li>
            ) : null}
          </ul>
        ) : (
          <p className="rounded-xl border border-dashed border-mist-200 bg-white px-4 py-6 text-sm leading-6 text-muted">
            You are not part of an organization yet. Find the one you work with below and request access, or register it if it is not on Sea N Shore.
          </p>
        )}

        {state.kind === 'application' && state.status === 'pending' ? (
          <div className="mt-3 flex gap-3 rounded-xl border border-sky-100 bg-sky-50 px-4 py-3 text-sky-950">
            <Clock3 className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
            <div>
              <h3 className="font-bold">Organization verification in progress</h3>
              <p className="mt-0.5 text-sm leading-6">Sea N Shore is reviewing {state.company.name}. You will see the result here. Verification and paid Organization Pro access remain separate.</p>
            </div>
          </div>
        ) : null}

        {state.kind === 'application' && state.status === 'suspended' ? (
          <div className="mt-3 flex gap-3 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-red-950">
            <ShieldAlert className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
            <div>
              <h3 className="font-bold">Organization access suspended</h3>
              <p className="mt-0.5 text-sm leading-6">{state.company.name} cannot publish or decide access requests until Sea N Shore resolves the review.{state.adminReviewNote ? ` Note from Sea N Shore: ${state.adminReviewNote}` : ''}</p>
            </div>
          </div>
        ) : null}

      </section>

      {requests.length ? (
        <section aria-labelledby="your-requests-heading" id="your-requests" className="scroll-mt-24">
          <SectionHeader id="your-requests-heading" title="Your requests" description="Requests go to each organization's owner and administrators. If nobody responds within 7 days, or you disagree with a decision, you can ask Sea N Shore to review it." />
          <div className="overflow-hidden rounded-xl border border-mist-100 bg-white">
            <OrganizationAccessPanel initialRequests={requests} nowIso={nowIso} />
          </div>
        </section>
      ) : null}

      <section aria-labelledby="find-organization">
        <h2 id="find-organization" className="text-lg font-bold text-navy-950">Find your organization</h2>
        <p className="mt-0.5 max-w-3xl text-sm leading-6 text-muted">Search before registering so the same organization is not listed twice.</p>
        <form method="get" action="/organizations" className="mt-3 flex flex-col gap-2 sm:flex-row" role="search">
          <label className="relative flex-1">
            <span className="sr-only">Search organizations</span>
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input
              type="search"
              name="q"
              defaultValue={query}
              minLength={2}
              maxLength={100}
              placeholder="Company, charity, institute or other organization"
              className="min-h-11 w-full rounded-xl border border-mist-100 bg-white pl-9 pr-3 text-sm text-navy-950 outline-none focus:border-ocean-500 focus:ring-2 focus:ring-ocean-100"
            />
          </label>
          <button type="submit" className="min-h-11 rounded-xl bg-navy-950 px-5 text-sm font-bold text-white hover:bg-navy-900">Search</button>
        </form>

        {query ? (
          <div className="mt-4">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold text-navy-950">Organization search results for &ldquo;{query}&rdquo;</h3>
              <Link href="/organizations" className="text-sm font-semibold text-ocean-700 hover:underline">Clear search</Link>
            </div>
            {query.length < 2 ? (
              <p className="rounded-xl border border-dashed border-mist-200 bg-white px-4 py-5 text-sm text-muted">Enter at least 2 characters to search.</p>
            ) : searchResults.length ? (
              <ul className="divide-y divide-mist-100 overflow-hidden rounded-xl border border-mist-100 bg-white">
                {searchResults.map((organization) => (
                  <li key={organization.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2">
                        <Link href={'/organizations/' + organization.slug} className="font-semibold text-navy-950 hover:underline">{organization.name}</Link>
                        {organization.verified ? <StatusChip tone="success">Verified</StatusChip> : null}
                      </p>
                      <p className="mt-0.5 truncate text-sm text-muted">
                        {organization.companyType ?? 'Organization'}{organization.website ? ` · ${organization.website.replace(/^https?:\/\//, '')}` : ''}
                      </p>
                    </div>
                    <div className="sm:max-w-sm sm:shrink-0">
                      <RequestAccessForm company={organization} initialState={requestState(organization.id)} compact />
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-xl border border-dashed border-mist-200 bg-white px-4 py-5 text-sm text-muted">
                No organization matches &ldquo;{query}&rdquo;. Check the spelling or try a shorter name. If it is not on Sea N Shore yet, register it below.
              </p>
            )}
          </div>
        ) : null}
      </section>

      <section aria-labelledby="register-organization" id="update-application" className="scroll-mt-24">
        <SectionHeader
          id="register-organization"
          title={editable ? 'Update your organization application' : 'Register a new organization'}
          description={editable
            ? undefined
            : 'For shipping and maritime companies, wellbeing and support services, training bodies, public bodies, associations and more. Sea N Shore verifies each organization before its workspace can publish.'}
        />
        {editable ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950">
              <strong>{state.kind === 'application' && state.status === 'rejected' ? 'Sea N Shore did not approve this application.' : 'Sea N Shore asked for changes.'}</strong>
              {state.kind === 'application' && state.adminReviewNote ? <> Review note: {state.adminReviewNote}</> : null}
              {' '}Update the details below and resubmit.
            </div>
            <OrganizationApplicationForm mode="resubmit" applicationId={state.kind === 'application' ? state.applicationId : ''} initial={editable} />
          </div>
        ) : canRegister ? (
          <NewOrganizationPanel initiallyOpen={registerRequested} />
        ) : state.kind === 'application' && state.status === 'pending' ? (
          <p className="text-sm leading-6 text-muted">You can register another organization once Sea N Shore has reviewed {state.company.name}.</p>
        ) : (
          <p className="text-sm leading-6 text-muted">Registering new organizations is paused while {state.kind === 'application' ? state.company.name : 'your organization'} is suspended.</p>
        )}
      </section>

      <section aria-labelledby="following">
        <SectionHeader id="following" title="Following" meta={followedOrganizations.length ? `${followedOrganizations.length}` : undefined} />
        {followedOrganizations.length ? (
          <ul className="flex flex-wrap gap-2">
            {followedOrganizations.map((organization) => (
              <li key={organization.id}>
                <Link
                  href={'/organizations/' + organization.slug}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-mist-100 bg-white px-3 text-sm font-semibold text-navy-950 hover:border-ocean-200 hover:bg-ocean-50"
                >
                  {organization.name}
                  {organization.verified ? <CheckCircle2 aria-label="Verified" className="size-3.5 text-emerald-700" /> : null}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm leading-6 text-muted">You are not following any organizations yet. Open an organization and choose Follow to see its updates.</p>
        )}
      </section>

      <p className="text-xs leading-5 text-muted">
        Verification confirms an organization is genuine. It does not start an Organization Pro subscription or give anyone extra permissions.
      </p>
    </div>
  )
}
