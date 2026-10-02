import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HiringJobInput, HiringJobUpdateInput, ManagedHiringJobSummary } from './hiring-repository'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  createJob: vi.fn(),
  updateJob: vi.fn(),
  changeJobStatus: vi.fn(),
  deleteJob: vi.fn(),
  getManagedJob: vi.fn(),
  getManagedEditableJob: vi.fn(),
  getApplicationPublisherScope: vi.fn(),
  updateApplicationStatus: vi.fn(),
  saveRecruiterNote: vi.fn(),
  revalidatePath: vi.fn(),
  flagContentAutomatically: vi.fn(async () => undefined),
  requireCapability: vi.fn(async () => undefined),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/features/access/server', () => ({ requireCapability: mocks.requireCapability }))
vi.mock('@/features/moderation/repository', () => ({
  moderationRepository: { flagContentAutomatically: mocks.flagContentAutomatically },
}))
vi.mock('./hiring-repository', async (importOriginal) => {
  const original = await importOriginal<typeof import('./hiring-repository')>()
  return {
    ...original,
    hiringRepository: {
      createJob: mocks.createJob,
      updateJob: mocks.updateJob,
      changeJobStatus: mocks.changeJobStatus,
      deleteJob: mocks.deleteJob,
      getManagedJob: mocks.getManagedJob,
      getManagedEditableJob: mocks.getManagedEditableJob,
      getApplicationPublisherScope: mocks.getApplicationPublisherScope,
      updateApplicationStatus: mocks.updateApplicationStatus,
      saveRecruiterNote: mocks.saveRecruiterNote,
    },
  }
})

import {
  changeHiringJobStatus,
  createHiringJob,
  deleteHiringJob,
  saveHiringRecruiterNote,
  updateHiringApplicationStatus,
  updateHiringJob,
} from './hiring-actions'

const companyId = '11111111-1111-4111-8111-111111111111'
const jobId = '22222222-2222-4222-8222-222222222222'
const applicationId = '33333333-3333-4333-8333-333333333333'

