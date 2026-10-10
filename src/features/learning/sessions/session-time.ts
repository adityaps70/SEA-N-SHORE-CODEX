/**
 * Learning round D: times for batches and live sessions. Stored in UTC; entered as a local date and time in a chosen
 * IANA time zone; shown with the zone named clearly (seafarers move between zones). Pure Intl, no dependency, safe in
 * the browser and on the server.
 */

export const DEFAULT_TIME_ZONE = 'Asia/Kolkata'

const ZONE_PATTERN = /^[A-Za-z][A-Za-z0-9_+/-]*$/

export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 64) return false
  if (value === 'UTC') return true
  if (!ZONE_PATTERN.test(value)) return false
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: value }).format(0)
    return true
  } catch {
    return false
  }
}

/** Every zone this runtime knows, UTC first; falls back to a short list on old runtimes. */
export function timeZoneOptions(): string[] {
  const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.('timeZone')
  const zones = supported?.length ? supported : ['Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Europe/London', 'Europe/Athens', 'America/New_York', 'Australia/Sydney']
  return ['UTC', ...zones.filter((zone) => zone !== 'UTC')]
}

type Parts = { year: number; month: number; day: number; hour: number; minute: number; second: number }

function zonedParts(date: Date, timeZone: string): Parts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const values: Record<string, number> = {}
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') values[part.type] = Number(part.value)
  }
  return {
    year: values.year!,
    month: values.month!,
    day: values.day!,
    hour: values.hour === 24 ? 0 : values.hour!,
    minute: values.minute!,
    second: values.second!,
  }
}

/** The zone's offset from UTC at an instant, in minutes (IST = +330). */
export function zoneOffsetMinutes(at: Date, timeZone: string) {
  const parts = zonedParts(at, timeZone)
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000)
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const TIME_PATTERN = /^(\d{2}):(\d{2})$/

/**
 * The UTC instant of a wall-clock date and time ("2026-10-13", "19:00") in a zone, correct across daylight-saving
 * changes. A time skipped by a spring-forward change moves to the first valid minute after it; a repeated autumn hour
 * takes its first occurrence. Null for malformed input.
 */
export function zonedLocalToUtc(date: string, time: string, timeZone: string): Date | null {
  const dateMatch = DATE_PATTERN.exec(date)
  const timeMatch = TIME_PATTERN.exec(time)
  if (!dateMatch || !timeMatch || !isValidTimeZone(timeZone)) return null
  const [year, month, day] = [Number(dateMatch[1]), Number(dateMatch[2]), Number(dateMatch[3])]
  const [hour, minute] = [Number(timeMatch[1]), Number(timeMatch[2])]
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null
  const wall = Date.UTC(year, month - 1, day, hour, minute)
  const check = new Date(wall)
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null
  // The offsets just before and just after any change near this date; an exact match is the answer (the earlier
  // one for a repeated hour). No match means a skipped time: the offset before the change moves it forward.
  const before = zoneOffsetMinutes(new Date(wall - 12 * 60 * 60_000), timeZone)
  const after = zoneOffsetMinutes(new Date(wall + 12 * 60 * 60_000), timeZone)
  const matches = [wall - before * 60_000, wall - after * 60_000].filter((candidate) => {
    const parts = zonedParts(new Date(candidate), timeZone)
    return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) === wall
  }).sort((a, b) => a - b)
  return new Date(matches[0] ?? wall - before * 60_000)
}

/** The wall-clock date ("YYYY-MM-DD") and time ("HH:mm") of an instant in a zone, for form inputs. */
export function utcToZonedInputs(at: Date | string, timeZone: string) {
  const parts = zonedParts(typeof at === 'string' ? new Date(at) : at, isValidTimeZone(timeZone) ? timeZone : 'UTC')
  const pad = (value: number) => String(value).padStart(2, '0')
  return { date: `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`, time: `${pad(parts.hour)}:${pad(parts.minute)}` }
}

/** The ISO weekday (1 = Monday … 7 = Sunday) of a "YYYY-MM-DD" date. */
export function isoWeekday(date: string) {
  const match = DATE_PATTERN.exec(date)
  if (!match) return null
  const day = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))).getUTCDay()
  return day === 0 ? 7 : day
}

/** "YYYY-MM-DD" plus a number of days (calendar arithmetic, no time zone involved). */
export function addDays(date: string, days: number) {
  const match = DATE_PATTERN.exec(date)
  if (!match) return null
  const next = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days))
  return next.toISOString().slice(0, 10)
}

/** A short zone name for an instant ("IST", "GMT+4", "EDT"), or the IANA name when the runtime has none. */
export function zoneAbbreviation(at: Date, timeZone: string) {
  const read = (locale: string) => {
    try {
      return new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: 'short' }).formatToParts(at).find((item) => item.type === 'timeZoneName')?.value ?? null
    } catch {
      return null
    }
  }
  // en-US names most American and European zones ("EDT", "CET"); en-IN names India ("IST"); otherwise "GMT+4".
  const candidates = [read('en-US'), read('en-IN'), read('en-GB')].filter((value): value is string => Boolean(value))
  return candidates.find((value) => !/^(GMT|UTC)[+-]/.test(value)) ?? candidates[0] ?? timeZone
}

/**
 * "Mon 13 Oct, 19:00 IST (Asia/Kolkata)": a session time in a zone, with the zone named twice so a seafarer who has
 * changed zones is never unsure. `withYear` adds the year (emails, far-off dates).
 */
export function formatZonedTime(at: Date | string, timeZone: string, options: { withYear?: boolean } = {}) {
  const date = typeof at === 'string' ? new Date(at) : at
  const zone = isValidTimeZone(timeZone) ? timeZone : 'UTC'
  const day = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(options.withYear ? { year: 'numeric' } : {}),
  }).format(date).replace(',', '')
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date)
  const abbreviation = zoneAbbreviation(date, zone)
  return zone === 'UTC' ? `${day}, ${time} UTC` : `${day}, ${time} ${abbreviation} (${zone})`
}

/** "Mon 13 Oct, 19:00–20:30 IST (Asia/Kolkata)": a session with its end time, in a zone. */
export function formatZonedRange(start: Date | string, durationMinutes: number, timeZone: string, options: { withYear?: boolean } = {}) {
  const startDate = typeof start === 'string' ? new Date(start) : start
  const end = new Date(startDate.getTime() + durationMinutes * 60_000)
  const zone = isValidTimeZone(timeZone) ? timeZone : 'UTC'
  const clock = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  const day = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(options.withYear ? { year: 'numeric' } : {}),
  }).format(startDate).replace(',', '')
  const label = zone === 'UTC' ? 'UTC' : `${zoneAbbreviation(startDate, zone)} (${zone})`
  return `${day}, ${clock.format(startDate)}–${clock.format(end)} ${label}`
}
