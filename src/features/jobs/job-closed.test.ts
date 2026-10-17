import { describe, expect, it } from 'vitest'
import { JOB_CLOSED_LABELS, isJoiningWindowOpen, jobClosedReason } from './job-lifecycle'
import { JOB_ACCEPTING_SQL, LIVE_JOB_SQL } from './repository'

describe('jobs close by themselves (Round H, H2)', () => {
  const today = '2026-10-17'

  it('closes a job once its joining date has passed ("Joining Oct 15" on 17 Oct)', () => {
    expect(jobClosedReason({ applyUntil: null, joiningFrom: '2026-10-15', joiningUntil: null }, today)).toBe('joining_passed')
    expect(JOB_CLOSED_LABELS.joining_passed).toBe('Joining date passed')
  })

  it('uses the end of a joining window when there is one', () => {
    expect(isJoiningWindowOpen('2026-10-10', '2026-10-20', today)).toBe(true)
    expect(isJoiningWindowOpen('2026-10-10', '2026-10-16', today)).toBe(false)
    expect(isJoiningWindowOpen(null, null, today)).toBe(true)
    expect(isJoiningWindowOpen('2026-10-17', null, today)).toBe(true)
  })

  it('still closes on a passed apply-by date, and stays open otherwise', () => {
    expect(jobClosedReason({ applyUntil: '2026-10-16', joiningFrom: '2026-11-01', joiningUntil: null }, today)).toBe('apply_by_passed')
    expect(jobClosedReason({ applyUntil: '2026-10-17', joiningFrom: '2026-11-01', joiningUntil: null }, today)).toBeNull()
  })

  it('leaves such jobs out of what members can apply to, and out of the admin count', () => {
    expect(JOB_ACCEPTING_SQL).toContain('coalesce(j.joining_until, j.joining_from) >= current_date')
    expect(JOB_ACCEPTING_SQL).toContain('j.apply_until >= current_date')
    expect(LIVE_JOB_SQL).toContain("j.status = 'published'")
    expect(LIVE_JOB_SQL).toContain('j.deleted_at is null')
    expect(LIVE_JOB_SQL).toContain(JOB_ACCEPTING_SQL)
  })
})
