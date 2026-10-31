/**
 * Adds whole calendar months in UTC, keeping the day of the month and clamping it to the target month's last day:
 * 31 Oct + 6 months = 30 Apr, 31 Jan + 1 month = 28 or 29 Feb, 29 Feb + 12 months = 28 Feb. The time of day is kept.
 * This is what Postgres does for `timestamptz + make_interval(months => n)` in a UTC session, which is how plan and
 * seat periods are stored, so the app and the database always agree on an end date.
 */
export function addCalendarMonths(date: Date, months: number): Date {
  const result = new Date(date.getTime())
  const day = result.getUTCDate()
  result.setUTCDate(1)
  result.setUTCMonth(result.getUTCMonth() + months)
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate()
  result.setUTCDate(Math.min(day, lastDay))
  return result
}
