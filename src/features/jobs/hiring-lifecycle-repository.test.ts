import { describe, expect, it } from 'vitest'
import { createHiringRepository, managedJobLifecycle } from './hiring-repository'

type Seen = Array<{ text: string; values?: readonly unknown[] }>

const HIRING_ROLE_VALUES = ['owner', 'administrator', 'recruiter']

function recordingRepository(respond: (text: string, values?: readonly unknown[]) => unknown[]) {
  const seen: Seen = []
  const query = async (text: string, values?: readonly unknown[]) => {
    seen.push({ text, values })
    return respond(text, values) as never[]
  }
  return { seen, repository: createHiringRepository({ query, transaction: async (work) => work(query) }) }
}

const managedRow = {
  id: 'job-1',
  title: 'Chief Officer',
  status: 'closed',
  job_domain: 'sea',
  rank: 'Chief Officer',
  vessel_types: ['Oil Tanker'],
  location: 'Worldwide',
  urgent: false,
  apply_until: new Date('2026-09-01T00:00:00.000Z'),
  joining_until: null,
  published_at: new Date('2026-08-01T00:00:00.000Z'),
  created_at: new Date('2026-07-30T00:00:00.000Z'),
  archived_at: new Date('2026-09-02T00:00:00.000Z'),
  company_id: 'company-1',
  publisher_name: 'Oceanic Shipping',
  company_slug: 'oceanic',
  company_logo_path: 'companies/company-1/logo.png',
  company_location: 'Dubai',
  company_verified: true,
  applicant_count: '3',
  new_applicant_count: '1',
  moderation_removed: false,
  can_delete: true,
}

const applicantBase = {
  application_status: 'applied',
  updated_at: new Date('2026-09-10T10:00:00.000Z'),
  cover_note: null,
  cv_storage_path: null,
  cv_file_name: null,
  cv_mime_type: null,
  cv_size_bytes: null,
  candidate_slug: 'capt-rahul',
  candidate_account_status: 'active',
  avatar_path: 'profiles/candidate-1/avatar.webp',
  candidate_location: 'Mumbai',
  headline: 'Chief Officer',
  candidate_rank: 'Chief Officer',
  sailing_experience_years: '10',
  candidate_vessel_types: ['Oil Tanker'],
  trading_areas: [],
  availability: null,
  shore_career_preference: false,
  skills: [],
  credentials: [],
  visas: [],
  job_id: 'job-1',
  job_title: 'Chief Officer',
  job_status: 'published',
  company_name: 'Oceanic',
  company_id: 'company-1',
  company_slug: 'oceanic',
  company_verified: true,
  recruiter_verified: true,
  job_location: 'Worldwide',
  job_summary: 'Opening',
  job_description: 'Lead deck team',
  job_requirements: null,
  apply_until: null,
  job_created_at: new Date('2026-09-09T00:00:00.000Z'),
  job_published_at: new Date('2026-09-09T00:00:00.000Z'),
  job_domain: 'sea',
  department: null,
  job_rank: 'Chief Officer',
  job_vessel_types: ['Oil Tanker'],
  experience_min_years: null,
  experience_max_years: null,
  joining_from: null,
  joining_until: null,
  salary_min: null,
  salary_max: null,
  salary_currency: null,
  salary_period: null,
  sailing_regions: [],
  urgent: false,
  easy_apply: true,
  certificate_requirements: [],
  visa_requirements: [],
}

