import { describe, expect, it } from 'vitest'
import { JOB_APPLICATION_STATUSES, JOB_APPLICATION_STATUS_LABELS } from './types'

describe('job application statuses', () => {
  it('keeps every approved status user-readable', () => {
    expect(JOB_APPLICATION_STATUSES).toEqual([
      'applied',
      'under_review',
      'shortlisted',
      'interview',
      'selected',
      'rejected',
      'withdrawn',
    ])
    expect(JOB_APPLICATION_STATUSES.map((status) => JOB_APPLICATION_STATUS_LABELS[status])).toEqual([
      'Applied',
      'Under review',
      'Shortlisted',
      'Interview',
      'Selected',
      'Rejected',
      'Withdrawn',
    ])
  })
})
