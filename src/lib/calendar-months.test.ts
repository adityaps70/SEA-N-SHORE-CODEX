import { describe, expect, it } from 'vitest'
import { addInterval } from '@/features/billing/plans'
import { accessExpiresAt } from '@/features/learning/course-plans'
import { addMonths } from '@/features/learning/company-training/seat-rules'
import { addCalendarMonths } from './calendar-months'

const at = (iso: string) => new Date(iso)

describe('addCalendarMonths: same day of the month, clamped to the month’s last day', () => {
  it.each([
    ['2026-10-31T10:15:30.123Z', 6, '2027-04-30T10:15:30.123Z'], // 31 Oct + 6 months = 30 Apr
    ['2027-01-31T08:00:00.000Z', 1, '2027-02-28T08:00:00.000Z'], // 31 Jan + 1 month = 28 Feb
    ['2028-01-31T08:00:00.000Z', 1, '2028-02-29T08:00:00.000Z'], // ... or 29 Feb in a leap year
    ['2026-08-31T23:59:59.999Z', 6, '2027-02-28T23:59:59.999Z'], // 31 Aug + 6 months = 28 Feb
    ['2028-02-29T12:00:00.000Z', 12, '2029-02-28T12:00:00.000Z'], // 29 Feb + 12 months = 28 Feb
    ['2026-03-15T00:00:00.000Z', 12, '2027-03-15T00:00:00.000Z'], // an ordinary day keeps its day
    ['2026-12-31T00:00:00.000Z', 2, '2027-02-28T00:00:00.000Z'], // across a year end
  ])('%s + %i months = %s', (start, months, expected) => {
    expect(addCalendarMonths(at(start), months).toISOString()).toBe(expected)
  })

  it('never changes the date it was given', () => {
    const start = at('2026-10-31T00:00:00.000Z')
    addCalendarMonths(start, 6)
    expect(start.toISOString()).toBe('2026-10-31T00:00:00.000Z')
  })

  it('is the rule every plan length uses: Pro intervals, course access (and its renewals) and company seats', () => {
    expect(addInterval(at('2027-01-31T00:00:00.000Z'), 'month').toISOString()).toBe('2027-02-28T00:00:00.000Z')
    expect(accessExpiresAt(6, { now: at('2026-10-31T00:00:00.000Z') })?.toISOString()).toBe('2027-04-30T00:00:00.000Z')
    expect(accessExpiresAt(12, { now: at('2028-02-29T00:00:00.000Z') })?.toISOString()).toBe('2029-02-28T00:00:00.000Z')
    // A renewal while access still runs extends from the current end.
    expect(accessExpiresAt(6, { now: at('2027-03-01T00:00:00.000Z'), currentExpiresAt: at('2027-04-30T00:00:00.000Z') })?.toISOString())
      .toBe('2027-10-30T00:00:00.000Z')
    expect(addMonths(at('2028-02-29T00:00:00.000Z'), 12).toISOString()).toBe('2029-02-28T00:00:00.000Z')
  })
})
