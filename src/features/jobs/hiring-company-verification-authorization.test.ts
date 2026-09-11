import { describe, expect, it } from 'vitest'
import { createHiringRepository } from './hiring-repository'

const hiringRoles = ['owner', 'administrator', 'recruiter']

describe('hiring company verification authorization', () => {
  it('requires the company itself to remain verified before an approved hiring member is authorized', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const repository = createHiringRepository({
      query: async (text, values) => {
        seen.push({ text, values })
        return []
      },
    })

    await expect(repository.getAuthorizedCompany('user-1', 'company-1')).resolves.toBeNull()

    expect(seen[0]?.text).toContain('cm.approved_at is not null')
    expect(seen[0]?.text).toContain("cm.role::text = any($2::text[])")
    expect(seen[0]?.text).toContain('c.is_verified = true')
    expect(seen[0]?.values).toEqual(['user-1', hiringRoles, 'company-1'])
  })

  it('requires verified-company authorization in company-scoped dashboard and vacancy queries', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const repository = createHiringRepository({
      query: async (text, values) => {
        seen.push({ text, values })
        return []
      },
    })

    await repository.getDashboardMetrics('user-1', 'company-1')
    await repository.listCompanyJobs('user-1', 'company-1')

    expect(seen[0]?.text).toContain('public.companies')
    expect(seen[0]?.text).toContain('is_verified = true')
    expect(seen[1]?.text).toContain('public.companies')
    expect(seen[1]?.text).toContain('is_verified = true')
  })
})
