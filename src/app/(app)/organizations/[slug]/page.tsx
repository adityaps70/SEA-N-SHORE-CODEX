import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { LucideIcon } from 'lucide-react'
import { BarChart3, BookOpen, BriefcaseBusiness, Building2, CalendarDays, Globe2, Lock, MapPin, Palette, ShieldCheck, UsersRound } from 'lucide-react'
import { canUseCapability, type Capability } from '@/features/access/policy'
import { getAccessContext } from '@/features/access/server'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { accessRoleLabel } from '@/features/organizations/access-request-labels'
import { organizationAccessRequestRepository } from '@/features/organizations/access-request-repository'
import { StatusChip } from '@/features/organizations/components/organization-access-panel'
import { OrganizationFollowButton } from '@/features/organizations/components/organization-follow-button'
import { OrganizationRequestsPanel } from '@/features/organizations/components/organization-requests-panel'
import { RequestAccessForm } from '@/features/organizations/components/request-access-form'
import { isWellbeingType, organizationTypeHasField, wellbeingServiceLabel } from '@/features/organizations/organization-types'
import { organizationRepository } from '@/features/organizations/repository'
import { organizationWorkspaceRepository } from '@/features/organizations/workspace-repository'

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const workspace = await organizationWorkspaceRepository.getBySlug(slug).catch(() => null)
  return { title: workspace ? workspace.name : 'Organization' }
}

type Tool = {
  href: string
  label: string
  icon: LucideIcon
  capability: Capability
  ready: string
  locked: string
}

