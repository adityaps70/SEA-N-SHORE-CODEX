import Link from 'next/link'
import { notFound } from 'next/navigation'
import { CalendarDays, MapPin, Monitor, Users } from 'lucide-react'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { calendarEventRepository } from '@/features/events/calendar-repository'
import { AttendanceControl } from '@/features/events/components/attendance-control'
import { EventNav } from '@/features/events/components/event-nav'

function dateTime(value: string) { return new Intl.DateTimeFormat('en', { dateStyle: 'full', timeStyle: 'short' }).format(new Date(value)) }

export default async function EventDetailPage({ params }: { params: Promise<{ eventId: string }> }) {
  const user = await requireAwsUser()
  const { eventId } = await params
  const event = await calendarEventRepository.getEvent(eventId, user.id)
  if (!event) notFound()
  const ended = new Date(event.endAt).getTime() <= Date.now()
  const registrationClosed = event.status !== 'published' || ended

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-4 py-6 sm:px-6">
      <EventNav active="discover" />
      <article className="overflow-hidden rounded-[2rem] border border-mist-100 bg-white shadow-[var(--shadow-card)]">
        {event.bannerUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- event banners may use external organizer URLs
          <img src={event.bannerUrl} alt="" className="max-h-80 w-full object-cover" />
        ) : <div className="h-36 bg-gradient-to-br from-navy-950 via-navy-800 to-teal-700" />}
        <div className="grid gap-8 p-6 sm:p-8 lg:grid-cols-[1fr_300px]">
          <div>
            <div className="flex flex-wrap gap-2"><span className="rounded-full bg-teal-50 px-3 py-1 text-xs font-bold capitalize text-teal-800">{event.format.replace('_', ' ')}</span><span className="rounded-full bg-mist-50 px-3 py-1 text-xs font-bold capitalize text-navy-700">{event.status}</span></div>
            <h1 className="mt-4 text-3xl font-bold tracking-tight text-navy-950 sm:text-4xl">{event.title}</h1>
            <p className="mt-3 text-lg leading-8 text-navy-700">{event.summary}</p>
            <div className="mt-6 grid gap-3 rounded-2xl bg-mist-50 p-5 text-sm text-navy-800 sm:grid-cols-2">
              <span className="flex gap-2"><CalendarDays className="h-4 w-4 text-teal-700" />{dateTime(event.startAt)} – {dateTime(event.endAt)}</span>
              <span className="flex gap-2">{event.format === 'online' ? <Monitor className="h-4 w-4 text-teal-700" /> : <MapPin className="h-4 w-4 text-teal-700" />}{event.format === 'online' ? 'Online' : [event.locationName, event.locationAddress].filter(Boolean).join(', ')}</span>
              <span className="flex gap-2"><Users className="h-4 w-4 text-teal-700" />{event.attendeeCount}{event.capacity ? ` / ${event.capacity}` : ''} attending</span>
              <span>Timezone: {event.timezone}</span>
            </div>
            {event.description ? <div className="mt-8 whitespace-pre-wrap text-sm leading-7 text-navy-800">{event.description}</div> : null}
            {event.topics.length ? <div className="mt-7"><h2 className="font-bold text-navy-950">Topics</h2><div className="mt-2 flex flex-wrap gap-2">{event.topics.map((topic) => <span key={topic} className="rounded-lg bg-teal-50 px-3 py-1.5 text-sm font-medium text-teal-800">{topic}</span>)}</div></div> : null}
            {event.speakers.length ? <div className="mt-7"><h2 className="font-bold text-navy-950">Speakers</h2><p className="mt-2 text-sm text-navy-700">{event.speakers.join(' · ')}</p></div> : null}
          </div>
          <aside className="space-y-4 rounded-2xl border border-mist-100 bg-white p-5 shadow-sm">
            <div><p className="text-xs font-bold uppercase tracking-[0.15em] text-muted">Hosted by</p><p className="mt-1 font-bold text-navy-950">{event.hostName}</p></div>
            {event.viewerIsHost ? <Link href={`/events/${event.id}/edit`} className="block rounded-xl bg-navy-950 px-4 py-3 text-center text-sm font-bold text-white">Edit event</Link> : <AttendanceControl eventId={event.id} attending={event.viewerIsAttending} disabled={registrationClosed} />}
            {registrationClosed && !event.viewerIsHost ? <p className="text-xs text-muted">Registration is closed for this event.</p> : null}
            {event.meetingUrl ? <a href={event.meetingUrl} target="_blank" rel="noreferrer" className="block rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 text-center text-sm font-bold text-teal-800">Join online session</a> : null}
            <p className="text-xs leading-5 text-muted">Joining links are visible only to the host and registered attendees.</p>
          </aside>
        </div>
      </article>
    </div>
  )
}
