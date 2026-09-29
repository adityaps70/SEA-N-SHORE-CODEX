import { formatMoney } from '@/features/payments/currency'
import type { CalendarEvent, CalendarEventFormat } from './calendar-types'

/** Attendee-facing names for how an event is attended. "in_person" is shown as Offline. */
export function eventFormatLabel(format: CalendarEventFormat) {
  if (format === 'in_person') return 'Offline'
  if (format === 'hybrid') return 'Hybrid'
  return 'Online'
}

/** "Free", or the ticket price such as "₹499". */
export function eventPriceLabel(event: Pick<CalendarEvent, 'pricing' | 'priceMinor' | 'currency'>) {
  if (event.pricing !== 'paid') return 'Free'
  if (!event.priceMinor || !event.currency) return 'Paid'
  return formatMoney(event.priceMinor, event.currency)
}

/**
 * Where "Hosted by" links: a member's public profile (/people/{slug}) or the organization page.
 * Null when the publisher has no public page.
 */
export function eventPublisherHref(event: Pick<CalendarEvent, 'publisherType' | 'publisherSlug'>) {
  if (!event.publisherSlug) return null
  return event.publisherType === 'organization'
    ? `/organizations/${event.publisherSlug}`
    : `/people/${event.publisherSlug}`
}

/** Short place for phone rows and chips: "Online", "Navi Mumbai & online", "Navi Mumbai". */
export function eventPlaceShort(event: Pick<CalendarEvent, 'format' | 'locationName' | 'city' | 'country'>) {
  if (event.format === 'online') return 'Online'
  const place = event.city || event.locationName || event.country || 'Venue to be confirmed'
  return event.format === 'hybrid' ? `${place} & online` : place
}
