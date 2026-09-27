import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import type { LucideIcon } from 'lucide-react'
import { BarChart3, BookOpen, BriefcaseBusiness, CalendarDays, Inbox, Lock, Palette, ShieldCheck, UsersRound } from 'lucide-react'
import { canUseCapability, type Capability } from '@/features/access/policy'
import { getAccessContext } from '@/features/access/server'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { accessRoleLabel } from '@/features/organizations/access-request-labels'
import { organizationAccessRequestRepository } from '@/features/organizations/access-request-repository'
import { StatusChip } from '@/features/organizations/components/organization-access-panel'
import { OrganizationManageShell } from '@/features/organizations/components/organization-manage-shell'
import { OrganizationRequestsPanel } from '@/features/organizations/components/organization-requests-panel'
import { organizationManageHref, parseManageSection } from '@/features/organizations/organization-page-profile'
import { organizationRepository } from '@/features/organizations/repository'
import { organizationWorkspaceRepository } from '@/features/organizations/workspace-repository'

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const workspace = await organizationWorkspaceRepository.getBySlug(slug).catch(() => null)
  return { title: workspace ? `Manage ${workspace.name}` : 'Manage organization' }
}

type Tool = {
  href: string
  label: string
  icon: LucideIcon
  capability: Capability
  ready: string
  locked: string
}

