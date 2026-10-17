import { describe, expect, it, vi } from 'vitest'
import { createJobsQueries } from './queries'
import type { JobListing } from './types'

const job = { id: 'job-1', title: 'Chief Officer', vesselTypes: ['Oil Tanker'], rank: 'Chief Officer' } as JobListing

describe('getJobPageExtras (Round H, H7)', () => {
  it('loads the applicant count and similar jobs without asking who is signed in', async () => {
    const requireUser = vi.fn()
    const repository = {
      countJobApplicants: vi.fn().mockResolvedValue(14),
      listSimilarJobs: vi.fn().mockResolvedValue([{ ...job, id: 'job-2' }]),
    }
    const queries = createJobsQueries({ requireUser, repository: repository as never })

    await expect(queries.getJobPageExtras(job)).resolves.toEqual({ applicantCount: 14, similarJobs: [{ ...job, id: 'job-2' }] })
    expect(requireUser).not.toHaveBeenCalled()
    expect(repository.countJobApplicants).toHaveBeenCalledWith('job-1')
    expect(repository.listSimilarJobs).toHaveBeenCalledWith(job, 4)
  })

  it('hides a section whose read fails instead of failing the page', async () => {
    const repository = {
      countJobApplicants: vi.fn().mockRejectedValue(new Error('down')),
      listSimilarJobs: vi.fn().mockRejectedValue(new Error('down')),
    }
    const queries = createJobsQueries({ requireUser: vi.fn(), repository: repository as never })
    await expect(queries.getJobPageExtras(job)).resolves.toEqual({ applicantCount: null, similarJobs: [] })
  })
})