describe('hiring repository lifecycle', () => {
  it('lists managed jobs with company identity, lifecycle facts and delete permission, excluding deleted jobs', async () => {
    const { seen, repository } = recordingRepository(() => [managedRow])

    const [job] = await repository.listManagedJobs('user-1')
    expect(job).toMatchObject({
      id: 'job-1',
      status: 'closed',
      applyUntil: '2026-09-01',
      publishedAt: '2026-08-01T00:00:00.000Z',
      archivedAt: '2026-09-02T00:00:00.000Z',
      publisherName: 'Oceanic Shipping',
      companySlug: 'oceanic',
      companyLogoPath: 'companies/company-1/logo.png',
      companyLocation: 'Dubai',
      applicantCount: 3,
      newApplicantCount: 1,
      canDelete: true,
      moderationRemoved: false,
    })
    expect(managedJobLifecycle(job!)).toEqual({
      status: 'closed', deleted: false, moderationRemoved: false, applyUntil: '2026-09-01', joiningUntil: null, applicantCount: 3, canDelete: true,
    })
    const text = seen[0]!.text
    expect(text).toContain('where j.deleted_at is null')
    expect(text).toContain('coalesce(c.name, j.company_name) as publisher_name')
    expect(text).toContain("from public.moderation_actions ma")
    expect(text).toContain("cm.role::text in ('owner', 'administrator')")
    expect(seen[0]!.values).toEqual(['user-1', HIRING_ROLE_VALUES])
  })

  it('loads one managed job by id through the same authorization', async () => {
    const { seen, repository } = recordingRepository(() => [])
    await expect(repository.getManagedJob('user-1', 'job-9')).resolves.toBeNull()
    expect(seen[0]!.text).toContain('and j.id = $3')
    expect(seen[0]!.text).toContain('cm.approved_at is not null')
    expect(seen[0]!.values).toEqual(['user-1', HIRING_ROLE_VALUES, 'job-9'])
  })

  it('moves a job between states only from the status that was validated', async () => {
    const { seen, repository } = recordingRepository((text) => {
      if (text.includes('select j.id, j.company_id')) return [{ id: 'job-1', company_id: 'company-1' }]
      if (text.includes('update public.jobs')) return [{ id: 'job-1' }]
      return []
    })

    await repository.changeJobStatus('user-1', 'job-1', { from: 'closed', to: 'published', applyUntil: '2026-12-01' })
    expect(seen[0]!.text).toContain('for update of j')
    const update = seen.find((entry) => entry.text.includes('update public.jobs'))!
    expect(update.text).toContain('and status = $2::public.job_listing_status')
    expect(update.text).toContain('and deleted_at is null')
    expect(update.values).toEqual(['job-1', 'closed', 'published', '2026-12-01'])
  })

  it('reports a concurrent change when the job is no longer in the expected state', async () => {
    const { repository } = recordingRepository((text) => (text.includes('select j.id, j.company_id') ? [{ id: 'job-1' }] : []))
    await expect(repository.changeJobStatus('user-1', 'job-1', { from: 'published', to: 'closed', applyUntil: null }))
      .rejects.toThrow('job_state_changed')
  })

  it('refuses lifecycle changes for someone who cannot manage the job', async () => {
    const { seen, repository } = recordingRepository(() => [])
    await expect(repository.changeJobStatus('stranger', 'job-1', { from: 'published', to: 'closed', applyUntil: null }))
      .rejects.toThrow('hiring_forbidden')
    expect(seen.some((entry) => entry.text.includes('update public.jobs'))).toBe(false)
  })

  it('soft-deletes a draft, keeps applications and clears saves', async () => {
    const { seen, repository } = recordingRepository((text) => {
      if (text.includes('select j.id') && text.includes('for update of j')) return [{ id: 'job-1' }]
      if (text.includes('update public.jobs')) return [{ id: 'job-1' }]
      return []
    })

    await repository.deleteJob('user-1', 'job-1', 'draft')
    expect(seen[0]!.text).toContain("cm.role::text in ('owner', 'administrator')")
    expect(seen[0]!.text).toContain('j.created_by_user_id = $2')
    const update = seen.find((entry) => entry.text.includes('update public.jobs'))!
    expect(update.text).toContain('deleted_at = now()')
    expect(update.text).toContain('deleted_by = $2')
    expect(update.text).toContain("status = 'closed'::public.job_listing_status")
    expect(update.text).toContain("and status <> 'published'::public.job_listing_status")
    expect(update.values).toEqual(['job-1', 'user-1', 'draft'])
    expect(seen.some((entry) => entry.text.includes('delete from public.job_saves'))).toBe(true)
    expect(seen.some((entry) => /delete from public\.(jobs|job_applications)\b/.test(entry.text))).toBe(false)
  })

  it('refuses to delete for a viewer without delete permission', async () => {
    const { seen, repository } = recordingRepository(() => [])
    await expect(repository.deleteJob('recruiter-2', 'job-1', 'closed')).rejects.toThrow('hiring_forbidden')
    expect(seen.some((entry) => entry.text.includes('update public.jobs'))).toBe(false)
  })

  it('excludes deleted jobs from editing, applicants and application review', async () => {
    const { seen, repository } = recordingRepository(() => [])
    await repository.getManagedEditableJob('user-1', 'job-1')
    await repository.getEditableJob('user-1', null, 'job-1')
    await repository.getEditableJob('user-1', 'company-1', 'job-1')
    await repository.listApplicants('user-1', 'job-1')
    await repository.getApplicationReview('user-1', 'application-1')
    await repository.getApplicationPublisherScope('user-1', 'application-1')
    for (const entry of seen) expect(entry.text).toContain('j.deleted_at is null')
  })
})

