import { describe, expect, it } from 'vitest'
import { createHiringRepository } from './hiring-repository'

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
    expect(seen[0]?.values).toEqual(['user-1', ['owner', 'administrator', 'recruiter'], 'company-1'])
  })

  it('loads a recruiter dashboard with jobs and application funnel metrics scoped to that company', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const repository = createHiringRepository({ query: async (text, values) => { seen.push({ text, values }); return [{ active_jobs: '4', applicants: '128', shortlisted: '8', interviews: '3', selected: '1' }] } })

    await expect(repository.getDashboardMetrics('user-1', 'company-1')).resolves.toEqual({ activeJobs: 4, applicants: 128, shortlisted: 8, interviews: 3, selected: 1 })
    expect(seen[0]?.text).toContain('public.company_members cm')
    expect(seen[0]?.text).toContain('cm.user_id = $1')
    expect(seen[0]?.text).toContain('j.company_id = $3')
    expect(seen[0]?.values).toEqual(['user-1', ['owner', 'administrator', 'recruiter'], 'company-1'])
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

    await expect(repository.createJob('user-1', {
      companyId: 'company-1', title: 'Chief Officer', domain: 'sea', department: 'Deck', rank: 'Chief Officer',
      vesselTypes: ['Oil Tanker'], location: 'Worldwide', regions: ['Worldwide'], summary: 'Urgent tanker opening',
      description: 'Lead the deck team.', requirements: 'Tanker experience.', experienceMinYears: 4, experienceMaxYears: null,
      joiningFrom: '2026-09-20', joiningUntil: '2026-09-30', salaryMin: 7800, salaryMax: 8400, salaryCurrency: 'USD',
      salaryPeriod: 'month', urgent: true, easyApply: true, applyUntil: '2026-09-18', status: 'published',
      certificates: ['STCW'], visas: ['US C1/D'],
    })).resolves.toBe('job-1')

    const insert = seen.find((entry) => entry.text.includes('insert into public.jobs'))
    expect(insert?.text).toContain('company_name')
    expect(insert?.text).toContain('published_at')
    expect(insert?.values).toContain('Oceanic')
    expect(insert?.values).not.toContain('client-company-name')
    expect(seen.some((entry) => entry.text.includes('job_certificate_requirements'))).toBe(true)
    expect(seen.some((entry) => entry.text.includes('job_visa_requirements'))).toBe(true)
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

  it('keeps recruiter notes private to the authorized company hiring workflow', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const query = async (text: string, values?: readonly unknown[]) => {
      seen.push({ text, values })
      if (text.includes('select a.id')) return [{ id: 'application-1', company_id: 'company-1' }]
      return []
    }
    const repository = createHiringRepository({ query, transaction: async (work) => work(query) })

    await repository.saveRecruiterNote('user-1', 'application-1', 'Call after 1600 UTC.')

    expect(seen[0]?.text).toContain('public.company_members cm')
    expect(seen.some((entry) => entry.text.includes('insert into public.job_recruiter_notes'))).toBe(true)
    expect(seen.flatMap((entry) => entry.values ?? [])).toContain('Call after 1600 UTC.')
  })
})
