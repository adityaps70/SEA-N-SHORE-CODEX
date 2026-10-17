import { describe, expect, it } from 'vitest'
import { scoreJobV2 } from '@/features/ranking/job-scorer'
import { scoreJobForMember } from '@/features/ranking/job-match'
import { scoreJobMatch } from './matching'
import { experienceCheck, pushCheck, yearsLabel } from './match-checks'
import type { JobCandidateProfile, JobListing, JobMatchCheck } from './types'

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
    persona: 'seafarer', roleKey: 'chief_officer', rank: null, sailingExperienceYears: 3, vesselTypes: ['Bulk Carrier'], tradingAreas: [],
    availability: null, certificates: [], visas: [], shoreCareerPreference: false, skills: [], ...overrides,
  }
}

const find = (checks: JobMatchCheck[] | undefined, key: JobMatchCheck['key']) => checks?.find((check) => check.key === key)

describe('"Check before applying" items (Round H, H7)', () => {
  const masterJob = job({
    acceptedRoleKeys: ['master'],
    experienceMinYears: 5,
    vesselTypes: ['Oil Tanker'],
    certificateList: [{ name: 'COC: Master', code: 'coc_master', required: true }],
    certificateRequirements: ['COC: Master'],
    visaList: [{ name: 'US C1/D', required: true }],
    visaRequirements: ['US C1/D'],
  })
  const chiefOfficer = seafarer({ certificates: [{ name: 'COC: Chief Mate', code: 'coc_chief_mate', expiresAt: null, verified: true }], visas: ['Schengen'] })

  it('matching v2 says what each requirement asks and what the profile has, and keeps the strings', () => {
    const match = scoreJobV2(masterJob, chiefOfficer, today)
    expect(match.missingRequirements.length).toBeGreaterThan(0)
    expect(find(match.checks, 'certificate')).toEqual({ key: 'certificate', label: 'Certificate', required: 'COC: Master', yours: 'COC: Chief Mate' })
    expect(find(match.checks, 'vessel')).toEqual({ key: 'vessel', label: 'Vessel type', required: 'Oil Tanker', yours: 'Bulk Carrier' })
    expect(find(match.checks, 'visa')).toEqual({ key: 'visa', label: 'Visa', required: 'US C1/D', yours: 'Schengen' })
    // Chief Officer is one step below Master: not a gap, so no rank check.
    expect(find(match.checks, 'rank')).toBeUndefined()
  })

  it('round-12 matching explains rank, sea time and missing certificates', () => {
    const match = scoreJobMatch(job({ acceptedRoleKeys: ['master'], experienceMinYears: 5, certificateRequirements: ['COC: Master'] }), seafarer({ roleKey: 'second_officer' }), today)
    expect(find(match.checks, 'rank')).toEqual({ key: 'rank', label: 'Rank / role', required: 'Master / Captain', yours: 'Second Officer' })
    expect(find(match.checks, 'experience')).toEqual({ key: 'experience', label: 'Sea time', required: '5+ years', yours: '3 years' })
    expect(find(match.checks, 'certificate')).toEqual({ key: 'certificate', label: 'Certificate', required: 'COC: Master', yours: 'Not on your profile' })
  })

  it('explains self-reported and expired certificates and missing profile data', () => {
    const selfReported = scoreJobMatch(job({ certificateRequirements: ['STCW'] }), seafarer({ certificates: [{ name: 'STCW', expiresAt: null, verified: false }] }), today)
    expect(find(selfReported.checks, 'certificate')).toEqual({ key: 'certificate', label: 'Certificate', required: 'STCW (verified)', yours: 'Self-reported, not yet verified' })
    const expired = scoreJobMatch(job({ certificateRequirements: ['STCW'] }), seafarer({ certificates: [{ name: 'STCW', expiresAt: '2025-01-31', verified: true }] }), today)
    expect(find(expired.checks, 'certificate')?.yours).toBe('Expired on 31 Jan 2025')
    const noSeaTime = scoreJobMatch(job({ experienceMinYears: 2 }), seafarer({ sailingExperienceYears: null }), today)
    expect(find(noSeaTime.checks, 'experience')?.yours).toBe('Not on your profile')
  })

  it('has no checks when nothing is missing', () => {
    const match = scoreJobV2(job({ acceptedRoleKeys: ['chief_officer'], vesselTypes: ['Bulk Carrier'] }), seafarer(), today)
    expect(match.missingRequirements).toEqual([])
    expect(match.checks).toEqual([])
  })

  it('keeps the gate’s checks when the member is below the minimum match', () => {
    const { match } = scoreJobForMember({ ...masterJob, minMatchToApply: 90 }, chiefOfficer, today)
    expect(match.eligible).toBe(false)
    expect(match.checks?.length).toBeGreaterThan(0)
    expect(new Set(match.checks?.map((check) => `${check.label}|${check.required}`)).size).toBe(match.checks?.length)
  })

  it('formats years and skips duplicate checks', () => {
    expect(yearsLabel(1)).toBe('1 year')
    expect(yearsLabel(2.46)).toBe('2.5 years')
    expect(experienceCheck(0.5, 0.25, false)).toEqual({ key: 'experience', label: 'Experience', required: '0.5+ years', yours: '0.3 years' })
    const checks: JobMatchCheck[] = []
    pushCheck(checks, experienceCheck(5, 3, true))
    pushCheck(checks, experienceCheck(5, 2, true))
    expect(checks).toHaveLength(1)
  })
})