export default async function OrganizationManagePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams?: Promise<{ section?: string | string[] }>
}) {
  const { slug } = await params
  const section = parseManageSection((await searchParams)?.section)
  const user = await requireAwsUser()
  const workspace = await organizationWorkspaceRepository.getBySlug(slug)
  if (!workspace) notFound()

  const [access, viewer, applicationState] = await Promise.all([
    getAccessContext(user.id),
    organizationAccessRequestRepository.getViewer(user.id, workspace.id),
    organizationRepository.getUserOrganizationState(user.id),
  ])
  // The owner of an organization that is still being verified has no approved membership yet.
  const ownApplication = applicationState.kind === 'application' && applicationState.company.id === workspace.id && applicationState.status !== 'approved'
    ? applicationState
    : null
  const membership = access.organizationMemberships.find((entry) => entry.companyId === workspace.id)

  // Members, request deciders (including Sea N Shore reviewers) and the applicant owner manage the page.
  if (!membership && !viewer && !ownApplication) redirect('/organizations/' + workspace.slug)

  const managedRequests = viewer ? (await organizationAccessRequestRepository.listForOrganization(user.id, workspace.id)).requests : []
  const pendingCount = managedRequests.filter((request) => request.status === 'pending').length
  const nowIso = new Date().toISOString()
  const readOnly = viewer?.kind === 'platform'

  const tools: Tool[] = [
    { href: '/hiring', label: 'Jobs', icon: BriefcaseBusiness, capability: 'job.publish', ready: 'Post jobs as this organization', locked: 'Needs Organization Pro and a recruiter role' },
    { href: '/events/hosting', label: 'Events', icon: CalendarDays, capability: 'event.publish', ready: 'Host events as this organization', locked: 'Needs Organization Pro and an events role' },
    { href: '/learn/studio', label: 'Courses', icon: BookOpen, capability: 'course.publish', ready: 'Publish courses as this organization', locked: 'Needs Organization Pro and a learning role' },
    { href: `/organizations/${workspace.slug}/team`, label: 'Team & roles', icon: UsersRound, capability: 'organization.team', ready: 'Manage member roles', locked: 'Needs Organization Pro and an admin role' },
    { href: `/organizations/${workspace.slug}/branding`, label: 'Branding', icon: Palette, capability: 'organization.branding', ready: 'Edit logo, cover and page details', locked: 'Needs Organization Pro and a content role' },
    { href: `/organizations/${workspace.slug}/analytics`, label: 'Analytics', icon: BarChart3, capability: 'analytics.view', ready: 'Jobs, events and course metrics', locked: 'Needs Organization Pro and an analyst role' },
  ]
  const can = (capability: Capability) => canUseCapability(access, capability, { companyId: workspace.id })
  const anyLocked = membership ? tools.some((tool) => !can(tool.capability)) : false
  const planLabel = membership?.plan === 'organization_pro' ? 'Organization Pro' : 'Free plan'
  const summary = membership
    ? `${accessRoleLabel(membership.role)} · ${planLabel}`
    : ownApplication
      ? 'Owner · Waiting for verification'
      : readOnly ? 'Sea N Shore reviewer' : null

  return (
    <OrganizationManageShell
      workspace={workspace}
      active={section === 'requests' && viewer ? 'requests' : 'overview'}
      summary={summary}
      showRequests={Boolean(viewer)}
      pendingRequests={pendingCount}
      locked={membership ? {
        team: !can('organization.team'),
        branding: !can('organization.branding'),
        analytics: !can('analytics.view'),
      } : undefined}
    >
      {section === 'requests' && viewer ? (
        <>
          <h1 className="sr-only">Requests to join {workspace.name}</h1>
          <OrganizationRequestsPanel
            organizationName={workspace.name}
            requests={managedRequests}
            nowIso={nowIso}
            readOnly={readOnly}
          />
        </>
      ) : (
        <>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-navy-950">Overview</h1>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">
              Everything for running the {workspace.name} page: who can join, team roles, page details and activity.
            </p>
          </div>

          <ul className="grid gap-3 sm:grid-cols-3">
            <li className="rounded-2xl border border-mist-100 bg-white p-4 shadow-[var(--shadow-card)]">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Your role</p>
              <p className="mt-1 font-bold text-navy-950">
                {membership ? accessRoleLabel(membership.role) : ownApplication ? 'Owner' : 'Sea N Shore reviewer'}
              </p>
              <p className="mt-0.5 text-sm text-muted">{membership ? planLabel : ownApplication ? 'Role starts once verified' : 'Read-only access'}</p>
            </li>
            <li className="rounded-2xl border border-mist-100 bg-white p-4 shadow-[var(--shadow-card)]">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Verification</p>
              {workspace.verified ? (
                <p className="mt-1 inline-flex items-center gap-1.5 font-bold text-emerald-800"><ShieldCheck aria-hidden="true" className="size-4" /> Verified by Sea N Shore</p>
              ) : (
                <p className="mt-1 font-bold text-amber-900">Not verified yet</p>
              )}
              <p className="mt-0.5 text-sm text-muted">{workspace.verified ? 'Shown with a badge on your page' : 'Publishing opens after verification'}</p>
            </li>
            <li className="rounded-2xl border border-mist-100 bg-white p-4 shadow-[var(--shadow-card)]">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Requests to join</p>
              {viewer ? (
                <>
                  <p className="mt-1 font-bold text-navy-950">{pendingCount} waiting</p>
                  <Link href={organizationManageHref(workspace.slug, 'requests')} className="mt-0.5 inline-flex items-center gap-1 text-sm font-semibold text-ocean-700 hover:underline">
                    <Inbox aria-hidden="true" className="size-3.5" /> {readOnly ? 'View requests' : 'Review requests'}
                  </Link>
                </>
              ) : (
                <p className="mt-1 text-sm leading-6 text-muted">
                  {ownApplication ? 'Opens once the organization is verified.' : 'The owner and administrators decide who joins.'}
                </p>
              )}
            </li>
          </ul>

          {ownApplication ? (
            <section aria-labelledby="verification-heading" className="rounded-2xl border border-sky-100 bg-sky-50 p-4 text-sky-950 sm:p-5">
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
              {ownApplication.adminReviewNote ? <p className="mt-2 text-sm leading-6">Note from Sea N Shore: {ownApplication.adminReviewNote}</p> : null}
              <Link href="/organizations#update-application" className="mt-3 inline-flex min-h-10 items-center rounded-xl bg-navy-950 px-4 text-sm font-bold text-white hover:bg-navy-900">Go to your application</Link>
            </section>
          ) : null}

          {membership ? (
            <section aria-labelledby="workspace-heading" className="rounded-2xl border border-mist-100 bg-white p-4 shadow-[var(--shadow-card)] sm:p-5">
              <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 id="workspace-heading" className="text-lg font-bold text-navy-950">Your workspace</h2>
                <p className="text-sm text-muted">{accessRoleLabel(membership.role)} · {planLabel}</p>
              </div>
              <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {tools.map((tool) => {
                  const enabled = can(tool.capability)
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
              {can('billing.manage') ? (
                <p className="mt-2 text-sm">
                  <Link href={`/settings/billing/organizations/${workspace.id}`} className="font-semibold text-ocean-700 hover:underline">Manage billing</Link>
                </p>
              ) : null}
            </section>
          ) : null}

          {!workspace.verified && membership ? (
            <p className="text-sm text-muted"><StatusChip tone="warning">Not verified yet</StatusChip> Verification confirms the organization is genuine. It does not start an Organization Pro subscription.</p>
          ) : null}
        </>
      )}
    </OrganizationManageShell>
  )
}
