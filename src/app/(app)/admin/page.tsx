import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight, CheckCircle2 } from 'lucide-react'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { auditActionLabel, auditTargetHref, auditTargetLabel } from '@/features/admin/audit-format'
import { AdminPageHeader, AdminPanel, formatAdminDate } from '@/features/admin/components/admin-ui'
import { adminRepository } from '@/features/admin/repository'

export const metadata: Metadata = { title: 'Admin' }

type AttentionItem = { label: string; count: number; href: string; urgent?: boolean }

export default async function AdminPage() {
  const user = await requireAwsUser()
  const [metrics, recentEvents] = await Promise.all([
    adminRepository.getAdminDashboardMetrics(user.id),
    adminRepository.listAuditEvents(user.id, { targetType: 'all', limit: 8 }).catch(() => []),
  ])

  const attention: AttentionItem[] = [
    { label: 'Priority reports', count: metrics.highPriorityReports, href: '/admin/moderation?status=open&type=all', urgent: true },
    { label: 'Open reports', count: metrics.openReports, href: '/admin/moderation?status=open&type=all' },
    { label: 'Under review', count: metrics.reviewingReports, href: '/admin/moderation?status=reviewing&type=all' },
    { label: 'Pending organizations', count: metrics.pendingOrganizations, href: '/admin/organizations' },
    { label: 'Organizations asked for changes', count: metrics.changesRequested, href: '/admin/organizations?status=changes_requested' },
    { label: 'Pending access requests', count: metrics.pendingAccessRequests, href: '/admin/access' },
  ]
  const waiting = attention.filter((item) => item.count > 0)

  const stats = [
    { label: 'Active posts', value: metrics.activePosts },
    { label: 'Published jobs', value: metrics.publishedJobs },
    { label: 'Published events', value: metrics.publishedEvents },
    { label: 'Approved organizations', value: metrics.approvedOrganizations },
    { label: 'Suspended organizations', value: metrics.suspendedOrganizations },
    { label: 'Reports in last 24h', value: metrics.reportsLast24h },
  ]

  return (
    <main className="space-y-6">
      <AdminPageHeader
        title="Overview"
        meta={waiting.length ? `${waiting.reduce((sum, item) => sum + item.count, 0)} items need attention` : 'All queues clear'}
        actions={(
          <>
            <Link href="/admin/verifications" className="inline-flex min-h-9 items-center rounded-lg border border-mist-100 bg-white px-3 text-sm font-semibold text-navy-950 hover:bg-mist-50">Creator verifications</Link>
            <Link href="/admin/users" className="inline-flex min-h-9 items-center rounded-lg bg-navy-950 px-3 text-sm font-semibold text-white hover:bg-navy-900">Manage users</Link>
          </>
        )}
      />

      <AdminPanel>
        <div className="border-b border-mist-100 px-5 py-3">
          <h3 className="text-sm font-bold text-navy-950">Needs your attention</h3>
        </div>
        {waiting.length ? (
          <ul className="divide-y divide-mist-100">
            {waiting.map((item) => (
              <li key={item.label}>
                <Link href={item.href} className="flex items-center gap-3 px-5 py-3 text-sm transition hover:bg-mist-50">
                  <span className={`min-w-8 rounded-md px-2 py-0.5 text-center text-sm font-bold ${item.urgent ? 'bg-red-600 text-white' : 'bg-mist-100 text-navy-950'}`}>
                    {item.count}
                  </span>
                  <span className="flex-1 font-semibold text-navy-950">{item.label}</span>
                  <ArrowRight aria-hidden="true" className="size-4 text-muted" />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="flex items-center gap-2 px-5 py-4 text-sm font-semibold text-emerald-800">
            <CheckCircle2 aria-hidden="true" className="size-4" /> No reports, applications or access requests are waiting.
          </p>
        )}
      </AdminPanel>

      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-mist-100 bg-mist-100 sm:grid-cols-3 xl:grid-cols-6">
        {stats.map((stat) => (
          <div key={stat.label} className="bg-white px-4 py-3">
            <dt className="text-xs font-semibold text-muted">{stat.label}</dt>
            <dd className="mt-1 text-2xl font-bold tracking-tight text-navy-950">{stat.value}</dd>
          </div>
        ))}
      </dl>

      <AdminPanel>
        <div className="flex items-center justify-between border-b border-mist-100 px-5 py-3">
          <h3 className="text-sm font-bold text-navy-950">Recent administrator activity</h3>
          <Link href="/admin/audit" className="text-sm font-semibold text-ocean-700 hover:underline">Full audit log</Link>
        </div>
        {recentEvents.length ? (
          <ul className="divide-y divide-mist-100 text-sm">
            {recentEvents.map((event) => {
              const href = auditTargetHref(event.targetType, event.targetId)
              return (
                <li key={event.id} className="grid gap-1 px-5 py-2.5 sm:grid-cols-[9rem_minmax(0,1fr)_auto] sm:items-center sm:gap-4">
                  <time dateTime={event.createdAt} className="text-xs text-muted">{formatAdminDate(event.createdAt, true)}</time>
                  <p className="min-w-0 truncate text-navy-950">
                    <span className="font-semibold">{event.actor.fullName}</span>
                    <span className="text-muted"> — {auditActionLabel(event.action)}</span>
                  </p>
                  {href ? (
                    <Link href={href} className="text-xs font-semibold text-ocean-700 hover:underline">
                      View {auditTargetLabel(event.targetType).toLowerCase()}
                    </Link>
                  ) : <span />}
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="px-5 py-4 text-sm text-muted">No administrator activity has been recorded yet.</p>
        )}
      </AdminPanel>
    </main>
  )
}
