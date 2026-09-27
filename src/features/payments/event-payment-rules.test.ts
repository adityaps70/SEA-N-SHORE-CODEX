import { describe, expect, it } from 'vitest'
import { formatMoney, minorToPriceInput, parsePriceToMinor } from './currency'
import { checkoutBlocker, confirmationBlocker, eventPrice, registrationBlockerMessage, type PaidEventSnapshot } from './event-payment-rules'

const now = new Date('2030-01-01T10:00:00.000Z')

function event(overrides: Partial<PaidEventSnapshot> = {}): PaidEventSnapshot {
  return {
    id: 'event-1',
    hostUserId: 'host-1',
    title: 'Paid masterclass',
    status: 'published',
    endAt: new Date('2030-01-05T10:00:00.000Z'),
    capacity: 10,
    registrationMode: 'open',
    registrationClosesAt: new Date('2030-01-04T10:00:00.000Z'),
    isPaid: true,
    priceMinor: 49900,
    currency: 'INR',
    ...overrides,
  }
}

const open = { profileId: 'attendee-1', alreadyRegistered: false, attendeeCount: 3, heldSeats: 0, now }

describe('paid event registration rules', () => {
  it('allows checkout while registration is open and seats remain', () => {
    expect(checkoutBlocker({ ...open, event: event() })).toBeNull()
    expect(eventPrice(event())).toEqual({ amountMinor: 49900, currency: 'INR' })
  })

  it('counts other attendees’ unfinished checkouts against capacity', () => {
    expect(checkoutBlocker({ ...open, event: event({ capacity: 5 }), attendeeCount: 3, heldSeats: 1 })).toBeNull()
    expect(checkoutBlocker({ ...open, event: event({ capacity: 5 }), attendeeCount: 3, heldSeats: 2 })).toBe('event_full')
    expect(checkoutBlocker({ ...open, event: event({ capacity: null }), attendeeCount: 900, heldSeats: 90 })).toBeNull()
  })

  it('blocks checkout when registration is closed, the event ended, or it is not published', () => {
    expect(checkoutBlocker({ ...open, event: event({ registrationClosesAt: new Date('2030-01-01T09:59:00.000Z') }) })).toBe('event_registration_closed')
    expect(checkoutBlocker({ ...open, event: event({ registrationMode: 'closed' }) })).toBe('event_registration_closed')
    expect(checkoutBlocker({ ...open, event: event({ endAt: new Date('2030-01-01T09:00:00.000Z') }) })).toBe('event_ended')
    expect(checkoutBlocker({ ...open, event: event({ status: 'draft' }) })).toBe('event_not_published')
    expect(checkoutBlocker({ ...open, event: event({ status: 'cancelled' }) })).toBe('event_not_published')
  })

  it('blocks hosts, repeat registrations, free events and missing prices', () => {
    expect(checkoutBlocker({ ...open, event: event(), profileId: 'host-1' })).toBe('event_host_cannot_attend')
    expect(checkoutBlocker({ ...open, event: event(), alreadyRegistered: true })).toBe('already_registered')
    expect(checkoutBlocker({ ...open, event: event({ isPaid: false }) })).toBe('event_not_paid')
    expect(checkoutBlocker({ ...open, event: event({ priceMinor: null }) })).toBe('event_price_missing')
    expect(checkoutBlocker({ ...open, event: event({ currency: 'EUR' }) })).toBe('event_price_missing')
    expect(checkoutBlocker({ ...open, event: null })).toBe('event_not_found')
  })

  it('re-checks capacity and closing time when a payment is confirmed, ignoring seat holds', () => {
    expect(confirmationBlocker({ event: event({ capacity: 4 }), alreadyRegistered: false, attendeeCount: 3, now })).toBeNull()
    expect(confirmationBlocker({ event: event({ capacity: 3 }), alreadyRegistered: false, attendeeCount: 3, now })).toBe('event_full')
    expect(confirmationBlocker({ event: event({ registrationClosesAt: new Date('2030-01-01T09:00:00.000Z') }), alreadyRegistered: false, attendeeCount: 0, now })).toBe('event_registration_closed')
    expect(confirmationBlocker({ event: event(), alreadyRegistered: true, attendeeCount: 0, now })).toBe('already_registered')
  })

  it('explains every blocker in plain language', () => {
    for (const code of ['event_full', 'event_registration_closed', 'event_ended', 'event_not_published', 'already_registered']) {
      expect(registrationBlockerMessage(code)).not.toMatch(/_/)
    }
  })
})

describe('ticket price parsing and display', () => {
  it('converts typed prices to minor units', () => {
    expect(parsePriceToMinor('499')).toBe(49900)
    expect(parsePriceToMinor('499.5')).toBe(49950)
    expect(parsePriceToMinor('1,499.99')).toBe(149999)
    expect(parsePriceToMinor('')).toBeNull()
    expect(parsePriceToMinor('4.999')).toBeNaN()
    expect(parsePriceToMinor('abc')).toBeNaN()
    expect(parsePriceToMinor('-5')).toBeNaN()
  })

  it('round-trips minor units back to the form value', () => {
    expect(minorToPriceInput(49900)).toBe('499')
    expect(minorToPriceInput(49950)).toBe('499.50')
    expect(minorToPriceInput(null)).toBe('')
  })

  it('formats prices for INR and USD', () => {
    expect(formatMoney(49900, 'INR')).toBe('₹499')
    expect(formatMoney(150000000, 'INR')).toBe('₹15,00,000')
    expect(formatMoney(2550, 'USD')).toBe('$25.50')
  })
})