function isoDate(offsetDays: number) {
  return new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

const future = isoDate(30)
const past = isoDate(-10)

function createInput(overrides: Partial<HiringJobInput> = {}): HiringJobInput {
  return {
    publisherType: 'organization',
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
    joiningFrom: isoDate(40),
    joiningUntil: isoDate(50),
    salaryMin: 7800,
    salaryMax: 8400,
    salaryCurrency: 'USD',
    salaryPeriod: 'month',
    urgent: true,
    easyApply: true,
    applyUntil: future,
    status: 'published',
    certificates: ['STCW'],
    visas: ['US C1/D'],
    ...overrides,
  }
}

function updateInput(overrides: Partial<HiringJobUpdateInput> = {}): HiringJobUpdateInput {
  const { companyId: _companyId, publisherType: _publisherType, status: _status, ...rest } = createInput()
  void _companyId
  void _publisherType
  void _status
  return { ...rest, ...overrides }
}

function managedJob(overrides: Partial<ManagedHiringJobSummary> = {}): ManagedHiringJobSummary {
  return {
    id: jobId,
    title: 'Chief Officer',
    status: 'published',
    domain: 'sea',
    rank: 'Chief Officer',
    vesselTypes: ['Oil Tanker'],
    location: 'Worldwide',
    urgent: false,
    applyUntil: future,
    publishedAt: '2026-09-01T00:00:00.000Z',
    applicantCount: 0,
    companyId,
    publisherName: 'Oceanic',
    companySlug: 'oceanic',
    companyLogoPath: null,
    companyLocation: 'Dubai',
    companyVerified: true,
    joiningUntil: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    archivedAt: null,
    newApplicantCount: 0,
    moderationRemoved: false,
    canDelete: true,
    ...overrides,
  }
}

describe('hiring server actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAwsUser.mockResolvedValue({ id: 'recruiter-1', cognitoSub: 'sub-1', email: null })
    mocks.createJob.mockResolvedValue(jobId)
    mocks.updateJob.mockResolvedValue(undefined)
    mocks.changeJobStatus.mockResolvedValue(undefined)
    mocks.deleteJob.mockResolvedValue(undefined)
    mocks.getManagedJob.mockResolvedValue(managedJob())
    mocks.getManagedEditableJob.mockResolvedValue({ id: jobId, companyId, status: 'draft', ...updateInput() })
    mocks.getApplicationPublisherScope.mockResolvedValue({ companyId, status: 'applied' })
    mocks.updateApplicationStatus.mockResolvedValue(undefined)
    mocks.saveRecruiterNote.mockResolvedValue(undefined)
  })

  it('rejects invalid company ids before loading the authenticated user', async () => {
    await expect(createHiringJob(createInput({ companyId: 'not-a-uuid' }))).resolves.toMatchObject({ ok: false })
    expect(mocks.requireAwsUser).not.toHaveBeenCalled()
    expect(mocks.createJob).not.toHaveBeenCalled()
  })

  it('rejects invalid salary ranges', async () => {
    await expect(createHiringJob(createInput({ salaryMin: 9000, salaryMax: 8000 }))).resolves.toMatchObject({ ok: false })
    expect(mocks.createJob).not.toHaveBeenCalled()
  })

  it('does not persist a legacy joining-until value for newly posted jobs', async () => {
    await expect(createHiringJob(createInput({ joiningUntil: isoDate(50) }))).resolves.toEqual({ ok: true, jobId })
    expect(mocks.createJob).toHaveBeenCalledWith(
      'recruiter-1',
      expect.objectContaining({ joiningUntil: null }),
    )
  })

  it('refuses to publish a new job whose apply-by date has already passed', async () => {
    await expect(createHiringJob(createInput({ applyUntil: past }))).resolves.toEqual({
      ok: false,
      error: expect.stringMatching(/apply-by date .* has passed/i),
    })
    expect(mocks.createJob).not.toHaveBeenCalled()
  })

  it('saves a draft with a past apply-by date so it can be fixed before publishing', async () => {
    await expect(createHiringJob(createInput({ status: 'draft', applyUntil: past }))).resolves.toEqual({ ok: true, jobId })
    expect(mocks.createJob).toHaveBeenCalledWith('recruiter-1', expect.objectContaining({ status: 'draft', applyUntil: past }))
  })

  it('never creates a job directly in the archived state', async () => {
    await expect(createHiringJob(createInput({ status: 'closed' }))).resolves.toMatchObject({ ok: false })
    expect(mocks.createJob).not.toHaveBeenCalled()
  })

  it('blocks high-confidence unsafe vacancy text before creation', async () => {
    await expect(createHiringJob(createInput({
      description: 'Send your OTP and password to verify your account immediately.',
    }))).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/community safety rules/i) })

    expect(mocks.createJob).not.toHaveBeenCalled()
    expect(mocks.flagContentAutomatically).not.toHaveBeenCalled()
  })

  it('creates an automated moderation case for review-level published vacancy text', async () => {
    await expect(createHiringJob(createInput({
      description: 'Guaranteed job. Pay the registration fee now and contact us on WhatsApp.',
    }))).resolves.toEqual({ ok: true, jobId })

    expect(mocks.flagContentAutomatically).toHaveBeenCalledWith(expect.objectContaining({
      targetType: 'job',
      targetId: jobId,
      reason: 'scam',
      details: expect.stringContaining('[AUTOMATED MODERATION]'),
    }))
  })

  it('requires the central job publishing capability for the selected organization', async () => {
    await expect(createHiringJob(createInput())).resolves.toEqual({ ok: true, jobId })
    expect(mocks.requireCapability).toHaveBeenCalledWith('recruiter-1', 'job.publish', { companyId })
  })

  it('requires personal Creator Pro capability when publishing as the recruiter', async () => {
    await expect(createHiringJob(createInput({
      publisherType: 'personal',
      companyId: null,
    }))).resolves.toEqual({ ok: true, jobId })

    expect(mocks.requireCapability).toHaveBeenCalledWith('recruiter-1', 'job.publish')
    expect(mocks.createJob).toHaveBeenCalledWith(
      'recruiter-1',
      expect.objectContaining({ publisherType: 'personal', companyId: null }),
    )
  })

  it('fails closed when paid or verified job publishing access is missing', async () => {
    mocks.requireCapability.mockRejectedValueOnce(new Error('capability_required'))

    await expect(createHiringJob(createInput())).resolves.toEqual({
      ok: false,
      error: expect.stringMatching(/creator pro|organization pro|publishing access/i),
    })
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

  it('updates only a valid job id with server-authenticated identity and keeps the lifecycle status', async () => {
    await expect(updateHiringJob('not-a-uuid', updateInput())).resolves.toMatchObject({ ok: false })
    await expect(updateHiringJob(jobId, updateInput({ title: 'Senior Chief Officer' }))).resolves.toEqual({ ok: true })
    expect(mocks.updateJob).toHaveBeenCalledWith(
      'recruiter-1',
      jobId,
      expect.objectContaining({ title: 'Senior Chief Officer' }),
      { expectedStatus: 'published', nextStatus: 'published' },
    )
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/hiring/jobs/${jobId}/edit`)
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/jobs/${jobId}`)
  })

  it('preserves a legacy joining-until value when editing through the simplified form', async () => {
    const legacyJoiningUntil = isoDate(45)
    mocks.getManagedJob.mockResolvedValueOnce(managedJob({ joiningUntil: legacyJoiningUntil }))

    await expect(updateHiringJob(jobId, updateInput({ joiningUntil: isoDate(90) }))).resolves.toEqual({ ok: true })
    expect(mocks.updateJob).toHaveBeenCalledWith(
      'recruiter-1',
      jobId,
      expect.objectContaining({ joiningUntil: legacyJoiningUntil }),
      { expectedStatus: 'published', nextStatus: 'published' },
    )
  })

  it('requires the central publishing capability when updating an organization job', async () => {
    await expect(updateHiringJob(jobId, updateInput())).resolves.toEqual({ ok: true })
    expect(mocks.requireCapability).toHaveBeenCalledWith('recruiter-1', 'job.publish', { companyId })
  })

  it('refuses to save a live job with an apply-by date in the past instead of silently clearing it', async () => {
    await expect(updateHiringJob(jobId, updateInput({ applyUntil: past }))).resolves.toEqual({
      ok: false,
      error: expect.stringMatching(/apply-by date .* is in the past/i),
    })
    expect(mocks.updateJob).not.toHaveBeenCalled()
  })

  it('saves an archived job with its old apply-by date without republishing it', async () => {
    mocks.getManagedJob.mockResolvedValue(managedJob({ status: 'closed', applyUntil: past }))
    await expect(updateHiringJob(jobId, updateInput({ applyUntil: past }))).resolves.toEqual({ ok: true })
    expect(mocks.updateJob).toHaveBeenCalledWith('recruiter-1', jobId, expect.anything(), { expectedStatus: 'closed', nextStatus: 'closed' })
  })

  it('publishes a draft in the same save when asked', async () => {
    mocks.getManagedJob.mockResolvedValue(managedJob({ status: 'draft' }))
    await expect(updateHiringJob(jobId, updateInput(), 'publish')).resolves.toEqual({ ok: true })
    expect(mocks.updateJob).toHaveBeenCalledWith('recruiter-1', jobId, expect.anything(), { expectedStatus: 'draft', nextStatus: 'published' })
  })

  it('does not republish a job that moderation removed, even through save and publish', async () => {
    mocks.getManagedJob.mockResolvedValue(managedJob({ status: 'closed', moderationRemoved: true }))
    await expect(updateHiringJob(jobId, updateInput(), 'publish')).resolves.toEqual({
      ok: false,
      error: expect.stringMatching(/moderation/i),
    })
    expect(mocks.updateJob).not.toHaveBeenCalled()
  })

  it('denies editing a job the viewer cannot manage', async () => {
    mocks.getManagedJob.mockResolvedValue(null)
    await expect(updateHiringJob(jobId, updateInput())).resolves.toEqual({
      ok: false,
      error: expect.stringMatching(/can’t manage this job/),
    })
    expect(mocks.updateJob).not.toHaveBeenCalled()
  })

  it('returns a safe error when a repository authorization check rejects the mutation', async () => {
    mocks.updateJob.mockRejectedValue(new Error('hiring_forbidden'))
    await expect(updateHiringJob(jobId, updateInput())).resolves.toEqual({
      ok: false,
      error: 'You can’t manage this job. Only the person who posted it, or the organization’s owners, administrators and recruiters, can.',
    })
  })

  it('explains a concurrent lifecycle change instead of failing silently', async () => {
    mocks.updateJob.mockRejectedValue(new Error('job_state_changed'))
    await expect(updateHiringJob(jobId, updateInput())).resolves.toEqual({
      ok: false,
      error: expect.stringMatching(/changed in another window/i),
    })
  })
})

