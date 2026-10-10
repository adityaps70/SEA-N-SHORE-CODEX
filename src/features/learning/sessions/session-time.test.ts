import { describe, expect, it } from 'vitest'
import { addDays, formatZonedRange, formatZonedTime, isoWeekday, isValidTimeZone, utcToZonedInputs, zonedLocalToUtc } from './session-time'

describe('session times (round D)', () => {
  it('converts a local time in a zone to UTC, including India (no daylight saving)', () => {
    expect(zonedLocalToUtc('2026-10-13', '19:00', 'Asia/Kolkata')?.toISOString()).toBe('2026-10-13T13:30:00.000Z')
    expect(zonedLocalToUtc('2026-10-13', '19:00', 'UTC')?.toISOString()).toBe('2026-10-13T19:00:00.000Z')
  })

  it('handles daylight-saving changes: summer and winter offsets, a skipped hour and a repeated hour', () => {
    expect(zonedLocalToUtc('2026-07-01', '09:00', 'America/New_York')?.toISOString()).toBe('2026-07-01T13:00:00.000Z')
    expect(zonedLocalToUtc('2026-12-01', '09:00', 'America/New_York')?.toISOString()).toBe('2026-12-01T14:00:00.000Z')
    // 02:30 does not exist on 8 March 2026 in New York; it moves forward to 03:30 EDT.
    expect(zonedLocalToUtc('2026-03-08', '02:30', 'America/New_York')?.toISOString()).toBe('2026-03-08T07:30:00.000Z')
    // 01:30 happens twice on 1 November 2026; the first (EDT) is taken.
    expect(zonedLocalToUtc('2026-11-01', '01:30', 'America/New_York')?.toISOString()).toBe('2026-11-01T05:30:00.000Z')
    expect(zonedLocalToUtc('2026-03-29', '01:30', 'Europe/London')?.toISOString()).toBe('2026-03-29T01:30:00.000Z')
  })

  it('refuses malformed input', () => {
    expect(zonedLocalToUtc('2026-02-30', '10:00', 'Asia/Kolkata')).toBeNull()
    expect(zonedLocalToUtc('2026-10-13', '25:00', 'Asia/Kolkata')).toBeNull()
    expect(zonedLocalToUtc('2026-10-13', '10:00', 'Not/AZone')).toBeNull()
    expect(isValidTimeZone('Asia/Kolkata')).toBe(true)
    expect(isValidTimeZone("Asia/Kolkata'; drop")).toBe(false)
  })

  it('round-trips form inputs and does calendar arithmetic', () => {
    expect(utcToZonedInputs('2026-10-13T13:30:00Z', 'Asia/Kolkata')).toEqual({ date: '2026-10-13', time: '19:00' })
    expect(isoWeekday('2026-10-12')).toBe(1)
    expect(isoWeekday('2026-10-18')).toBe(7)
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02')
  })

  it('names the zone clearly', () => {
    expect(formatZonedTime('2026-10-13T13:30:00Z', 'Asia/Kolkata')).toBe('Tue 13 Oct, 19:00 IST (Asia/Kolkata)')
    expect(formatZonedTime('2026-10-13T13:30:00Z', 'America/New_York')).toBe('Tue 13 Oct, 09:30 EDT (America/New_York)')
    expect(formatZonedTime('2026-10-13T13:30:00Z', 'UTC', { withYear: true })).toBe('Tue 13 Oct 2026, 13:30 UTC')
    expect(formatZonedRange('2026-10-13T13:30:00Z', 90, 'Asia/Kolkata')).toBe('Tue 13 Oct, 19:00–20:30 IST (Asia/Kolkata)')
  })
})
