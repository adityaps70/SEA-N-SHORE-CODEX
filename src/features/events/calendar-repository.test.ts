import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  query: vi.fn(),
  txQuery: vi.fn(),
}))

vi.mock('@/lib/db/client', () => ({
  query: db.query,
  withTransaction: async (callback: (client: { query: typeof db.txQuery }) => unknown) => callback({ query: db.txQuery }),
}))

import { calendarEventRepository } from './calendar-repository'

const viewerId = '11111111-1111-4111-8111-111111111111'
const eventId = '22222222-2222-4222-8222-222222222222'
const hostId = '33333333-3333-4333-8333-333333333333'

const row = {
  id: eventId,
  host_user_id: hostId,
  host_name: 'Capt. Host',
  host_slug: 'capt-host',
  title: 'SIRE 2.0 Masterclass',
  summary: 'Practical readiness session',
  description: 'Detailed session',
  category: 'training',
  event_type: 'masterclass',
  format: 'hybrid',
  status: 'published',
  start_at: '2026-10-10T03:30:00.000Z',
  end_at: '2026-10-10T06:30:00.000Z',
  timezone: 'Asia/Kolkata',
  location_name: 'Maritime Centre',
  location_address: 'Harbour Road',
  city: 'Mumbai',
  country: 'India',
  meeting_url: null,
  topics: ['SIRE 2.0'],
  agenda: ['Welcome', 'Readiness'],
  speakers: ['Capt. Speaker'],
  speaker_details: [{ name: 'Capt. Speaker', title: 'Master Mariner', organization: 'Sea N Shore' }],
  capacity: 50,
  banner_url: null,
  registration_mode: 'open',
  registration_closes_at: '2026-10-10T02:30:00.000Z',
  attendee_count: '4',
  viewer_is_attending: false,
  viewer_is_host: false,
  registration_open: true,
  is_past: false,
  created_at: '2026-09-12T10:00:00.000Z',
  updated_at: '2026-09-12T10:00:00.000Z',
}

beforeEach(() => {
  db.query.mockReset()
  db.txQuery.mockReset()
})

describe('calendar event repository', () => {
  it('maps event rows and applies discovery filters', async () => {
    db.query.mockResolvedValue([row])
    const result = await calendarEventRepository.listDiscoverEvents(viewerId, {
      search: 'SIRE', category: 'training', eventType: 'masterclass', format: 'hybrid', location: 'Mumbai',
    })
    expect(result[0]).toMatchObject({ id: eventId, category: 'training', eventType: 'masterclass', city: 'Mumbai', attendeeCount: 4, registrationOpen: true, isPast: false })
    expect(result[0]?.agenda).toEqual(['Welcome', 'Readiness'])
    expect(result[0]?.speakerDetails[0]?.organization).toBe('Sea N Shore')
    expect(db.query.mock.calls[0]?.[1]).toEqual([viewerId, 'SIRE', 'training', 'masterclass', 'hybrid', 'Mumbai'])
  })

  it('queries attending and hosting views using the authenticated user id', async () => {
    db.query.mockResolvedValue([])
    await calendarEventRepository.listMyEvents(viewerId)
    await calendarEventRepository.listMyPastEvents(viewerId)
    await calendarEventRepository.listHostedEvents(viewerId)
    expect(String(db.query.mock.calls[0]?.[0])).toContain('event_attendees')
    expect(String(db.query.mock.calls[1]?.[0])).toContain('e.end_at <= now()')
    expect(String(db.query.mock.calls[2]?.[0])).toContain('e.host_user_id = $1::uuid')
  })

  it('enforces organizer authorization on edit and cancel', async () => {
    db.query.mockResolvedValue([])
    const input = {
      title: 'Event', summary: 'Summary', description: '', category: 'community' as const, eventType: 'community' as const,
      format: 'online' as const, status: 'draft' as const, startAt: '2026-10-10T09:00:00.000Z', endAt: '2026-10-10T10:00:00.000Z',
      timezone: 'UTC', locationName: null, locationAddress: null, city: null, country: null, meetingUrl: 'https://example.com',
      topics: [], agenda: [], speakers: [], speakerDetails: [], capacity: null, bannerUrl: null, registrationMode: 'open' as const, registrationClosesAt: null,
    }
    await expect(calendarEventRepository.updateEvent(viewerId, eventId, input)).rejects.toThrow('event_forbidden')
    await expect(calendarEventRepository.cancelEvent(viewerId, eventId)).rejects.toThrow('event_forbidden')
  })

  it('makes duplicate attendance idempotent', async () => {
    db.txQuery
      .mockResolvedValueOnce({ rows: [{ id: eventId, host_user_id: hostId, status: 'published', end_at: '2099-01-01T00:00:00.000Z', capacity: 1, registration_mode: 'open', registration_closes_at: null }] })
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
    await expect(calendarEventRepository.attendEvent(viewerId, eventId)).resolves.toBeUndefined()
    expect(db.txQuery).toHaveBeenCalledTimes(2)
  })

  it('rejects new attendance when capacity is full', async () => {
    db.txQuery
      .mockResolvedValueOnce({ rows: [{ id: eventId, host_user_id: hostId, status: 'published', end_at: '2099-01-01T00:00:00.000Z', capacity: 1, registration_mode: 'open', registration_closes_at: null }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] })
    await expect(calendarEventRepository.attendEvent(viewerId, eventId)).rejects.toThrow('event_full')
  })

  it('registers once when capacity is available and withdrawal is idempotent', async () => {
    db.txQuery
      .mockResolvedValueOnce({ rows: [{ id: eventId, host_user_id: hostId, status: 'published', end_at: '2099-01-01T00:00:00.000Z', capacity: 2, registration_mode: 'open', registration_closes_at: null }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] })
      .mockResolvedValueOnce({ rows: [] })
    await calendarEventRepository.attendEvent(viewerId, eventId)
    expect(String(db.txQuery.mock.calls[3]?.[0])).toContain('on conflict (event_id, user_id) do nothing')

    db.query.mockResolvedValue([])
    await expect(calendarEventRepository.withdrawAttendance(viewerId, eventId)).resolves.toBeUndefined()
    expect(String(db.query.mock.calls[0]?.[0])).toContain('delete from public.event_attendees')
  })
})