describe('job lifecycle actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAwsUser.mockResolvedValue({ id: 'recruiter-1', cognitoSub: 'sub-1', email: null })
    mocks.changeJobStatus.mockResolvedValue(undefined)
    mocks.deleteJob.mockResolvedValue(undefined)
    mocks.getManagedEditableJob.mockResolvedValue({ id: jobId, companyId, status: 'draft', ...updateInput() })
  })

  it('archives a live job without requiring a paid publishing plan', async () => {
    mocks.getManagedJob.mockResolvedValue(managedJob({ status: 'published' }))
    await expect(changeHiringJobStatus(jobId, 'archive')).resolves.toEqual({ ok: true })
    expect(mocks.changeJobStatus).toHaveBeenCalledWith('recruiter-1', jobId, { from: 'published', to: 'closed', applyUntil: future })
    expect(mocks.requireCapability).not.toHaveBeenCalled()
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/hiring/jobs')
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/jobs/${jobId}`)
  })

  it('publishes a draft only with the publishing capability and a content check', async () => {
    mocks.getManagedJob.mockResolvedValue(managedJob({ status: 'draft' }))
    await expect(changeHiringJobStatus(jobId, 'publish')).resolves.toEqual({ ok: true })
    expect(mocks.requireCapability).toHaveBeenCalledWith('recruiter-1', 'job.publish', { companyId })
    expect(mocks.getManagedEditableJob).toHaveBeenCalledWith('recruiter-1', jobId)
    expect(mocks.changeJobStatus).toHaveBeenCalledWith('recruiter-1', jobId, { from: 'draft', to: 'published', applyUntil: future })
  })

  it('asks for a new apply-by date before republishing an archived job whose date has passed', async () => {
    mocks.getManagedJob.mockResolvedValue(managedJob({ status: 'closed', applyUntil: past }))
    await expect(changeHiringJobStatus(jobId, 'republish')).resolves.toEqual({
      ok: false,
      error: expect.stringMatching(/has passed\. Choose a new date, or remove it, to republish/),
    })
    expect(mocks.changeJobStatus).not.toHaveBeenCalled()
  })

  it('republishes an archived job with a new apply-by date', async () => {
    mocks.getManagedJob.mockResolvedValue(managedJob({ status: 'closed', applyUntil: past }))
    await expect(changeHiringJobStatus(jobId, 'republish', { applyUntil: future })).resolves.toEqual({ ok: true })
    expect(mocks.changeJobStatus).toHaveBeenCalledWith('recruiter-1', jobId, { from: 'closed', to: 'published', applyUntil: future })
  })

  it('republishes an archived job with no closing date when the date is removed', async () => {
    mocks.getManagedJob.mockResolvedValue(managedJob({ status: 'closed', applyUntil: past }))
    await expect(changeHiringJobStatus(jobId, 'republish', { applyUntil: null })).resolves.toEqual({ ok: true })
    expect(mocks.changeJobStatus).toHaveBeenCalledWith('recruiter-1', jobId, { from: 'closed', to: 'published', applyUntil: null })
  })

  it('rejects transitions the lifecycle does not allow', async () => {
    mocks.getManagedJob.mockResolvedValue(managedJob({ status: 'draft' }))
    await expect(changeHiringJobStatus(jobId, 'archive')).resolves.toEqual({
      ok: false,
      error: expect.stringMatching(/only live jobs can be archived/i),
    })
    await expect(changeHiringJobStatus(jobId, 'republish')).resolves.toMatchObject({ ok: false })
    await expect(changeHiringJobStatus(jobId, 'delete' as never)).resolves.toMatchObject({ ok: false })
    expect(mocks.changeJobStatus).not.toHaveBeenCalled()
  })

  it('denies lifecycle changes to someone who cannot manage the job', async () => {
    mocks.getManagedJob.mockResolvedValue(null)
    await expect(changeHiringJobStatus(jobId, 'archive')).resolves.toEqual({
      ok: false,
      error: expect.stringMatching(/can’t manage this job/),
    })
    expect(mocks.changeJobStatus).not.toHaveBeenCalled()
  })

  it('deletes a draft the viewer posted', async () => {
    mocks.getManagedJob.mockResolvedValue(managedJob({ status: 'draft', canDelete: true }))
    await expect(deleteHiringJob(jobId)).resolves.toEqual({ ok: true })
    expect(mocks.deleteJob).toHaveBeenCalledWith('recruiter-1', jobId, 'draft')
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/hiring/jobs')
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/jobs/applications')
  })

  it('deletes an archived job that has applicants (soft delete keeps their applications)', async () => {
    mocks.getManagedJob.mockResolvedValue(managedJob({ status: 'closed', applicantCount: 4 }))
    await expect(deleteHiringJob(jobId)).resolves.toEqual({ ok: true })
    expect(mocks.deleteJob).toHaveBeenCalledWith('recruiter-1', jobId, 'closed')
  })

  it('asks for a live job to be archived before it can be deleted', async () => {
    mocks.getManagedJob.mockResolvedValue(managedJob({ status: 'published' }))
    await expect(deleteHiringJob(jobId)).resolves.toEqual({
      ok: false,
      error: expect.stringMatching(/archive this job before deleting/i),
    })
    expect(mocks.deleteJob).not.toHaveBeenCalled()
  })

  it('denies deletion to a recruiter who did not post the job and is not an owner or administrator', async () => {
    mocks.getManagedJob.mockResolvedValue(managedJob({ status: 'closed', canDelete: false }))
    await expect(deleteHiringJob(jobId)).resolves.toEqual({
      ok: false,
      error: expect.stringMatching(/only the person who posted this job/i),
    })
    expect(mocks.deleteJob).not.toHaveBeenCalled()
  })

  it('denies deletion to someone outside the hiring team', async () => {
    mocks.getManagedJob.mockResolvedValue(null)
    await expect(deleteHiringJob(jobId)).resolves.toMatchObject({ ok: false })
    await expect(deleteHiringJob('not-a-uuid')).resolves.toMatchObject({ ok: false })
    expect(mocks.deleteJob).not.toHaveBeenCalled()
  })
})

describe('applicant management actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAwsUser.mockResolvedValue({ id: 'recruiter-1', cognitoSub: 'sub-1', email: null })
    mocks.getApplicationPublisherScope.mockResolvedValue({ companyId, status: 'applied' })
    mocks.updateApplicationStatus.mockResolvedValue(undefined)
    mocks.saveRecruiterNote.mockResolvedValue(undefined)
  })

  it('requires the central applicant-management capability before changing candidate state', async () => {
    await expect(updateHiringApplicationStatus(applicationId, 'shortlisted', null)).resolves.toEqual({ ok: true })
    expect(mocks.requireCapability).toHaveBeenCalledWith('recruiter-1', 'job.manage_applicants', { companyId })
  })

  it('requires the central applicant-management capability before saving recruiter notes', async () => {
    await expect(saveHiringRecruiterNote(applicationId, 'Call after 1600 UTC.')).resolves.toEqual({ ok: true })
    expect(mocks.requireCapability).toHaveBeenCalledWith('recruiter-1', 'job.manage_applicants', { companyId })
  })

  it('rejects unsupported application statuses before repository mutation', async () => {
    await expect(updateHiringApplicationStatus(applicationId, 'unknown' as never, null)).resolves.toMatchObject({ ok: false })
    await expect(updateHiringApplicationStatus(applicationId, 'withdrawn', null)).resolves.toMatchObject({ ok: false })
    await expect(updateHiringApplicationStatus(applicationId, 'applied', null)).resolves.toMatchObject({ ok: false })
    expect(mocks.updateApplicationStatus).not.toHaveBeenCalled()
  })

  it('keeps a withdrawn application unchanged', async () => {
    mocks.getApplicationPublisherScope.mockResolvedValue({ companyId, status: 'withdrawn' })
    await expect(updateHiringApplicationStatus(applicationId, 'shortlisted', null)).resolves.toEqual({
      ok: false,
      error: expect.stringMatching(/withdrew their application/i),
    })
    expect(mocks.updateApplicationStatus).not.toHaveBeenCalled()
  })

  it('denies status changes to someone who cannot manage the job', async () => {
    mocks.getApplicationPublisherScope.mockResolvedValue(null)
    await expect(updateHiringApplicationStatus(applicationId, 'selected', null)).resolves.toMatchObject({ ok: false })
    await expect(saveHiringRecruiterNote(applicationId, 'Note')).resolves.toMatchObject({ ok: false })
    expect(mocks.updateApplicationStatus).not.toHaveBeenCalled()
    expect(mocks.saveRecruiterNote).not.toHaveBeenCalled()
  })

  it('updates application status (Hired maps to selected) and refreshes recruiter and candidate timelines', async () => {
    await expect(updateHiringApplicationStatus(applicationId, 'selected', 'Welcome aboard')).resolves.toEqual({ ok: true })
    expect(mocks.updateApplicationStatus).toHaveBeenCalledWith('recruiter-1', applicationId, 'selected', 'Welcome aboard')
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
})
