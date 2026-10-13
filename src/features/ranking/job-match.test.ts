import { describe, expect, it } from 'vitest'
import { evaluateApplyGate } from '@/features/jobs/apply-gate'
import type { JobCandidateProfile, JobListing } from '@/features/jobs/types'
import { scoreJobV2 } from './job-scorer'
import { scoreJobForMember } from './job-match'

const today = new Date('2026-10-13T00:00:00.000Z')
const job: JobListing = {
  id: 'job-1', title: 'Chief Officer', companyName: 'Placeholder Lines', companyId: 'company-1', companySlug: 'placeholder-lines',
  companyVerified: true, recruiterVerified: true, location: 'Worldwide', summary: 'Placeholder', description: 'Placeholder',
  requirements: '', applyUntil: null, createdAt: '2026-10-10T10:00:00.000Z', publishedAt: '2026-10-10T10:00:00.000Z',
  domain: 'sea', department: 'Deck', rank: 'Chief Officer', acceptedRoleKeys: ['chief_officer'], vesselTypes: ['Oil Tanker'],
  experienceMinYears: 4, experienceMaxYears: null, joiningFrom: null, joiningUntil: null, salaryMin: null, salaryMax: null,
  salaryCurrency: null, salaryPeriod: null, regions: ['Worldwide'], certificateRequirements: [], visaRequirements: [], urgent: false, easyApply: true,
}
const profile: JobCandidateProfile = {
  rank: 'Chief Officer', roleKey: 'chief_officer', persona: 'seafarer', sailingExperienceYears: 7, vesselTypes: ['Bulk Carrier'],
  tradingAreas: ['Worldwide'], availability: null, certificates: [], visas: [], shoreCareerPreference: false, skills: [],
}

describe('matching v2 kept consistent with the minimum match to apply (round G)', () => {
  it('shows a job the round-12 gate refuses as not eligible, with the minimum, instead of a good match', () => {
    const strict = { ...job, minMatchToApply: 100 }
    const { match, gateMatch } = scoreJobForMember(strict, profile, today)
    expect(scoreJobV2(strict, profile, today).eligible).toBe(true)
    expect(evaluateApplyGate(strict, gateMatch).status).toBe('below_minimum')
    expect(match.eligible).toBe(false)
    expect(match.ineligibleReason).toBe('Not eligible: below this job’s minimum match (100%)')
    expect(match.missingRequirements).toEqual(expect.arrayContaining(gateMatch.missingRequirements))
  })

  it('leaves the v2 match alone when the gate is open', () => {
    const open = { ...job, minMatchToApply: 0 }
    const { match } = scoreJobForMember(open, profile, today)
    expect(match).toEqual(scoreJobV2(open, profile, today))
    expect(match.eligible).toBe(true)
  })

  it('keeps the v2 reason when the job already fails a hard requirement', () => {
    const other = { ...job, minMatchToApply: 100, acceptedRoleKeys: ['chief_engineer'], department: 'Engine', rank: 'Chief Engineer' }
    const { match } = scoreJobForMember(other, profile, today)
    expect(match.eligible).toBe(false)
    expect(match.ineligibleReason).toMatch(/^Not eligible: needs /)
  })
})
