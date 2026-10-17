import { describe, expect, it } from 'vitest'
import { eventJsonLd, eventMetadata } from './event-seo'
import type { CalendarEvent } from './calendar-types'

const event = {
  id: '66666666-6666-4666-8666-666666666666',
  title: 'Ballast water management workshop',
  summary: 'Hands-on workshop on **ballast water** rules.',
  description: 'Full agenda inside.',
  status: 'published',
  format: 'in_person',
  startAt: '2026-11-20T04:30:00.000Z',
  endAt: '2026-11-20T08:30:00.000Z',
  locationName: 'Example Training Centre',
  locationAddress: '12 Harbour Road',
  city: 'Navi Mumbai',
  country: 'India',
  bannerUrl: '/api/media/image/events/6666/banners/banner.jpg?w=1&s=abc',
  publisherType: 'organization',
  publisherName: 'Example Ship Management',
  publisherSlug: 'example-ship-management',
  pricing: 'paid',
  priceMinor: 150000,
  currency: 'INR',
  registrationOpen: true,
  meetingUrl: 'https://meet.example.com/secret-room',
} as unknown as CalendarEvent

const origin = 'https://seanshore.in'

/** Round H (H5): event page search data. */
describe('event search metadata', () => {
  it('gives the event a canonical address and a plain description', () => {
    const metadata = eventMetadata(event)
    expect(metadata.alternates).toEqual({ canonical: '/events/66666666-6666-4666-8666-666666666666' })
    expect(metadata.description).toBe('Hands-on workshop on ballast water rules.')
  })

  it('builds Event data for an in-person paid event with a place, organizer, image and offer', () => {
    expect(eventJsonLd(event, origin)).toEqual({
      '@context': 'https://schema.org',
      '@type': 'Event',
      name: 'Ballast water management workshop',
      url: 'https://seanshore.in/events/66666666-6666-4666-8666-666666666666',
      startDate: '2026-11-20T04:30:00.000Z',
      endDate: '2026-11-20T08:30:00.000Z',
      eventStatus: 'https://schema.org/EventScheduled',
      eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
      location: {
        '@type': 'Place',
        name: 'Example Training Centre',
        address: { '@type': 'PostalAddress', streetAddress: '12 Harbour Road', addressLocality: 'Navi Mumbai', addressCountry: 'India' },
      },
      organizer: { '@type': 'Organization', name: 'Example Ship Management', url: 'https://seanshore.in/organizations/example-ship-management' },
      description: 'Hands-on workshop on ballast water rules.',
      image: ['https://seanshore.in/api/media/image/events/6666/banners/banner.jpg?w=1&s=abc'],
      offers: {
        '@type': 'Offer',
        url: 'https://seanshore.in/events/66666666-6666-4666-8666-666666666666',
        price: '1500.00',
        priceCurrency: 'INR',
        availability: 'https://schema.org/InStock',
      },
    })
  })

  it('points an online event at the event page, never the joining link', () => {
    const data = eventJsonLd({ ...event, format: 'online', pricing: 'free', priceMinor: null, currency: null }, origin)
    expect(data.eventAttendanceMode).toBe('https://schema.org/OnlineEventAttendanceMode')
    expect(data.location).toEqual({ '@type': 'VirtualLocation', url: 'https://seanshore.in/events/66666666-6666-4666-8666-666666666666' })
    expect(data).not.toHaveProperty('offers')
    expect(JSON.stringify(data)).not.toContain('meet.example.com')
  })

  it('marks hybrid events as mixed with both locations and cancelled events as cancelled', () => {
    const data = eventJsonLd({ ...event, format: 'hybrid', status: 'cancelled', publisherType: 'personal', publisherSlug: 'example-host', publisherName: 'Example Host' }, origin)
    expect(data.eventAttendanceMode).toBe('https://schema.org/MixedEventAttendanceMode')
    expect(data.eventStatus).toBe('https://schema.org/EventCancelled')
    expect(data.location).toEqual([
      expect.objectContaining({ '@type': 'Place' }),
      { '@type': 'VirtualLocation', url: 'https://seanshore.in/events/66666666-6666-4666-8666-666666666666' },
    ])
    expect(data.organizer).toEqual({ '@type': 'Person', name: 'Example Host' })
  })

  it('leaves out a short-lived signed banner address', () => {
    const data = eventJsonLd({ ...event, bannerUrl: 'https://bucket.s3.amazonaws.com/events/x.jpg?X-Amz-Signature=abc' }, origin)
    expect(data).not.toHaveProperty('image')
  })
})