export default async function OrganizationWorkspacePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const user = await requireAwsUser()
  const workspace = await organizationWorkspaceRepository.getBySlug(slug)
  if (!workspace) notFound()

  const [access, followState, viewer, myRequests, applicationState] = await Promise.all([
    getAccessContext(user.id),
    organizationWorkspaceRepository.getFollowState(workspace.id, user.id),
    organizationAccessRequestRepository.getViewer(user.id, workspace.id),
    organizationRepository.listUserAccessRequests(user.id),
    organizationRepository.getUserOrganizationState(user.id),
  ])
  // The owner of an organization that is still being verified has no approved membership yet.
  const ownApplication = applicationState.kind === 'application' && applicationState.company.id === workspace.id && applicationState.status !== 'approved'
    ? applicationState
    : null
  const nowIso = new Date().toISOString()
  const membership = access.organizationMemberships.find((entry) => entry.companyId === workspace.id)
  const managedRequests = viewer ? (await organizationAccessRequestRepository.listForOrganization(user.id, workspace.id)).requests : []
  const myPendingRequest = myRequests.find((request) => request.company.id === workspace.id && request.status === 'pending')

  const tools: Tool[] = [
    { href: '/hiring', label: 'Jobs', icon: BriefcaseBusiness, capability: 'job.publish', ready: 'Post jobs as this organization', locked: 'Needs Organization Pro and a recruiter role' },
    { href: '/events/hosting', label: 'Events', icon: CalendarDays, capability: 'event.publish', ready: 'Host events as this organization', locked: 'Needs Organization Pro and an events role' },
    { href: '/learn/studio', label: 'Courses', icon: BookOpen, capability: 'course.publish', ready: 'Publish courses as this organization', locked: 'Needs Organization Pro and a learning role' },
    { href: `/organizations/${workspace.slug}/team`, label: 'Team & roles', icon: UsersRound, capability: 'organization.team', ready: 'Manage member roles', locked: 'Needs Organization Pro and an admin role' },
    { href: `/organizations/${workspace.slug}/branding`, label: 'Branding', icon: Palette, capability: 'organization.branding', ready: 'Edit logo and public details', locked: 'Needs Organization Pro and a content role' },
    { href: `/organizations/${workspace.slug}/analytics`, label: 'Analytics', icon: BarChart3, capability: 'analytics.view', ready: 'Jobs, events and course metrics', locked: 'Needs Organization Pro and an analyst role' },
  ]
  const anyLocked = membership ? tools.some((tool) => !canUseCapability(access, tool.capability, { companyId: workspace.id })) : false

  const details = workspace.details
  const wellbeing = isWellbeingType(workspace.organizationType)
  const showFleet = organizationTypeHasField(workspace.organizationType, 'fleetSummary') || organizationTypeHasField(workspace.organizationType, 'vesselTypes')
  const hasOperations = (showFleet && (workspace.fleetSummary || workspace.vesselTypes.length)) || typeof details.fleetSize === 'number'
  const hasSupport = wellbeing && (details.servicesOffered?.length || details.languages?.length || typeof details.helpline24x7 === 'boolean' || details.accreditation)

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 py-6 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-4 border-b border-mist-100 pb-5 sm:flex-row sm:items-start">
        <div className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-xl bg-navy-950 text-white">
          {workspace.logoPath
            ? <Image
                src={'/api/company-logo/' + workspace.id}
                alt=""
                width={64}
                height={64}
                unoptimized
                className="size-full bg-white object-contain"
              />
            : <Building2 aria-hidden="true" className="size-7" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h1 className="break-words text-2xl font-bold tracking-tight text-navy-950 sm:text-3xl">{workspace.name}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <StatusChip tone="neutral">{workspace.companyType ?? 'Organization'}</StatusChip>
                {workspace.verified ? (
                  <StatusChip tone="success"><ShieldCheck aria-hidden="true" className="mr-1 size-3.5" />Verified by Sea N Shore</StatusChip>
                ) : (
                  <StatusChip tone="warning">Not verified yet</StatusChip>
                )}
                {wellbeing && details.helpline24x7 ? <StatusChip tone="info">24/7 helpline</StatusChip> : null}
              </div>
            </div>
            <OrganizationFollowButton
              companyId={workspace.id}
              initialFollowing={followState.following}
              initialFollowerCount={followState.followerCount}
            />
          </div>
          {workspace.description ? <p className="mt-3 max-w-3xl whitespace-pre-line text-sm leading-7 text-navy-900">{workspace.description}</p> : null}
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm text-muted">
            {workspace.website ? <a href={workspace.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-semibold text-ocean-700 hover:underline"><Globe2 className="size-4" aria-hidden="true" /> {workspace.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}</a> : null}
            {workspace.officeLocations.length ? <span className="inline-flex items-center gap-1.5"><MapPin className="size-4" aria-hidden="true" /> {workspace.officeLocations.join(' · ')}</span> : null}
          </div>
        </div>
      </header>

      {hasSupport ? (
        <section aria-labelledby="support-heading" className="rounded-xl border border-mist-100 bg-white p-4 sm:p-5">
          <h2 id="support-heading" className="text-base font-bold text-navy-950">Support offered</h2>
          <dl className="mt-3 grid gap-4 sm:grid-cols-2">
            {details.servicesOffered?.length ? (
              <div className="sm:col-span-2">
                <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Services</dt>
                <dd className="mt-1.5 flex flex-wrap gap-1.5">{details.servicesOffered.map((service) => <StatusChip key={service} tone="neutral">{wellbeingServiceLabel(service)}</StatusChip>)}</dd>
              </div>
            ) : null}
            {details.languages?.length ? (
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Languages</dt>
                <dd className="mt-1 text-sm text-navy-950">{details.languages.join(', ')}</dd>
              </div>
            ) : null}
            {typeof details.helpline24x7 === 'boolean' ? (
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-muted">24/7 helpline</dt>
                <dd className="mt-1 text-sm text-navy-950">{details.helpline24x7 ? 'Yes, available around the clock' : 'No'}</dd>
              </div>
            ) : null}
            {details.accreditation ? (
              <div className="sm:col-span-2">
                <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Accreditation</dt>
                <dd className="mt-1 text-sm text-navy-950">{details.accreditation}</dd>
              </div>
            ) : null}
          </dl>
        </section>
      ) : null}

      {hasOperations ? (
        <section aria-labelledby="operations-heading" className="rounded-xl border border-mist-100 bg-white p-4 sm:p-5">
          <h2 id="operations-heading" className="text-base font-bold text-navy-950">Operations</h2>
          {typeof details.fleetSize === 'number' ? <p className="mt-2 text-sm text-navy-950"><span className="font-semibold">{details.fleetSize}</span> {details.fleetSize === 1 ? 'vessel' : 'vessels'}</p> : null}
          {workspace.fleetSummary ? <p className="mt-2 whitespace-pre-line text-sm leading-7 text-muted">{workspace.fleetSummary}</p> : null}
          {workspace.vesselTypes.length ? <div className="mt-3 flex flex-wrap gap-1.5">{workspace.vesselTypes.map((type) => <StatusChip key={type} tone="neutral">{type}</StatusChip>)}</div> : null}
        </section>
      ) : null}

      {viewer ? (
        <OrganizationRequestsPanel
          organizationName={workspace.name}
          requests={managedRequests}
          nowIso={nowIso}
          readOnly={viewer.kind === 'platform'}
        />
      ) : null}

      {membership ? (
        <section aria-labelledby="workspace-heading">
          <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 id="workspace-heading" className="text-lg font-bold text-navy-950">Your workspace</h2>
            <p className="text-sm text-muted">
              {accessRoleLabel(membership.role)} · {membership.plan === 'organization_pro' ? 'Organization Pro' : 'Free plan'}
            </p>
          </div>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {tools.map((tool) => {
              const enabled = canUseCapability(access, tool.capability, { companyId: workspace.id })
              const Icon = tool.icon
              const body = (
                <>
                  <Icon className={'size-5 shrink-0 ' + (enabled ? 'text-ocean-700' : 'text-muted')} aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 font-semibold text-navy-950">{tool.label}{enabled ? null : <Lock aria-label="Locked" className="size-3.5 text-muted" />}</span>
                    <span className="mt-0.5 block text-xs text-muted">{enabled ? tool.ready : tool.locked}</span>
                  </span>
                </>
              )
              return (
                <li key={tool.label}>
                  {enabled ? (
                    <Link href={tool.href} className="flex h-full items-start gap-3 rounded-xl border border-ocean-200 bg-white p-3 transition hover:bg-ocean-50">{body}</Link>
                  ) : (
                    <div className="flex h-full items-start gap-3 rounded-xl border border-mist-100 bg-mist-50/60 p-3">{body}</div>
                  )}
                </li>
              )
            })}
          </ul>
          {anyLocked ? (
            <p className="mt-3 text-sm text-muted">
              Locked tools open with the Organization Pro plan and the right role.{' '}
              <Link href="/plans" className="font-semibold text-ocean-700 hover:underline">Compare plans</Link>
              {membership.role !== 'owner' && membership.role !== 'administrator' ? ' · Ask an owner or administrator of this organization to change your role.' : null}
            </p>
          ) : null}
        </section>
      ) : ownApplication ? (
        <section aria-labelledby="verification-heading" className="rounded-xl border border-sky-100 bg-sky-50 p-4 text-sky-950 sm:p-5">
          <h2 id="verification-heading" className="font-bold">
            {ownApplication.status === 'pending' ? 'Sea N Shore is verifying this organization'
              : ownApplication.status === 'suspended' ? 'This organization is suspended'
                : 'Your organization application needs attention'}
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-6">
            {ownApplication.status === 'pending'
              ? 'Your workspace tools and the Requests section open once the organization is verified.'
              : ownApplication.status === 'suspended'
                ? 'Workspace tools are unavailable until Sea N Shore resolves the review.'
                : 'Update the application from your Organizations page and resubmit it.'}
          </p>
          <Link href="/organizations#update-application" className="mt-3 inline-flex min-h-10 items-center rounded-xl bg-navy-950 px-4 text-sm font-bold text-white">Go to your application</Link>
        </section>
      ) : (
        <section aria-labelledby="join-heading" className="rounded-xl border border-mist-100 bg-mist-50 p-4 sm:p-5">
          <h2 id="join-heading" className="font-bold text-navy-950">Work with {workspace.name}?</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">
            Ask to join and choose the role you need. The organization&apos;s owner and administrators decide, and you can follow the status on your Organizations page.
          </p>
          <div className="mt-3">
            <RequestAccessForm company={{ id: workspace.id, name: workspace.name }} initialState={myPendingRequest ? 'pending' : 'none'} />
          </div>
          {myPendingRequest ? (
            <p className="mt-2 text-sm text-muted">
              <Link href="/organizations#your-requests" className="font-semibold text-ocean-700 hover:underline">See your request</Link>
            </p>
          ) : null}
        </section>
      )}
    </div>
  )
}
