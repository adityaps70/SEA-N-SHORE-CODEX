import { COUNTRY_ADMIN_SECTION_INFO, COUNTRY_ADMIN_SECTIONS, isCountryAdminSection } from '@/features/country-admins/sections'
import type { Metadata } from 'next'
import Link from 'next/link'
import { ExternalLink, UserRound } from 'lucide-react'
import { auditDetails, auditTargetHref, auditTargetLabel, auditVerb } from '@/features/admin/audit-format'
import { AdminChip, AdminEmptyState, AdminFilterBar, AdminPageHeader, AdminPanel, formatAdminDate } from '@/features/admin/components/admin-ui'
import { ADMIN_TABLE_DESKTOP_CLASS, AdminMobileCard, AdminMobileList } from '@/features/admin/components/admin-mobile-list'
import {
  adminRepository,
  type AdminAuditTargetType,
} from '@/features/admin/repository'
import { pluralize } from '@/lib/format'
import { requireAdminAccess } from '@/features/admin/admin-access'
import { isCountryCode } from '@/features/countries/catalog'
import { CountrySelect } from '@/features/countries/components/country-select'

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
    'group',
    'organization_application',
  ]
  const targetType = allowedTypes.includes(requestedType as AdminAuditTargetType)
    ? requestedType as AdminAuditTargetType
    : 'all'

  const user = (await requireAdminAccess('platform')).user
  // Round GP (Part C): filter by one admin, by country, and to country admin decisions.
  const actorCandidate = firstValue(params.actor) ?? ''
  const actorId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actorCandidate) ? actorCandidate : null
  const countryCandidate = (firstValue(params.country) ?? '').toUpperCase()
  const country = isCountryCode(countryCandidate) ? countryCandidate : null
  const countryAdminsOnly = firstValue(params.role) === 'country_admin'
  // Round GP Part E: one admin section (a country admin section, or Country admins itself).
  const sectionCandidate = firstValue(params.section) ?? ''
  const section = isCountryAdminSection(sectionCandidate) || sectionCandidate === 'country_admins' ? sectionCandidate : null
  const events = await adminRepository.listAuditEvents(user.id, {
    targetType,
    limit: 100,
    ...(actorId ? { actorId } : {}),
    ...(country ? { country } : {}),
    ...(countryAdminsOnly ? { countryAdminsOnly } : {}),
    ...(section ? { section } : {}),
  })
  const keep = (next: Record<string, string | null>) => {
    const search = new URLSearchParams()
    const values: Record<string, string | null> = {
      type: targetType,
      actor: actorId,
      country,
      role: countryAdminsOnly ? 'country_admin' : null,
      section,
      ...next,
    }
    for (const [key, value] of Object.entries(values)) if (value) search.set(key, value)
    const query = search.toString()
    return `/admin/audit${query ? `?${query}` : ''}`
  }

  const filters: Array<{ value: AdminAuditTargetType; label: string }> = [
    { value: 'all', label: 'All activity' },
    { value: 'post', label: 'Posts' },
    { value: 'comment', label: 'Comments' },
    { value: 'job', label: 'Jobs' },
    { value: 'event', label: 'Events' },
    { value: 'group', label: 'Groups' },
    { value: 'organization_application', label: 'Organizations' },
  ]

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title="Audit log"
        meta={`${pluralize(events.length, 'event')} · newest first · read-only`}
      />

      <AdminFilterBar
        label="Audit filters"
        options={filters.map((filter) => ({
          href: keep({ type: filter.value }),
          label: filter.label,
          active: targetType === filter.value,
        }))}
      />

      <form method="get" action="/admin/audit" className="flex flex-wrap items-end gap-3 text-sm">
        {targetType !== 'all' ? <input type="hidden" name="type" value={targetType} /> : null}
        {actorId ? <input type="hidden" name="actor" value={actorId} /> : null}
        <div>
          <label htmlFor="audit-country" className="block text-xs font-semibold text-muted">Country</label>
          <CountrySelect id="audit-country" name="country" defaultValue={country} emptyLabel="All countries" className="mt-1 min-h-9 rounded-lg border border-mist-200 bg-white px-2 text-sm text-navy-950" />
        </div>
        <div>
          <label htmlFor="audit-section" className="block text-xs font-semibold text-muted">Section</label>
          <select id="audit-section" name="section" defaultValue={section ?? ''} className="mt-1 min-h-9 rounded-lg border border-mist-200 bg-white px-2 text-sm text-navy-950">
            <option value="">All sections</option>
            {COUNTRY_ADMIN_SECTIONS.map((value) => <option key={value} value={value}>{COUNTRY_ADMIN_SECTION_INFO[value].label}</option>)}
            <option value="country_admins">Country admins</option>
          </select>
        </div>
        <label className="flex min-h-9 items-center gap-2 text-navy-900">
          <input type="checkbox" name="role" value="country_admin" defaultChecked={countryAdminsOnly} className="size-4" />
          Country admin decisions only
        </label>
        <button type="submit" className="min-h-9 rounded-lg bg-navy-950 px-3 text-sm font-semibold text-white hover:bg-navy-900">Filter</button>
        {actorId || country || countryAdminsOnly || section ? (
          <Link href={keep({ actor: null, country: null, role: null, section: null })} className="min-h-9 py-2 text-sm font-semibold text-ocean-700 hover:underline">Clear</Link>
        ) : null}
        {actorId ? <AdminChip tone="info">One administrator</AdminChip> : null}
      </form>

      <AdminPanel>
        {events.length === 0 ? (
          <AdminEmptyState title="No audit activity in this view" description="Choose another filter to review more administrator activity." />
        ) : (
          <>
          <AdminMobileList label="Audit events">
            {events.map((event) => {
              const href = auditTargetHref(event.targetType, event.targetId)
              const details = auditDetails(event.metadata)
              const target = auditTargetLabel(event.targetType)
              return (
                <AdminMobileCard
                  key={event.id}
                  title={auditVerb(event.action)}
                  subtitle={<>{event.actor.fullName} · <time dateTime={event.createdAt}>{formatAdminDate(event.createdAt, true)}</time></>}
                  fields={[{ label: 'Target', value: <AdminChip>{target}</AdminChip> }]}
                  note={details.length ? details.join(' · ') : null}
                  actionsLabel={`Actions for ${auditVerb(event.action)} by ${event.actor.fullName}`}
                  actions={[
                    ...(href ? [{ kind: 'link' as const, href, label: `Open ${target.toLowerCase()}`, icon: <ExternalLink aria-hidden="true" /> }] : []),
                    ...(event.actor.slug ? [{ kind: 'link' as const, href: `/people/${event.actor.slug}`, label: `View ${event.actor.fullName}`, icon: <UserRound aria-hidden="true" /> }] : []),
                  ]}
                />
              )
            })}
          </AdminMobileList>
          <div className={ADMIN_TABLE_DESKTOP_CLASS}>
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
          </>
        )}
      </AdminPanel>
    </div>
  )
}
