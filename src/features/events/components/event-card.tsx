import Link from 'next/link'
import { CalendarDays, MapPin, Monitor, Users } from 'lucide-react'
import type { CalendarEvent } from '../calendar-types'

function dateLabel(value: string, timeZone: string) {
  try {
    return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(new Date(value))
  } catch {
    return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
  }
}

function formatLabel(format: CalendarEvent['format']) {
  if (format === 'in_person') return 'In person'
  if (format === 'hybrid') return 'Hybrid'
  return 'Online'
}

function titleCase(value: string) { return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) }

export function EventCard({ event, showStatus = false }: { event: CalendarEvent; showStatus?: boolean }) {
  const place = [event.locationName, event.city, event.country].filter(Boolean).join(', ')
  return (
    <article className="overflow-hidden rounded-[1.5rem] border border-mist-100 bg-white shadow-[var(--shadow-card)] transition hover:-translate-y-0.5 hover:shadow-lg">
      {event.bannerUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- only organizer supplied public/signed display URLs are stored
        <img src={event.bannerUrl} alt="" className="h-40 w-full object-cover" loading="lazy" />
      ) : (
        <div className="flex h-32 items-end bg-gradient-to-br from-navy-950 via-navy-800 to-teal-700 p-5 text-white">
          <span className="text-xs font-bold uppercase tracking-[0.18em]">Sea N Shore Events</span>
        </div>
      )}
      <div className="space-y-4 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-teal-50 px-2.5 py-1 text-xs font-bold text-teal-800">{formatLabel(event.format)}</span>
          <span className="rounded-full bg-navy-50 px-2.5 py-1 text-xs font-semibold text-navy-700">{titleCase(event.category)}</span>
          <span className="rounded-full bg-mist-50 px-2.5 py-1 text-xs font-semibold text-navy-700">{titleCase(event.eventType)}</span>
          {showStatus ? <span className="rounded-full bg-mist-50 px-2.5 py-1 text-xs font-semibold capitalize text-navy-700">{event.status}</span> : null}
          {event.viewerIsAttending ? <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">Attending</span> : null}
        </div>
        <div>
          <Link href={`/events/${event.id}`} className="text-xl font-bold text-navy-950 hover:text-teal-700">{event.title}</Link>
          <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted">{event.summary}</p>
        </div>
        <div className="grid gap-2 text-sm text-navy-700">
          <span className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-teal-700" />{dateLabel(event.startAt, event.timezone)}</span>
          <span className="flex items-center gap-2">{event.format === 'online' ? <Monitor className="h-4 w-4 text-teal-700" /> : <MapPin className="h-4 w-4 text-teal-700" />}{event.format === 'online' ? 'Online' : place || 'Venue to be confirmed'}</span>
          <span className="flex items-center gap-2"><Users className="h-4 w-4 text-teal-700" />{event.attendeeCount}{event.capacity ? ` / ${event.capacity}` : ''} attending</span>
        </div>
        {event.topics.length ? <div className="flex flex-wrap gap-1.5">{event.topics.slice(0, 4).map((topic) => <span key={topic} className="rounded-lg bg-mist-50 px-2 py-1 text-xs text-navy-700">{topic}</span>)}</div> : null}
        <p className="border-t border-mist-100 pt-3 text-xs text-muted">Hosted by <span className="font-semibold text-navy-800">{event.hostName}</span></p>
      </div>
    </article>
  )
}
