import Link from 'next/link'
import { notFound } from 'next/navigation'
import { BarChart3, BookOpen, BriefcaseBusiness, CalendarDays, Crown, UsersRound } from 'lucide-react'
import { canUseCapability } from '@/features/access/policy'
import { getAccessContext } from '@/features/access/server'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { organizationWorkspaceRepository } from '@/features/organizations/workspace-repository'

export default async function OrganizationAnalyticsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const user = await requireAwsUser()
  const workspace = await organizationWorkspaceRepository.getBySlug(slug)
  if (!workspace) notFound()

  const access = await getAccessContext(user.id)
  const membership = access.organizationMemberships.find((entry) => entry.companyId === workspace.id)
  if (!membership) notFound()

  const canViewAnalytics = canUseCapability(access, 'analytics.view', { companyId: workspace.id })
  const metrics = canViewAnalytics ? await organizationWorkspaceRepository.getMetrics(workspace.id) : null

  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <div>
        <Link href={'/organizations/' + workspace.slug} className="text-sm font-bold text-muted hover:text-navy-950">← {workspace.name}</Link>
        <div className="mt-3 flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-xl bg-ocean-50 text-ocean-700"><BarChart3 aria-hidden="true" className="size-5" /></span>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-ocean-700">Organization Pro</p>
            <h1 className="text-3xl font-bold text-navy-950">Workspace analytics</h1>
          </div>
        </div>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-muted">
          One cross-module view of the organization’s activity across Jobs, Events and Learning.
        </p>
      </div>

      {metrics ? (
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[
            { label: 'Published jobs', value: metrics.publishedJobs, icon: BriefcaseBusiness },
            { label: 'Job applications', value: metrics.applications, icon: UsersRound },
            { label: 'Published events', value: metrics.publishedEvents, icon: CalendarDays },
            { label: 'Event attendees', value: metrics.attendees, icon: UsersRound },
            { label: 'Published courses', value: metrics.publishedCourses, icon: BookOpen },
            { label: 'Course enrollments', value: metrics.enrollments, icon: UsersRound },
          ].map((metric) => {
            const Icon = metric.icon
            return (
              <article key={metric.label} className="rounded-[1.4rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)]">
                <Icon aria-hidden="true" className="size-5 text-ocean-700" />
                <p className="mt-4 text-3xl font-bold text-navy-950">{metric.value}</p>
                <p className="mt-1 text-sm font-semibold text-muted">{metric.label}</p>
              </article>
            )
          })}
        </section>
      ) : (
        <section className="rounded-[1.5rem] border border-amber-200 bg-amber-50 p-6">
          <div className="flex gap-3">
            <Crown className="mt-0.5 size-5 shrink-0 text-amber-900" aria-hidden="true" />
            <div>
              <h2 className="font-bold text-amber-950">Analytics access is not enabled for this workspace role</h2>
              <p className="mt-2 text-sm leading-6 text-amber-900">
                Organization analytics requires Organization Pro and an Owner, Administrator or Analyst role.
              </p>
              <Link href="/plans" className="mt-4 inline-flex rounded-xl bg-navy-950 px-4 py-2.5 text-sm font-bold text-white">View Organization Pro</Link>
            </div>
          </div>
        </section>
      )}
    </main>
  )
}
