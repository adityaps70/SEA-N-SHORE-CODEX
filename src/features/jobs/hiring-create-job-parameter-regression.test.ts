import { describe, expect, it } from 'vitest'
import { createHiringRepository, type HiringJobInput } from './hiring-repository'

const HIRING_ROLE_VALUES = ['owner', 'administrator', 'recruiter']

const companyRow = {
  company_id: 'company-1',
  company_slug: 'oceanic',
  company_name: 'Oceanic',
  company_verified: true,
  role: 'owner',
}

const input: HiringJobInput = {
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
}

describe('createJob PostgreSQL enum parameter regression', () => {
  it('types the reused status parameter consistently without weakening company authorization', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const query = async (text: string, values?: readonly unknown[]) => {
      seen.push({ text, values })
      if (text.includes('from public.companies c')) return [companyRow]
      if (text.includes('insert into public.jobs')) return [{ id: 'job-1' }]
      return []
    }
    const repository = createHiringRepository({ query, transaction: async (work) => work(query) })

    await expect(repository.createJob('user-1', input)).resolves.toBe('job-1')

    const authorization = seen.find((entry) => entry.text.includes('from public.companies c'))
    expect(authorization?.text).toContain('cm.approved_at is not null')
    expect(authorization?.text).toContain('cm.role::text = any($2::text[])')
    expect(authorization?.text).toContain('c.is_verified = true')
    expect(authorization?.text).not.toContain('profile_type')
    expect(authorization?.values).toEqual(['user-1', HIRING_ROLE_VALUES, 'company-1'])

    const insert = seen.find((entry) => entry.text.includes('insert into public.jobs'))
    expect(insert?.text).toContain('$10::public.job_listing_status')
    expect(insert?.text).toContain("case when $10::public.job_listing_status = 'published'::public.job_listing_status then now() else null end")
  })
})
