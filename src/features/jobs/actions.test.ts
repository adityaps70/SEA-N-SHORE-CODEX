import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  userCan: vi.fn(),
  isMemberReady: vi.fn(),
  getPublishedJob: vi.fn(),
  isAcceptingApplications: vi.fn(),
  hasApplied: vi.fn(),
  createApplication: vi.fn(),
  getCandidateProfile: vi.fn(),
  createPendingJobApplicationCvUpload: vi.fn(),
  verifyPendingJobApplicationCv: vi.fn(),
  removeJobApplicationCv: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/features/access/server', () => ({ userCan: mocks.userCan }))
vi.mock('./application-media', () => ({
  createPendingJobApplicationCvUpload: mocks.createPendingJobApplicationCvUpload,
  verifyPendingJobApplicationCv: mocks.verifyPendingJobApplicationCv,
  removeJobApplicationCv: mocks.removeJobApplicationCv,
}))
vi.mock('./repository', () => ({
  jobsRepository: {
    isMemberReady: mocks.isMemberReady,
    getPublishedJob: mocks.getPublishedJob,
    isAcceptingApplications: mocks.isAcceptingApplications,
    hasApplied: mocks.hasApplied,
    createApplication: mocks.createApplication,
    getCandidateProfile: mocks.getCandidateProfile,
  },
}))

