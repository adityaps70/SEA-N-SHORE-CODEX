import { describe, expect, it } from 'vitest'
import { createJobsRepository, LIVE_JOB_SQL } from './repository'

type Seen = Array<{ text: string; values?: readonly unknown[] }>

describe('jobs repository: job page extras (Round H, H7)', () => {
  it('counts applicants read-only, leaving withdrawn applications out', async () => {
    const seen: Seen = []
    const repository = createJobsRepository({ query: async (text, values) => { seen.push({ text, values }); return [{ applicant_count: '12' }] } })

    await expect(repository.countJobApplicants('job-1')).resolves.toBe(12)
    expect(seen[0]?.text).toMatch(/^select count\(\*\)/)
    expect(seen[0]?.text).toContain('from public.job_applications a')
    expect(seen[0]?.text).toContain("a.status::text <> 'withdrawn'")
    expect(seen[0]?.values).toEqual(['job-1'])
  })

  it('counts no applicants when the query returns nothing', async () => {
    const repository = createJobsRepository({ query: async () => [] })
    await expect(repository.countJobApplicants('job-1')).resolves.toBe(0)
  })

  it('lists up to four live similar jobs: same rank first, then department, then vessel type, never the job itself', async () => {
    const seen: Seen = []
    const repository = createJobsRepository({ query: async (text, values) => { seen.push({ text, values }); return [] } })

    await repository.listSimilarJobs({
      id: 'job-1',
      acceptedRoleKeys: ['chief_officer'],
      rank: ' Chief Officer ',
      departmentKey: 'deck_officers',
      department: null,
      vesselTypes: ['Oil Tanker'],
    })

    const text = seen[0]!.text
    expect(text).toContain(LIVE_JOB_SQL)
    expect(text).toContain('j.id <> $1')
    expect(text).toMatch(/^with similar_jobs as \(/)
    expect(text).toContain('where s.same_role or s.same_department or s.same_vessel')
    expect(text).toMatch(/order by s\.same_role desc, s\.same_department desc, s\.same_vessel desc,\s+coalesce\(j\.published_at, j\.created_at\) desc/)
    expect(seen[0]?.values).toEqual(['job-1', ['chief_officer'], 'Chief Officer', 'deck_officers', null, ['Oil Tanker'], 4])
  })

  it('caps the limit and copes with an older job without rank keys', async () => {
    const seen: Seen = []
    const repository = createJobsRepository({ query: async (text, values) => { seen.push({ text, values }); return [] } })
    await repository.listSimilarJobs({ id: 'job-2', rank: null, department: 'Deck', vesselTypes: [] }, 50)
    expect(seen[0]?.values).toEqual(['job-2', [], null, null, 'Deck', [], 12])
  })
})
