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
