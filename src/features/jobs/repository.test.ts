import { describe, expect, it } from 'vitest'
import { createJobsRepository } from './repository'

describe('jobs repository', () => {
  it('lists only published and unexpired jobs newest first', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const repository = createJobsRepository({
      query: async (text, values) => {
        seen.push({ text, values })
        return []
      },
    })

    await repository.listPublishedJobs(20)

    expect(seen[0]?.text).toContain("j.status = 'published'")
    expect(seen[0]?.text).toContain('(j.apply_until is null or j.apply_until >= current_date)')
    expect(seen[0]?.text).toContain('order by j.created_at desc, j.id desc')
    expect(seen[0]?.values).toEqual([20])
  })

  it('scopes applications to the signed-in applicant and orders newest first', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const repository = createJobsRepository({
      query: async (text, values) => {
        seen.push({ text, values })
        return []
      },
    })

    await repository.listApplications('viewer-1', 50)

    expect(seen[0]?.text).toContain('a.applicant_id = $1')
    expect(seen[0]?.text).toContain('order by a.applied_at desc, a.id desc')
    expect(seen[0]?.values).toEqual(['viewer-1', 50])
  })

  it('requires an active onboarded profile before an application can be submitted', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const repository = createJobsRepository({
      query: async (text, values) => {
        seen.push({ text, values })
        return [{ ready: true }]
      },
    })

    await expect(repository.isMemberReady('viewer-1')).resolves.toBe(true)

    expect(seen[0]?.text).toContain("p.account_status = 'active'")
    expect(seen[0]?.text).toContain('p.onboarding_completed_at is not null')
    expect(seen[0]?.values).toEqual(['viewer-1'])
  })

  it('creates an application with applied status', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const repository = createJobsRepository({
      query: async (text, values) => {
        seen.push({ text, values })
        return []
      },
    })

    await repository.createApplication('job-1', 'viewer-1')

    expect(seen[0]?.text).toContain("values ($1, $2, 'applied')")
    expect(seen[0]?.values).toEqual(['job-1', 'viewer-1'])
  })
})
