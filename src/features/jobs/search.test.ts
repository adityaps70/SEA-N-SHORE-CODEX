import { describe, expect, it } from 'vitest'
import { parseJobSearchParams } from './search'

describe('jobs search filters', () => {
  it('parses maritime search filters into a stable typed contract', () => {
    expect(parseJobSearchParams({
      q: 'chief officer',
      mode: 'sea',
      rank: 'Chief Officer',
      vessel: 'Oil Tanker,LNG',
      experience: '5',
      joining: '7',
      salaryMin: '7000',
      salaryMax: '10000',
      region: 'Worldwide,Middle East',
      certificate: 'STCW,Advanced Oil Tanker',
      // Hotfix P5: an old link with a visa parameter still works; the parameter is ignored.
      visa: 'US C1/D',
      verified: '1',
      urgent: '1',
      easyApply: '1',
      postedWithin: '7',
      sort: 'recommended',
    })).toEqual({
      query: 'chief officer',
      mode: 'sea',
      // Round 12: rank filters are taxonomy keys; an old rank name is converted.
      department: null,
      ranks: ['chief_officer'],
      vesselTypes: ['Oil Tanker', 'LNG'],
      minExperienceYears: 5,
      joiningWithinDays: 7,
      salaryMin: 7000,
      salaryMax: 10000,
      regions: ['Worldwide', 'Middle East'],
      certificates: ['STCW', 'Advanced Oil Tanker'],
      verifiedOnly: true,
      urgentOnly: true,
      easyApplyOnly: true,
      postedWithinDays: 7,
      sort: 'recommended',
    })
  })

  it('ignores the visa parameter of an old link: the same filters as without it (hotfix P5)', () => {
    const withoutVisa = { mode: 'sea', rank: 'second_officer', certificate: 'ECDIS' }
    expect(parseJobSearchParams({ ...withoutVisa, visa: 'US C1/D,N/A' })).toEqual(parseJobSearchParams(withoutVisa))
    expect(parseJobSearchParams({ visa: 'Schengen' })).not.toHaveProperty('visas')
  })

  it('normalizes invalid numerics and unsupported modes instead of leaking them to SQL', () => {
    expect(parseJobSearchParams({
      mode: 'anything',
      experience: '-3',
      joining: 'tomorrow',
      salaryMin: 'free',
      postedWithin: '0',
      sort: 'unknown',
    })).toMatchObject({
      mode: 'for-you',
      minExperienceYears: null,
      joiningWithinDays: null,
      salaryMin: null,
      postedWithinDays: null,
      sort: 'recommended',
    })
  })

  it('maps urgent and recent discovery modes to explicit filter semantics', () => {
    expect(parseJobSearchParams({ mode: 'urgent' })).toMatchObject({ mode: 'urgent', urgentOnly: true })
    expect(parseJobSearchParams({ mode: 'recent' })).toMatchObject({ mode: 'recent', postedWithinDays: 7 })
  })

  it('sorts Recently Posted newest first even when the sort says Recommended or Best match (bug fix, 13 Nov)', () => {
    expect(parseJobSearchParams({ mode: 'recent' }).sort).toBe('recent')
    expect(parseJobSearchParams({ mode: 'recent', sort: 'recommended' }).sort).toBe('recent')
    expect(parseJobSearchParams({ mode: 'recent', sort: 'best' }).sort).toBe('recent')
    // A sort the member chose on purpose still applies; other chips keep the default.
    expect(parseJobSearchParams({ mode: 'recent', sort: 'salary' }).sort).toBe('salary')
    expect(parseJobSearchParams({ mode: 'urgent' }).sort).toBe('recommended')
    expect(parseJobSearchParams({ mode: 'urgent', sort: 'recent' })).toMatchObject({ urgentOnly: true, sort: 'recent' })
  })
})

describe('discovery chip links (bug fix, 13 Nov)', () => {
  it('keep the search words, filters and sort, set the chip and start again at page 1', async () => {
    const { jobModeHref } = await import('./filter-state')
    expect(jobModeHref('mode=for-you&q=tanker&department=deck_officers&sort=salary&page=3', 'urgent')).toBe('/jobs?mode=urgent&q=tanker&department=deck_officers&sort=salary')
    expect(jobModeHref(new URLSearchParams(''), 'recent')).toBe('/jobs?mode=recent')
    expect(jobModeHref('rank=master&rank=chief_officer', 'sea')).toBe('/jobs?rank=master&rank=chief_officer&mode=sea')
  })
})

describe('department and rank filters (round 12)', () => {
  it('keeps known department and rank keys, converts old rank names and drops unknown text', () => {
    expect(parseJobSearchParams({ department: 'deck_officers', rank: 'master' })).toMatchObject({ department: 'deck_officers', ranks: ['master'] })
    expect(parseJobSearchParams({ rank: 'Captain,Sea wizard' }).ranks).toEqual(['master'])
    expect(parseJobSearchParams({ department: 'moon_base' }).department).toBeNull()
    expect(parseJobSearchParams({ sort: 'best' }).sort).toBe('best')
  })
})
