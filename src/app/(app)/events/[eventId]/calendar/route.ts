import { NextResponse } from 'next/server'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { calendarEventRepository } from '@/features/events/calendar-repository'

function calendarStamp(value: string) {
  return new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

function escapeIcs(value: string) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
}

function fileStem(title: string) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'sea-n-shore-event'
}

export async function GET(request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const user = await requireAwsUser()
  const { eventId } = await params
  const event = await calendarEventRepository.getEvent(eventId, user.id)

  if (!event) {
    return new NextResponse('Event not found', { status: 404 })
  }

  const location = event.format === 'online'
    ? 'Online'
    : [event.locationName, event.locationAddress, event.city, event.country].filter(Boolean).join(', ') || 'Venue to be confirmed'
  const eventUrl = new URL(`/events/${event.id}`, request.url).toString()
  const description = [event.summary, event.meetingUrl ? `Join online: ${event.meetingUrl}` : null]
    .filter(Boolean)
    .join('\n\n')

  const calendar = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Sea N Shore//Events//EN',
    'CALSCALE:GREGORIAN',
    `X-WR-TIMEZONE:${escapeIcs(event.timezone)}`,
    'BEGIN:VEVENT',
    `UID:${event.id}@seaandshore.in`,
    `DTSTAMP:${calendarStamp(new Date().toISOString())}`,
    `DTSTART:${calendarStamp(event.startAt)}`,
    `DTEND:${calendarStamp(event.endAt)}`,
    `SUMMARY:${escapeIcs(event.title)}`,
    `DESCRIPTION:${escapeIcs(description)}`,
    `LOCATION:${escapeIcs(location)}`,
    `URL:${escapeIcs(eventUrl)}`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n')

  return new NextResponse(calendar, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${fileStem(event.title)}.ics"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
