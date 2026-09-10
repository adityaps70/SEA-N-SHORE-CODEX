import { describe, expect, it } from 'vitest'
import { createHiringRepository, type HiringJobInput, type HiringJobUpdateInput } from './hiring-repository'

const HIRING_ROLE_VALUES = ['owner', 'administrator', 'recruiter']

function jobInput(overrides: Partial<HiringJobInput> = {}): HiringJobInput {
  return {
    companyId: 'company-1',
    title: 'Chief Officer',
    domain: 'sea',
    department: 'Deck',
    rank: 'Chief Officer',
    vesselTypes: ['Oil Tanker'],
    location: 'Worldwide',
    regions: ['Worldwide'],
    summary: 'Urgent tanker opening',
    description: 'Lead the deck team.',
    requirements: 'Tanker experience.',
    experienceMinYears: 4,
    experienceMaxYears: null,
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

function jobUpdateInput(overrides: Partial<HiringJobUpdateInput> = {}): HiringJobUpdateInput {
  const { companyId: _companyId, ...input } = jobInput()
  return { ...input, ...overrides }
}

describe('jobs hiring repository', () => {
  it('authorizes hiring only through an approved owner, administrator or recruiter company membership', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const repository = createHiringRepository({
      query: async (text, values) => {
        seen.push({ text, values })
        return [{ company_id: 'company-1', company_slug: 'oceanic', company_name: 'Oceanic', company_verified: true, role: 'recruiter' }]
      },
    })

    await expect(repository.getAuthorizedCompany('user-1', 'company-1')).resolves.toMatchObject({ id: 'company-1', role: 'recruiter' })
    expect(seen[0]?.text).toContain('cm.user_id = $1')
    expect(seen[0]?.text).toContain('cm.approved_at is not null')
    expect(seen[0]?.text).toContain('cm.role::text = any($2::text[])')
    expect(seen[0]?.text).not.toContain('profile_type')
    expect(seen[0]?.values).toEqual(['user-1', HIRING_ROLE_VALUES, 'company-1'])
  })

  it('loads a recruiter dashboard with jobs and application funnel metrics scoped to that company', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const repository = createHiringRepository({ query: async (text, values) => { seen.push({ text, values }); return [{ active_jobs: '4', applicants: '128', shortlisted: '8', interviews: '3', selected: '1' }] } })

    await expect(repository.getDashboardMetrics('user-1', 'company-1')).resolves.toEqual({ activeJobs: 4, applicants: 128, shortlisted: 8, interviews: 3, selected: 1 })
    expect(seen[0]?.text).toContain('public.company_members cm')
    expect(seen[0]?.text).toContain('cm.user_id = $1')
    expect(seen[0]?.text).toContain('j.company_id = $3')
    expect(seen[0]?.values).toEqual(['user-1', HIRING_ROLE_VALUES, 'company-1'])
  })

  it('creates a structured job using the authorized company identity instead of trusting a client company name', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const query = async (text: string, values?: readonly unknown[]) => {
      seen.push({ text, values })
      if (text.includes('from public.companies c')) return [{ company_id: 'company-1', company_slug: 'oceanic', company_name: 'Oceanic', company_verified: true, role: 'recruiter' }]
      if (text.includes('insert into public.jobs')) return [{ id: 'job-1' }]
      return []
    }
    const repository = createHiringRepository({ query, transaction: async (work) => work(query) })

    await expect(repository.createJob('user-1', jobInput())).resolves.toBe('job-1')

    const insert = seen.find((entry) => entry.text.includes('insert into public.jobs'))
    expect(insert?.text).toContain('company_name')
    expect(insert?.text).toContain('published_at')
    expect(insert?.values).toContain('Oceanic')
    expect(seen.some((entry) => entry.text.includes('job_certificate_requirements'))).toBe(true)
    expect(seen.some((entry) => entry.text.includes('job_visa_requirements'))).toBe(true)
  })

  it('lists only company vacancies visible through an approved hiring membership', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const repository = createHiringRepository({
      query: async (text, values) => {
        seen.push({ text, values })
        return [{
          id: 'job-1', title: 'Chief Officer', status: 'published', job_domain: 'sea', rank: 'Chief Officer',
          vessel_types: ['Oil Tanker'], location: 'Worldwide', urgent: true, apply_until: '2026-09-18',
          published_at: '2026-09-10T00:00:00.000Z', applicant_count: '12',
        }]
      },
    })

    await expect(repository.listCompanyJobs('user-1', 'company-1')).resolves.toEqual([{
      id: 'job-1', title: 'Chief Officer', status: 'published', domain: 'sea', rank: 'Chief Officer',
      vesselTypes: ['Oil Tanker'], location: 'Worldwide', urgent: true, applyUntil: '2026-09-18',
      publishedAt: '2026-09-10T00:00:00.000Z', applicantCount: 12,
    }])
    expect(seen[0]?.text).toContain('public.company_members cm')
    expect(seen[0]?.text).toContain('cm.approved_at is not null')
    expect(seen[0]?.text).toContain('j.company_id = $3')
    expect(seen[0]?.values).toEqual(['user-1', HIRING_ROLE_VALUES, 'company-1'])
  })

  it('loads an editable vacancy only when the recruiter is authorized for its company', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const repository = createHiringRepository({
      query: async (text, values) => {
        seen.push({ text, values })
        return [{
          id: 'job-1', company_id: 'company-1', title: 'Chief Officer', status: 'draft', job_domain: 'sea', department: 'Deck',
          rank: 'Chief Officer', vessel_types: ['Oil Tanker'], location: 'Worldwide', sailing_regions: ['Worldwide'],
          summary: 'Opening', description: 'Lead deck team', requirements: 'Tanker experience', experience_min_years: '4',
          experience_max_years: null, joining_from: null, joining_until: null, salary_min: '7800', salary_max: '8400',
          salary_currency: 'USD', salary_period: 'month', urgent: false, easy_apply: true, apply_until: null,
          certificates: ['STCW'], visas: ['US C1/D'],
        }]
      },
    })

    const result = await repository.getEditableJob('user-1', 'company-1', 'job-1')
    expect(result).toMatchObject({ id: 'job-1', companyId: 'company-1', title: 'Chief Officer', certificates: ['STCW'], visas: ['US C1/D'] })
    expect(seen[0]?.text).toContain('cm.user_id = $1')
    expect(seen[0]?.text).toContain('j.company_id = $2')
    expect(seen[0]?.text).toContain('j.id = $3')
  })

  it('updates a vacancy without allowing the client to move employer identity', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const query = async (text: string, values?: readonly unknown[]) => {
      seen.push({ text, values })
      if (text.includes('select j.id, j.company_id')) return [{ id: 'job-1', company_id: 'company-1' }]
      return []
    }
    const repository = createHiringRepository({ query, transaction: async (work) => work(query) })

    await repository.updateJob('user-1', 'job-1', jobUpdateInput({ title: 'Senior Chief Officer', certificates: ['STCW', 'Advanced Oil Tanker'], visas: [] }))

    const update = seen.find((entry) => entry.text.includes('update public.jobs'))
    expect(update?.text).toContain('title = $2')
    expect(update?.text).not.toContain('company_id =')
    expect(update?.text).not.toContain('company_name =')
    expect(seen.some((entry) => entry.text.includes('delete from public.job_certificate_requirements'))).toBe(true)
    expect(seen.some((entry) => entry.text.includes('Advanced Oil Tanker'))).toBe(false)
    expect(seen.flatMap((entry) => entry.values ?? [])).toContain('Advanced Oil Tanker')
    expect(seen.some((entry) => entry.text.includes('delete from public.job_visa_requirements'))).toBe(true)
  })

  it('lists authorized applicants with maritime candidate data and deterministic match scores', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const repository = createHiringRepository({
      query: async (text, values) => {
        seen.push({ text, values })
        return [{
          application_id: 'application-1', application_status: 'applied', applied_at: '2026-09-10T10:00:00.000Z', updated_at: '2026-09-10T10:00:00.000Z',
          candidate_id: 'candidate-1', candidate_slug: 'capt-rahul', candidate_name: 'Capt Rahul', avatar_path: null, candidate_location: 'Mumbai', headline: 'Chief Officer',
          candidate_rank: 'Chief Officer', sailing_experience_years: '11.4', candidate_vessel_types: ['Oil Tanker'], trading_areas: ['Worldwide'],
          availability: null, shore_career_preference: false, skills: ['Leadership'], credentials: [{ name: 'STCW', expires_at: null, verified: true }], visas: ['US C1/D'],
          job_id: 'job-1', job_title: 'Chief Officer', company_name: 'Oceanic', company_id: 'company-1', company_slug: 'oceanic', company_verified: true,
          recruiter_verified: true, job_location: 'Worldwide', job_summary: 'Opening', job_description: 'Lead deck team', job_requirements: null,
          apply_until: null, job_created_at: '2026-09-09T00:00:00.000Z', job_published_at: '2026-09-09T00:00:00.000Z', job_domain: 'sea', department: 'Deck',
          job_rank: 'Chief Officer', job_vessel_types: ['Oil Tanker'], experience_min_years: '4', experience_max_years: null, joining_from: null, joining_until: null,
          salary_min: '7800', salary_max: '8400', salary_currency: 'USD', salary_period: 'month', sailing_regions: ['Worldwide'], urgent: true, easy_apply: true,
          certificate_requirements: ['STCW'], visa_requirements: ['US C1/D'],
        }]
      },
    })

    const applicants = await repository.listApplicants('user-1', 'job-1')
    expect(applicants).toHaveLength(1)
    expect(applicants[0]).toMatchObject({
      applicationId: 'application-1', status: 'applied',
      candidate: { id: 'candidate-1', slug: 'capt-rahul', fullName: 'Capt Rahul', rank: 'Chief Officer', vesselTypes: ['Oil Tanker'] },
      match: { score: 100 },
    })
    expect(seen[0]?.text).toContain('public.company_members cm')
    expect(seen[0]?.text).toContain('cm.user_id = $1')
    expect(seen[0]?.text).toContain('j.id = $2')
    expect(seen[0]?.text).toContain('mp.sailing_experience_years')
  })

  it('loads an authorized application review with immutable history and private recruiter notes', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const repository = createHiringRepository({
      query: async (text, values) => {
        seen.push({ text, values })
        return [{
          application_id: 'application-1', application_status: 'shortlisted', applied_at: '2026-09-10T10:00:00.000Z', updated_at: '2026-09-11T10:00:00.000Z',
          candidate_id: 'candidate-1', candidate_slug: 'capt-rahul', candidate_name: 'Capt Rahul', avatar_path: null, candidate_location: 'Mumbai', headline: 'Chief Officer',
          candidate_rank: 'Chief Officer', sailing_experience_years: '11.4', candidate_vessel_types: ['Oil Tanker'], trading_areas: ['Worldwide'], availability: null,
          shore_career_preference: false, skills: [], credentials: [{ name: 'STCW', expires_at: null, verified: true }], visas: ['US C1/D'],
          job_id: 'job-1', job_title: 'Chief Officer', company_name: 'Oceanic', company_id: 'company-1', company_slug: 'oceanic', company_verified: true, recruiter_verified: true,
          job_location: 'Worldwide', job_summary: 'Opening', job_description: 'Lead deck team', job_requirements: null, apply_until: null,
          job_created_at: '2026-09-09T00:00:00.000Z', job_published_at: '2026-09-09T00:00:00.000Z', job_domain: 'sea', department: 'Deck', job_rank: 'Chief Officer',
          job_vessel_types: ['Oil Tanker'], experience_min_years: '4', experience_max_years: null, joining_from: null, joining_until: null, salary_min: '7800', salary_max: '8400',
          salary_currency: 'USD', salary_period: 'month', sailing_regions: ['Worldwide'], urgent: true, easy_apply: true, certificate_requirements: ['STCW'], visa_requirements: ['US C1/D'],
          events: [{ id: '1', status: 'applied', note: null, created_at: '2026-09-10T10:00:00.000Z' }, { id: '2', status: 'shortlisted', note: 'Strong tanker fit', created_at: '2026-09-11T10:00:00.000Z' }],
          recruiter_notes: [{ id: 'note-1', recruiter_id: 'user-1', note: 'Call after 1600 UTC.', created_at: '2026-09-11T11:00:00.000Z' }],
        }]
      },
    })

    const review = await repository.getApplicationReview('user-1', 'application-1')
    expect(review).toMatchObject({
      applicationId: 'application-1', status: 'shortlisted',
      candidate: { fullName: 'Capt Rahul' },
      events: [{ status: 'applied' }, { status: 'shortlisted' }],
      recruiterNotes: [{ id: 'note-1', note: 'Call after 1600 UTC.' }],
      match: { score: 100 },
    })
    expect(seen[0]?.text).toContain('cm.approved_at is not null')
    expect(seen[0]?.text).toContain('rn.application_id = a.id')
    expect(seen[0]?.values).toEqual(['user-1', 'application-1', HIRING_ROLE_VALUES])
  })

  it('updates application status and appends immutable history in the same transaction', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const query = async (text: string, values?: readonly unknown[]) => {
      seen.push({ text, values })
      if (text.includes('select a.id')) return [{ id: 'application-1', company_id: 'company-1' }]
      return []
    }
    const repository = createHiringRepository({ query, transaction: async (work) => work(query) })

    await repository.updateApplicationStatus('user-1', 'application-1', 'shortlisted', 'Strong tanker fit')

    expect(seen[0]?.text).toContain('public.company_members cm')
    expect(seen[0]?.text).toContain('cm.approved_at is not null')
    expect(seen.some((entry) => entry.text.includes('update public.job_applications'))).toBe(true)
    expect(seen.some((entry) => entry.text.includes('insert into public.job_application_events'))).toBe(true)
    expect(seen.flatMap((entry) => entry.values ?? [])).toContain('shortlisted')
    expect(seen.flatMap((entry) => entry.values ?? [])).toContain('Strong tanker fit')
  })

  it('keeps recruiter notes private to the authorized company hiring workflow and uses the schema recruiter_id column', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const query = async (text: string, values?: readonly unknown[]) => {
      seen.push({ text, values })
      if (text.includes('select a.id')) return [{ id: 'application-1', company_id: 'company-1' }]
      return []
    }
    const repository = createHiringRepository({ query, transaction: async (work) => work(query) })

    await repository.saveRecruiterNote('user-1', 'application-1', 'Call after 1600 UTC.')

    expect(seen[0]?.text).toContain('public.company_members cm')
    const insert = seen.find((entry) => entry.text.includes('insert into public.job_recruiter_notes'))
    expect(insert?.text).toContain('(application_id, recruiter_id, note)')
    expect(insert?.text).not.toContain('author_id')
    expect(seen.flatMap((entry) => entry.values ?? [])).toContain('Call after 1600 UTC.')
  })
})
