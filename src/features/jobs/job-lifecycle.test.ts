import { describe, expect, it } from 'vitest'
import {
  JOB_LIFECYCLE_TRANSITIONS,
  availableJobActions,
  isApplyUntilOpen,
  isIsoDate,
  jobStatusPresentation,
  todayIsoDate,
  validateApplyUntilForStatus,
  validateJobTransition,
  type JobLifecycleAction,
  type JobLifecycleSnapshot,
  type JobListingStatus,
} from './job-lifecycle'

const today = '2026-09-27'

function snapshot(overrides: Partial<JobLifecycleSnapshot> = {}): JobLifecycleSnapshot {
  return {
    status: 'draft',
    deleted: false,
    moderationRemoved: false,
    applyUntil: null,
    joiningUntil: null,
    applicantCount: 0,
    canDelete: true,
    ...overrides,
  }
}

const STATUSES: JobListingStatus[] = ['draft', 'published', 'closed']
const ACTIONS: JobLifecycleAction[] = ['publish', 'archive', 'republish', 'delete']

describe('job lifecycle state machine', () => {
  it('allows exactly Draft→Published, Published→Archived, Archived→Published and Draft/Archived→Deleted', () => {
    const allowed: string[] = []
    for (const status of STATUSES) {
      for (const action of ACTIONS) {
        const result = validateJobTransition(snapshot({ status }), action, { today })
        if (result.ok) allowed.push(`${status}:${action}->${result.to}`)
      }
    }
    expect(allowed.sort()).toEqual([
      'closed:delete->closed',
      'closed:republish->published',
      'draft:delete->closed',
      'draft:publish->published',
      'published:archive->closed',
    ])
  })

  it('explains every refused transition in plain words', () => {
    for (const status of STATUSES) {
      for (const action of ACTIONS) {
        if (JOB_LIFECYCLE_TRANSITIONS[action].from.includes(status)) continue
        const result = validateJobTransition(snapshot({ status }), action, { today })
        expect(result).toMatchObject({ ok: false, code: 'transition_not_allowed' })
        if (!result.ok) expect(result.message.length).toBeGreaterThan(10)
      }
    }
    expect(validateJobTransition(snapshot({ status: 'published' }), 'delete', { today })).toMatchObject({
      ok: false,
      message: expect.stringMatching(/archive this job before deleting/i),
    })
  })

  it('never changes a deleted job', () => {
    for (const action of ACTIONS) {
      expect(validateJobTransition(snapshot({ status: 'closed', deleted: true }), action, { today })).toMatchObject({ ok: false, code: 'job_deleted' })
    }
    expect(availableJobActions(snapshot({ status: 'closed', deleted: true }))).toEqual([])
  })

  it('requires delete permission', () => {
    expect(validateJobTransition(snapshot({ status: 'draft', canDelete: false }), 'delete', { today })).toMatchObject({ ok: false, code: 'delete_forbidden' })
    expect(availableJobActions(snapshot({ status: 'draft', canDelete: false }))).toEqual(['publish'])
  })

  it('republishes an archived job only with a valid apply-by date (or none)', () => {
    const archived = snapshot({ status: 'closed', applyUntil: '2026-09-01' })
    expect(validateJobTransition(archived, 'republish', { today })).toMatchObject({ ok: false, code: 'apply_until_past' })
    expect(validateJobTransition(archived, 'republish', { today, applyUntil: '2026-10-15' })).toEqual({
      ok: true, action: 'republish', to: 'published', applyUntil: '2026-10-15',
    })
    expect(validateJobTransition(archived, 'republish', { today, applyUntil: null })).toEqual({
      ok: true, action: 'republish', to: 'published', applyUntil: null,
    })
    expect(validateJobTransition(archived, 'republish', { today, applyUntil: today })).toMatchObject({ ok: true })
    expect(validateJobTransition(archived, 'republish', { today, applyUntil: '2026-02-30' })).toMatchObject({ ok: false, code: 'apply_until_invalid' })
  })

  it('keeps a valid apply-by date when none is supplied', () => {
    expect(validateJobTransition(snapshot({ applyUntil: '2026-12-01' }), 'publish', { today })).toMatchObject({ ok: true, applyUntil: '2026-12-01' })
  })

  it('does not block publishing on a legacy joining-until value that is no longer editable', () => {
    expect(validateJobTransition(snapshot({ joiningUntil: '2026-09-01' }), 'publish', { today })).toMatchObject({ ok: true })
  })

  it('never lets a moderation-removed job go live again but still allows deleting it', () => {
    const removed = snapshot({ status: 'closed', moderationRemoved: true })
    expect(validateJobTransition(removed, 'republish', { today })).toMatchObject({ ok: false, code: 'moderation_removed' })
    expect(availableJobActions(removed)).toEqual(['delete'])
  })

  it('offers only the buttons for allowed transitions', () => {
    expect(availableJobActions(snapshot({ status: 'draft' }))).toEqual(['publish', 'delete'])
    expect(availableJobActions(snapshot({ status: 'published' }))).toEqual(['archive'])
    expect(availableJobActions(snapshot({ status: 'closed' }))).toEqual(['republish', 'delete'])
    expect(availableJobActions(snapshot({ status: 'closed', applyUntil: '2020-01-01' }))).toEqual(['republish', 'delete'])
  })

  it('validates apply-by dates when details are saved', () => {
    expect(validateApplyUntilForStatus('published', '2026-09-01', today)).toMatchObject({ ok: false })
    expect(validateApplyUntilForStatus('published', null, today)).toEqual({ ok: true })
    expect(validateApplyUntilForStatus('draft', '2026-09-01', today)).toEqual({ ok: true })
    expect(validateApplyUntilForStatus('closed', '2026-09-01', today)).toEqual({ ok: true })
    expect(validateApplyUntilForStatus('draft', 'soon', today)).toMatchObject({ ok: false })
  })

  it('describes each state for the hiring workspace', () => {
    expect(jobStatusPresentation(snapshot({ status: 'draft' }), today).key).toBe('draft')
    expect(jobStatusPresentation(snapshot({ status: 'published' }), today)).toMatchObject({ key: 'live', label: 'Live' })
    expect(jobStatusPresentation(snapshot({ status: 'published', applyUntil: '2026-09-01' }), today)).toMatchObject({ key: 'expired', label: 'Applications closed' })
    expect(jobStatusPresentation(snapshot({ status: 'closed' }), today)).toMatchObject({ key: 'archived', label: 'Archived' })
    expect(jobStatusPresentation(snapshot({ status: 'closed', moderationRemoved: true }), today).key).toBe('removed')
    expect(jobStatusPresentation(snapshot({ status: 'closed', deleted: true }), today).key).toBe('deleted')
  })

  it('handles dates as calendar days', () => {
    expect(todayIsoDate(new Date('2026-09-27T23:30:00.000Z'))).toBe('2026-09-27')
    expect(isIsoDate('2026-09-27')).toBe(true)
    expect(isIsoDate('2026-13-01')).toBe(false)
    expect(isApplyUntilOpen(null, today)).toBe(true)
    expect(isApplyUntilOpen(today, today)).toBe(true)
    expect(isApplyUntilOpen('2026-09-26', today)).toBe(false)
  })
})