describe('hiring repository applicants', () => {
  it('sorts applicants with equal match scores without crashing on database timestamps', async () => {
    const { repository } = recordingRepository(() => [
      { ...applicantBase, application_id: 'application-1', applied_at: new Date('2026-09-10T10:00:00.000Z'), candidate_id: 'c-1', candidate_name: 'Capt Rahul' },
      { ...applicantBase, application_id: 'application-2', applied_at: new Date('2026-09-12T10:00:00.000Z'), candidate_id: 'c-2', candidate_name: 'Capt Meera' },
    ])

    const applicants = await repository.listApplicants('user-1', 'job-1')
    expect(applicants.map((applicant) => applicant.applicationId)).toEqual(['application-2', 'application-1'])
    expect(applicants[0]!.appliedAt).toBe('2026-09-12T10:00:00.000Z')
    expect(applicants[0]!.updatedAt).toBe('2026-09-10T10:00:00.000Z')
  })

  it('returns applicant photo, cover note and missing CV gracefully', async () => {
    const { repository } = recordingRepository(() => [
      { ...applicantBase, application_id: 'application-1', applied_at: '2026-09-10T10:00:00.000Z', candidate_id: 'c-1', candidate_name: 'Capt Rahul', cover_note: 'Available from November.' },
    ])
    const [applicant] = await repository.listApplicants('user-1', 'job-1')
    expect(applicant).toMatchObject({
      coverNote: 'Available from November.',
      cvAttachment: null,
      candidate: { accountActive: true, slug: 'capt-rahul', avatarPath: 'profiles/candidate-1/avatar.webp' },
    })
  })

  it('hides the profile of an applicant whose account is no longer active', async () => {
    const { repository } = recordingRepository(() => [
      { ...applicantBase, application_id: 'application-1', applied_at: '2026-09-10T10:00:00.000Z', candidate_id: 'c-1', candidate_name: 'Deleted member', candidate_account_status: 'deletion_requested' },
    ])
    const [applicant] = await repository.listApplicants('user-1', 'job-1')
    expect(applicant!.candidate).toMatchObject({
      accountActive: false,
      slug: null,
      avatarPath: null,
      fullName: 'Former Sea N Shore member',
    })
  })

  it('refuses a status change that is no longer allowed', async () => {
    const { seen, repository } = recordingRepository((text) => (text.includes('select j.company_id') ? [{ company_id: null, application_status: 'withdrawn' }] : []))
    await expect(repository.updateApplicationStatus('user-1', 'application-1', 'selected', null)).rejects.toThrow('application_status_not_allowed')
    expect(seen.some((entry) => entry.text.includes('update public.job_applications'))).toBe(false)
  })

  it('gives CV access to the applicant or the hiring team only', async () => {
    const { seen, repository } = recordingRepository(() => [{
      cv_storage_path: 'job-applications/c-1/job-1/11111111-1111-4111-8111-111111111111.pdf',
      cv_file_name: 'cv.pdf',
      cv_mime_type: 'application/pdf',
      cv_size_bytes: 2048,
      is_applicant: false,
    }])
    await expect(repository.getApplicationCvAccess('user-1', 'application-1')).resolves.toEqual({
      viewer: 'hiring',
      cv: { storagePath: 'job-applications/c-1/job-1/11111111-1111-4111-8111-111111111111.pdf', fileName: 'cv.pdf', mimeType: 'application/pdf', sizeBytes: 2048 },
    })
    expect(seen[0]!.text).toContain('a.applicant_id = $2')
    expect(seen[0]!.text).toContain('j.deleted_at is null')
    expect(seen[0]!.text).toContain('cm.approved_at is not null')
    expect(seen[0]!.values).toEqual(['application-1', 'user-1', HIRING_ROLE_VALUES])

    const denied = recordingRepository(() => [])
    await expect(denied.repository.getApplicationCvAccess('stranger', 'application-1')).resolves.toBeNull()
  })
})
