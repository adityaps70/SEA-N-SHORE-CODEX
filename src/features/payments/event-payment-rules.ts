import { isPaymentCurrency } from './currency'
import type { PaymentCurrency } from './types'

/** How long an unfinished checkout holds a seat for its attendee. */
export const CHECKOUT_HOLD_MINUTES = 20
/**
 * How long a gateway order can be paid. Longer than the seat hold so a buyer who is
 * mid-payment is not cut off; a late payment is still checked against capacity.
 * Cashfree expects order_expiry_time at least 15 minutes ahead.
 */
export const GATEWAY_ORDER_LIFETIME_MINUTES = 30
/** The payment window closes itself after this long (a little under the hold). */
export const CHECKOUT_TIMEOUT_SECONDS = 15 * 60

export const PAYMENTS_NOT_CONFIGURED_MESSAGE = "Registration opens soon — payments aren't set up yet."

/** Buyers: the event is priced in a currency the payment gateway cannot take yet. */
export const CURRENCY_UNAVAILABLE_BUYER_MESSAGE = "Tickets for this event are priced in US dollars, which Sea N Shore can't accept yet. Ask the organiser to switch the price to Indian rupees (INR)."
/** Organisers choosing a currency the gateway cannot take yet. */
export const CURRENCY_UNAVAILABLE_ORGANIZER_MESSAGE = "Sea N Shore can only take payments in Indian rupees (INR) right now. You can save a US dollar price, but attendees won't be able to pay until US dollar payments are switched on. Choose INR to start selling tickets now."

export type PaidEventSnapshot = {
  id: string
  hostUserId: string
  /** Set when the event is hosted as an organization; that organization is the seller. */
  companyId?: string | null
  title: string
  status: 'draft' | 'published' | 'cancelled'
  endAt: Date
  capacity: number | null
  registrationMode: 'open' | 'closed'
  registrationClosesAt: Date | null
  isPaid: boolean
  priceMinor: number | null
  currency: string | null
}

export type EventRegistrationBlocker =
  | 'event_not_found'
  | 'event_not_paid'
  | 'event_price_missing'
  | 'event_host_cannot_attend'
  | 'event_not_published'
  | 'event_ended'
  | 'event_registration_closed'
  | 'event_full'
  | 'already_registered'
  | 'event_currency_unsupported'

export function eventPrice(event: PaidEventSnapshot): { amountMinor: number; currency: PaymentCurrency } | null {
  if (!event.isPaid || !event.priceMinor || event.priceMinor <= 0 || !isPaymentCurrency(event.currency)) return null
  return { amountMinor: event.priceMinor, currency: event.currency }
}

function registrationWindowBlocker(event: PaidEventSnapshot, now: Date): EventRegistrationBlocker | null {
  if (event.status !== 'published') return 'event_not_published'
  if (event.endAt.getTime() <= now.getTime()) return 'event_ended'
  if (event.registrationMode !== 'open') return 'event_registration_closed'
  if (event.registrationClosesAt && event.registrationClosesAt.getTime() <= now.getTime()) return 'event_registration_closed'
  return null
}

/**
 * Can this attendee start paying for this event right now?
 * `heldSeats` are unfinished checkouts by other attendees that still hold a seat.
 */
export function checkoutBlocker(input: {
  event: PaidEventSnapshot | null
  profileId: string
  alreadyRegistered: boolean
  attendeeCount: number
  heldSeats: number
  now: Date
}): EventRegistrationBlocker | null {
  const { event } = input
  if (!event) return 'event_not_found'
  if (!event.isPaid) return 'event_not_paid'
  if (!eventPrice(event)) return 'event_price_missing'
  if (event.hostUserId === input.profileId) return 'event_host_cannot_attend'
  const window = registrationWindowBlocker(event, input.now)
  if (window) return window
  if (input.alreadyRegistered) return 'already_registered'
  if (event.capacity !== null && input.attendeeCount + input.heldSeats >= event.capacity) return 'event_full'
  return null
}

