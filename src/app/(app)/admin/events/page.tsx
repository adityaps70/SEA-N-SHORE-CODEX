import type { Metadata } from 'next'
import Link from 'next/link'
import { requireAdminAccess } from '@/features/admin/admin-access'
import { AdminChip, AdminEmptyState, AdminPageHeader, AdminPanel, formatAdminDate } from '@/features/admin/components/admin-ui'
import { ModerationActionPanel } from '@/features/admin/components/moderation-action-panel'
import { adminRepository } from '@/features/admin/repository'
import { countryName } from '@/features/countries/catalog'
import { allows } from '@/features/country-admins/sections'
import { pluralize } from '@/lib/format'

export const metadata: Metadata = { title: 'Events · Admin' }
export const dynamic = 'force-dynamic'

/**
 * Round GP Part E (owner, 21 Nov): Admin › Events. Events are not approved; this page shows published and recently
 * cancelled events, and the reports on them. Decisions are made through reports only: cancel an event (remove) or
 * restore it. A country admin sees their countries' events (the organizer organization's country, or else the host's
 * country of residence); with Moderation "act" they also get the other report actions.
 */
export default async function AdminEventsPage() {
  const access = await requireAdminAccess('events')
  const user = access.user
  const [events, reported] = await Promise.all([
    adminRepository.listCountryEvents(user.id),
    adminRepository.listModerationCases(user.id, { status: 'open', targetType: 'event', limit: 100 }, { section: 'events' }),
  ])
  const panelMode = access.kind === 'platform'
    ? 'platform' as const
    : allows(access.permissions, 'moderation', 'act') || allows(access.permissions, 'events', 'act') ? 'country' as const : 'view' as const
  const panelActions = access.kind === 'country' && !allows(access.permissions, 'moderation', 'act')
    ? ['remove', 'restore'] as const
    : undefined

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title="Events"
        meta={pluralize(events.length, 'event')}
        description="Published and recently cancelled events, and the reports on them. Cancel or restore an event through its report; refunds and payments stay with Sea N Shore."
      />

      <AdminPanel>
        <div className="border-b border-mist-100 px-5 py-3">
          <h3 className="text-sm font-bold text-navy-950">Reported events</h3>
        </div>
        {reported.length ? (
          <ul className="divide-y divide-mist-100">
            {reported.map((item) => (
              <li key={item.targetId} className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
                <div className="min-w-0">
                  <p className="font-semibold text-navy-950">
                    <Link href={`/events/${item.targetId}`} className="hover:text-ocean-700 hover:underline">{item.title}</Link>
                  </p>
                  {item.excerpt ? <p className="mt-1 line-clamp-3 text-sm text-ink">{item.excerpt}</p> : null}
                  <p className="mt-2 text-xs text-muted">
                    {pluralize(item.reportCount, 'report')} · {item.targetState} · latest {formatAdminDate(item.latestReportedAt, true)}
                  </p>
                </div>
                <ModerationActionPanel
                  targetType="event"
                  targetId={item.targetId}
                  targetState={item.targetState}
                  mode={panelMode}
                  {...(panelActions ? { actions: panelActions } : {})}
                />
              </li>
            ))}
          </ul>
        ) : (
          <AdminEmptyState title="No open reports on events." description="Reported events appear here." />
        )}
      </AdminPanel>

      <AdminPanel>
        <div className="border-b border-mist-100 px-5 py-3">
          <h3 className="text-sm font-bold text-navy-950">Events</h3>
        </div>
        {events.length ? (
          <ul className="divide-y divide-mist-100">
            {events.map((event) => (
              <li key={event.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-sm">
                <Link href={`/events/${event.id}`} className="min-w-0 flex-1 font-semibold text-navy-950 hover:text-ocean-700 hover:underline">{event.title}</Link>
                <span className="text-muted">{event.organizerName}</span>
                <span className="text-muted">{event.startAt ? formatAdminDate(event.startAt, true) : 'No date'}</span>
                <span className="text-muted">{event.country ? countryName(event.country) ?? event.country : 'Country not set'}</span>
                {event.status === 'cancelled' ? <AdminChip tone="danger">Cancelled</AdminChip> : null}
                {event.openReports ? <AdminChip tone="warning">{pluralize(event.openReports, 'open report')}</AdminChip> : null}
              </li>
            ))}
          </ul>
        ) : (
          <AdminEmptyState title="No events." description="Published events in your countries appear here." />
        )}
      </AdminPanel>
    </div>
  )
}
