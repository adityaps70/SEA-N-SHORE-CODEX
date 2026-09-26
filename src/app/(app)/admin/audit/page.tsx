import type { Metadata } from 'next'
import Link from 'next/link'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { auditDetails, auditTargetHref, auditTargetLabel, auditVerb } from '@/features/admin/audit-format'
import { AdminChip, AdminEmptyState, AdminFilterBar, AdminPageHeader, AdminPanel, formatAdminDate } from '@/features/admin/components/admin-ui'
import {
  adminRepository,
  type AdminAuditTargetType,
} from '@/features/admin/repository'
import { pluralize } from '@/lib/format'

export const metadata: Metadata = { title: 'Audit log · Admin' }

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const requestedType = firstValue(params.type)
  const allowedTypes: AdminAuditTargetType[] = [
    'all',
    'post',
    'comment',
    'job',
    'event',
    'organization_application',
  ]
  const targetType = allowedTypes.includes(requestedType as AdminAuditTargetType)
    ? requestedType as AdminAuditTargetType
    : 'all'

  const user = await requireAwsUser()
  const events = await adminRepository.listAuditEvents(user.id, {
    targetType,
    limit: 100,
  })

  const filters: Array<{ value: AdminAuditTargetType; label: string }> = [
    { value: 'all', label: 'All activity' },
    { value: 'post', label: 'Posts' },
    { value: 'comment', label: 'Comments' },
    { value: 'job', label: 'Jobs' },
    { value: 'event', label: 'Events' },
    { value: 'organization_application', label: 'Organizations' },
  ]

  return (
    <main className="space-y-4">
      <AdminPageHeader
        title="Audit log"
        meta={`${pluralize(events.length, 'event')} · newest first · read-only`}
      />

      <AdminFilterBar
        label="Audit filters"
        options={filters.map((filter) => ({
          href: `/admin/audit?type=${filter.value}`,
          label: filter.label,
          active: targetType === filter.value,
        }))}
      />

      <AdminPanel>
        {events.length === 0 ? (
          <AdminEmptyState title="No audit activity in this view" description="Choose another filter to review more administrator activity." />
        ) : (
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[48rem] text-left text-sm">
              <thead className="border-b border-mist-100 bg-mist-50/70 text-xs font-semibold uppercase tracking-wide text-muted">
                <tr>
                  <th scope="col" className="px-4 py-2.5">When</th>
                  <th scope="col" className="px-4 py-2.5">Administrator</th>
                  <th scope="col" className="px-4 py-2.5">Action</th>
                  <th scope="col" className="px-4 py-2.5">Details</th>
                  <th scope="col" className="px-4 py-2.5">Target</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-mist-100">
                {events.map((event) => {
                  const href = auditTargetHref(event.targetType, event.targetId)
                  const details = auditDetails(event.metadata)
                  return (
                    <tr key={event.id} className="align-top">
                      <td className="whitespace-nowrap px-4 py-2.5 text-muted">
                        <time dateTime={event.createdAt}>{formatAdminDate(event.createdAt, true)}</time>
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5">
                        {event.actor.slug ? (
                          <Link href={`/people/${event.actor.slug}`} className="font-semibold text-ocean-700 hover:underline">
                            {event.actor.fullName}
                          </Link>
                        ) : (
                          <span className="font-semibold text-navy-950">{event.actor.fullName}</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <AdminChip>{auditTargetLabel(event.targetType)}</AdminChip>
                          <span className="font-semibold text-navy-950" title={event.action}>{auditVerb(event.action)}</span>
                        </div>
                      </td>
                      <td className="max-w-[22rem] px-4 py-2.5 text-navy-900">
                        {details.length ? details.join(' · ') : <span className="text-muted">—</span>}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5">
                        {href ? (
                          <Link href={href} className="text-xs font-semibold text-ocean-700 hover:underline">
                            Open {auditTargetLabel(event.targetType).toLowerCase()}
                          </Link>
                        ) : <span className="text-xs text-muted">—</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </AdminPanel>
    </main>
  )
}
