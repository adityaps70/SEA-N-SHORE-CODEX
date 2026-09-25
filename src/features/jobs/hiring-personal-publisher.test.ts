import { describe, expect, it } from 'vitest'
import { createHiringRepository, type HiringJobInput } from './hiring-repository'

function personalJob(overrides: Partial<HiringJobInput> = {}): HiringJobInput {
  return {
    publisherType: 'personal',
    companyId: null,
    title: 'Marine Superintendent',
    domain: 'shore',
    department: 'Marine',
    rank: null,
    vesselTypes: [],
    location: 'Mumbai',
    regions: ['India'],
    summary: 'Independent recruiter opportunity.',
    description: 'Hiring an experienced marine superintendent.',
    requirements: null,
    experienceMinYears: 8,
    experienceMaxYears: null,
    joiningFrom: null,
    joiningUntil: null,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    salaryPeriod: null,
    urgent: false,
    easyApply: true,
    applyUntil: null,
    status: 'published',
    certificates: [],
    visas: [],
    ...overrides,
  }
}

describe('independent recruiter hiring publisher', () => {
  it('creates a personal job only for an approved recruiter identity and stores no company_id', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const query = async (text: string, values?: readonly unknown[]) => {
      seen.push({ text, values })
      if (text.includes('from public.profiles p') && text.includes('feature_verifications')) {
        return [{ profile_id: 'user-1', profile_name: 'Asha Singh', recruiter_verified: true }]
      }
      if (text.includes('insert into public.jobs')) return [{ id: 'job-1' }]
      return []
    }
    const repository = createHiringRepository({ query, transaction: async (work) => work(query) })

    await expect(repository.createJob('user-1', personalJob())).resolves.toBe('job-1')

    const insert = seen.find((entry) => entry.text.includes('insert into public.jobs'))
    expect(insert?.values).toContain('Asha Singh')
    expect(insert?.values).toContain(null)
    expect(insert?.values).toContain('user-1')
    expect(seen.some((entry) => entry.text.includes('public.company_members'))).toBe(false)
  })

  it('rejects personal job creation when recruiter verification is not approved', async () => {
    const query = async (text: string) => {
      if (text.includes('from public.profiles p') && text.includes('feature_verifications')) {
        return [{ profile_id: 'user-1', profile_name: 'Asha Singh', recruiter_verified: false }]
      }
      return []
    }
    const repository = createHiringRepository({ query, transaction: async (work) => work(query) })

    await expect(repository.createJob('user-1', personalJob())).rejects.toThrow('hiring_forbidden')
  })

  it('lists every verified organization publisher instead of silently selecting the first company', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const repository = createHiringRepository({
      query: async (text, values) => {
        seen.push({ text, values })
        return [
          { company_id: 'company-1', company_slug: 'alpha', company_name: 'Alpha Shipping', company_verified: true, role: 'owner' },
          { company_id: 'company-2', company_slug: 'beta', company_name: 'Beta Manning', company_verified: true, role: 'recruiter' },
        ]
      },
    })

    await expect(repository.listAuthorizedCompanies('user-1')).resolves.toEqual([
      { id: 'company-1', slug: 'alpha', name: 'Alpha Shipping', verified: true, role: 'owner' },
      { id: 'company-2', slug: 'beta', name: 'Beta Manning', verified: true, role: 'recruiter' },
    ])
    expect(seen[0]?.text).not.toContain('limit 1')
  })

  it('loads the personal publisher display name from the active completed profile', async () => {
    const repository = createHiringRepository({
      query: async () => [{ profile_id: 'user-1', profile_name: 'Asha Singh' }],
    })

    await expect(repository.getPersonalPublisher('user-1')).resolves.toEqual({
      profileId: 'user-1',
      name: 'Asha Singh',
    })
  })

  it('authorizes management of a personal job by its creator without a company membership', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const query = async (text: string, values?: readonly unknown[]) => {
      seen.push({ text, values })
      if (text.includes('select j.id, j.company_id') && text.includes('created_by_user_id')) {
        return [{ id: 'job-1', company_id: null, created_by_user_id: 'user-1' }]
      }
      return []
    }
    const repository = createHiringRepository({ query, transaction: async (work) => work(query) })

    await expect(repository.updateJob('user-1', 'job-1', {
      ...personalJob(),
      publisherType: undefined as never,
      companyId: undefined as never,
      title: 'Senior Marine Superintendent',
    })).resolves.toBeUndefined()

    expect(seen[0]?.text).toContain('j.company_id is null')
    expect(seen[0]?.text).toContain('j.created_by_user_id = $2')
  })

  it('lists personal and organization jobs together for the hiring workspace', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const repository = createHiringRepository({
      query: async (text, values) => {
        seen.push({ text, values })
        return [{
          id: 'job-1',
          title: 'Marine Superintendent',
          status: 'published',
          job_domain: 'shore',
          rank: null,
          vessel_types: [],
          location: 'Mumbai',
          urgent: false,
          apply_until: null,
          published_at: '2026-09-25T00:00:00.000Z',
          applicant_count: '4',
          company_id: null,
          publisher_name: 'Asha Singh',
        }]
      },
    })

    await expect(repository.listManagedJobs('user-1')).resolves.toEqual([expect.objectContaining({
      id: 'job-1',
      companyId: null,
      publisherName: 'Asha Singh',
      applicantCount: 4,
    })])
    expect(seen[0]?.text).toContain('j.created_by_user_id = $1')
    expect(seen[0]?.text).toContain('public.company_members')
  })

  it('loads a personal vacancy for editing by its creator without requiring a company id', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const repository = createHiringRepository({
      query: async (text, values) => {
        seen.push({ text, values })
        return [{
          id: 'job-1',
          company_id: null,
          title: 'Marine Superintendent',
          status: 'draft',
          job_domain: 'shore',
          department: 'Marine',
          rank: null,
          vessel_types: [],
          location: 'Mumbai',
          sailing_regions: ['India'],
          summary: 'Independent recruiter opportunity.',
          description: 'Hiring an experienced marine superintendent.',
          requirements: null,
          experience_min_years: '8',
          experience_max_years: null,
          joining_from: null,
          joining_until: null,
          salary_min: null,
          salary_max: null,
          salary_currency: null,
          salary_period: null,
          urgent: false,
          easy_apply: true,
          apply_until: null,
          certificates: [],
          visas: [],
        }]
      },
    })

    await expect(repository.getEditableJob('user-1', null, 'job-1')).resolves.toMatchObject({
      id: 'job-1',
      companyId: null,
      title: 'Marine Superintendent',
    })
    expect(seen[0]?.text).toContain('j.company_id is null')
    expect(seen[0]?.text).toContain('j.created_by_user_id = $1')
  })

  it('authorizes application management for a personal vacancy creator without company membership', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const query = async (text: string, values?: readonly unknown[]) => {
      seen.push({ text, values })
      if (text.includes('select a.id') && text.includes('created_by_user_id')) {
        return [{ id: 'application-1', company_id: null, created_by_user_id: 'user-1' }]
      }
      return []
    }
    const repository = createHiringRepository({ query, transaction: async (work) => work(query) })

    await expect(repository.updateApplicationStatus('user-1', 'application-1', 'shortlisted', 'Strong fit')).resolves.toBeUndefined()
    expect(seen[0]?.text).toContain('j.company_id is null')
    expect(seen[0]?.text).toContain('j.created_by_user_id = $2')
    expect(seen.some((entry) => entry.text.includes('insert into public.job_application_events'))).toBe(true)
  })

})
