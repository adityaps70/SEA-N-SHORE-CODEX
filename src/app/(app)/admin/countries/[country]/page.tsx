import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { requireAdminAccess } from '@/features/admin/admin-access'
import { AdminEmptyState, AdminPageHeader, AdminPanel, formatAdminDate } from '@/features/admin/components/admin-ui'
import { adminCountryRepository, COUNTRY_BASES, type CountryBasis, type CountryDetail } from '@/features/countries/admin-country-repository'
import { COUNTRY_SCHEMA_MISSING_MESSAGE, CountrySchemaMissingError } from '@/features/countries/country-schema'
import { countryLabel, countrySlug, departmentLabel, rankGroupCounts, readCountrySlug } from '@/features/countries/admin-country-view'

export const metadata: Metadata = { title: 'Country · Members by country · Admin' }

type SearchParams = Promise<Record<string, string | string[] | undefined>>

const count = (value: number) => value.toLocaleString('en-IN')

function readBasis(value: string | string[] | undefined): CountryBasis {
  const candidate = Array.isArray(value) ? value[0] : value
  return COUNTRY_BASES.find((basis) => basis === candidate) ?? 'residence'
}

function Tile({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <div className="rounded-xl border border-mist-100 bg-white px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-navy-950">{count(value)}</p>
      {note ? <p className="text-xs text-muted">{note}</p> : null}
    </div>
  )
}

