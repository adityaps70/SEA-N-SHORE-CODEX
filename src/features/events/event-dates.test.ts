import { describe, expect, it } from 'vitest'
import { eventCardDateLine, eventDetailDateLine } from './event-dates'
import { eventPlaceShort, eventPublisherHref } from './event-labels'

describe('phone event date lines', () => {
  it('formats list rows and the detail line in the event timezone', () => {
    expect(eventCardDateLine('2026-10-03T11:30:00.000Z', 'Asia/Kolkata')).toBe('Sat, 3 Oct · 5:00 pm')
    expect(eventDetailDateLine('2026-10-03T11:30:00.000Z', '2026-10-03T13:30:00.000Z', 'Asia/Kolkata')).toBe('Sat, 3 Oct 2026 · 5:00 – 7:00 pm IST')
  })

  it('shows only the start time for events that run over several days, and survives unknown timezones', () => {
    expect(eventDetailDateLine('2026-10-03T11:30:00.000Z', '2026-10-05T11:30:00.000Z', 'Asia/Kolkata')).toBe('Sat, 3 Oct 2026 · 5:00 pm IST')
    expect(() => eventCardDateLine('2026-10-03T11:30:00.000Z', 'Not/AZone')).not.toThrow()
  })
})

describe('event labels', () => {
  it('links hosts to /people or the organization page, never /profile', () => {
    expect(eventPublisherHref({ publisherType: 'personal', publisherSlug: 'grace' })).toBe('/people/grace')
    expect(eventPublisherHref({ publisherType: 'organization', publisherSlug: 'oceanic' })).toBe('/organizations/oceanic')
    expect(eventPublisherHref({ publisherType: 'personal', publisherSlug: null })).toBeNull()
  })

  it('gives a short place for phone rows', () => {
    const base = { locationName: 'Hall', city: 'Navi Mumbai', country: 'India' }
    expect(eventPlaceShort({ ...base, format: 'online' })).toBe('Online')
    expect(eventPlaceShort({ ...base, format: 'hybrid' })).toBe('Navi Mumbai & online')
    expect(eventPlaceShort({ ...base, format: 'in_person' })).toBe('Navi Mumbai')
  })
})
