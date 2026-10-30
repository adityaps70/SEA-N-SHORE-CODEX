import { describe, expect, it } from 'vitest'
import type { JobCandidateProfile, JobListing } from '@/features/jobs/types'
import { compareRankedJobs, isJobClosed, scoreJobV2 } from './job-scorer'

const today = new Date('2026-10-13T06:00:00.000Z')

function job(overrides: Partial<JobListing> = {}): JobListing {
  return {
    id: 'job-1', title: 'Placeholder role', companyName: 'Placeholder Lines', companyId: null, companySlug: null, companyVerified: false,
    recruiterVerified: false, location: null, summary: '', description: '', requirements: null, applyUntil: null,
    createdAt: '2026-10-12T00:00:00.000Z', publishedAt: '2026-10-12T00:00:00.000Z', domain: 'sea', department: null, rank: null,
    departmentKey: 'deck_officers', acceptedRoleKeys: [], vesselTypes: [], experienceMinYears: null, experienceMaxYears: null,
    joiningFrom: null, joiningUntil: null, salaryMin: null, salaryMax: null, salaryCurrency: null, salaryPeriod: null, regions: [],
    certificateRequirements: [], visaRequirements: [], urgent: false, easyApply: true, ...overrides,
  }
}

function seafarer(overrides: Partial<JobCandidateProfile> = {}): JobCandidateProfile {
  return {
    persona: 'seafarer', roleKey: 'second_officer', rank: null, sailingExperienceYears: 6, vesselTypes: ['Product Tanker'], tradingAreas: ['Middle East'],
    availability: null, certificates: [], visas: [], shoreCareerPreference: false, skills: [], experiences: [], ...overrides,
  }
}

describe('jobs match v2: specificity', () => {
  it('a job with no criteria has no score, and a job with one matching criterion is never Strong', () => {
    expect(scoreJobV2(job({ departmentKey: null }), seafarer(), today)).toMatchObject({ score: null, band: null, criteria: 0 })
    const one = scoreJobV2(job({ acceptedRoleKeys: ['second_officer'] }), seafarer(), today)
    expect(one.criteria).toBe(1)
    expect(one.band).not.toBe('strong')
    const three = scoreJobV2(job({ acceptedRoleKeys: ['second_officer'], vesselTypes: ['Product Tanker'], regions: ['Middle East'] }), seafarer(), today)
    expect(three.band).toBe('strong')
  })

  it('only counts criteria the job specifies (no free points for blank fields)', () => {
    const partial = scoreJobV2(job({ acceptedRoleKeys: ['second_officer'], vesselTypes: ['LNG Carrier'], regions: ['Far East'] }), seafarer(), today)
    expect(partial.criteria).toBe(3)
    expect(partial.score!).toBeLessThan(scoreJobV2(job({ acceptedRoleKeys: ['second_officer'], vesselTypes: ['Product Tanker'], regions: ['Far East'] }), seafarer(), today).score!)
  })
})

describe('jobs match v2: rank', () => {
  it('matches rank synonyms: a job that asks for "2/O" accepts a Second Officer', () => {
    const match = scoreJobV2(job({ rank: '2/O' }), seafarer(), today)
    expect(match.eligible).toBe(true)
    expect(match.parts.rank).toBeGreaterThan(0)
    expect(scoreJobV2(job({ rank: 'Second Officer' }), seafarer({ roleKey: null, rank: '2/O' }), today).eligible).toBe(true)
  })

  it('one ladder step earns less than exact; two steps or another department is not eligible', () => {
    const exact = scoreJobV2(job({ acceptedRoleKeys: ['second_officer'] }), seafarer(), today)
    const oneStep = scoreJobV2(job({ acceptedRoleKeys: ['chief_officer'] }), seafarer(), today)
    expect(oneStep.eligible).toBe(true)
    expect(oneStep.parts.rank!).toBeLessThan(exact.parts.rank!)
    const twoSteps = scoreJobV2(job({ acceptedRoleKeys: ['master'] }), seafarer(), today)
    expect(twoSteps.eligible).toBe(false)
    expect(twoSteps.ineligibleReason).toMatch(/^Not eligible: needs /)
    expect(scoreJobV2(job({ acceptedRoleKeys: ['chief_engineer'], departmentKey: 'engine_officers' }), seafarer(), today).eligible).toBe(false)
  })
})

