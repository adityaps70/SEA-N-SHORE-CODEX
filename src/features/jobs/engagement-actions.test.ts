import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  saveJob: vi.fn(),
  unsaveJob: vi.fn(),
  createJobAlert: vi.fn(),
  deleteJobAlert: vi.fn(),
  reportJob: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('./repository', () => ({
  jobsRepository: {
    saveJob: mocks.saveJob,
    unsaveJob: mocks.unsaveJob,
    createJobAlert: mocks.createJobAlert,
    deleteJobAlert: mocks.deleteJobAlert,
    reportJob: mocks.reportJob,
  },
}))

import { createJobAlert, deleteJobAlert, reportJob, saveJob, unsaveJob } from './actions'

const jobId = '11111111-1111-4111-8111-111111111111'
const alertId = '22222222-2222-4222-8222-222222222222'

describe('jobs engagement actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAwsUser.mockResolvedValue({ id: 'viewer-1', cognitoSub: 'sub-1', email: null })
  })

  it('saves and unsaves jobs only for the signed-in member and refreshes Jobs surfaces', async () => {
    await expect(saveJob(jobId)).resolves.toEqual({ ok: true })
    expect(mocks.saveJob).toHaveBeenCalledWith(jobId, 'viewer-1')
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/jobs')
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/jobs/saved')

    vi.clearAllMocks()
    mocks.requireAwsUser.mockResolvedValue({ id: 'viewer-1', cognitoSub: 'sub-1', email: null })
    await expect(unsaveJob(jobId)).resolves.toEqual({ ok: true })
    expect(mocks.unsaveJob).toHaveBeenCalledWith(jobId, 'viewer-1')
  })

  it('creates a normalized maritime alert from the same discovery query contract', async () => {
    await expect(createJobAlert({
      name: 'Chief Officer tanker',
      queryString: 'mode=sea&rank=Chief+Officer&vessel=Oil+Tanker&urgent=1',
      frequency: 'daily',
    })).resolves.toEqual({ ok: true })

    expect(mocks.createJobAlert).toHaveBeenCalledWith(
      'viewer-1',
      'Chief Officer tanker',
      expect.objectContaining({ mode: 'sea', ranks: ['Chief Officer'], vesselTypes: ['Oil Tanker'], urgentOnly: true }),
      'daily',
    )
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/jobs/alerts')
  })

  it('deletes only the signed-in member alert', async () => {
    await expect(deleteJobAlert(alertId)).resolves.toEqual({ ok: true })
    expect(mocks.deleteJobAlert).toHaveBeenCalledWith(alertId, 'viewer-1')
  })

  it('submits structured suspicious-job reports without automatically changing the listing', async () => {
    await expect(reportJob({
      jobId,
      reason: 'fake_company',
      details: ' Company identity looks suspicious. ',
    })).resolves.toEqual({ ok: true })

    expect(mocks.reportJob).toHaveBeenCalledWith(jobId, 'viewer-1', 'fake_company', 'Company identity looks suspicious.')
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/jobs/${jobId}`)
  })
})
