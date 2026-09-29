import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import type { LucideIcon } from 'lucide-react'
import { ArrowRight, BarChart3, BookOpen, BriefcaseBusiness, CalendarDays, Inbox, Lock, MessagesSquare, Palette, ShieldCheck, UsersRound } from 'lucide-react'
import { canUseCapability, type Capability } from '@/features/access/policy'
import { getAccessContext } from '@/features/access/server'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { canManageOrganizationBilling, isOrganizationBillingContact } from '@/features/billing/billing-access'
import { BillingHistory, PlanBillingPanel } from '@/features/billing/components/plan-billing-panel'
import { loadPlanBillingView } from '@/features/billing/page-data'
import { accessRoleLabel } from '@/features/organizations/access-request-labels'
import { organizationAccessRequestRepository } from '@/features/organizations/access-request-repository'
import { StatusChip } from '@/features/organizations/components/organization-access-panel'
import { OrganizationManageShell } from '@/features/organizations/components/organization-manage-shell'
import { OrganizationRequestsPanel } from '@/features/organizations/components/organization-requests-panel'
import { organizationManageHref, organizationPlanBillingHref, parseManageSection } from '@/features/organizations/organization-page-profile'
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

  // Owners and administrators see Plan & billing on the free plan too (billing.manage comes
  // WITH Organization Pro). Buying is authorized again in every billing server action.
  const billingContact = isOrganizationBillingContact(access, workspace.id)
  const activeSection = section === 'requests' && viewer ? 'requests' : section === 'billing' && billingContact ? 'billing' : 'overview'
  const billingView = activeSection === 'billing'
    ? await loadPlanBillingView({ kind: 'company', companyId: workspace.id }).catch((error: unknown) => {
        console.error('organization_manage_billing_unavailable', { message: error instanceof Error ? error.message : null })
        return null
      })
    : null
  const billingBlockedMessage = !canManageOrganizationBilling(access, workspace.id)
    ? 'Your account is restricted right now, so plans can’t be bought or changed. Contact the Sea N Shore team for help.'
    : !workspace.verified
      ? 'Organization Pro can be bought once Sea N Shore has verified this organization, because its features only work for verified organizations.'
      : null

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
    // Round 9C: one community per Organization Pro organization, created by its owner or an administrator.
    { href: `/community/new?as=${workspace.id}`, label: 'Community', icon: MessagesSquare, capability: 'organization.manage', ready: 'Create and run a community as this organization', locked: 'Needs Organization Pro and an admin role' },
  ]
  const can = (capability: Capability) => canUseCapability(access, capability, { companyId: workspace.id })
  const anyLocked = membership ? tools.some((tool) => !can(tool.capability)) : false
  const isPro = membership?.plan === 'organization_pro'
  const planLabel = isPro ? 'Organization Pro' : 'Free plan'
  const canUpgradeHere = billingContact && workspace.verified && !isPro
  const summary = membership
    ? `${accessRoleLabel(membership.role)} · ${planLabel}`
    : ownApplication
      ? 'Owner · Waiting for verification'
      : readOnly ? 'Sea N Shore reviewer' : null

  return (
    <OrganizationManageShell
      workspace={workspace}
      active={activeSection}
      summary={summary}
      showRequests={Boolean(viewer)}
      pendingRequests={pendingCount}
      showBilling={billingContact}
      locked={membership ? {
        team: !can('organization.team'),
        branding: !can('organization.branding'),
        analytics: !can('analytics.view'),
      } : undefined}
    >
      {activeSection === 'billing' ? (
        <>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-navy-950 max-md:sr-only">Plan & billing</h1>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted max-md:mt-0 max-md:text-[13px] max-md:leading-5">
              The {workspace.name} plan, renewing automatically through our payment provider, Cashfree. Only the owner and administrators can see and change it.
            </p>
          </div>
          {billingView ? (
            <>
              <PlanBillingPanel
                view={billingView}
                target={{ kind: 'organization', companyId: workspace.id }}
                eyebrow="Organization plan"
                description="Organization Pro unlocks jobs, events and courses as this organization, multiple admins, applicant and student management, analytics, branding and team permissions."
                blockedMessage={billingBlockedMessage}
                anchorId="organization-pro"
              />
              {billingView.history.length ? <BillingHistory rows={billingView.history} /> : null}
            </>
          ) : (
            <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950">
              We couldn’t load this organization’s plan just now. Reload the page to try again. Nothing has been charged.
            </p>
          )}
          <p className="text-sm text-muted">
            Also in{' '}
            <Link href={`/settings/billing/organizations/${workspace.id}`} className="font-semibold text-ocean-700 hover:underline">Membership & billing</Link>
            {' '}with your personal plan.
          </p>
        </>
      ) : activeSection === 'requests' ? (
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
            <h1 className="text-2xl font-bold tracking-tight text-navy-950 max-md:sr-only">Overview</h1>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted max-md:hidden">
              Everything for running the {workspace.name} page: who can join, team roles, page details and activity.
            </p>
          </div>

          <ul className="grid gap-3 sm:grid-cols-3">
            <li className="rounded-2xl border border-mist-100 bg-white p-4 shadow-[var(--shadow-card)]">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Your role</p>
              <p className="mt-1 font-bold text-navy-950">
                {membership ? accessRoleLabel(membership.role) : ownApplication ? 'Owner' : 'Sea N Shore reviewer'}
              </p>
              <p className="mt-0.5 text-sm text-muted">
                {membership ? planLabel : ownApplication ? 'Role starts once verified' : 'Read-only access'}
                {billingContact ? (
                  <>
                    {' · '}
                    <Link href={organizationPlanBillingHref(workspace.slug)} className="font-semibold text-ocean-700 hover:underline">
                      {canUpgradeHere ? 'Upgrade' : 'Plan & billing'}
                    </Link>
                  </>
                ) : null}
              </p>
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
                  // Owners and administrators of a verified free organization unlock these by upgrading.
                  const upgrade = !enabled && canUpgradeHere
                  const lockedText = upgrade
                    ? 'Included with Organization Pro'
                    : billingContact && !workspace.verified && !isPro
                      ? 'Opens once the organization is verified and on Organization Pro'
                      : tool.locked
                  const body = (
                    <>
                      <Icon className={'size-5 shrink-0 ' + (enabled || upgrade ? 'text-ocean-700' : 'text-muted')} aria-hidden="true" />
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5 font-semibold text-navy-950">{tool.label}{enabled ? null : <Lock aria-label="Locked" className="size-3.5 text-muted" />}</span>
                        <span className="mt-0.5 block text-xs text-muted">{enabled ? tool.ready : lockedText}</span>
                        {upgrade ? (
                          <span className="mt-1 inline-flex items-center gap-1 text-xs font-bold text-ocean-700">
                            Upgrade <ArrowRight aria-hidden="true" className="size-3.5" />
                          </span>
                        ) : null}
                      </span>
                    </>
                  )
                  return (
                    <li key={tool.label}>
                      {enabled ? (
                        <Link href={tool.href} className="flex h-full items-start gap-3 rounded-xl border border-ocean-200 bg-white p-3 transition hover:bg-ocean-50">{body}</Link>
                      ) : upgrade ? (
                        <Link href={organizationPlanBillingHref(workspace.slug)} className="flex h-full cursor-pointer items-start gap-3 rounded-xl border border-dashed border-ocean-200 bg-white p-3 transition hover:border-ocean-300 hover:bg-ocean-50">{body}</Link>
                      ) : (
                        <div className="flex h-full items-start gap-3 rounded-xl border border-mist-100 bg-mist-50/60 p-3">{body}</div>
                      )}
                    </li>
                  )
                })}
              </ul>
              {anyLocked ? (
                <p className="mt-3 text-sm text-muted">
                  {billingContact ? (
                    isPro ? 'Some tools are not included in this organization’s plan. ' : !workspace.verified
                      ? 'Organization Pro can be bought once Sea N Shore verifies this organization. '
                      : 'Locked tools open with Organization Pro. '
                  ) : isPro
                    ? 'Locked tools need a different role. Ask an owner or administrator of this organization to change your role.'
                    : 'Locked tools open with Organization Pro and the right role. Ask an owner or administrator to upgrade to Organization Pro.'}
                  {canUpgradeHere ? (
                    <Link href={organizationPlanBillingHref(workspace.slug)} className="font-semibold text-ocean-700 hover:underline">Upgrade to Organization Pro</Link>
                  ) : billingContact ? (
                    <Link href={organizationPlanBillingHref(workspace.slug)} className="font-semibold text-ocean-700 hover:underline">See Plan & billing</Link>
                  ) : null}
                </p>
              ) : null}
              {billingContact && !anyLocked ? (
                <p className="mt-3 text-sm">
                  <Link href={organizationPlanBillingHref(workspace.slug)} className="font-semibold text-ocean-700 hover:underline">Plan & billing</Link>
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
