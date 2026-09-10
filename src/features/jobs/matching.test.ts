import { describe, expect, it } from 'vitest'
import { scoreJobMatch } from './matching'
import type { JobCandidateProfile, JobListing } from './types'

const job: JobListing = {
  id: 'job-1',
  title: 'Chief Officer',
  companyName: 'Oceanic Ship Management',
  companyId: 'company-1',
  companySlug: 'oceanic-ship-management',
  companyVerified: true,
  recruiterVerified: true,
  location: 'Worldwide',
  summary: 'Oil tanker opportunity',
  description: 'Join a managed oil tanker fleet.',
  requirements: 'Chief Officer with tanker background.',
  applyUntil: '2026-10-01',
  createdAt: '2026-09-10T10:00:00.000Z',
  publishedAt: '2026-09-10T10:00:00.000Z',
  domain: 'sea',
  department: 'Deck',
  rank: 'Chief Officer',
  vesselTypes: ['Oil Tanker'],
  experienceMinYears: 4,
  experienceMaxYears: null,
  joiningFrom: '2026-09-20',
  joiningUntil: '2026-09-30',
  salaryMin: 7800,
  salaryMax: 8400,
  salaryCurrency: 'USD',
  salaryPeriod: 'month',
  regions: ['Worldwide'],
  certificateRequirements: ['STCW', 'Advanced Oil Tanker'],
  visaRequirements: ['US C1/D'],
  urgent: true,
  easyApply: true,
}

const profile: JobCandidateProfile = {
  rank: 'Chief Officer',
  sailingExperienceYears: 7,
  vesselTypes: ['Oil Tanker', 'Chemical Tanker'],
  tradingAreas: ['Worldwide', 'Middle East'],
  availability: '2026-09-18',
  certificates: [
    { name: 'STCW', expiresAt: '2028-01-01', verified: true },
    { name: 'Advanced Oil Tanker', expiresAt: '2027-04-01', verified: true },
  ],
  visas: ['US C1/D'],
  shoreCareerPreference: false,
  skills: ['Leadership', 'Cargo Operations'],
}

describe('Your Maritime Match', () => {
  it('returns a high explainable match when the profile satisfies maritime requirements', () => {
    const result = scoreJobMatch(job, profile, new Date('2026-09-11T00:00:00.000Z'))

    expect(result.score).toBeGreaterThanOrEqual(95)
    expect(result.reasons).toEqual(expect.arrayContaining([
      expect.stringContaining('rank'),
      expect.stringContaining('vessel'),
      expect.stringContaining('certificate'),
      expect.stringContaining('joining'),
    ]))
    expect(result.missingRequirements).toEqual([])
  })

  it('surfaces missing visas and expired credentials as eligibility warnings', () => {
    const result = scoreJobMatch(job, {
      ...profile,
      visas: [],
      certificates: [
        { name: 'STCW', expiresAt: '2026-08-01', verified: true },
        { name: 'Advanced Oil Tanker', expiresAt: '2027-04-01', verified: true },
      ],
    }, new Date('2026-09-11T00:00:00.000Z'))

    expect(result.score).toBeLessThan(95)
    expect(result.missingRequirements).toEqual(expect.arrayContaining(['US C1/D', 'STCW']))
    expect(result.warnings.join(' ')).toMatch(/visa/i)
    expect(result.warnings.join(' ')).toMatch(/expired/i)
  })

  it('does not recommend a sea job as a strong fit when current rank and vessel experience miss', () => {
    const result = scoreJobMatch(job, {
      ...profile,
      rank: 'Third Officer',
      vesselTypes: ['Bulk Carrier'],
    }, new Date('2026-09-11T00:00:00.000Z'))

    expect(result.score).toBeLessThan(75)
    expect(result.missingRequirements).toEqual(expect.arrayContaining(['Chief Officer', 'Oil Tanker']))
  })
})