export default async function AdminCountryDetailPage({ params, searchParams }: { params: Promise<{ country: string }>; searchParams: SearchParams }) {
  const { country } = await params
  const code = readCountrySlug(decodeURIComponent(country))
  if (code === undefined) notFound()
  const basis = readBasis((await searchParams).basis)
  // Round GP (Part C): a country admin opens only their own countries.
  const access = await requireAdminAccess('members')
  const admin = access.user
  let detail: CountryDetail
  try {
    detail = await adminCountryRepository.getCountryDetail(admin.id, code, basis)
  } catch (error) {
    // Round GP safety net: this release can run before migration 0108 is applied.
    if (error instanceof Error && error.message === 'country_out_of_scope') {
      return (
        <div className="space-y-4">
          <AdminPageHeader title={countryLabel(code)} />
          <AdminPanel>
            <AdminEmptyState title="This country is not one of yours" description="As a country admin you see the numbers for your own countries only." />
          </AdminPanel>
        </div>
      )
    }
    if (error instanceof CountrySchemaMissingError) {
      return (
        <div className="space-y-4">
          <AdminPageHeader title={countryLabel(code)} />
          <AdminPanel>
            <AdminEmptyState title="Not available yet" description={COUNTRY_SCHEMA_MISSING_MESSAGE} />
          </AdminPanel>
        </div>
      )
    }
    throw error
  }
  const { totals } = detail
  const groups = rankGroupCounts(detail.departments)
  const peak = Math.max(1, ...detail.weeks.map((week) => week.newMembers))
  const backHref = basis === 'residence' ? '/admin/countries' : `/admin/countries?basis=${basis}`

  return (
    <div className="space-y-5">
      <Link href={backHref} className="inline-flex items-center gap-1 text-sm font-semibold text-ocean-700 hover:underline">
        <ChevronLeft aria-hidden="true" className="size-4" /> Members by country
      </Link>
      <AdminPageHeader
        title={countryLabel(code)}
        meta={basis === 'residence' ? 'By country of residence' : 'By nationality'}
        description={totals.estimated
          ? `${count(totals.estimated)} of these members have not chosen a country; they are counted from an estimate.`
          : undefined}
        actions={(
          <>
            {basis === 'residence' && access.kind === 'platform' ? (
              <Link href={`/admin/users?country=${countrySlug(code)}`} className="inline-flex min-h-9 items-center rounded-lg border border-mist-200 bg-white px-3 text-sm font-semibold text-navy-950 hover:border-ocean-200 hover:bg-ocean-50">Members</Link>
            ) : null}
            <Link href={`/admin/organizations?country=${countrySlug(code)}`} className="inline-flex min-h-9 items-center rounded-lg border border-mist-200 bg-white px-3 text-sm font-semibold text-navy-950 hover:border-ocean-200 hover:bg-ocean-50">Organizations</Link>
          </>
        )}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Tile label="Registered" value={totals.registered} note={totals.estimated ? `${count(totals.estimated)} estimated` : undefined} />
        <Tile label="Verified" value={totals.verified} />
        <Tile label="New, 7 days" value={totals.newThisWeek} />
        <Tile label="New, 30 days" value={totals.newThisMonth} />
        <Tile label="Organizations" value={totals.organizations} />
        <Tile label="Active jobs" value={totals.activeJobs} />
      </div>

      <AdminPanel>
        <h3 className="border-b border-mist-100 px-4 py-3 text-base font-semibold text-navy-950">Week by week (last 12 weeks)</h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <thead className="border-b border-mist-100 bg-mist-50/70 text-xs font-semibold uppercase tracking-wide text-muted">
              <tr>
                <th scope="col" className="px-4 py-2.5">Week of</th>
                <th scope="col" className="px-4 py-2.5 text-right">New members</th>
                <th scope="col" className="px-4 py-2.5"><span className="sr-only">New members, as a bar</span></th>
                <th scope="col" className="px-4 py-2.5 text-right">Members by week end</th>
                <th scope="col" className="px-4 py-2.5 text-right">New organizations</th>
                <th scope="col" className="px-4 py-2.5 text-right">Jobs posted</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-mist-100">
              {[...detail.weeks].reverse().map((week) => (
                <tr key={week.weekStart}>
                  <th scope="row" className="whitespace-nowrap px-4 py-2 font-medium text-navy-950">{formatAdminDate(week.weekStart)}</th>
                  <td className="px-4 py-2 text-right tabular-nums">{count(week.newMembers)}</td>
                  <td className="w-1/4 px-4 py-2" aria-hidden="true">
                    <span className="block h-2 rounded-full bg-ocean-500" style={{ width: `${Math.round((week.newMembers / peak) * 100)}%`, minWidth: week.newMembers ? '0.25rem' : 0 }} />
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{count(week.membersToDate)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{count(week.newOrganizations)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{count(week.jobsPosted)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </AdminPanel>

      <div className="grid gap-4 lg:grid-cols-2">
        <AdminPanel>
          <h3 className="border-b border-mist-100 px-4 py-3 text-base font-semibold text-navy-950">By rank group</h3>
          {groups.length ? (
            <ul className="divide-y divide-mist-100 text-sm">
              {groups.map((entry) => (
                <li key={entry.group} className="flex items-center justify-between px-4 py-2.5">
                  <span className="text-navy-950">{entry.group}</span>
                  <span className="tabular-nums text-navy-900">{count(entry.members)}</span>
                </li>
              ))}
            </ul>
          ) : <p className="px-4 py-6 text-sm text-muted">No registered members yet.</p>}
        </AdminPanel>
        <AdminPanel>
          <h3 className="border-b border-mist-100 px-4 py-3 text-base font-semibold text-navy-950">By department</h3>
          {detail.departments.length ? (
            <ul className="divide-y divide-mist-100 text-sm">
              {detail.departments.map((entry) => (
                <li key={`${entry.departmentKey ?? 'none'}-${entry.cadet}`} className="flex items-center justify-between px-4 py-2.5">
                  <span className="text-navy-950">{departmentLabel(entry)}</span>
                  <span className="tabular-nums text-navy-900">{count(entry.members)}</span>
                </li>
              ))}
            </ul>
          ) : <p className="px-4 py-6 text-sm text-muted">No registered members yet.</p>}
        </AdminPanel>
      </div>
    </div>
  )
}
