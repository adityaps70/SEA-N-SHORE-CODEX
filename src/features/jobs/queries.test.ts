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
    getAppliedJobIds: vi.fn().mockResolvedValue(['job-1']),
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
      mode: 'sea', ranks: ['chief_officer'], vesselTypes: ['Oil Tanker'],
    }), 60, 0)
    expect(repository.getCandidateProfile).toHaveBeenCalledWith('viewer-1')
    expect(repository.getSavedJobIds).toHaveBeenCalledWith('viewer-1', ['job-1'])
    expect(repository.getAppliedJobIds).toHaveBeenCalledWith('viewer-1', ['job-1'])
    expect(result.items[0]).toMatchObject({ job: { id: 'job-1' }, isSaved: true, alreadyApplied: true })
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

describe('jobs for you v2 (round G, behind the jobs switch)', () => {
  const on = { isEnabled: async () => true }
  const seaProfile: JobCandidateProfile = { ...profile, persona: 'seafarer', roleKey: 'chief_officer' }
  const many = Array.from({ length: 45 }, (_, index) => ({
    ...job,
    id: `job-${String(index).padStart(2, '0')}`,
    acceptedRoleKeys: [index % 3 === 0 ? 'third_officer' : 'chief_officer'],
    applyUntil: null,
    publishedAt: new Date(Date.UTC(2026, 9, 12) - index * 3_600_000).toISOString(),
  }))

  function v2Queries(appliedIds: string[] = []) {
    const repository = makeRepository()
    repository.getCandidateProfile.mockResolvedValue(seaProfile)
    repository.searchJobs.mockResolvedValue(many)
    repository.getSavedJobIds.mockResolvedValue([])
    repository.getAppliedJobIds.mockResolvedValue(appliedIds)
    return { repository, queries: createJobsQueries({ requireUser: async () => ({ id: 'viewer-1' } as never), repository: repository as never, ranking: on }) }
  }

  it('scores the prefiltered pool of up to 300 and moves applied jobs to their own section', async () => {
    const { repository, queries } = v2Queries(['job-01'])
    const result = await queries.getJobsDiscovery({ mode: 'for-you' })
    expect(repository.searchJobs).toHaveBeenCalledWith(expect.anything(), 300, 0, expect.objectContaining({ viewerId: 'viewer-1', departmentKeys: ['deck_officers'] }))
    expect(result.version).toBe(2)
    expect(result.items.map((item) => item.job.id)).not.toContain('job-01')
    expect(result.applied.map((item) => item.job.id)).toEqual(['job-01'])
  })

  it('puts not-eligible jobs below eligible ones in a search, with the reason, and keeps the apply gate on round 12', async () => {
    // Round H (H2): a search still shows not-eligible jobs, labelled and ordered lower; For You leaves them out.
    const { queries } = v2Queries()
    const search = { mode: 'for-you', q: 'officer' }
    const all = [...(await queries.getJobsDiscovery(search)).items, ...(await queries.getJobsDiscovery({ ...search, page: '2' })).items, ...(await queries.getJobsDiscovery({ ...search, page: '3' })).items]
    const firstIneligible = all.findIndex((item) => item.match?.eligible === false)
    expect(firstIneligible).toBeGreaterThan(0)
    expect(all.slice(firstIneligible).every((item) => item.match?.eligible === false)).toBe(true)
    expect(all[firstIneligible]!.match?.ineligibleReason).toMatch(/^Not eligible: needs /)
    expect(all[0]!.gateMatch?.version).toBeUndefined()
  })

  it('paginates: pages do not overlap and together cover every job', async () => {
    const { queries } = v2Queries()
    const pages = await Promise.all(['1', '2', '3'].map((page) => queries.getJobsDiscovery({ mode: 'for-you', q: 'officer', page })))
    expect(pages.map((page) => page.items.length)).toEqual([20, 20, 5])
    expect(pages.map((page) => page.hasMore)).toEqual([true, true, false])
    expect(new Set(pages.flatMap((page) => page.items.map((item) => item.job.id))).size).toBe(45)
  })

  it('leaves jobs the member is not eligible for out of For You (Round H, H2)', async () => {
    const { queries } = v2Queries()
    const pages = await Promise.all(['1', '2', '3'].map((page) => queries.getJobsDiscovery({ mode: 'for-you', page })))
    const items = pages.flatMap((page) => page.items)
    // 15 of the 45 jobs are for a Third Officer: not eligible for this Chief Officer.
    expect(items).toHaveLength(30)
    expect(items.every((item) => item.match?.eligible !== false)).toBe(true)
    expect(pages.map((page) => page.hasMore)).toEqual([true, false, false])
  })

  it('lists Recently Posted strictly newest first from SQL, own and applied jobs included (bug fix, 13 Nov)', async () => {
    const { repository, queries } = v2Queries(['job-01'])
    // The member's own posted job, published a minute ago, is first: SQL orders by publish time.
    const own = { ...job, id: 'own-job', publishedAt: new Date(Date.now() - 60_000).toISOString(), acceptedRoleKeys: ['master'] }
    repository.searchJobs.mockResolvedValue([own, ...many.slice(0, 5)])
    const result = await queries.getJobsDiscovery({ mode: 'recent' })
    expect(repository.searchJobs).toHaveBeenCalledWith(expect.objectContaining({ mode: 'recent', sort: 'recent', postedWithinDays: 7 }), 21, 0)
    expect(result.filters.sort).toBe('recent')
    expect(result.items.map((item) => item.job.id)).toEqual(['own-job', 'job-00', 'job-01', 'job-02', 'job-03', 'job-04'])
  })

  it('under Recommended (any chip), never puts a not-eligible job above an eligible one; newer first at equal relevance', async () => {
    const { queries } = v2Queries()
    const pages = await Promise.all(['1', '2', '3'].map((page) => queries.getJobsDiscovery({ mode: 'sea', sort: 'recommended', page })))
    const items = pages.flatMap((page) => page.items)
    expect(items).toHaveLength(45)
    const firstIneligible = items.findIndex((item) => item.match?.eligible === false)
    expect(firstIneligible).toBeGreaterThan(0)
    expect(items.slice(firstIneligible).every((item) => item.match?.eligible === false)).toBe(true)
    const eligible = items.filter((item) => item.match?.eligible !== false)
    const sameScore = eligible.filter((item) => item.match?.score === eligible[0]!.match?.score)
    expect(sameScore.length).toBeGreaterThan(1)
    const dates = sameScore.map((item) => Date.parse(item.job.publishedAt!))
    expect(dates).toEqual([...dates].sort((a, b) => b - a))
  })

  it('pages other sorts in SQL', async () => {
    const { repository, queries } = v2Queries()
    await queries.getJobsDiscovery({ mode: 'sea', sort: 'recent', page: '2' })
    expect(repository.searchJobs).toHaveBeenCalledWith(expect.anything(), 21, 20)
  })
})

