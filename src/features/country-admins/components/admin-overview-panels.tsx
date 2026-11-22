import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { AdminPanel } from '@/features/admin/components/admin-ui'
import { countryName } from '@/features/countries/catalog'
import type { AdminCountryCounts } from '../overview-repository'
import { allows, LIVE_COUNTRY_ADMIN_SECTIONS, type CountryAdminPermissions, type CountryAdminSection } from '../sections'

/**
 * Round GP Part E: the Overview's counts, as rows that link to their queue. A country admin sees the rows for the
 * sections they have (their countries only); a platform administrator sees the "no country" rows.
 */
type CountRow = { section: CountryAdminSection; label: string; count: number; href: string }

export function countRows(counts: AdminCountryCounts): CountRow[] {
  return [
    { section: 'organizations', label: 'Organizations pending', count: counts.pendingOrganizations, href: '/admin/organizations?view=queue' },
    { section: 'organizations', label: 'Organizations asked for changes', count: counts.changesRequestedOrganizations, href: '/admin/organizations?view=queue&status=changes_requested' },
    { section: 'learning', label: 'Courses waiting for review', count: counts.coursesWaiting, href: '/admin/learning/courses' },
    { section: 'learning', label: 'Trainer applications pending', count: counts.trainerApplicationsPending, href: '/admin/learning' },
    { section: 'events', label: 'Published events', count: counts.publishedEvents, href: '/admin/events' },
    { section: 'events', label: 'Events with open reports', count: counts.reportedEvents, href: '/admin/events?reported=1' },
    { section: 'moderation', label: 'Open reports', count: counts.openReportCases, href: '/admin/moderation?status=open&type=all' },
    { section: 'verification', label: 'Verifications pending', count: counts.verificationsPending, href: '/admin/verifications' },
    { section: 'access', label: 'Access requests waiting on Sea N Shore', count: counts.accessRequestsWaiting, href: '/admin/access' },
  ]
}

function Rows({ rows, linked = true }: { rows: Array<{ label: string; count: number; href: string }>; linked?: boolean }) {
  return (
    <ul className="divide-y divide-mist-100">
      {rows.map((row) => {
        const content = (
          <>
            <span className="min-w-8 rounded-md bg-mist-100 px-2 py-0.5 text-center text-sm font-bold text-navy-950">{row.count}</span>
            <span className="flex-1 font-semibold text-navy-950">{row.label}</span>
            {linked ? <ArrowRight aria-hidden="true" className="size-4 text-muted" /> : null}
          </>
        )
        return (
          <li key={row.label}>
            {linked ? (
              <Link href={row.href} className="flex items-center gap-3 px-5 py-3 text-sm transition hover:bg-mist-50">{content}</Link>
            ) : (
              <div className="flex items-center gap-3 px-5 py-3 text-sm">{content}</div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/** A country admin's Overview: their countries, their sections. */
export function CountryAdminOverview({ countries, counts, permissions, newMembers }: {
  countries: readonly string[]
  counts: AdminCountryCounts
  permissions: CountryAdminPermissions
  /** New members this week and this month, when they have Members by country. */
  newMembers: { week: number; month: number } | null
}) {
  const rows = countRows(counts).filter((row) => LIVE_COUNTRY_ADMIN_SECTIONS.includes(row.section) && allows(permissions, row.section))
  const names = countries.map((code) => countryName(code) ?? code).join(', ')
  return (
    <div className="space-y-4">
      <AdminPanel>
        <div className="border-b border-mist-100 px-5 py-3">
          <h3 className="text-sm font-bold text-navy-950">Your countries: {names}</h3>
          <p className="mt-0.5 text-xs text-muted">Counts for your countries only, in the sections you have.</p>
        </div>
        {rows.length ? <Rows rows={rows} /> : <p className="px-5 py-4 text-sm text-muted">No counts for your sections yet.</p>}
      </AdminPanel>
      {newMembers ? (
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-mist-100 bg-mist-100">
          <div className="bg-white px-4 py-3">
            <dt className="text-xs font-semibold text-muted">New members this week</dt>
            <dd className="mt-1 text-2xl font-bold tracking-tight text-navy-950">{newMembers.week}</dd>
          </div>
          <div className="bg-white px-4 py-3">
            <dt className="text-xs font-semibold text-muted">New members this month</dt>
            <dd className="mt-1 text-2xl font-bold tracking-tight text-navy-950">{newMembers.month}</dd>
          </div>
        </dl>
      ) : null}
    </div>
  )
}

/** Platform administrators: what is waiting with no stored country (country admins never see these). */
export function NoCountryPanel({ counts }: { counts: AdminCountryCounts }) {
  const rows = countRows(counts).filter((row) => row.count > 0 && row.label !== 'Published events')
  return (
    <AdminPanel>
      <div className="border-b border-mist-100 px-5 py-3">
        <h3 className="text-sm font-bold text-navy-950">Waiting with no country</h3>
        <p className="mt-0.5 text-xs text-muted">
          These have no stored country (organization country or member’s country of residence), so country admins can’t see them. Only Sea N Shore administrators can decide them.
        </p>
      </div>
      {rows.length ? <Rows rows={rows} /> : <p className="px-5 py-4 text-sm text-muted">Nothing is waiting without a country.</p>}
    </AdminPanel>
  )
}
