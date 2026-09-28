import Link from 'next/link'
import { ArrowRight, CalendarDays, MapPin, Monitor, Users } from 'lucide-react'
import type { CalendarEvent } from '../calendar-types'
import { eventCardDateLine } from '../event-dates'
import { eventFormatLabel, eventPlaceShort, eventPriceLabel } from '../event-labels'

function dateLabel(value: string, timeZone: string) {
  try {
    return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(new Date(value))
  } catch {
    return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
  }
}

function titleCase(value: string) { return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) }

/**
 * Event card. Below `md` it becomes a compact row (round 8): image on the left, amber date
 * line, title, place and price; the chips, summary and facts stay on the event page.
 */
export function EventCard({ event, showStatus = false }: { event: CalendarEvent; showStatus?: boolean }) {
  const place = [event.locationName, event.city, event.country].filter(Boolean).join(', ')
  const phoneMeta = [
    event.viewerIsAttending ? (event.viewerHasPaid ? 'Attending · Paid' : 'Attending') : null,
    showStatus && event.status !== 'published' ? titleCase(event.status) : null,
  ].filter(Boolean).join(' · ')
  return (
    <Link
      href={`/events/${event.id}`}
      aria-label={`View ${event.title}`}
      className="group block h-full rounded-[1.5rem] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-500 max-md:-mx-4 max-md:rounded-none max-md:focus-visible:-outline-offset-2"
    >
      <article className="flex h-full flex-col overflow-hidden rounded-[1.5rem] border border-mist-100 bg-white shadow-[var(--shadow-card)] transition group-hover:-translate-y-0.5 group-hover:border-teal-200 group-hover:shadow-lg max-md:flex-row max-md:items-start max-md:gap-3 max-md:rounded-none max-md:border-0 max-md:px-4 max-md:py-3 max-md:shadow-none max-md:group-hover:translate-y-0 max-md:group-hover:shadow-none">
      {event.bannerUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- only organizer supplied public/signed display URLs are stored
        <img src={event.bannerUrl} alt="" className="h-40 w-full object-cover max-md:h-[72px] max-md:w-24 max-md:shrink-0 max-md:rounded-xl" loading="lazy" />
      ) : (
        <div className="flex h-32 items-end bg-gradient-to-br from-navy-950 via-navy-800 to-teal-700 p-5 text-white max-md:h-[72px] max-md:w-24 max-md:shrink-0 max-md:rounded-xl max-md:p-0">
          <span className="text-xs font-bold uppercase tracking-[0.18em] max-md:hidden">Sea N Shore Events</span>
        </div>
      )}
      <div className="flex flex-1 flex-col gap-4 p-5 max-md:min-w-0 max-md:gap-0.5 max-md:p-0">
        <p className="text-xs font-bold uppercase tracking-wide text-amber-700 md:hidden">{eventCardDateLine(event.startAt, event.timezone)}</p>
        <div className="flex flex-wrap items-center gap-2 max-md:hidden">
          <span className="rounded-full bg-teal-50 px-2.5 py-1 text-xs font-bold text-teal-800">{eventFormatLabel(event.format)}</span>
          <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${event.pricing === 'paid' ? 'bg-amber-50 text-amber-900' : 'bg-emerald-50 text-emerald-800'}`}>{eventPriceLabel(event)}</span>
          <span className="rounded-full bg-navy-50 px-2.5 py-1 text-xs font-semibold text-navy-700">{titleCase(event.category)}</span>
          <span className="rounded-full bg-mist-50 px-2.5 py-1 text-xs font-semibold text-navy-700">{titleCase(event.eventType)}</span>
          {showStatus ? <span className="rounded-full bg-mist-50 px-2.5 py-1 text-xs font-semibold capitalize text-navy-700">{event.status}</span> : null}
          {event.viewerIsAttending ? <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">{event.viewerHasPaid ? 'Attending · Paid' : 'Attending'}</span> : null}
        </div>
        <div>
          <h3 className="text-xl font-bold text-navy-950 transition group-hover:text-teal-700 max-md:line-clamp-2 max-md:text-[15px] max-md:font-semibold max-md:leading-5">{event.title}</h3>
          <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted max-md:hidden">{event.summary}</p>
        </div>
        <p className="truncate text-[13px] text-muted md:hidden">{eventPlaceShort(event)}</p>
        <p className="text-[13px] font-semibold text-teal-700 md:hidden">
          {eventPriceLabel(event)}
          {phoneMeta ? <span className="font-medium text-muted"> · {phoneMeta}</span> : null}
        </p>
        <div className="grid gap-2 text-sm text-navy-700 max-md:hidden">
          <span className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-teal-700" />{dateLabel(event.startAt, event.timezone)}</span>
          <span className="flex items-center gap-2">{event.format === 'online' ? <Monitor className="h-4 w-4 text-teal-700" /> : <MapPin className="h-4 w-4 text-teal-700" />}{event.format === 'online' ? 'Online' : `${place || 'Venue to be confirmed'}${event.format === 'hybrid' ? ' · also online' : ''}`}</span>
          <span className="flex items-center gap-2"><Users className="h-4 w-4 text-teal-700" />{event.attendeeCount}{event.capacity ? ` / ${event.capacity}` : ''} attending</span>
        </div>
        {event.topics.length ? <div className="flex flex-wrap gap-1.5 max-md:hidden">{event.topics.slice(0, 4).map((topic) => <span key={topic} className="rounded-lg bg-mist-50 px-2 py-1 text-xs text-navy-700">{topic}</span>)}</div> : null}
        <p className="mt-auto border-t border-mist-100 pt-3 text-xs text-muted max-md:hidden">Hosted by <span className="font-semibold text-navy-800">{event.publisherName}</span></p>
        <div className="flex items-center justify-between border-t border-mist-100 pt-3 text-sm font-bold text-teal-700 max-md:hidden">
          <span>View event</span>
          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" aria-hidden="true" />
        </div>
      </div>
      </article>
    </Link>
  )
}
