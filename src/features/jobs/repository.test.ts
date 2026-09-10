import { describe, expect, it } from 'vitest'
import { parseJobSearchParams } from './search'
import { createJobsRepository } from './repository'

describe('jobs repository', () => {
  it('lists only published and unexpired jobs newest first', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const repository = createJobsRepository({ query: async (text, values) => { seen.push({ text, values }); return [] } })

    await repository.listPublishedJobs(20)

    expect(seen[0]?.text).toContain("j.status = 'published'")
    expect(seen[0]?.text).toContain('(j.apply_until is null or j.apply_until >= current_date)')
    expect(seen[0]?.text).toContain('order by j.created_at desc, j.id desc')
    expect(seen[0]?.values).toEqual([20])
  })

  it('builds structured PostgreSQL discovery filters and maps maritime job intelligence', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const repository = createJobsRepository({
      query: async (text, values) => {
        seen.push({ text, values })
        return [{
          id: 'job-1', title: 'Chief Officer', company_name: 'Oceanic', company_id: 'company-1',
          company_slug: 'oceanic', company_verified: true, recruiter_verified: true, location: 'Worldwide',
          summary: 'Tanker opening', description: 'Join us', requirements: 'Tanker experience', apply_until: '2026-10-01',
          created_at: '2026-09-10T10:00:00.000Z', published_at: '2026-09-10T10:00:00.000Z', job_domain: 'sea',
          department: 'Deck', rank: 'Chief Officer', vessel_types: ['Oil Tanker'], experience_min_years: '4.0',
          experience_max_years: null, joining_from: '2026-09-20', joining_until: '2026-09-30', salary_min: '7800.00',
          salary_max: '8400.00', salary_currency: 'USD', salary_period: 'month', sailing_regions: ['Worldwide'],
          urgent: true, easy_apply: true, certificate_requirements: ['STCW'], visa_requirements: ['US C1/D'],
        }]
      },
    })

    const filters = parseJobSearchParams({
      mode: 'sea', rank: 'Chief Officer', vessel: 'Oil Tanker', experience: '5', joining: '7',
      salaryMin: '7000', region: 'Worldwide', certificate: 'STCW', visa: 'US C1/D', verified: '1', urgent: '1',
    })
    const jobs = await repository.searchJobs(filters, 40, 0)

    expect(seen[0]?.text).toContain("j.job_domain = 'sea'")
    expect(seen[0]?.text).toContain('j.vessel_types &&')
    expect(seen[0]?.text).toContain('c.is_verified')
    expect(seen[0]?.text).toContain('j.urgent = true')
    expect(seen[0]?.text).toContain('job_certificate_requirements')
    expect(seen[0]?.text).toContain('job_visa_requirements')
    expect(seen[0]?.values).toContain(40)
    expect(jobs[0]).toMatchObject({
      id: 'job-1', companyId: 'company-1', companySlug: 'oceanic', companyVerified: true,
      recruiterVerified: true, domain: 'sea', rank: 'Chief Officer', vesselTypes: ['Oil Tanker'],
      experienceMinYears: 4, salaryMin: 7800, certificateRequirements: ['STCW'], visaRequirements: ['US C1/D'],
      urgent: true, easyApply: true,
    })
  })

  it('loads the candidate match profile from existing maritime profile, skills, credentials and visas', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const repository = createJobsRepository({
      query: async (text, values) => {
        seen.push({ text, values })
        return [{
          rank: 'Chief Officer', sailing_experience_years: '7.5', vessel_types: ['Oil Tanker'], trading_areas: ['Worldwide'],
          availability: '2026-09-18', shore_career_preference: false, skills: ['Leadership'],
          credentials: [{ name: 'STCW', expires_at: '2028-01-01', verified: true }], visas: ['US C1/D'],
        }]
      },
    })

    await expect(repository.getCandidateProfile('viewer-1')).resolves.toEqual({
      rank: 'Chief Officer', sailingExperienceYears: 7.5, vesselTypes: ['Oil Tanker'], tradingAreas: ['Worldwide'],
      availability: '2026-09-18', shoreCareerPreference: false, skills: ['Leadership'],
      certificates: [{ name: 'STCW', expiresAt: '2028-01-01', verified: true }], visas: ['US C1/D'],
    })
    expect(seen[0]?.text).toContain('public.maritime_profiles')
    expect(seen[0]?.text).toContain('public.profile_skills')
    expect(seen[0]?.text).toContain('public.profile_credentials')
    expect(seen[0]?.text).toContain('public.profile_visas')
    expect(seen[0]?.values).toEqual(['viewer-1'])
  })

  it('scopes applications to the signed-in applicant, includes immutable status events and orders newest first', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const repository = createJobsRepository({ query: async (text, values) => { seen.push({ text, values }); return [] } })

    await repository.listApplications('viewer-1', 50)

    expect(seen[0]?.text).toContain('a.applicant_id = $1')
    expect(seen[0]?.text).toContain('job_application_events')
    expect(seen[0]?.text).toContain('order by a.applied_at desc, a.id desc')
    expect(seen[0]?.values).toEqual(['viewer-1', 50])
  })

  it('requires an active onboarded profile before an application can be submitted', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const repository = createJobsRepository({ query: async (text, values) => { seen.push({ text, values }); return [{ ready: true }] } })

    await expect(repository.isMemberReady('viewer-1')).resolves.toBe(true)
    expect(seen[0]?.text).toContain("p.account_status = 'active'")
    expect(seen[0]?.text).toContain('p.onboarding_completed_at is not null')
    expect(seen[0]?.values).toEqual(['viewer-1'])
  })

  it('creates the application and its first timeline event atomically', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const repository = createJobsRepository({ query: async (text, values) => { seen.push({ text, values }); return [] } })

    await repository.createApplication('job-1', 'viewer-1')

    expect(seen[0]?.text).toContain("values ($1, $2, 'applied')")
    expect(seen[0]?.text).toContain('job_application_events')
    expect(seen[0]?.values).toEqual(['job-1', 'viewer-1'])
  })

  it('keeps saves, alerts and reports scoped to the signed-in member', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const repository = createJobsRepository({ query: async (text, values) => { seen.push({ text, values }); return [] } })

    await repository.saveJob('job-1', 'viewer-1')
    await repository.unsaveJob('job-1', 'viewer-1')
    await repository.createJobAlert('viewer-1', 'Chief Officer tanker', parseJobSearchParams({ mode: 'sea', rank: 'Chief Officer' }), 'daily')
    await repository.reportJob('job-1', 'viewer-1', 'fake_company', 'Company identity looks suspicious')

    expect(seen[0]?.text).toContain('insert into public.job_saves')
    expect(seen[0]?.text).toContain('on conflict (job_id, user_id) do nothing')
    expect(seen[1]?.text).toContain('delete from public.job_saves')
    expect(seen[1]?.text).toContain('job_id = $1 and user_id = $2')
    expect(seen[2]?.text).toContain('insert into public.job_alerts')
    expect(seen[2]?.values?.[0]).toBe('viewer-1')
    expect(seen[3]?.text).toContain('insert into public.job_reports')
    expect(seen[3]?.values).toEqual(['job-1', 'viewer-1', 'fake_company', 'Company identity looks suspicious'])
  })
})
