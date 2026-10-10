import { describe, expect, it } from 'vitest'
import { attendanceRuleMet, attendanceSummary, joinState, learnerSessionStatus, reminderStageDue, seriesInputSchema, seriesOccurrences, sessionInputSchema } from './session-rules'

const series = { title: 'Evening class', weekdays: [1, 3], time: '19:00', timeZone: 'Asia/Kolkata', firstDate: '2026-11-02', weekCount: 6, durationMinutes: 60, meetingUrl: 'https://zoom.us/j/123' }

describe('live session rules (round D, D2)', () => {
  it('makes a Mon/Wed 19:00 IST series for 6 weeks: 12 numbered sessions at 13:30 UTC', () => {
    const occurrences = seriesOccurrences(series)!
    expect(occurrences).toHaveLength(12)
    expect(occurrences[0]).toEqual({ title: 'Evening class · 1', startsAt: new Date('2026-11-02T13:30:00Z') })
    expect(occurrences[1]!.startsAt.toISOString()).toBe('2026-11-04T13:30:00.000Z')
    expect(occurrences[11]!.title).toBe('Evening class · 12')
  })

  it('keeps the local time across a daylight-saving change and refuses a series that is too long', () => {
    const newYork = seriesOccurrences({ ...series, timeZone: 'America/New_York', firstDate: '2026-10-26', weekdays: [1], weekCount: 2 })!
    expect(newYork.map((occurrence) => occurrence.startsAt.toISOString())).toEqual(['2026-10-26T23:00:00.000Z', '2026-11-03T00:00:00.000Z'])
    expect(seriesOccurrences({ ...series, weekdays: [1, 2, 3, 4, 5, 6, 7], weekCount: 52 })).toBeNull()
  })

  it('accepts any https meeting link and refuses others, with plain messages', () => {
    const one = { title: 'Kick-off', description: null, date: '2026-11-02', time: '19:00', timeZone: 'Asia/Kolkata', durationMinutes: 90, meetingUrl: 'https://meet.google.com/abc-defg-hij' }
    expect(sessionInputSchema.safeParse(one).success).toBe(true)
    expect(sessionInputSchema.safeParse({ ...one, meetingUrl: 'http://example.com' }).error?.issues[0]?.message).toMatch(/starting with https/)
    expect(sessionInputSchema.safeParse({ ...one, durationMinutes: 2 }).error?.issues[0]?.message).toBe('A session lasts at least 5 minutes.')
    expect(seriesInputSchema.safeParse({ ...series, weekdays: [] }).error?.issues[0]?.message).toBe('Choose at least one day of the week.')
  })

  it('opens Join from 15 minutes before the start until the end', () => {
    const session = { startsAt: '2026-11-02T13:30:00Z', durationMinutes: 60, status: 'scheduled' as const, meetingUrl: 'https://zoom.us/j/1' }
    expect(joinState(session, new Date('2026-11-02T13:10:00Z'))).toBe('not_yet')
    expect(joinState(session, new Date('2026-11-02T13:16:00Z'))).toBe('open')
    expect(joinState(session, new Date('2026-11-02T14:29:00Z'))).toBe('open')
    expect(joinState(session, new Date('2026-11-02T14:31:00Z'))).toBe('ended')
    expect(joinState({ ...session, meetingUrl: null }, new Date('2026-11-02T13:20:00Z'))).toBe('no_link')
    expect(joinState({ ...session, status: 'cancelled' }, new Date('2026-11-02T13:20:00Z'))).toBe('cancelled')
  })

  it('counts attendance without excused sessions; a join counts as present until marked', () => {
    const records = [
      { startsAt: '2026-11-02T13:30:00Z', status: 'scheduled' as const, mark: 'present' as const, joined: true },
      { startsAt: '2026-11-04T13:30:00Z', status: 'scheduled' as const, mark: null, joined: true },
      { startsAt: '2026-11-09T13:30:00Z', status: 'scheduled' as const, mark: 'excused' as const, joined: false },
      { startsAt: '2026-11-11T13:30:00Z', status: 'scheduled' as const, mark: 'absent' as const, joined: true },
      { startsAt: '2026-11-16T13:30:00Z', status: 'cancelled' as const, mark: null, joined: false },
    ]
    const summary = attendanceSummary(records)
    expect(summary).toEqual({ attended: 2, total: 3, percent: 66 })
    expect(attendanceRuleMet(66, summary)).toBe(true)
    expect(attendanceRuleMet(67, summary)).toBe(false)
    expect(attendanceRuleMet(null, summary)).toBe(true)
    expect(attendanceRuleMet(80, { attended: 0, total: 0 })).toBe(true)
  })

  it('names the learner status of a session', () => {
    const session = { startsAt: '2026-11-02T13:30:00Z', durationMinutes: 60, status: 'scheduled' as const }
    expect(learnerSessionStatus(session, null, false, new Date('2026-11-01T00:00:00Z'))).toBe('Upcoming')
    expect(learnerSessionStatus(session, null, true, new Date('2026-11-02T13:40:00Z'))).toBe('Joined')
    expect(learnerSessionStatus(session, null, false, new Date('2026-11-03T00:00:00Z'))).toBe('Absent')
    expect(learnerSessionStatus(session, 'excused', false, new Date('2026-11-03T00:00:00Z'))).toBe('Excused')
  })

  it('sends the 24-hour reminder from a day before and the 1-hour one in the last hour', () => {
    const start = '2026-11-02T13:30:00Z'
    expect(reminderStageDue(start, new Date('2026-11-01T13:00:00Z'))).toBeNull()
    expect(reminderStageDue(start, new Date('2026-11-01T13:31:00Z'))).toBe('24h')
    expect(reminderStageDue(start, new Date('2026-11-02T12:29:00Z'))).toBe('24h')
    expect(reminderStageDue(start, new Date('2026-11-02T12:31:00Z'))).toBe('1h')
    expect(reminderStageDue(start, new Date('2026-11-02T13:31:00Z'))).toBeNull()
  })
})
