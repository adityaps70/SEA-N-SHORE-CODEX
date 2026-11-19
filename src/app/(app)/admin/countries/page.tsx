import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowDown, ArrowUp, Building2, Search, UsersRound } from 'lucide-react'
import { requireAdminAccess } from '@/features/admin/admin-access'
import { AdminChip, AdminEmptyState, AdminFilterBar, AdminPageHeader, AdminPanel } from '@/features/admin/components/admin-ui'
import { ADMIN_TABLE_DESKTOP_CLASS, AdminMobileCard, AdminMobileList } from '@/features/admin/components/admin-mobile-list'
import { adminCountryRepository, COUNTRY_BASES, type CountryBasis, type CountryStatsRow } from '@/features/countries/admin-country-repository'
import {
  COUNTRY_SORT_LABELS,
  countryLabel,
  countrySlug,
  countryTotals,
  readSortDirection,
  readSortKey,
  sortAndFilterCountries,
  type CountrySortKey,
  type SortDirection,
} from '@/features/countries/admin-country-view'
import { COUNTRY_SCHEMA_MISSING_MESSAGE, CountrySchemaMissingError } from '@/features/countries/country-schema'

export const metadata: Metadata = { title: 'Members by country · Admin' }

type SearchParams = Promise<Record<string, string | string[] | undefined>>

const NUMBER_COLUMNS: Exclude<CountrySortKey, 'country'>[] = ['registered', 'verified', 'newThisWeek', 'newThisMonth', 'organizations', 'activeJobs']

const BASIS_LABELS: Record<CountryBasis, string> = { residence: 'Country of residence', nationality: 'Nationality' }

function readSingle(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? '' : value ?? ''
}

function readBasis(value: string | string[] | undefined): CountryBasis {
  const candidate = readSingle(value)
  return COUNTRY_BASES.find((basis) => basis === candidate) ?? 'residence'
}

const count = (value: number) => value.toLocaleString('en-IN')

function CountriesNotReady() {
  return (
    <div className="space-y-4">
      <AdminPageHeader title="Members by country" />
      <AdminPanel>
        <AdminEmptyState title="Not available yet" description={COUNTRY_SCHEMA_MISSING_MESSAGE} />
      </AdminPanel>
    </div>
  )
}