/**
 * Once a payment has succeeded, can the seat still be confirmed?
 * Seat holds are not counted here: the attendee who paid owns their hold.
 */
export function confirmationBlocker(input: {
  event: PaidEventSnapshot | null
  alreadyRegistered: boolean
  attendeeCount: number
  now: Date
}): EventRegistrationBlocker | null {
  const { event } = input
  if (!event) return 'event_not_found'
  const window = registrationWindowBlocker(event, input.now)
  if (window) return window
  if (input.alreadyRegistered) return 'already_registered'
  if (event.capacity !== null && input.attendeeCount >= event.capacity) return 'event_full'
  return null
}

export function registrationBlockerMessage(code: string) {
  switch (code) {
    case 'event_not_found': return 'This event is no longer available.'
    case 'event_not_paid': return 'This event is free. Use Register for event instead.'
    case 'event_price_missing': return 'The organiser has not set a ticket price yet, so registration is not open.'
    case 'event_host_cannot_attend': return 'Hosts are already part of their own event.'
    case 'event_not_published': return 'Registration opens once the organiser publishes this event.'
    case 'event_ended': return 'Registration is no longer available because this event has ended.'
    case 'event_registration_closed': return 'Registration for this event has closed.'
    case 'event_full': return 'This event has reached its attendee capacity. No seats are available right now.'
    case 'already_registered': return 'You are already registered for this event.'
    case 'event_currency_unsupported': return CURRENCY_UNAVAILABLE_BUYER_MESSAGE
    default: return 'Registration is not open for this event.'
  }
}

/** Plain-language reason shown to organisers and attendees when a paid seat must be refunded. */
export function refundReasonLabel(code: string | null) {
  switch (code) {
    case 'event_full': return 'The event was full when the payment arrived.'
    case 'event_registration_closed': return 'Registration had closed when the payment arrived.'
    case 'event_ended': return 'The event had ended when the payment arrived.'
    case 'event_not_published':
    case 'event_not_found': return 'The event was no longer open when the payment arrived.'
    case 'already_registered': return 'The attendee was already registered, so this was a duplicate payment.'
    case 'amount_mismatch': return 'The amount paid did not match the ticket price.'
    case 'event_cancelled': return 'The event was cancelled because its organiser left Sea N Shore.'
    default: return code ? 'The seat could not be confirmed.' : ''
  }
}

/** Organiser-facing status for one payment order. */
export function paymentStatusLabel(row: { status: string; registrationConfirmedAt: string | null; refundStatus?: string | null }) {
  if (row.refundStatus === 'requested') return { label: 'Refund in progress', tone: 'bg-amber-50 text-amber-900' }
  if (row.status === 'refunded' && row.refundStatus === 'failed') return { label: 'Refund failed', tone: 'bg-rose-50 text-rose-700' }
  if (row.status === 'refunded' && row.refundStatus === 'pending') return { label: 'Refund on its way', tone: 'bg-mist-50 text-navy-700' }
  if (row.status === 'paid' && row.refundStatus === 'failed') return { label: 'Refund failed', tone: 'bg-rose-50 text-rose-700' }
  if (row.status === 'paid' && row.registrationConfirmedAt) return { label: 'Paid', tone: 'bg-emerald-50 text-emerald-800' }
  if (row.status === 'paid') return { label: 'Refund due', tone: 'bg-amber-50 text-amber-900' }
  if (row.status === 'refunded') return { label: 'Refunded', tone: 'bg-mist-50 text-navy-700' }
  if (row.status === 'failed') return { label: 'Payment failed', tone: 'bg-rose-50 text-rose-700' }
  if (row.status === 'created') return { label: 'Checkout not finished', tone: 'bg-mist-50 text-navy-700' }
  return { label: 'Cancelled', tone: 'bg-mist-50 text-navy-700' }
}