import { applyToJob, prepareJobApplicationCvUpload } from './actions'

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
    mocks.userCan.mockResolvedValue(true)
    mocks.isMemberReady.mockResolvedValue(true)
    mocks.getPublishedJob.mockResolvedValue(job)
    mocks.isAcceptingApplications.mockResolvedValue(true)
    mocks.hasApplied.mockResolvedValue(false)
    mocks.createApplication.mockResolvedValue(undefined)
    mocks.getCandidateProfile.mockResolvedValue(null)
    mocks.createPendingJobApplicationCvUpload.mockResolvedValue({
      storagePath: 'job-applications/viewer-1/11111111-1111-4111-8111-111111111111/cv.pdf',
      fileName: 'resume.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      uploadUrl: 'https://uploads.example.test/cv',
    })
    mocks.verifyPendingJobApplicationCv.mockResolvedValue({
      storagePath: 'job-applications/viewer-1/11111111-1111-4111-8111-111111111111/cv.pdf',
      fileName: 'resume.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
    })
    mocks.removeJobApplicationCv.mockResolvedValue(undefined)
  })

  it('blocks applications until the professional profile is ready', async () => {
    mocks.isMemberReady.mockResolvedValue(false)

    await expect(applyToJob(jobId)).resolves.toEqual({
      ok: false,
      error: 'Complete your Sea N Shore profile before applying.',
    })
    expect(mocks.getPublishedJob).not.toHaveBeenCalled()
    expect(mocks.createApplication).not.toHaveBeenCalled()
  })

  it('keeps an expired published job visible but blocks new applications after its deadline', async () => {
    mocks.isAcceptingApplications.mockResolvedValue(false)

    await expect(applyToJob(jobId)).resolves.toEqual({
      ok: false,
      error: 'This job is no longer accepting applications.',
    })
    expect(mocks.getPublishedJob).toHaveBeenCalledWith(jobId)
    expect(mocks.isAcceptingApplications).toHaveBeenCalledWith(jobId)
    expect(mocks.createApplication).not.toHaveBeenCalled()
  })

  it('does not create a duplicate when the member already applied', async () => {
    mocks.hasApplied.mockResolvedValue(true)

    await expect(applyToJob(jobId)).resolves.toEqual({ ok: true, alreadyApplied: true })
    expect(mocks.createApplication).not.toHaveBeenCalled()
  })

  it('prepares a private PDF CV upload for the signed-in applicant and job', async () => {
    await expect(prepareJobApplicationCvUpload(jobId, {
      fileName: 'resume.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
    })).resolves.toEqual({
      ok: true,
      uploadUrl: 'https://uploads.example.test/cv',
      storagePath: 'job-applications/viewer-1/11111111-1111-4111-8111-111111111111/cv.pdf',
      fileName: 'resume.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
    })

    expect(mocks.createPendingJobApplicationCvUpload).toHaveBeenCalledWith({
      profileId: 'viewer-1',
      jobId,
      fileName: 'resume.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
    })
  })

  it('verifies and persists an attached PDF CV with the application', async () => {
    const cv = {
      storagePath: 'job-applications/viewer-1/11111111-1111-4111-8111-111111111111/cv.pdf',
      fileName: 'resume.pdf',
      mimeType: 'application/pdf' as const,
      sizeBytes: 1024,
    }

    await expect(applyToJob(jobId, cv)).resolves.toEqual({ ok: true, alreadyApplied: false })

    expect(mocks.verifyPendingJobApplicationCv).toHaveBeenCalledWith({
      profileId: 'viewer-1',
      jobId,
      ...cv,
    })
    expect(mocks.createApplication).toHaveBeenCalledWith(jobId, 'viewer-1', cv, null)
  })

  it('blocks an application when the uploaded CV cannot be verified', async () => {
    mocks.verifyPendingJobApplicationCv.mockRejectedValue(new Error('job_application_cv_unavailable'))

    await expect(applyToJob(jobId, {
      storagePath: 'job-applications/viewer-1/11111111-1111-4111-8111-111111111111/cv.pdf',
      fileName: 'resume.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
    })).resolves.toEqual({
      ok: false,
      error: 'We could not verify your CV. Please attach the PDF again.',
    })

    expect(mocks.createApplication).not.toHaveBeenCalled()
  })

  it('creates the first application and revalidates jobs and activity routes', async () => {
    await expect(applyToJob(jobId)).resolves.toEqual({ ok: true, alreadyApplied: false })

    expect(mocks.createApplication).toHaveBeenCalledWith(jobId, 'viewer-1', null, null)
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/jobs')
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/jobs/${jobId}`)
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/activities')
  })
})

describe('minimum match to apply, enforced on the server (round 12)', () => {
  const seaJob = {
    ...job,
    domain: 'sea',
    department: 'Deck officers',
    rank: 'Master / Captain',
    departmentKey: 'deck_officers',
    acceptedRoleKeys: ['master'],
    vesselTypes: ['Oil Tanker'],
    experienceMinYears: null,
    regions: [],
    certificateRequirements: [],
    visaRequirements: [],
    minMatchToApply: 70,
  }
  const seafarer = {
    persona: 'seafarer',
    roleKey: 'master',
    rank: 'Master / Captain',
    sailingExperienceYears: 20,
    vesselTypes: ['Oil Tanker'],
    tradingAreas: [],
    availability: null,
    certificates: [],
    visas: [],
    shoreCareerPreference: false,
    skills: [],
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAwsUser.mockResolvedValue({ id: 'viewer-1', cognitoSub: 'sub-1', email: null })
    mocks.userCan.mockResolvedValue(true)
    mocks.isMemberReady.mockResolvedValue(true)
    mocks.getPublishedJob.mockResolvedValue(seaJob)
    mocks.isAcceptingApplications.mockResolvedValue(true)
    mocks.hasApplied.mockResolvedValue(false)
    mocks.createApplication.mockResolvedValue(undefined)
  })

  it('refuses an application below the minimum with the score and what is missing', async () => {
    mocks.getCandidateProfile.mockResolvedValue({ ...seafarer, roleKey: 'chief_officer', rank: 'Chief Officer' })
    const result = await applyToJob(jobId)
    expect(result).toMatchObject({ ok: false, gate: { status: 'below_minimum', minimum: 70 } })
    expect(result.ok ? '' : result.error).toBe('Below this job’s minimum (70%) · you’re at 60%. Missing: Master / Captain.')
    expect(mocks.createApplication).not.toHaveBeenCalled()
  })

  it('lets a match at or above the minimum apply as usual', async () => {
    mocks.getCandidateProfile.mockResolvedValue(seafarer)
    await expect(applyToJob(jobId)).resolves.toEqual({ ok: true, alreadyApplied: false })
    expect(mocks.createApplication).toHaveBeenCalled()
  })

  it('lets anyone apply when the minimum is 0', async () => {
    mocks.getPublishedJob.mockResolvedValue({ ...seaJob, minMatchToApply: 0 })
    mocks.getCandidateProfile.mockResolvedValue({ ...seafarer, persona: 'maritime_enthusiast', roleKey: null })
    await expect(applyToJob(jobId)).resolves.toEqual({ ok: true, alreadyApplied: false })
  })

  it('asks a member with an incomplete profile for the exact missing items', async () => {
    mocks.getCandidateProfile.mockResolvedValue({ ...seafarer, roleKey: null, rank: null, vesselTypes: [] })
    const result = await applyToJob(jobId)
    expect(result).toMatchObject({
      ok: false,
      gate: {
        status: 'incomplete',
        gaps: [
          { key: 'rank', href: `/profile?edit=profile-header&job=${jobId}` },
          { key: 'vessel_types', href: `/profile?edit=profile-maritime&job=${jobId}` },
        ],
      },
    })
    expect(result.ok ? '' : result.error).toBe('Complete your profile to apply: Your current or most recent rank, Vessel types you have sailed on.')
    expect(mocks.createApplication).not.toHaveBeenCalled()
  })

  it('refuses a sea job to a profile type other than Seafarer or Student / Cadet', async () => {
    mocks.getCandidateProfile.mockResolvedValue({ ...seafarer, persona: 'maritime_enthusiast', roleKey: null })
    const result = await applyToJob(jobId)
    expect(result).toMatchObject({ ok: false, error: 'This role is for seafarers. Update your profile type if this is wrong.', gate: { status: 'sea_job_profile_type' } })
    expect(mocks.createApplication).not.toHaveBeenCalled()
  })

  it('refuses the CV upload step for the same reasons', async () => {
    mocks.getCandidateProfile.mockResolvedValue({ ...seafarer, persona: 'maritime_enthusiast', roleKey: null })
    await expect(prepareJobApplicationCvUpload(jobId, { fileName: 'cv.pdf', mimeType: 'application/pdf', sizeBytes: 100 }))
      .resolves.toMatchObject({ ok: false, gate: { status: 'sea_job_profile_type' } })
    expect(mocks.createPendingJobApplicationCvUpload).not.toHaveBeenCalled()
  })
})
