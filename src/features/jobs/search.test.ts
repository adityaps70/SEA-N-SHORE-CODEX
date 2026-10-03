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
      visa: 'US C1/D',
      verified: '1',
      urgent: '1',
      easyApply: '1',
      postedWithin: '7',
      sort: 'recommended',
    })).toEqual({
      query: 'chief officer',
      mode: 'sea',
      ranks: ['Chief Officer'],
      vesselTypes: ['Oil Tanker', 'LNG'],
      minExperienceYears: 5,
      joiningWithinDays: 7,
      salaryMin: 7000,
      salaryMax: 10000,
      regions: ['Worldwide', 'Middle East'],
      certificates: ['STCW', 'Advanced Oil Tanker'],
      visas: ['US C1/D'],
      verifiedOnly: true,
      urgentOnly: true,
      easyApplyOnly: true,
      postedWithinDays: 7,
      sort: 'recommended',
    })
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
})
