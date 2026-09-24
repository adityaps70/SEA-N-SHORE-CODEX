import Link from 'next/link'
import {
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  CheckCircle2,
  Clock3,
  FileWarning,
  KeyRound,
  MessageSquareWarning,
  ShieldAlert,
  UserCog,
} from 'lucide-react'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { adminRepository } from '@/features/admin/repository'

export default async function AdminPage() {
  const user = await requireAwsUser()
  const metrics = await adminRepository.getAdminDashboardMetrics(user.id)

  const operationsCards = [
    { label: 'Open reports', value: metrics.openReports, icon: MessageSquareWarning, href: '/admin/moderation?status=open&type=all' },
    { label: 'Priority reports', value: metrics.highPriorityReports, icon: ShieldAlert, href: '/admin/moderation?status=open&type=all' },
    { label: 'Under review', value: metrics.reviewingReports, icon: FileWarning, href: '/admin/moderation?status=reviewing&type=all' },
    { label: 'Reports · 24h', value: metrics.reportsLast24h, icon: Clock3, href: '/admin/moderation?status=open&type=all' },
  ] as const

  const platformCards = [
    { label: 'Active posts', value: metrics.activePosts, icon: MessageSquareWarning },
    { label: 'Published jobs', value: metrics.publishedJobs, icon: BriefcaseBusiness },
    { label: 'Published events', value: metrics.publishedEvents, icon: CalendarDays },
    { label: 'Pending organizations', value: metrics.pendingOrganizations, icon: Building2 },
    { label: 'Pending access requests', value: metrics.pendingAccessRequests, icon: KeyRound },
  ] as const

  return (
    <main className="space-y-6">
      <section>
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-red-700">Trust & safety</p>
            <h2 className="mt-1 text-2xl font-bold text-navy-950">Platform operations</h2>
          </div>
          <Link href="/admin/moderation" className="text-sm font-bold text-ocean-700 hover:underline">Open moderation queue →</Link>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {operationsCards.map(({ label, value, icon: Icon, href }) => (
            <Link key={label} href={href} className="rounded-[1.35rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] transition hover:-translate-y-0.5 hover:border-ocean-200">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-muted">{label}</p>
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-red-50 text-red-700"><Icon aria-hidden="true" className="size-4" /></span>
              </div>
              <p className="mt-3 text-3xl font-bold tracking-tight text-navy-950">{value}</p>
            </Link>
          ))}
        </div>
      </section>

      <section>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-teal-700">Site health</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {platformCards.map(({ label, value, icon: Icon }) => (
            <article key={label} className="rounded-[1.35rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)]">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-muted">{label}</p>
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-mist-50 text-navy-950"><Icon aria-hidden="true" className="size-4" /></span>
              </div>
              <p className="mt-3 text-3xl font-bold tracking-tight text-navy-950">{value}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.25fr_1fr_1fr]">
        <article className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6 lg:col-span-3">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex gap-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-ocean-50 text-ocean-700">
                <UserCog aria-hidden="true" className="size-5" />
              </span>
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-ocean-700">User administration</p>
                <h2 className="mt-1 text-xl font-bold text-navy-950">Search, suspend, restore or permanently delete user accounts</h2>
                <p className="mt-1 text-sm leading-6 text-muted">Every account action requires a reason and is retained in the administrator audit history.</p>
              </div>
            </div>
            <Link href="/admin/users" className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-xl bg-navy-950 px-4 text-sm font-bold text-white hover:bg-navy-900">
              Manage users
            </Link>
          </div>
        </article>
        <article className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-red-700">Content moderation</p>
          <h2 className="mt-2 text-xl font-bold text-navy-950">One queue for posts, comments, jobs and events</h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            Reports are grouped by content item, prioritized by serious reasons, and every moderator decision is recorded in the platform audit trail.
          </p>
          <Link href="/admin/moderation" className="mt-5 inline-flex min-h-11 items-center rounded-xl bg-navy-950 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-navy-900">
            Review reports
          </Link>
        </article>

        <article className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-teal-700">Organization verification</p>
          <h2 className="mt-2 text-xl font-bold text-navy-950">{metrics.pendingOrganizations} waiting for review</h2>
          <p className="mt-2 text-sm leading-6 text-muted">{metrics.changesRequested} need changes · {metrics.suspendedOrganizations} suspended · {metrics.approvedOrganizations} approved.</p>
          <Link href="/admin/organizations" className="mt-5 inline-flex min-h-10 items-center rounded-xl border border-mist-100 px-4 text-sm font-bold text-navy-950 hover:bg-mist-50">
            Organization queue
          </Link>
        </article>

        <article className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-teal-700">Access control</p>
          <h2 className="mt-2 text-xl font-bold text-navy-950">Membership queue</h2>
          <p className="mt-2 text-sm leading-6 text-muted">{metrics.pendingAccessRequests} request{metrics.pendingAccessRequests === 1 ? '' : 's'} currently wait for controlled organization access review.</p>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800">
              <CheckCircle2 aria-hidden="true" className="size-4" /> Administrator-only
            </div>
            <Link href="/admin/access" className="inline-flex min-h-10 items-center rounded-xl border border-mist-100 px-4 text-sm font-bold text-navy-950 hover:bg-mist-50">
              Review access
            </Link>
          </div>
        </article>
      </section>
    </main>
  )
}