describe('jobs for you without the ranking switch (Round H, H2)', () => {
  it('leaves seafarer-only jobs out of For You for a shore member, and keeps them in a search', async () => {
    const repository = makeRepository()
    const shoreProfile: JobCandidateProfile = { ...profile, persona: 'shore_professional' }
    repository.getCandidateProfile.mockResolvedValue(shoreProfile)
    repository.searchJobs.mockResolvedValue([{ ...job, id: 'sea-job' }])
    repository.getSavedJobIds.mockResolvedValue([])
    repository.getAppliedJobIds.mockResolvedValue([])
    const queries = createJobsQueries({ requireUser: async () => ({ id: 'viewer-1' } as never), repository: repository as never, ranking: { isEnabled: async () => false } })
    const forYou = await queries.getJobsDiscovery({ mode: 'for-you' })
    const search = await queries.getJobsDiscovery({ mode: 'for-you', q: 'officer' })
    expect(forYou.items.map((item) => item.job.id)).toEqual([])
    expect(search.items.map((item) => item.job.id)).toEqual(['sea-job'])
  })

  it('puts eligible jobs above not-eligible ones under Recommended without the switch too (bug fix, 13 Nov)', async () => {
    const repository = makeRepository()
    repository.getCandidateProfile.mockResolvedValue({ ...profile, persona: 'seafarer', roleKey: 'chief_officer' })
    // The not-eligible job (a Third Officer one) is newer and would otherwise sort first on an equal score.
    repository.searchJobs.mockResolvedValue([
      { ...job, id: 'not-eligible', acceptedRoleKeys: ['third_officer'], publishedAt: '2026-09-12T10:00:00.000Z' },
      { ...job, id: 'eligible', acceptedRoleKeys: ['chief_officer'], publishedAt: '2026-09-01T10:00:00.000Z' },
    ])
    repository.getSavedJobIds.mockResolvedValue([])
    repository.getAppliedJobIds.mockResolvedValue([])
    const queries = createJobsQueries({ requireUser: async () => ({ id: 'viewer-1' } as never), repository: repository as never, ranking: { isEnabled: async () => false } })
    const result = await queries.getJobsDiscovery({ mode: 'sea', q: 'officer' })
    expect(result.items.map((item) => item.job.id)).toEqual(['eligible', 'not-eligible'])
  })

  it('gives signed-out visitors live jobs by newest, without a match or member state (round H, H5)', async () => {
    const repository = makeRepository()
    const requireUser = vi.fn(async () => { throw new Error('signed out') })
    const queries = createJobsQueries({ requireUser, repository: repository as never })

    const result = await queries.getSignedOutJobsDiscovery({ mode: 'sea', page: '2' })

    expect(requireUser).not.toHaveBeenCalled()
    expect(repository.searchJobs).toHaveBeenCalledWith(expect.objectContaining({ mode: 'sea', sort: 'recent' }), 21, 20, undefined, { liveOnly: true })
    expect(repository.getCandidateProfile).not.toHaveBeenCalled()
    expect(repository.getSavedJobIds).not.toHaveBeenCalled()
    expect(result.items).toEqual([{ job, isSaved: false, alreadyApplied: false, match: null, gateMatch: null }])
    expect(result).toMatchObject({ page: 2, hasMore: false, profileReady: false, applied: [] })

    await queries.getSignedOutJobsDiscovery({ sort: 'salary' })
    expect(repository.searchJobs).toHaveBeenLastCalledWith(expect.objectContaining({ sort: 'salary' }), 21, 0, undefined, { liveOnly: true })
  })

  it('gives signed-out visitors the published job alone (round H, H5)', async () => {
    const repository = makeRepository()
    const requireUser = vi.fn(async () => { throw new Error('signed out') })
    const queries = createJobsQueries({ requireUser, repository: repository as never })

    await expect(queries.getSignedOutJobDetailState('job-1')).resolves.toEqual({ job, alreadyApplied: false, isSaved: false, match: null, gateMatch: null, profileReady: false })
    expect(requireUser).not.toHaveBeenCalled()
    expect(repository.hasApplied).not.toHaveBeenCalled()
  })
})
