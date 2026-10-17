import type { Metadata } from 'next'
import { isMediaImageLink } from '@/lib/images/media-image-route'
import { indexableMetadata, metaDescription } from '@/lib/seo/meta'
import type { CalendarEvent } from './calendar-types'

/**
 * Round H (H5): search metadata and schema.org Event data for an event page (/events/<id>).
 * The online joining link is never published: the virtual location points at the event page itself.
 */
type EventSeoInput = Pick<
  CalendarEvent,
  | 'id' | 'title' | 'summary' | 'description' | 'status' | 'format' | 'startAt' | 'endAt'
  | 'locationName' | 'locationAddress' | 'city' | 'country' | 'bannerUrl'
  | 'publisherType' | 'publisherName' | 'publisherSlug'
  | 'pricing' | 'priceMinor' | 'currency' | 'registrationOpen'
>

const ATTENDANCE_MODE: Record<CalendarEvent['format'], string> = {
  online: 'https://schema.org/OnlineEventAttendanceMode',
  in_person: 'https://schema.org/OfflineEventAttendanceMode',
  hybrid: 'https://schema.org/MixedEventAttendanceMode',
}

export function eventPath(eventId: string) {
  return `/events/${eventId}`
}

export function eventMetaDescription(event: Pick<EventSeoInput, 'summary' | 'description'>) {
  return metaDescription(event.summary, event.description)
}

export function eventMetadata(event: EventSeoInput): Metadata {
  return indexableMetadata({ title: event.title, description: eventMetaDescription(event), path: eventPath(event.id) })
}

/** A banner address that stays valid: the stable first-party link, or an older plain https address. */
function bannerAddress(bannerUrl: string | null, origin: string) {
  if (!bannerUrl) return null
  if (isMediaImageLink(bannerUrl)) return `${origin}${bannerUrl}`
  return /^https:\/\//i.test(bannerUrl) && !/[?&]X-Amz-/i.test(bannerUrl) ? bannerUrl : null
}

function place(event: EventSeoInput) {
  const address = {
    '@type': 'PostalAddress',
    ...(event.locationAddress ? { streetAddress: event.locationAddress } : {}),
    ...(event.city ? { addressLocality: event.city } : {}),
    ...(event.country ? { addressCountry: event.country } : {}),
  }
  const name = event.locationName || event.city || event.country
  return {
    '@type': 'Place',
    ...(name ? { name } : {}),
    address,
  }
}

function priceOffer(event: EventSeoInput, url: string) {
  if (event.pricing !== 'paid' || !event.priceMinor || !event.currency) return null
  return {
    '@type': 'Offer',
    url,
    // Stored in minor units (paise / cents).
    price: (event.priceMinor / 100).toFixed(2),
    priceCurrency: event.currency,
    ...(event.registrationOpen ? { availability: 'https://schema.org/InStock' } : {}),
  }
}

export function eventJsonLd(event: EventSeoInput, origin: string) {
  const url = `${origin}${eventPath(encodeURIComponent(event.id))}`
  const virtual = { '@type': 'VirtualLocation', url }
  const location = event.format === 'online' ? virtual : event.format === 'hybrid' ? [place(event), virtual] : place(event)
  const organizerUrl = event.publisherType === 'organization' && event.publisherSlug
    ? `${origin}/organizations/${encodeURIComponent(event.publisherSlug)}`
    : null
  const description = eventMetaDescription(event)
  const image = bannerAddress(event.bannerUrl, origin)
  const offers = priceOffer(event, url)
  return {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: event.title,
    url,
    startDate: event.startAt,
    endDate: event.endAt,
    eventStatus: event.status === 'cancelled' ? 'https://schema.org/EventCancelled' : 'https://schema.org/EventScheduled',
    eventAttendanceMode: ATTENDANCE_MODE[event.format],
    location,
    organizer: {
      '@type': event.publisherType === 'organization' ? 'Organization' : 'Person',
      name: event.publisherName,
      ...(organizerUrl ? { url: organizerUrl } : {}),
    },
    ...(description ? { description } : {}),
    ...(image ? { image: [image] } : {}),
    ...(offers ? { offers } : {}),
  }
}
