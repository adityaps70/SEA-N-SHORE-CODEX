import { beforeEach, describe, expect, it, vi } from 'vitest'
import { APPLICANT_WITHDRAWABLE_STATUSES, canWithdrawApplication } from './application-status'
import { createJobsRepository } from './repository'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  withdrawApplication: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/features/access/server', () => ({ userCan: vi.fn() }))
vi.mock('./application-media', () => ({
  createPendingJobApplicationCvUpload: vi.fn(),
  verifyPendingJobApplicationCv: vi.fn(),
  removeJobApplicationCv: vi.fn(),
}))
vi.mock('./repository', async (importOriginal) => {
  const original = await importOriginal<typeof import('./repository')>()
  return { ...original, jobsRepository: { withdrawApplication: mocks.withdrawApplication } }
})

import { withdrawJobApplication } from './actions'

const applicationId = '33333333-3333-4333-8333-333333333333'

describe('withdrawing an application', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAwsUser.mockResolvedValue({ id: 'viewer-1', cognitoSub: 'sub-1', email: null })
    mocks.withdrawApplication.mockResolvedValue({ jobId: 'job-1' })
  })

  it('only allows open stages: New, Reviewed, Shortlisted and Interview', () => {
    expect([...APPLICANT_WITHDRAWABLE_STATUSES]).toEqual(['applied', 'under_review', 'shortlisted', 'interview'])
    expect(canWithdrawApplication('applied')).toBe(true)
    expect(canWithdrawApplication('interview')).toBe(true)
    expect(canWithdrawApplication('selected')).toBe(false)
    expect(canWithdrawApplication('rejected')).toBe(false)
    expect(canWithdrawApplication('withdrawn')).toBe(false)
  })

  it('withdraws the signed-in member’s own application and refreshes both sides', async () => {
    await expect(withdrawJobApplication(applicationId)).resolves.toEqual({ ok: true })

    expect(mocks.withdrawApplication).toHaveBeenCalledWith(applicationId, 'viewer-1')
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/jobs/applications')
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/jobs/job-1')
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/hiring/jobs/job-1/applicants')
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/hiring/applicants/${applicationId}`)
  })

  it('refuses when the application is not the viewer’s or is past the open stages', async () => {
    mocks.withdrawApplication.mockResolvedValue(null)

    await expect(withdrawJobApplication(applicationId)).resolves.toEqual({
      ok: false,
      error: 'This application can no longer be withdrawn.',
    })
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it('rejects malformed ids before touching the database', async () => {
    await expect(withdrawJobApplication('not-a-uuid')).resolves.toEqual({ ok: false, error: 'Invalid application.' })
    expect(mocks.requireAwsUser).not.toHaveBeenCalled()
    expect(mocks.withdrawApplication).not.toHaveBeenCalled()
  })

  it('reports a database failure without claiming success', async () => {
    mocks.withdrawApplication.mockRejectedValue(new Error('connection lost'))
    await expect(withdrawJobApplication(applicationId)).resolves.toEqual({
      ok: false,
      error: 'We could not withdraw your application. Please try again.',
    })
  })
})

describe('jobs repository withdrawApplication', () => {
  it('scopes the update to the applicant and the open stages, and records a withdrawn event', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const repository = createJobsRepository({
      query: async (text, values) => {
        seen.push({ text, values })
        return [{ job_id: 'job-1' }]
      },
    })

    await expect(repository.withdrawApplication(applicationId, 'viewer-1')).resolves.toEqual({ jobId: 'job-1' })

    const sql = seen[0]?.text ?? ''
    expect(sql).toContain("set status = 'withdrawn'")
    expect(sql).toContain('a.id = $1')
    expect(sql).toContain('a.applicant_id = $2')
    expect(sql).toContain('a.status::text = any($3::text[])')
    expect(sql).toContain('insert into public.job_application_events (application_id, status, actor_id)')
    expect(seen[0]?.values).toEqual([applicationId, 'viewer-1', ['applied', 'under_review', 'shortlisted', 'interview']])
  })

  it('returns null when nothing was withdrawn (someone else’s application, or already decided)', async () => {
    const repository = createJobsRepository({ query: async () => [] })
    await expect(repository.withdrawApplication(applicationId, 'viewer-2')).resolves.toBeNull()
  })

  it('lists the recruiter and company logo with each application for the phone rows', async () => {
    const seen: string[] = []
    const repository = createJobsRepository({
      query: async (text) => {
        seen.push(text)
        return [{ id: 'a-1', status: 'applied', applied_at: '2026-09-10T00:00:00.000Z', updated_at: '2026-09-10T00:00:00.000Z', job_id: 'job-1', title: 'Master', company_name: 'Oceanic', location: null, job_state: 'open', company_id: 'company-1', company_logo_path: 'companies/company-1/logo.png', recruiter_profile_id: 'recruiter-1', cover_note: null, events: [] }]
      },
    })
    const [application] = await repository.listApplications('viewer-1')
    expect(seen[0]).toContain('j.created_by_user_id as recruiter_profile_id')
    expect(seen[0]).toContain('left join public.companies c on c.id = j.company_id')
    expect(application?.job).toMatchObject({ companyId: 'company-1', companyLogoPath: 'companies/company-1/logo.png', recruiterProfileId: 'recruiter-1' })
  })
})
