const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
const COMPACT_DATE_AFTER_MS = 7 * DAY_MS

export function relativeTimeFrom(timestamp: string, now = Date.now()) {
  const occurredAt = Date.parse(timestamp)
  if (!Number.isFinite(occurredAt)) return ''

  const age = Math.max(0, now - occurredAt)
  if (age < MINUTE_MS) return 'just now'
  if (age < HOUR_MS) return `${Math.max(1, Math.floor(age / MINUTE_MS))}m`
  if (age < DAY_MS) return `${Math.max(1, Math.floor(age / HOUR_MS))}h`
  if (age < COMPACT_DATE_AFTER_MS) return `${Math.max(1, Math.floor(age / DAY_MS))}d`

  const date = new Date(occurredAt)
  const nowDate = new Date(now)
  const sameYear = date.getUTCFullYear() === nowDate.getUTCFullYear()
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' as const }),
    timeZone: 'UTC',
  }).format(date)
}
