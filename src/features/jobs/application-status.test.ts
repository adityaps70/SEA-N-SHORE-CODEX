import { describe, expect, it } from 'vitest'
import {
  HIRING_APPLICATION_STATUS_LABELS,
  HIRING_PIPELINE_STATUSES,
  OWNER_SETTABLE_APPLICATION_STATUSES,
  validateApplicationStatusChange,
} from './application-status'
import { JOB_APPLICATION_STATUSES, JOB_APPLICATION_STATUS_LABELS } from './types'

describe('applicant status mapping', () => {
  it('maps the owner stages New, Reviewed, Shortlisted, Rejected and Hired onto existing statuses', () => {
    expect(HIRING_APPLICATION_STATUS_LABELS).toMatchObject({
      applied: 'New',
      under_review: 'Reviewed',
      shortlisted: 'Shortlisted',
      selected: 'Hired',
      rejected: 'Rejected',
    })
    expect([...HIRING_PIPELINE_STATUSES].sort()).toEqual([...JOB_APPLICATION_STATUSES].sort())
  })

  it('keeps applicant-facing wording gentle', () => {
    expect(JOB_APPLICATION_STATUS_LABELS.rejected).toBe('Not selected')
    expect(JOB_APPLICATION_STATUS_LABELS.applied).toBe('Applied')
  })

  it('lets owners move applications between hiring stages, but never back to New or to Withdrawn', () => {
    expect(OWNER_SETTABLE_APPLICATION_STATUSES).toEqual(['under_review', 'shortlisted', 'interview', 'selected', 'rejected'])
    expect(validateApplicationStatusChange('applied', 'under_review')).toEqual({ ok: true })
    expect(validateApplicationStatusChange('rejected', 'shortlisted')).toEqual({ ok: true })
    expect(validateApplicationStatusChange('shortlisted', 'applied')).toMatchObject({ ok: false })
    expect(validateApplicationStatusChange('shortlisted', 'withdrawn')).toMatchObject({ ok: false })
    expect(validateApplicationStatusChange('shortlisted', 'shortlisted')).toMatchObject({ ok: false, message: expect.stringMatching(/already marked Shortlisted/) })
    expect(validateApplicationStatusChange('withdrawn', 'selected')).toMatchObject({ ok: false, message: expect.stringMatching(/withdrew/) })
  })
})
