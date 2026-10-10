/**
 * A small iCalendar (RFC 5545) writer for "Add to calendar" files: UTC times, escaped text and lines folded at 75
 * octets. Learning round D uses it for live sessions; any feature can.
 */

export type IcsEvent = {
  uid: string
  title: string
  startsAt: Date | string
  endsAt: Date | string
  description?: string | null
  location?: string | null
  url?: string | null
  cancelled?: boolean
}

export function icsStamp(value: Date | string) {
  return new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

export function escapeIcsText(value: string) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\;')
}

/** Folds a content line at 75 octets (UTF-8), continuing with a single space, without splitting a character. */
export function foldIcsLine(line: string) {
  const encoder = new TextEncoder()
  if (encoder.encode(line).length <= 75) return line
  const parts: string[] = []
  let current = ''
  let size = 0
  for (const character of line) {
    const bytes = encoder.encode(character).length
    const limit = parts.length === 0 ? 75 : 74
    if (size + bytes > limit) {
      parts.push(current)
      current = ''
      size = 0
    }
    current += character
    size += bytes
  }
  parts.push(current)
  return parts.join('\r\n ')
}

export function buildIcsCalendar(input: { name: string; events: readonly IcsEvent[]; now?: Date }) {
  const stamp = icsStamp(input.now ?? new Date())
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Sea N Shore//Learning//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText(input.name)}`,
  ]
  for (const event of input.events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${event.uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${icsStamp(event.startsAt)}`,
      `DTEND:${icsStamp(event.endsAt)}`,
      `SUMMARY:${escapeIcsText(event.title)}`,
    )
    if (event.description) lines.push(`DESCRIPTION:${escapeIcsText(event.description)}`)
    if (event.location) lines.push(`LOCATION:${escapeIcsText(event.location)}`)
    if (event.url) lines.push(`URL:${escapeIcsText(event.url)}`)
    if (event.cancelled) lines.push('STATUS:CANCELLED')
    lines.push('END:VEVENT')
  }
  lines.push('END:VCALENDAR', '')
  return lines.map(foldIcsLine).join('\r\n')
}

export function icsFileName(title: string) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'sea-n-shore-session'
}
