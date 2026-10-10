import { describe, expect, it } from 'vitest'
import { mapPublicJobsFeed } from './public-feed'
import type { JobListing } from './types'

function job(overrides: Partial<JobListing> = {}): JobListing {
  return {
    id: 'job-101',
    title: 'Chief Officer',
    companyName: 'Maritime Employer',
    companyId: null,
    companySlug: null,
    companyVerified: true,
    recruiterVerified: false,
    location: 'UAE',
    summary: 'Sea-going role',
    description: 'Job description',
    requirements: null,
    applyUntil: null,
    createdAt: '2026-10-09T12:00:00.000Z',
    publishedAt: '2026-10-09T12:00:00.000Z',
    domain: 'sea',
    department: 'Deck',
    rank: 'Chief Officer',
    vesselTypes: ['AHTS'],
    experienceMinYears: 2,
    experienceMaxYears: null,
    joiningFrom: '2026-10-15',
    joiningUntil: null,
    salaryMin: 6000,
    salaryMax: 8000,
    salaryCurrency: 'USD',
    salaryPeriod: 'month',
    regions: [],
    certificateRequirements: [],
    visaRequirements: [],
    urgent: false,
    easyApply: true,
    ...overrides,
  }
}

describe('public Sea N Shore vacancies feed', () => {
  it('publishes a minimal job card without private fields', () => {
    const [entry] = mapPublicJobsFeed([job()], new Date('2026-10-10T00:00:00Z'))
    expect(entry).toEqual({
      id: 'job-101',
      title: 'Chief Officer',
      company: 'Maritime Employer',
      location: 'UAE',
      rank: 'Chief Officer',
      vessel_type: 'AHTS',
      experience: '2 years',
      salary: 'USD 6,000–8,000 / month',
      joining_date: '2026-10-15',
      expires_at: null,
      status: 'published',
      public_url: 'https://seanshore.in/jobs/job-101',
    })
    expect(JSON.stringify(entry)).not.toContain('description')
    expect(JSON.stringify(entry)).not.toContain('requirements')
  })

  it('filters listings with a closing date in the past', () => {
    expect(mapPublicJobsFeed([
      job({ id: 'old', applyUntil: '2026-10-09' }),
      job({ id: 'new', applyUntil: '2026-10-10' }),
    ], new Date('2026-10-10T00:00:00Z')).map((entry) => entry.id)).toEqual(['new'])
  })

  it('limits results to 24 vacancies', () => {
    expect(mapPublicJobsFeed(
      Array.from({ length: 45 }, (_, index) => job({ id: 'job-' + index })),
    )).toHaveLength(24)
  })
})
