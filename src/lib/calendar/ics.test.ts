import { describe, expect, it } from 'vitest'
import { buildIcsCalendar, escapeIcsText, foldIcsLine } from './ics'

describe('iCalendar writer', () => {
  it('escapes text and folds long lines at 75 octets without splitting characters', () => {
    expect(escapeIcsText('a, b; c\\d\nnext')).toBe('a\\, b\; c\\\\d\\nnext')
    const folded = foldIcsLine(`DESCRIPTION:${'é'.repeat(60)}`)
    for (const line of folded.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75)
    expect(folded.split('\r\n').slice(1).every((line) => line.startsWith(' '))).toBe(true)
    expect(folded.replace(/\r\n /g, '')).toBe(`DESCRIPTION:${'é'.repeat(60)}`)
  })

  it('writes UTC events with CRLF line ends', () => {
    const body = buildIcsCalendar({
      name: 'Fixture course',
      now: new Date('2026-10-10T00:00:00Z'),
      events: [{ uid: 'learning-session-1@seanshore.in', title: 'Week 1, part 1', startsAt: '2026-11-02T13:30:00Z', endsAt: '2026-11-02T14:30:00Z', description: 'Join: https://seanshore.in/x', cancelled: true }],
    })
    expect(body.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true)
    expect(body).toContain('DTSTART:20261102T133000Z\r\nDTEND:20261102T143000Z\r\nSUMMARY:Week 1\\, part 1')
    expect(body).toContain('STATUS:CANCELLED')
    expect(body.endsWith('END:VCALENDAR\r\n')).toBe(true)
  })
})
