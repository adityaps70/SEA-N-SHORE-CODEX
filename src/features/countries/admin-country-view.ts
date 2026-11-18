import { departmentByKey } from '@/features/roles/taxonomy'
import { countryName, isCountryCode, normaliseCountryText } from './catalog'
import type { CountryDepartmentCount, CountryKey, CountryStatsRow } from './admin-country-repository'

/** Round GP (Global Partners), Part B: sorting, search and grouping for Admin › Members by country. Pure. */
export const COUNTRY_SORT_KEYS = ['country', 'registered', 'verified', 'newThisWeek', 'newThisMonth', 'organizations', 'activeJobs'] as const
export type CountrySortKey = (typeof COUNTRY_SORT_KEYS)[number]
export type SortDirection = 'asc' | 'desc'

export const COUNTRY_SORT_LABELS: Record<CountrySortKey, string> = {
  country: 'Country',
  registered: 'Registered members',
  verified: 'Verified members',
  newThisWeek: 'New, 7 days',
  newThisMonth: 'New, 30 days',
  organizations: 'Organizations',
  activeJobs: 'Active jobs',
}

/** The path segment for a country's detail page and list filters: the code, or "unset". */
export function countrySlug(code: CountryKey) {
  return code ?? 'unset'
}

/** "PH" → "PH"; "unset" → null; anything else → undefined (not a country page). */
export function readCountrySlug(value: string | null | undefined): CountryKey | undefined {
  const candidate = (value ?? '').trim()
  if (candidate === 'unset') return null
  const code = candidate.toUpperCase()
  return isCountryCode(code) ? code : undefined
}

export function countryLabel(code: CountryKey) {
  if (code === null) return 'Country not set'
  return countryName(code) ?? code
}

export function readSortKey(value: string | null | undefined): CountrySortKey {
  return COUNTRY_SORT_KEYS.find((key) => key === value) ?? 'registered'
}

export function readSortDirection(value: string | null | undefined, key: CountrySortKey): SortDirection {
  if (value === 'asc' || value === 'desc') return value
  return key === 'country' ? 'asc' : 'desc'
}

/**
 * Rows matching the search (country name, other name or code), sorted by one column; ties by name. The "Country not
 * set" row always stays last.
 */
export function sortAndFilterCountries(rows: readonly CountryStatsRow[], input: { query?: string; sort: CountrySortKey; direction: SortDirection }) {
  const needle = normaliseCountryText(input.query ?? '')
  const matching = rows.filter((row) => {
    if (!needle) return true
    const name = normaliseCountryText(countryLabel(row.code))
    return name.includes(needle) || (row.code !== null && row.code.toLowerCase() === needle)
  })
  const factor = input.direction === 'asc' ? 1 : -1
  const byName = (a: CountryStatsRow, b: CountryStatsRow) => countryLabel(a.code).localeCompare(countryLabel(b.code), 'en')
  return [...matching].sort((a, b) => {
    if ((a.code === null) !== (b.code === null)) return a.code === null ? 1 : -1
    if (input.sort === 'country') return factor * byName(a, b)
    return factor * (a[input.sort] - b[input.sort]) || byName(a, b)
  })
}

export function countryTotals(rows: readonly CountryStatsRow[]) {
  return rows.reduce((sum, row) => ({
    registered: sum.registered + row.registered,
    verified: sum.verified + row.verified,
    estimated: sum.estimated + row.estimated,
    countries: sum.countries + (row.code !== null && row.registered > 0 ? 1 : 0),
  }), { registered: 0, verified: 0, estimated: 0, countries: 0 })
}

export const RANK_GROUPS = ['Officers', 'Ratings', 'Other sea roles', 'Shore', 'Cadets', 'Not set'] as const
export type RankGroup = (typeof RANK_GROUPS)[number]

const OFFICER_DEPARTMENTS = new Set(['deck_officers', 'engine_officers'])
const RATING_DEPARTMENTS = new Set(['deck_ratings', 'engine_ratings'])

export function rankGroupFor(entry: Pick<CountryDepartmentCount, 'departmentKey' | 'cadet'>): RankGroup {
  if (!entry.departmentKey) return entry.cadet ? 'Cadets' : 'Not set'
  if (OFFICER_DEPARTMENTS.has(entry.departmentKey)) return 'Officers'
  if (RATING_DEPARTMENTS.has(entry.departmentKey)) return 'Ratings'
  const department = departmentByKey(entry.departmentKey)
  if (department?.domain === 'sea') return 'Other sea roles'
  if (department?.domain === 'shore') return 'Shore'
  return 'Not set'
}

/** Members per rank group, in a fixed order, groups with nobody left out. */
export function rankGroupCounts(departments: readonly CountryDepartmentCount[]) {
  const counts = new Map<RankGroup, number>()
  for (const entry of departments) counts.set(rankGroupFor(entry), (counts.get(rankGroupFor(entry)) ?? 0) + entry.members)
  return RANK_GROUPS.filter((group) => counts.get(group)).map((group) => ({ group, members: counts.get(group)! }))
}

export function departmentLabel(entry: Pick<CountryDepartmentCount, 'departmentKey' | 'cadet'>) {
  if (!entry.departmentKey) return entry.cadet ? 'Cadets (no department yet)' : 'Department not set'
  return departmentByKey(entry.departmentKey)?.label ?? 'Other department'
}