describe('jobs match v2: hard requirements', () => {
  const cocJob = job({ acceptedRoleKeys: ['second_officer'], certificateList: [{ name: 'COC: Officer in Charge of a Navigational Watch', code: 'coc_oow_deck', required: true }] })

  it('an expired COC makes the job not eligible, with a clear label', () => {
    const expired = scoreJobV2(cocJob, seafarer({ certificates: [{ name: 'Second Mate FG', expiresAt: '2026-01-01', verified: true }] }), today)
    expect(expired.eligible).toBe(false)
    expect(expired.ineligibleReason).toBe('Not eligible: needs a valid COC: Officer in Charge of a Navigational Watch')
    expect(scoreJobV2(cocJob, seafarer({ certificates: [] }), today).eligible).toBe(false)
    expect(scoreJobV2(cocJob, seafarer({ certificates: [{ name: 'Second Mate FG', expiresAt: '2030-01-01', verified: true }] }), today).eligible).toBe(true)
  })

  it('a higher COC grade covers a lower one', () => {
    expect(scoreJobV2(cocJob, seafarer({ roleKey: 'chief_officer', certificates: [{ name: 'Chief Mate COC', expiresAt: null, verified: false }] }), today).eligible).toBe(true)
  })

  it('verified certificates count more than self-reported ones; a missing optional certificate is not a hard fail', () => {
    const list = [{ name: 'ECDIS', code: 'ecdis', required: true }]
    const verified = scoreJobV2(job({ certificateList: list }), seafarer({ certificates: [{ name: 'Generic ECDIS', expiresAt: null, verified: true }] }), today)
    const self = scoreJobV2(job({ certificateList: list }), seafarer({ certificates: [{ name: 'ECDIS', expiresAt: null, verified: false }] }), today)
    expect(verified.parts.certificates!).toBeGreaterThan(self.parts.certificates!)
    expect(scoreJobV2(job({ certificateList: list }), seafarer(), today).eligible).toBe(true)
  })

  it('a listed visa, required or preferred, is never eligibility or points (hotfix P5)', () => {
    const required = scoreJobV2(job({ acceptedRoleKeys: ['second_officer'], visaList: [{ name: 'US C1/D', required: true }] }), seafarer(), today)
    expect(required.eligible).toBe(true)
    expect(required.ineligibleReason).toBeNull()
    expect(required.parts).not.toHaveProperty('visas')
    expect(required.score).toBe(scoreJobV2(job({ acceptedRoleKeys: ['second_officer'] }), seafarer(), today).score)
    const preferred = scoreJobV2(job({ visaList: [{ name: 'US C1/D', required: false }, { name: 'Schengen', required: false }] }), seafarer({ visas: ['Schengen'] }), today)
    expect(preferred.eligible).toBe(true)
    expect(preferred).toMatchObject({ score: null, criteria: 0 })
  })
})

describe('jobs match v2: history and availability', () => {
  it('counts vessel types and sea time from sea-service history', () => {
    const history = seafarer({
      vesselTypes: [],
      sailingExperienceYears: null,
      experiences: [{ track: 'sea_service', rankCode: 'second_officer', vesselTypeCode: 'lng_carrier', startedOn: '2023-01-01', endedOn: '2025-07-01' }],
    })
    const match = scoreJobV2(job({ acceptedRoleKeys: ['second_officer'], vesselTypes: ['LNG Carrier'], experienceMinYears: 2 }), history, today)
    expect(match.parts.vessel).toBe(20)
    expect(match.parts.seaTime).toBe(15)
  })

  it('compares "available from" with the joining window (no free points)', () => {
    const joining = job({ joiningFrom: '2026-11-01', joiningUntil: '2026-11-15' })
    expect(scoreJobV2(joining, seafarer({ availableFrom: '2026-10-20' }), today).parts.availability).toBe(10)
    expect(scoreJobV2(joining, seafarer({ availableFrom: '2026-12-01' }), today).parts.availability).toBe(5)
    expect(scoreJobV2(joining, seafarer({ availableFrom: '2027-03-01' }), today).parts.availability).toBe(0)
    const unknown = scoreJobV2(joining, seafarer(), today)
    expect(unknown.parts.availability).toBe(0)
    expect(unknown.profileGaps?.map((gap) => gap.key)).toContain('availability')
  })
})

describe('jobs for you ordering', () => {
  it('puts eligible jobs first, then match × freshness', () => {
    const fresh = { job: { id: 'a', publishedAt: '2026-10-12T00:00:00.000Z', createdAt: '2026-10-12T00:00:00.000Z' }, match: { score: 70, eligible: true, reasons: [], missingRequirements: [], warnings: [] } }
    const old = { job: { id: 'b', publishedAt: '2026-08-01T00:00:00.000Z', createdAt: '2026-08-01T00:00:00.000Z' }, match: { score: 90, eligible: true, reasons: [], missingRequirements: [], warnings: [] } }
    const ineligible = { job: { id: 'c', publishedAt: '2026-10-13T00:00:00.000Z', createdAt: '2026-10-13T00:00:00.000Z' }, match: { score: 100, eligible: false, reasons: [], missingRequirements: [], warnings: [] } }
    expect([ineligible, old, fresh].sort((l, r) => compareRankedJobs(l, r, today)).map((item) => item.job.id)).toEqual(['a', 'b', 'c'])
  })

  it('treats jobs past their apply-by date as closed', () => {
    expect(isJobClosed({ applyUntil: '2026-10-12' }, today)).toBe(true)
    expect(isJobClosed({ applyUntil: '2026-10-13' }, today)).toBe(false)
    expect(isJobClosed({ applyUntil: null }, today)).toBe(false)
  })
})
