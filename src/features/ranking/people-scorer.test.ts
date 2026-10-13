import { describe, expect, it } from 'vitest'
import type { PeopleCandidateFeatures, PeopleViewer } from './people-candidates'
import { diversifyPeople, reasonText, scorePeopleCandidate } from './people-scorer'

const viewer: PeopleViewer = {
  id: 'viewer', roleKey: 'second_officer', departmentKey: 'deck_officers', persona: 'seafarer',
  vesselCodes: ['product_tanker'], tradingAreas: ['Worldwide'], location: 'Mumbai, India', institution: null, companyId: null,
}

function candidate(overrides: Partial<PeopleCandidateFeatures> = {}): PeopleCandidateFeatures {
  return {
    candidateId: 'c1', mutualCount: 0, shipmateVessel: null, shipmate: false, sameCurrentCompany: null, pastCompany: null,
    pastCompanyOverlapYears: 0, sameInstitution: null, sharedCommunities: 0, sharedCommunityName: null, sharedOrganizations: 0,
    sharedEvents: 0, sharedCourses: 0, roleKey: null, departmentKey: null, persona: 'seafarer', vesselCodes: [], tradingAreas: [],
    location: null, companyId: null, companyName: null, hasPhoto: true, hasHeadline: true, joinedDaysAgo: 300, lastActiveDaysAgo: 3,
    openToRecruiters: false, ...overrides,
  }
}

describe('people scorer', () => {
  it('weights mutual connections (capped), shipmates and companies, with the strongest as the reason', () => {
    expect(scorePeopleCandidate(candidate({ mutualCount: 3 }), viewer).score).toBe(12)
    expect(scorePeopleCandidate(candidate({ mutualCount: 40 }), viewer).score).toBe(24)
    const shipmate = scorePeopleCandidate(candidate({ shipmate: true, shipmateVessel: 'MV Placeholder', mutualCount: 1 }), viewer)
    expect(shipmate.primarySource).toBe('shipmate')
    expect(shipmate.reasons[0]!.text).toBe('Sailed on MV Placeholder together')
    expect(scorePeopleCandidate(candidate({ sameCurrentCompany: 'Placeholder Lines' }), viewer).reasons[0]!.text).toBe('Also at Placeholder Lines')
  })

  it('never names a vessel the viewer cannot see, and never gives events or courses as the reason', () => {
    expect(reasonText({ code: 'shipmate', vessel: null })).toBe('You may have sailed together')
    const onlyEvent = scorePeopleCandidate(candidate({ sharedEvents: 2, sharedCourses: 1 }), viewer)
    expect(onlyEvent.score).toBeGreaterThan(0)
    expect(onlyEvent.reasons).toEqual([])
  })

  it('applies the activity, profile quality and new member multipliers', () => {
    const base = scorePeopleCandidate(candidate({ mutualCount: 2 }), viewer).score
    expect(scorePeopleCandidate(candidate({ mutualCount: 2, lastActiveDaysAgo: 60 }), viewer).score).toBeCloseTo(base * 0.7)
    expect(scorePeopleCandidate(candidate({ mutualCount: 2, lastActiveDaysAgo: 200 }), viewer).score).toBeCloseTo(base * 0.4)
    expect(scorePeopleCandidate(candidate({ mutualCount: 2, hasPhoto: false }), viewer).score).toBeCloseTo(base * 0.75)
    expect(scorePeopleCandidate(candidate({ mutualCount: 2, joinedDaysAgo: 3 }), viewer).score).toBeCloseTo(base * 1.15)
  })

  it('matches rank within the ladder and the same city', () => {
    const sameRank = scorePeopleCandidate(candidate({ roleKey: 'second_officer', location: 'Mumbai, India' }), viewer)
    expect(sameRank.reasons.map((reason) => reason.text)).toEqual(['Also a Second Officer', 'Also in Mumbai'])
    expect(scorePeopleCandidate(candidate({ roleKey: 'chief_engineer' }), viewer).score).toBe(0)
  })
})

describe('people diversity', () => {
  it('keeps at most 2 from one company in the top 5 and mixes at least two sources', () => {
    const entries = Array.from({ length: 8 }, (_, index) => ({
      id: `p${index}`,
      score: 100 - index,
      primarySource: index < 7 ? 'mutual' : 'shipmate',
      companyKey: index < 4 ? 'company-a' : `company-${index}`,
    }))
    const ordered = diversifyPeople(entries)
    const top = ordered.slice(0, 5)
    expect(top.filter((entry) => entry.companyKey === 'company-a').length).toBeLessThanOrEqual(2)
    expect(new Set(top.map((entry) => entry.primarySource)).size).toBeGreaterThanOrEqual(2)
    expect(ordered).toHaveLength(8)
  })
})
