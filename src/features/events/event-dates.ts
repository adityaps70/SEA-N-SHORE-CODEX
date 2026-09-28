/**
 * Short date lines for the phone event layouts (round 8), in the event's own timezone:
 *   list rows:  "Sat, 3 Oct · 5:00 pm"
 *   detail:     "Sat, 3 Oct 2026 · 5:00 – 7:00 pm IST"
 * Shown uppercase by CSS. An unknown timezone falls back to the viewer's.
 */

function formatter(options: Intl.DateTimeFormatOptions, timeZone: string) {
  try {
    return new Intl.DateTimeFormat('en-IN', { ...options, timeZone })
  } catch {
    return new Intl.DateTimeFormat('en-IN', options)
  }
}

function dayLabel(date: Date, timeZone: string, withYear: boolean) {
  const parts = formatter({ weekday: 'short', day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}) }, timeZone).formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value ?? ''
  return `${part('weekday')}, ${part('day')} ${part('month')}${withYear ? ` ${part('year')}` : ''}`
}

function sameDay(start: Date, end: Date, timeZone: string) {
  const key = formatter({ year: 'numeric', month: '2-digit', day: '2-digit' }, timeZone)
  return key.format(start) === key.format(end)
}

export function eventCardDateLine(startAt: string, timeZone: string) {
  const start = new Date(startAt)
  const time = formatter({ hour: 'numeric', minute: '2-digit', hour12: true }, timeZone).format(start)
  return `${dayLabel(start, timeZone, false)} · ${time}`
}

export function eventDetailDateLine(startAt: string, endAt: string, timeZone: string) {
  const start = new Date(startAt)
  const end = new Date(endAt)
  const time = formatter({ hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short' }, timeZone)
  const timeLabel = sameDay(start, end, timeZone) && end > start && typeof time.formatRange === 'function'
    ? time.formatRange(start, end)
    : time.format(start)
  // ICU puts thin / narrow no-break spaces in ranges; keep plain spaces like the rest of the line.
  return `${dayLabel(start, timeZone, true)} · ${timeLabel.replace(/[\u2009\u202f]/g, ' ')}`
}
