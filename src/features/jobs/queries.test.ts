import { describe, expect, it, vi } from 'vitest'
import { createJobsQueries } from './queries'
import type { JobCandidateProfile, JobListing } from './types'

const job: JobListing = {
  id: 'job-1', title: 'Chief Officer', companyName: 'Oceanic', companyId: 'company-1', companySlug: 'oceanic',
  companyVerified: true, recruiterVerified: true, location: 'Worldwide', summary: 'Tanker opening', description: 'Join us',
  requirements: 'Tanker experience', applyUntil: '2026-10-01', createdAt: '2026-09-10T10:00:00.000Z',
  publishedAt: '2026-09-10T10:00:00.000Z', domain: 'sea', department: 'Deck', rank: 'Chief Officer',
  vesselTypes: ['Oil Tanker'], experienceMinYears: 4, experienceMaxYears: null, joiningFrom: '2026-09-20',
  joiningUntil: '2026-09-30', salaryMin: 7800, salaryMax: 8400, salaryCurrency: 'USD', salaryPeriod: 'month',
  regions: ['Worldwide'], certificateRequirements: ['STCW'], visaRequirements: ['US C1/D'], urgent: true, easyApply: true,
}

const profile: JobCandidateProfile = {
  rank: 'Chief Officer', sailingExperienceYears: 7, vesselTypes: ['Oil Tanker'], tradingAreas: ['Worldwide'],
  availability: '2026-09-18', certificates: [{ name: 'STCW', expiresAt: '2028-01-01', verified: true }],
  visas: ['US C1/D'], shoreCareerPreference: false, skills: ['Leadership'],
}

function makeRepository() {
  return {
    listPublishedJobs: vi.fn().mockResolvedValue([job]),
    getPublishedJob: vi.fn().mockResolvedValue(job),
    listApplications: vi.fn().mockResolvedValue([]),
    hasApplied: vi.fn().mockResolvedValue(false),
    isMemberReady: vi.fn().mockResolvedValue(true),
    createApplication: vi.fn().mockResolvedValue(undefined),
    searchJobs: vi.fn().mockResolvedValue([job]),
    getCandidateProfile: vi.fn().mockResolvedValue(profile),
    getSavedJobIds: vi.fn().mockResolvedValue(['job-1']),
    isJobSaved: vi.fn().mockResolvedValue(true),
    listSavedJobs: vi.fn().mockResolvedValue([job]),
    listJobAlerts: vi.fn().mockResolvedValue([]),
    saveJob: vi.fn(), unsaveJob: vi.fn(), createJobAlert: vi.fn(), deleteJobAlert: vi.fn(), reportJob: vi.fn(),
  }
}

describe('jobs queries', () => {
  it('returns maritime discovery items with parsed filters, saved state and explainable match', async () => {
    const repository = makeRepository()
    const queries = createJobsQueries({
      requireUser: async () => ({ id: 'viewer-1' } as never),
      repository: repository as never,
    })

    const result = await queries.getJobsDiscovery({ mode: 'sea', rank: 'Chief Officer', vessel: 'Oil Tanker' })

    expect(repository.searchJobs).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'sea', ranks: ['Chief Officer'], vesselTypes: ['Oil Tanker'],
    }), 60, 0)
    expect(repository.getCandidateProfile).toHaveBeenCalledWith('viewer-1')
    expect(repository.getSavedJobIds).toHaveBeenCalledWith('viewer-1', ['job-1'])
    expect(result.items[0]).toMatchObject({ job: { id: 'job-1' }, isSaved: true })
    expect(result.items[0]?.match?.score).toBeGreaterThanOrEqual(90)
  })

  it('builds the job-detail state from application, save and profile eligibility in parallel', async () => {
    const repository = makeRepository()
    repository.hasApplied.mockResolvedValue(true)
    const queries = createJobsQueries({ requireUser: async () => ({ id: 'viewer-1' } as never), repository: repository as never })

    const state = await queries.getJobDetailState('job-1')

    expect(state).toMatchObject({ job: { id: 'job-1' }, alreadyApplied: true, isSaved: true })
    expect(state.match?.reasons.join(' ')).toMatch(/rank/i)
    expect(repository.isJobSaved).toHaveBeenCalledWith('job-1', 'viewer-1')
  })

  it('exposes saved jobs and alerts as dedicated Jobs-owned surfaces', async () => {
    const repository = makeRepository()
    const queries = createJobsQueries({ requireUser: async () => ({ id: 'viewer-1' } as never), repository: repository as never })

    await queries.getSavedJobs()
    await queries.getJobAlerts()

    expect(repository.listSavedJobs).toHaveBeenCalledWith('viewer-1', 100)
    expect(repository.listJobAlerts).toHaveBeenCalledWith('viewer-1')
  })
})
