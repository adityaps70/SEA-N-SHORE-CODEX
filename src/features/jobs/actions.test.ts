import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  isMemberReady: vi.fn(),
  getPublishedJob: vi.fn(),
  hasApplied: vi.fn(),
  createApplication: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('./repository', () => ({
  jobsRepository: {
    isMemberReady: mocks.isMemberReady,
    getPublishedJob: mocks.getPublishedJob,
    hasApplied: mocks.hasApplied,
    createApplication: mocks.createApplication,
  },
}))

import { applyToJob } from './actions'

const jobId = '11111111-1111-4111-8111-111111111111'
const job = {
  id: jobId,
  title: 'Chief Officer',
  companyName: 'Sea N Shore Shipping',
  location: 'Mumbai',
  summary: 'Tanker opportunity',
  description: 'Role description',
  requirements: null,
  applyUntil: null,
  createdAt: '2026-09-09T10:00:00.000Z',
}

describe('applyToJob', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAwsUser.mockResolvedValue({ id: 'viewer-1', cognitoSub: 'sub-1', email: null })
    mocks.isMemberReady.mockResolvedValue(true)
    mocks.getPublishedJob.mockResolvedValue(job)
    mocks.hasApplied.mockResolvedValue(false)
    mocks.createApplication.mockResolvedValue(undefined)
  })

  it('blocks applications until the professional profile is ready', async () => {
    mocks.isMemberReady.mockResolvedValue(false)

    await expect(applyToJob(jobId)).resolves.toEqual({
      ok: false,
      error: 'Complete your professional profile before applying.',
    })
    expect(mocks.getPublishedJob).not.toHaveBeenCalled()
    expect(mocks.createApplication).not.toHaveBeenCalled()
  })

  it('does not create a duplicate when the member already applied', async () => {
    mocks.hasApplied.mockResolvedValue(true)

    await expect(applyToJob(jobId)).resolves.toEqual({ ok: true, alreadyApplied: true })
    expect(mocks.createApplication).not.toHaveBeenCalled()
  })

  it('creates the first application and revalidates jobs and activity routes', async () => {
    await expect(applyToJob(jobId)).resolves.toEqual({ ok: true, alreadyApplied: false })

    expect(mocks.createApplication).toHaveBeenCalledWith(jobId, 'viewer-1')
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/jobs')
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/jobs/${jobId}`)
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/activities')
  })
})
