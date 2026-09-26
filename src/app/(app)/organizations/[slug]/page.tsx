import Link from 'next/link'
import { notFound } from 'next/navigation'
import { BarChart3, BookOpen, BriefcaseBusiness, Building2, CalendarDays, Globe2, MapPin, Palette, ShieldCheck, UsersRound } from 'lucide-react'
import { canUseCapability } from '@/features/access/policy'
import { getAccessContext } from '@/features/access/server'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { organizationWorkspaceRepository } from '@/features/organizations/workspace-repository'

export default async function OrganizationWorkspacePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const user = await requireAwsUser()
  const workspace = await organizationWorkspaceRepository.getBySlug(slug)
  if (!workspace) notFound()

  const access = await getAccessContext(user.id)
  const membership = access.organizationMemberships.find((entry) => entry.companyId === workspace.id)
  const canTeam = canUseCapability(access, 'organization.team', { companyId: workspace.id })
  const canBrand = canUseCapability(access, 'organization.branding', { companyId: workspace.id })
  const canAnalytics = canUseCapability(access, 'analytics.view', { companyId: workspace.id })
  const canJobs = canUseCapability(access, 'job.publish', { companyId: workspace.id })
  const canEvents = canUseCapability(access, 'event.publish', { companyId: workspace.id })
  const canCourses = canUseCapability(access, 'course.publish', { companyId: workspace.id })

  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <section className="overflow-hidden rounded-[2rem] border border-mist-100 bg-white p-6 shadow-[var(--shadow-card)] sm:p-8">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
          <div className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-2xl bg-navy-950 text-white">
            {workspace.logoPath
              ? <img src={'/api/company-logo/' + workspace.id} alt="" className="size-full object-contain bg-white" />
              : <Building2 aria-hidden="true" className="size-8" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-3xl font-bold text-navy-950 sm:text-4xl">{workspace.name}</h1>
              {workspace.verified ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-800">
                  <ShieldCheck aria-hidden="true" className="size-3.5" /> Verified organization
                </span>
              ) : (
                <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-900">Verification pending</span>
              )}
            </div>
            <p className="mt-2 text-sm text-muted">{workspace.companyType ?? 'Maritime organization'}</p>
            {workspace.description ? <p className="mt-4 max-w-3xl text-sm leading-7 text-navy-900">{workspace.description}</p> : null}
            <div className="mt-4 flex flex-wrap gap-3 text-sm text-muted">
              {workspace.website ? <a href={workspace.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-semibold text-ocean-700 hover:underline"><Globe2 className="size-4" aria-hidden="true" /> Website</a> : null}
              {workspace.officeLocations.length ? <span className="inline-flex items-center gap-1.5"><MapPin className="size-4" aria-hidden="true" /> {workspace.officeLocations.join(' · ')}</span> : null}
            </div>
          </div>
        </div>
      </section>

      {membership ? (
        <section className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-ocean-700">Your workspace access</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <p className="font-bold text-navy-950">{membership.role.replaceAll('_', ' ')}</p>
            <span className="rounded-full bg-mist-50 px-2.5 py-1 text-xs font-bold text-muted">
              {membership.plan === 'organization_pro' ? 'Organization Pro' : 'Free / legacy access'}
            </span>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Link href="/hiring" className={'rounded-2xl border p-4 transition ' + (canJobs ? 'border-ocean-200 bg-ocean-50/40' : 'border-mist-100 bg-mist-50/50')}>
              <BriefcaseBusiness className="size-5 text-ocean-700" aria-hidden="true" />
              <p className="mt-2 font-bold text-navy-950">Jobs</p><p className="mt-1 text-xs text-muted">{canJobs ? 'Organization publishing ready' : 'Publishing entitlement required'}</p>
            </Link>
            <Link href="/events/hosting" className={'rounded-2xl border p-4 transition ' + (canEvents ? 'border-ocean-200 bg-ocean-50/40' : 'border-mist-100 bg-mist-50/50')}>
              <CalendarDays className="size-5 text-ocean-700" aria-hidden="true" />
              <p className="mt-2 font-bold text-navy-950">Events</p><p className="mt-1 text-xs text-muted">{canEvents ? 'Organization publishing ready' : 'Publishing entitlement required'}</p>
            </Link>
            <Link href="/learn/studio" className={'rounded-2xl border p-4 transition ' + (canCourses ? 'border-ocean-200 bg-ocean-50/40' : 'border-mist-100 bg-mist-50/50')}>
              <BookOpen className="size-5 text-ocean-700" aria-hidden="true" />
              <p className="mt-2 font-bold text-navy-950">LMS</p><p className="mt-1 text-xs text-muted">{canCourses ? 'Organization publishing ready' : 'Publishing entitlement required'}</p>
            </Link>
            <Link href={'/organizations/' + workspace.slug + '/team'} className={'rounded-2xl border p-4 transition ' + (canTeam ? 'border-ocean-200 bg-ocean-50/40' : 'border-mist-100 bg-mist-50/50')}>
              <UsersRound className="size-5 text-ocean-700" aria-hidden="true" />
              <p className="mt-2 font-bold text-navy-950">Team & roles</p><p className="mt-1 text-xs text-muted">{canTeam ? 'Manage workspace permissions' : 'Organization Pro required'}</p>
            </Link>
            <Link href={'/organizations/' + workspace.slug + '/branding'} className={'rounded-2xl border p-4 transition ' + (canBrand ? 'border-ocean-200 bg-ocean-50/40' : 'border-mist-100 bg-mist-50/50')}>
              <Palette className="size-5 text-ocean-700" aria-hidden="true" />
              <p className="mt-2 font-bold text-navy-950">Branding</p><p className="mt-1 text-xs text-muted">{canBrand ? 'Manage public organization identity' : 'Organization Pro required'}</p>
            </Link>
            <Link href={'/organizations/' + workspace.slug + '/analytics'} className={'rounded-2xl border p-4 transition ' + (canAnalytics ? 'border-ocean-200 bg-ocean-50/40' : 'border-mist-100 bg-mist-50/50')}>
              <BarChart3 className="size-5 text-ocean-700" aria-hidden="true" />
              <p className="mt-2 font-bold text-navy-950">Analytics</p><p className="mt-1 text-xs text-muted">{canAnalytics ? 'Cross-module workspace metrics' : 'Organization Pro / Analyst access required'}</p>
            </Link>
          </div>
        </section>
      ) : (
        <section className="rounded-[1.5rem] border border-mist-100 bg-mist-50 p-5 sm:p-6">
          <h2 className="font-bold text-navy-950">Represent this organization?</h2>
          <p className="mt-1 text-sm leading-6 text-muted">Request access through the organization workspace hub. Sea N Shore reviews access before a personal account is linked to an organization role.</p>
          <Link href="/organizations" className="mt-4 inline-flex rounded-xl bg-navy-950 px-4 py-2.5 text-sm font-bold text-white">Request organization access</Link>
        </section>
      )}

      {workspace.fleetSummary || workspace.vesselTypes.length ? (
        <section className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
          <h2 className="font-bold text-navy-950">Operations</h2>
          {workspace.fleetSummary ? <p className="mt-2 text-sm leading-7 text-muted">{workspace.fleetSummary}</p> : null}
          {workspace.vesselTypes.length ? <div className="mt-4 flex flex-wrap gap-2">{workspace.vesselTypes.map((type) => <span key={type} className="rounded-full bg-mist-50 px-3 py-1.5 text-xs font-semibold text-navy-900">{type}</span>)}</div> : null}
        </section>
      ) : null}
    </main>
  )
}