export default async function AdminCountriesPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  // Round GP (Part C): country admins see their own countries' rows only, and no member lists.
  const access = await requireAdminAccess('country')
  const admin = access.user
  const basis = readBasis(params.basis)
  const membersLinks = access.kind === 'platform' && basis === 'residence'
  const query = readSingle(params.q).trim().slice(0, 80)
  const sort = readSortKey(readSingle(params.sort))
  const direction = readSortDirection(readSingle(params.dir), sort)

  let all: CountryStatsRow[]
  try {
    all = await adminCountryRepository.listCountryStats(admin.id, basis)
  } catch (error) {
    // Round GP safety net: this release can run before migration 0108 is applied.
    if (error instanceof CountrySchemaMissingError) return <CountriesNotReady />
    throw error
  }
  const rows = sortAndFilterCountries(all, { query, sort, direction })
  const totals = countryTotals(all)

  function href(next: { basis?: CountryBasis; sort?: CountrySortKey; direction?: SortDirection }) {
    const search = new URLSearchParams()
    const nextBasis = next.basis ?? basis
    if (nextBasis !== 'residence') search.set('basis', nextBasis)
    if (query) search.set('q', query)
    const nextSort = next.sort ?? sort
    if (nextSort !== 'registered') search.set('sort', nextSort)
    const nextDirection = next.direction ?? (next.sort ? readSortDirection(null, next.sort) : direction)
    if (nextDirection !== readSortDirection(null, nextSort)) search.set('dir', nextDirection)
    const value = search.toString()
    return `/admin/countries${value ? `?${value}` : ''}`
  }

  function detailHref(row: CountryStatsRow) {
    return `/admin/countries/${countrySlug(row.code)}${basis === 'residence' ? '' : `?basis=${basis}`}`
  }

  function sortHeader(column: CountrySortKey, className = '') {
    const active = sort === column
    const nextDirection: SortDirection = active ? (direction === 'asc' ? 'desc' : 'asc') : readSortDirection(null, column)
    return (
      <th key={column} scope="col" aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'} className={`px-3 py-2.5 ${className}`}>
        <Link href={href({ sort: column, direction: nextDirection })} className="inline-flex items-center gap-1 hover:text-navy-950">
          {COUNTRY_SORT_LABELS[column]}
          {active ? (direction === 'asc' ? <ArrowUp aria-hidden="true" className="size-3" /> : <ArrowDown aria-hidden="true" className="size-3" />) : null}
        </Link>
      </th>
    )
  }

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title="Members by country"
        meta={`${count(totals.registered)} registered members in ${count(totals.countries)} countries`}
        description={basis === 'residence'
          ? 'By the country each member chose. Members who have not chosen one are counted from an estimate (their location text, phone dialling code or sign-up country), shown as “estimated”. Estimates are never saved to anyone’s profile. Numbers refresh within 30 seconds.'
          : 'By the nationality each member chose. Members without one are under “Country not set”. Organizations and jobs count by the organization’s country. Numbers refresh within 30 seconds.'}
      />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <AdminFilterBar
          label="Count members by"
          options={COUNTRY_BASES.map((item) => ({ href: href({ basis: item }), label: BASIS_LABELS[item], active: item === basis }))}
        />
        <form method="get" action="/admin/countries" className="flex gap-2 max-md:order-first lg:w-80">
          <label className="relative flex-1">
            <span className="sr-only">Search countries</span>
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input
              type="search"
              name="q"
              defaultValue={query}
              maxLength={80}
              placeholder="Search a country"
              className="min-h-9 w-full rounded-lg border border-mist-100 bg-white py-1.5 pl-9 pr-3 text-sm text-navy-950 outline-none focus:border-ocean-400 focus:ring-2 focus:ring-ocean-100 max-md:min-h-11 max-md:rounded-xl max-md:bg-mist-50 max-md:text-[15px]"
            />
          </label>
          {basis !== 'residence' ? <input type="hidden" name="basis" value={basis} /> : null}
          {sort !== 'registered' ? <input type="hidden" name="sort" value={sort} /> : null}
          {direction !== readSortDirection(null, sort) ? <input type="hidden" name="dir" value={direction} /> : null}
          <button type="submit" className="min-h-9 rounded-lg bg-navy-950 px-3 text-sm font-semibold text-white hover:bg-navy-900 max-md:min-h-11 max-md:rounded-xl max-md:px-4">
            Search
          </button>
        </form>
      </div>

      <AdminPanel>
        {rows.length === 0 ? (
          <AdminEmptyState title={query ? 'No country matches this search.' : 'No members yet.'} description={query ? 'Try the country’s name or its two-letter code.' : undefined} />
        ) : (
          <>
            <AdminMobileList label="Countries">
              {rows.map((row) => (
                <AdminMobileCard
                  key={countrySlug(row.code)}
                  title={countryLabel(row.code)}
                  href={detailHref(row)}
                  badges={row.estimated ? <AdminChip tone="info">{count(row.estimated)} estimated</AdminChip> : null}
                  fields={[
                    { label: 'Members', value: count(row.registered) },
                    { label: 'Verified', value: count(row.verified) },
                    { label: 'New 7 days', value: count(row.newThisWeek) },
                    { label: 'New 30 days', value: count(row.newThisMonth) },
                    { label: 'Organizations', value: count(row.organizations) },
                    { label: 'Active jobs', value: count(row.activeJobs) },
                  ]}
                  actions={[
                    // The member list filters by country of residence (with estimates), so it is offered on that view only.
                    ...(membersLinks ? [{ kind: 'link' as const, href: `/admin/users?country=${countrySlug(row.code)}`, label: 'Members in this country', icon: <UsersRound aria-hidden="true" /> }] : []),
                    { kind: 'link', href: `/admin/organizations?country=${countrySlug(row.code)}`, label: 'Organizations in this country', icon: <Building2 aria-hidden="true" /> },
                  ]}
                />
              ))}
            </AdminMobileList>
            <div className={ADMIN_TABLE_DESKTOP_CLASS}>
              <table className="w-full min-w-[52rem] text-left text-sm">
                <thead className="border-b border-mist-100 bg-mist-50/70 text-xs font-semibold uppercase tracking-wide text-muted">
                  <tr>
                    {sortHeader('country', 'w-[26%]')}
                    {NUMBER_COLUMNS.map((column) => sortHeader(column, 'text-right'))}
                    <th scope="col" className="px-3 py-2.5"><span className="sr-only">Lists</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-mist-100">
                  {rows.map((row) => (
                    <tr key={countrySlug(row.code)} className="align-middle transition hover:bg-mist-50/60">
                      <th scope="row" className="px-3 py-2.5 font-semibold text-navy-950">
                        <Link href={detailHref(row)} className="hover:text-ocean-700 hover:underline">{countryLabel(row.code)}</Link>
                        {row.code ? <span className="ml-1.5 text-xs font-normal text-muted">{row.code}</span> : null}
                        {row.estimated ? <span className="block text-xs font-normal text-muted">{count(row.estimated)} estimated</span> : null}
                      </th>
                      {NUMBER_COLUMNS.map((column) => (
                        <td key={column} className="px-3 py-2.5 text-right tabular-nums text-navy-900">{count(row[column])}</td>
                      ))}
                      <td className="whitespace-nowrap px-3 py-2.5 text-right">
                        {membersLinks ? (
                          <>
                            <Link href={`/admin/users?country=${countrySlug(row.code)}`} className="text-xs font-semibold text-ocean-700 hover:underline">Members</Link>
                            <span aria-hidden="true" className="px-1 text-muted">·</span>
                          </>
                        ) : null}
                        <Link href={`/admin/organizations?country=${countrySlug(row.code)}`} className="text-xs font-semibold text-ocean-700 hover:underline">Organizations</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </AdminPanel>
      <p className="text-xs text-muted">
        Registered: active members who finished sign-up (test accounts left out). Verified: at least one approved Sea N Shore verification.
        Active jobs: live jobs still taking applications, by the organization’s country (a member’s own job by the member’s country).
      </p>
    </div>
  )
}
