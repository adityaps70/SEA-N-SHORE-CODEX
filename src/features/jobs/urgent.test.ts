import { describe, expect, it } from 'vitest'
import { URGENT_DAYS, URGENT_LIMIT_MESSAGE, URGENT_LIMIT_PER_COMPANY, urgentActiveSql, urgentWindow, urgentWindowLabel } from './urgent'

describe('urgent jobs (round H, H7)', () => {
  const now = new Date('2026-10-10T06:00:00.000Z')

  it('lasts 14 days from urgent_since', () => {
    expect(URGENT_DAYS).toBe(14)
    expect(urgentWindow(true, '2026-10-03T06:00:00.000Z', now)).toEqual({
      active: true,
      since: new Date('2026-10-03T06:00:00.000Z'),
      endsAt: new Date('2026-10-17T06:00:00.000Z'),
    })
    expect(urgentWindow(true, '2026-09-20T06:00:00.000Z', now)?.active).toBe(false)
    expect(urgentWindow(false, '2026-10-03T06:00:00.000Z', now)).toBeNull()
    expect(urgentWindow(true, null, now)).toBeNull()
    expect(urgentWindow(true, 'not a date', now)).toBeNull()
  })

  it('tells the poster when urgent started and ends', () => {
    expect(urgentWindowLabel(true, '2026-10-03T06:00:00.000Z', now)).toBe('Urgent since 3 Oct · ends 17 Oct')
    expect(urgentWindowLabel(true, '2026-09-20T06:00:00.000Z', now)).toBe('Urgent ended 4 Oct')
    expect(urgentWindowLabel(false, null, now)).toBeNull()
  })

  it('limits each organization to 2 live urgent jobs with a friendly message', () => {
    expect(URGENT_LIMIT_PER_COMPANY).toBe(2)
    expect(URGENT_LIMIT_MESSAGE).toContain('already has 2 live urgent jobs')
    expect(urgentActiveSql('job')).toBe("(job.urgent and job.urgent_since is not null and job.urgent_since > now() - interval '14 days')")
  })
})
