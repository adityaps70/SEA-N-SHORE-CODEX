import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({ query: vi.fn(), txQuery: vi.fn() }))

vi.mock('@/lib/db/client', () => ({
  query: db.query,
  withTransaction: async (callback: (client: { query: typeof db.txQuery }) => unknown) => callback({ query: db.txQuery }),
}))
vi.mock('./event-banner-media', () => ({ resolveEventBannerReference: async (value: string | null) => value }))

import { calendarEventRepository } from './calendar-repository'
import type { CalendarEventCreateInput } from './calendar-types'

const viewerId = '11111111-1111-4111-8111-111111111111'
const eventId = '22222222-2222-4222-8222-222222222222'

const paidInput: CalendarEventCreateInput = {
  publisherType: 'personal',
  companyId: null,
  title: 'Paid workshop',
  summary: 'Summary',
  description: '',
  category: 'training',
  eventType: 'workshop',
  format: 'online',
  status: 'published',
  startAt: '2030-10-10T09:00:00.000Z',
  endAt: '2030-10-10T10:00:00.000Z',
  timezone: 'UTC',
  locationName: null,
  locationAddress: null,
  city: null,
  country: null,
  meetingUrl: 'https://meet.example.com/x',
  topics: [],
  agenda: [],
  speakers: [],
  speakerDetails: [],
  capacity: 20,
  bannerUrl: null,
  registrationMode: 'open',
  registrationClosesAt: null,
  pricing: 'paid',
  priceMinor: 250000,
  currency: 'USD',
}

beforeEach(() => {
  db.query.mockReset()
  db.txQuery.mockReset()
})

describe('calendar event repository pricing', () => {
  it('writes is_paid, price_minor and currency on create and update', async () => {
    db.query.mockResolvedValueOnce([{ id: eventId }])
    await calendarEventRepository.createEvent(viewerId, paidInput)
    const [sql, values] = db.query.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('is_paid, price_minor, currency')
    expect(sql).toContain('$26::boolean, $27::bigint, $28::text')
    expect(values.slice(-3)).toEqual([true, 250000, 'USD'])

    db.query.mockResolvedValueOnce([{ id: eventId }])
    const { publisherType: _publisherType, companyId: _companyId, ...editable } = paidInput
    void _publisherType
    void _companyId
    await calendarEventRepository.updateEvent(viewerId, eventId, { ...editable, pricing: 'free', priceMinor: 999, currency: 'INR' })
    const [updateSql, updateValues] = db.query.mock.calls[1] as [string, unknown[]]
    expect(updateSql).toContain('is_paid=$26::boolean, price_minor=$27::bigint, currency=$28::text')
    expect(updateValues.slice(-3)).toEqual([false, null, null])
  })

  it('maps pricing and the viewer’s paid seat, and keeps the joining link private in SQL', async () => {
    db.query.mockResolvedValueOnce([{
      id: eventId, host_user_id: viewerId, host_name: 'Host', host_slug: null, title: 'Paid workshop', summary: 'S', description: '',
      category: 'training', event_type: 'workshop', format: 'online', status: 'published', start_at: '2030-10-10T09:00:00.000Z',
      end_at: '2030-10-10T10:00:00.000Z', timezone: 'UTC', location_name: null, location_address: null, city: null, country: null,
      meeting_url: null, topics: [], agenda: [], speakers: [], speaker_details: [], capacity: 20, banner_url: null,
      registration_mode: 'open', registration_closes_at: null, is_paid: true, price_minor: '250000', currency: 'USD',
      attendee_count: '3', viewer_is_attending: true, viewer_has_paid: true, viewer_is_host: false, registration_open: true, is_past: false,
      created_at: '2030-01-01T00:00:00.000Z', updated_at: '2030-01-01T00:00:00.000Z',
    }])
    const event = await calendarEventRepository.getEvent(eventId, viewerId)
    expect(event).toMatchObject({ pricing: 'paid', priceMinor: 250000, currency: 'USD', viewerHasPaid: true })
    const sql = String(db.query.mock.calls[0]?.[0])
    expect(sql).toContain('then e.meeting_url')
    expect(sql).toContain('else null')
    expect(sql).toContain('payment_order_id is not null')
  })

  it('refuses one-click registration for paid events', async () => {
    db.txQuery.mockResolvedValueOnce({ rows: [{ id: eventId, host_user_id: 'someone-else', status: 'published', end_at: '2099-01-01T00:00:00.000Z', capacity: null, registration_mode: 'open', registration_closes_at: null, is_paid: true }] })
    await expect(calendarEventRepository.attendEvent(viewerId, eventId)).rejects.toThrow('event_requires_payment')
    expect(db.txQuery).toHaveBeenCalledTimes(1)
  })

  it('does not delete a paid seat when the attendee withdraws', async () => {
    db.query.mockResolvedValueOnce([]).mockResolvedValueOnce([{ '?column?': 1 }])
    await expect(calendarEventRepository.withdrawAttendance(viewerId, eventId)).rejects.toThrow('event_paid_registration')
    expect(String(db.query.mock.calls[0]?.[0])).toContain('payment_order_id is null')
  })
})
