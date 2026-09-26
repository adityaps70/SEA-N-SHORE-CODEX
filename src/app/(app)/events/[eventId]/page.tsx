import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { CalendarDays, CalendarPlus, Download, MapPin, Monitor, Users } from 'lucide-react'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { calendarEventRepository } from '@/features/events/calendar-repository'
import { AttendanceControl } from '@/features/events/components/attendance-control'
import { EventNav } from '@/features/events/components/event-nav'
import { EventShareButton } from '@/features/events/components/event-share-button'
import { ReportContentButton } from '@/features/moderation/components/report-content-button'

function dateTime(value: string, timeZone: string) {
  try {
    return new Intl.DateTimeFormat('en', { dateStyle: 'full', timeStyle: 'short', timeZone }).format(new Date(value))
  } catch {
    return new Intl.DateTimeFormat('en', { dateStyle: 'full', timeStyle: 'short' }).format(new Date(value))
  }
}

function titleCase(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function calendarStamp(value: string) {
  return new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

function googleCalendarUrl(input: { title: string; summary: string; startAt: string; endAt: string; location: string }) {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: input.title,
    dates: `${calendarStamp(input.startAt)}/${calendarStamp(input.endAt)}`,
    details: input.summary,
    location: input.location,
  })
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

const loadEvent = cache((eventId: string, userId: string) => calendarEventRepository.getEvent(eventId, userId))

export async function generateMetadata({ params }: { params: Promise<{ eventId: string }> }): Promise<Metadata> {
  const user = await requireAwsUser()
  const { eventId } = await params
  const event = await loadEvent(eventId, user.id)
  return { title: event ? event.title : 'Event not found' }
}

export default async function EventDetailPage({ params }: { params: Promise<{ eventId: string }> }) {
  const user = await requireAwsUser()
  const { eventId } = await params
  const event = await loadEvent(eventId, user.id)
  if (!event) notFound()

  const place = [event.locationName, event.locationAddress, event.city, event.country].filter(Boolean).join(', ')
  const seatsLeft = event.capacity === null ? null : Math.max(event.capacity - event.attendeeCount, 0)
  const registrationState = event.isPast
    ? 'ended'
    : event.status !== 'published'
      ? 'closed'
      : seatsLeft === 0 && !event.viewerIsAttending
        ? 'full'
        : event.registrationOpen || event.viewerIsAttending
          ? 'open'
          : 'closed'
  const registrationLabel = registrationState === 'ended'
    ? 'Event ended'
    : registrationState === 'full'
      ? 'Event full'
      : registrationState === 'closed'
        ? 'Registration closed'
        : 'Registration open'
  const calendarHref = googleCalendarUrl({
    title: event.title,
    summary: event.summary,
    startAt: event.startAt,
    endAt: event.endAt,
    location: event.format === 'online' ? 'Online' : place || 'Venue to be confirmed',
  })
  const canJoinOnline = Boolean(event.meetingUrl && !event.isPast && event.status === 'published')
  const showAttendanceControl = !event.viewerIsHost && !event.isPast && event.status !== 'cancelled'

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-4 py-6 sm:px-6">
      <EventNav active="discover" />
      <article className="overflow-hidden rounded-[2rem] border border-mist-100 bg-white shadow-[var(--shadow-card)]">
        {event.bannerUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- only organizer supplied public/signed display URLs are stored
          <img src={event.bannerUrl} alt="" className="max-h-80 w-full object-cover" />
        ) : <div className="h-36 bg-gradient-to-br from-navy-950 via-navy-800 to-teal-700" />}
        <div className="grid gap-8 p-6 sm:p-8 lg:grid-cols-[1fr_300px]">
          <div>
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full bg-teal-50 px-3 py-1 text-xs font-bold text-teal-800">{titleCase(event.format)}</span>
              <span className="rounded-full bg-navy-50 px-3 py-1 text-xs font-bold text-navy-700">{titleCase(event.category)}</span>
              <span className="rounded-full bg-mist-50 px-3 py-1 text-xs font-bold text-navy-700">{titleCase(event.eventType)}</span>
              <span className="rounded-full bg-mist-50 px-3 py-1 text-xs font-bold capitalize text-navy-700">{event.status}</span>
            </div>

            <h1 className="mt-4 text-3xl font-bold tracking-tight text-navy-950 sm:text-4xl">{event.title}</h1>
            <p className="mt-3 text-lg leading-8 text-navy-700">{event.summary}</p>

            <div className="mt-6 grid gap-3 rounded-2xl bg-mist-50 p-5 text-sm text-navy-800 sm:grid-cols-2">
              <span className="flex gap-2"><CalendarDays className="h-4 w-4 shrink-0 text-teal-700" />{dateTime(event.startAt, event.timezone)} – {dateTime(event.endAt, event.timezone)}</span>
              <span className="flex gap-2">{event.format === 'online' ? <Monitor className="h-4 w-4 shrink-0 text-teal-700" /> : <MapPin className="h-4 w-4 shrink-0 text-teal-700" />}{event.format === 'online' ? 'Online' : place || 'Venue to be confirmed'}</span>
              <span className="flex gap-2"><Users className="h-4 w-4 text-teal-700" />{event.attendeeCount}{event.capacity ? ` / ${event.capacity}` : ''} attending</span>
              <span>Timezone: {event.timezone}</span>
            </div>

            {event.description ? <div className="mt-8 whitespace-pre-wrap text-sm leading-7 text-navy-800">{event.description}</div> : null}

            {event.agenda.length ? (
              <section className="mt-8">
                <h2 className="text-lg font-bold text-navy-950">Agenda</h2>
                <ol className="mt-3 space-y-2">
                  {event.agenda.map((item, index) => (
                    <li key={`${index}-${item}`} className="flex gap-3 rounded-xl bg-mist-50 px-4 py-3 text-sm text-navy-800">
                      <span className="font-bold text-teal-700">{String(index + 1).padStart(2, '0')}</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}

            {event.speakerDetails.length ? (
              <section className="mt-8">
                <h2 className="text-lg font-bold text-navy-950">Speakers</h2>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {event.speakerDetails.map((speaker) => (
                    <div key={`${speaker.name}-${speaker.organization}`} className="rounded-xl border border-mist-100 p-4">
                      <p className="font-bold text-navy-950">{speaker.name}</p>
                      {speaker.title ? <p className="mt-1 text-sm text-navy-700">{speaker.title}</p> : null}
                      {speaker.organization ? <p className="text-xs text-muted">{speaker.organization}</p> : null}
                    </div>
                  ))}
                </div>
              </section>
            ) : event.speakers.length ? (
              <section className="mt-8">
                <h2 className="font-bold text-navy-950">Speakers</h2>
                <p className="mt-2 text-sm text-navy-700">{event.speakers.join(' · ')}</p>
              </section>
            ) : null}

            {event.topics.length ? (
              <section className="mt-8">
                <h2 className="font-bold text-navy-950">What you&apos;ll learn</h2>
                <div className="mt-2 flex flex-wrap gap-2">
                  {event.topics.map((topic) => <span key={topic} className="rounded-lg bg-teal-50 px-3 py-1.5 text-sm font-medium text-teal-800">{topic}</span>)}
                </div>
              </section>
            ) : null}
          </div>

          <aside className="space-y-4 rounded-2xl border border-mist-100 bg-white p-5 shadow-sm lg:sticky lg:top-24 lg:self-start">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.15em] text-muted">Hosted by</p>
              {event.publisherType === 'personal' && event.publisherSlug ? (
                <Link href={`/profile/${event.publisherSlug}`} className="mt-1 block font-bold text-navy-950 hover:text-teal-700">
                  {event.publisherName}
                </Link>
              ) : (
                <p className="mt-1 font-bold text-navy-950">{event.publisherName}</p>
              )}
              {event.publisherType === 'organization' && event.publisherVerified ? (
                <p className="mt-1 text-xs font-semibold text-emerald-700">Verified organization</p>
              ) : null}
            </div>

            <div className="rounded-xl bg-mist-50 p-3 text-xs leading-5 text-navy-700" aria-live="polite">
              <p className="font-bold text-navy-900">Registration</p>
              <p className={registrationState === 'open' ? 'font-semibold text-emerald-700' : 'font-semibold text-navy-800'}>{registrationLabel}</p>
              {seatsLeft !== null && !event.isPast ? <p>{seatsLeft} seats left</p> : null}
              {event.registrationClosesAt && !event.isPast ? <p>Registration closes {dateTime(event.registrationClosesAt, event.timezone)}</p> : null}
            </div>

            {event.viewerIsHost ? (
              <Link href={`/events/${event.id}/edit`} className="block min-h-12 rounded-xl bg-navy-950 px-4 py-3 text-center text-sm font-bold text-white">Manage event</Link>
            ) : showAttendanceControl ? (
              <AttendanceControl eventId={event.id} attending={event.viewerIsAttending} disabled={registrationState !== 'open' && !event.viewerIsAttending} />
            ) : null}

            {!event.viewerIsHost && !event.viewerIsAttending && registrationState !== 'open' ? (
              <p className="text-xs leading-5 text-muted">
                {registrationState === 'full' ? 'No seats are currently available.' : registrationState === 'ended' ? 'Registration is no longer available because this event has ended.' : 'Registration is not currently accepting attendees.'}
              </p>
            ) : null}

            <div className="space-y-2 border-t border-mist-100 pt-4">
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-muted">Add to calendar</p>
              <a
                href={calendarHref}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-mist-200 bg-white px-4 text-sm font-bold text-navy-900 transition hover:border-teal-300 hover:bg-teal-50"
              >
                <CalendarPlus className="h-4 w-4 text-teal-700" aria-hidden="true" />
                Google Calendar
              </a>
              <a
                href={`/events/${event.id}/calendar`}
                className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-mist-200 bg-white px-4 text-sm font-bold text-navy-900 transition hover:border-teal-300 hover:bg-teal-50"
              >
                <Download className="h-4 w-4 text-teal-700" aria-hidden="true" />
                Download .ics
              </a>
            </div>

            <EventShareButton title={event.title} />

            {!event.viewerIsHost ? (
              <ReportContentButton targetType="event" targetId={event.id} label="Report event" />
            ) : null}

            {canJoinOnline ? (
              <a
                href={event.meetingUrl ?? undefined}
                target="_blank"
                rel="noreferrer"
                className="block min-h-12 rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 text-center text-sm font-bold text-teal-800"
              >
                Join online session
              </a>
            ) : null}
            {!event.meetingUrl && !event.isPast && (event.format === 'online' || event.format === 'hybrid') ? <p className="text-xs leading-5 text-muted">The joining link becomes visible to the host and registered attendees.</p> : null}
          </aside>
        </div>
      </article>
    </div>
  )
}
