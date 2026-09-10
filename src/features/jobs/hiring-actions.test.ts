import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HiringJobInput, HiringJobUpdateInput } from './hiring-repository'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  createJob: vi.fn(),
  updateJob: vi.fn(),
  updateApplicationStatus: vi.fn(),
  saveRecruiterNote: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('./hiring-repository', async (importOriginal) => {
  const original = await importOriginal<typeof import('./hiring-repository')>()
  return {
    ...original,
    hiringRepository: {
      createJob: mocks.createJob,
      updateJob: mocks.updateJob,
      updateApplicationStatus: mocks.updateApplicationStatus,
      saveRecruiterNote: mocks.saveRecruiterNote,
    },
  }
})

import {
  createHiringJob,
  saveHiringRecruiterNote,
  updateHiringApplicationStatus,
  updateHiringJob,
} from './hiring-actions'

const companyId = '11111111-1111-4111-8111-111111111111'
const jobId = '22222222-2222-4222-8222-222222222222'
const applicationId = '33333333-3333-4333-8333-333333333333'

function createInput(overrides: Partial<HiringJobInput> = {}): HiringJobInput {
  return {
    companyId,
    title: 'Chief Officer',
    domain: 'sea',
    department: 'Deck',
    rank: 'Chief Officer',
    vesselTypes: ['Oil Tanker'],
    location: 'Worldwide',
    regions: ['Worldwide'],
    summary: 'Urgent tanker opening',
    description: 'Lead the deck team onboard.',
    requirements: 'Advanced tanker experience preferred.',
    experienceMinYears: 4,
    experienceMaxYears: 12,
    joiningFrom: '2026-09-20',
    joiningUntil: '2026-09-30',
    salaryMin: 7800,
    salaryMax: 8400,
    salaryCurrency: 'USD',
    salaryPeriod: 'month',
    urgent: true,
    easyApply: true,
    applyUntil: '2026-09-18',
    status: 'published',
    certificates: ['STCW'],
    visas: ['US C1/D'],
    ...overrides,
  }
}

function updateInput(overrides: Partial<HiringJobUpdateInput> = {}): HiringJobUpdateInput {
  const input = createInput()
  const { companyId: _ignored, ...rest } = input
  void _ignored
  return { ...rest, ...overrides }
}

describe('hiring server actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAwsUser.mockResolvedValue({ id: 'recruiter-1', cognitoSub: 'sub-1', email: null })
    mocks.createJob.mockResolvedValue(jobId)
    mocks.updateJob.mockResolvedValue(undefined)
    mocks.updateApplicationStatus.mockResolvedValue(undefined)
    mocks.saveRecruiterNote.mockResolvedValue(undefined)
  })

  it('rejects invalid company ids before loading the authenticated user', async () => {
    await expect(createHiringJob(createInput({ companyId: 'not-a-uuid' }))).resolves.toMatchObject({ ok: false })
    expect(mocks.requireAwsUser).not.toHaveBeenCalled()
    expect(mocks.createJob).not.toHaveBeenCalled()
  })

  it('rejects invalid salary and joining ranges', async () => {
    await expect(createHiringJob(createInput({ salaryMin: 9000, salaryMax: 8000 }))).resolves.toMatchObject({ ok: false })
    await expect(createHiringJob(createInput({ joiningFrom: '2026-10-01', joiningUntil: '2026-09-30' }))).resolves.toMatchObject({ ok: false })
    expect(mocks.createJob).not.toHaveBeenCalled()
  })

  it('creates a vacancy with the server-authenticated recruiter and revalidates candidate and hiring surfaces', async () => {
    await expect(createHiringJob(createInput())).resolves.toEqual({ ok: true, jobId })
    expect(mocks.createJob).toHaveBeenCalledWith('recruiter-1', expect.objectContaining({ companyId, title: 'Chief Officer' }))
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/hiring')
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/hiring/jobs')
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/jobs')
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/jobs/${jobId}`)
  })

  it('updates only a valid job id with server-authenticated identity', async () => {
    await expect(updateHiringJob(jobId, updateInput({ title: 'Senior Chief Officer' }))).resolves.toEqual({ ok: true })
    expect(mocks.updateJob).toHaveBeenCalledWith('recruiter-1', jobId, expect.objectContaining({ title: 'Senior Chief Officer' }))
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/hiring/jobs/${jobId}/edit`)
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/jobs/${jobId}`)
  })

  it('rejects unsupported application statuses before repository mutation', async () => {
    await expect(updateHiringApplicationStatus(applicationId, 'unknown' as never, null)).resolves.toMatchObject({ ok: false })
    expect(mocks.updateApplicationStatus).not.toHaveBeenCalled()
  })

  it('updates application status and refreshes recruiter and candidate timelines', async () => {
    await expect(updateHiringApplicationStatus(applicationId, 'shortlisted', 'Strong tanker fit')).resolves.toEqual({ ok: true })
    expect(mocks.updateApplicationStatus).toHaveBeenCalledWith('recruiter-1', applicationId, 'shortlisted', 'Strong tanker fit')
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/hiring/applicants/${applicationId}`)
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/jobs/applications')
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/activities')
  })

  it('rejects blank recruiter notes and saves valid private notes', async () => {
    await expect(saveHiringRecruiterNote(applicationId, '   ')).resolves.toMatchObject({ ok: false })
    expect(mocks.saveRecruiterNote).not.toHaveBeenCalled()

    await expect(saveHiringRecruiterNote(applicationId, 'Call after 1600 UTC.')).resolves.toEqual({ ok: true })
    expect(mocks.saveRecruiterNote).toHaveBeenCalledWith('recruiter-1', applicationId, 'Call after 1600 UTC.')
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/hiring/applicants/${applicationId}`)
  })

  it('returns a safe error when a repository authorization check rejects the mutation', async () => {
    mocks.updateJob.mockRejectedValue(new Error('hiring_forbidden'))
    await expect(updateHiringJob(jobId, updateInput())).resolves.toEqual({ ok: false, error: 'You do not have permission to manage this hiring workspace.' })
  })
})
