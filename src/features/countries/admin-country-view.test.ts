import { describe, expect, it } from 'vitest'
import type { CountryStatsRow } from './admin-country-repository'
import {
  countryLabel,
  countryTotals,
  departmentLabel,
  rankGroupCounts,
  readCountrySlug,
  readSortDirection,
  readSortKey,
  sortAndFilterCountries,
} from './admin-country-view'

const row = (code: string | null, registered: number, extra: Partial<CountryStatsRow> = {}): CountryStatsRow => ({
  code, registered, verified: 0, newThisWeek: 0, newThisMonth: 0, estimated: 0, organizations: 0, activeJobs: 0, ...extra,
})

const rows = [row('IN', 40, { organizations: 2 }), row('PH', 12, { organizations: 5 }), row(null, 3), row('AE', 12), row('SG', 0, { organizations: 1 })]

describe('Members by country view (Round GP)', () => {
  it('sorts by any column, ties by name, and keeps "Country not set" last', () => {
    // PH and AE tie on 12: Philippines before United Arab Emirates.
    expect(sortAndFilterCountries(rows, { sort: 'registered', direction: 'desc' }).map((entry) => entry.code)).toEqual(['IN', 'PH', 'AE', 'SG', null])
    expect(sortAndFilterCountries(rows, { sort: 'organizations', direction: 'desc' }).map((entry) => entry.code)).toEqual(['PH', 'IN', 'SG', 'AE', null])
    expect(sortAndFilterCountries(rows, { sort: 'country', direction: 'asc' }).map((entry) => entry.code)).toEqual(['IN', 'PH', 'SG', 'AE', null])
    expect(sortAndFilterCountries(rows, { sort: 'country', direction: 'desc' }).at(-1)?.code).toBeNull()
  })

  it('searches by name, other name or code', () => {
    expect(sortAndFilterCountries(rows, { query: 'phil', sort: 'registered', direction: 'desc' }).map((entry) => entry.code)).toEqual(['PH'])
    expect(sortAndFilterCountries(rows, { query: 'ae', sort: 'registered', direction: 'desc' }).map((entry) => entry.code)).toEqual(['AE'])
    expect(sortAndFilterCountries(rows, { query: 'not set', sort: 'registered', direction: 'desc' }).map((entry) => entry.code)).toEqual([null])
  })

  it('reads country pages, sort keys and directions from the URL, refusing anything else', () => {
    expect(readCountrySlug('ph')).toBe('PH')
    expect(readCountrySlug('unset')).toBeNull()
    expect(readCountrySlug('QQ')).toBeUndefined()
    expect(readCountrySlug("PH' or 1=1")).toBeUndefined()
    expect(readSortKey('activeJobs')).toBe('activeJobs')
    expect(readSortKey('email')).toBe('registered')
    expect(readSortDirection(null, 'country')).toBe('asc')
    expect(readSortDirection('sideways', 'registered')).toBe('desc')
    expect(countryLabel(null)).toBe('Country not set')
    expect(countryLabel('PH')).toBe('Philippines')
  })

  it('totals the table and groups departments into rank groups', () => {
    expect(countryTotals(rows)).toEqual({ registered: 67, verified: 0, estimated: 0, countries: 3 })
    const groups = rankGroupCounts([
      { departmentKey: 'deck_officers', cadet: false, members: 3 },
      { departmentKey: 'engine_officers', cadet: false, members: 2 },
      { departmentKey: 'deck_ratings', cadet: false, members: 4 },
      { departmentKey: 'catering', cadet: false, members: 1 },
      { departmentKey: 'crewing_manning', cadet: false, members: 2 },
      { departmentKey: null, cadet: true, members: 5 },
      { departmentKey: null, cadet: false, members: 6 },
    ])
    expect(groups).toEqual([
      { group: 'Officers', members: 5 },
      { group: 'Ratings', members: 4 },
      { group: 'Other sea roles', members: 1 },
      { group: 'Shore', members: 2 },
      { group: 'Cadets', members: 5 },
      { group: 'Not set', members: 6 },
    ])
    expect(departmentLabel({ departmentKey: 'deck_officers', cadet: false })).toBe('Deck officers')
    expect(departmentLabel({ departmentKey: null, cadet: true })).toBe('Cadets (no department yet)')
  })
})
