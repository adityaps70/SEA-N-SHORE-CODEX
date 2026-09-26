import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CalendarEventCreateInput } from './calendar-types'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  requireCapability: vi.fn(),
  createEvent: vi.fn(),
  updateEvent: vi.fn(),
  getManagedEventPublisher: vi.fn(),
  countPaidOrdersForEvent: vi.fn(),
  withdrawAttendance: vi.fn(),
  attendEvent: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/features/access/server', () => ({ requireCapability: mocks.requireCapability, userCan: vi.fn(async () => true) }))
vi.mock('@/features/moderation/repository', () => ({ moderationRepository: { flagContentAutomatically: vi.fn() } }))
vi.mock('./event-banner-media', () => ({ prepareEventBannerUpload: vi.fn(), verifyEventBannerReference: vi.fn(async () => undefined) }))
vi.mock('@/features/payments/event-payment-repository', () => ({
  eventPaymentRepository: { countPaidOrdersForEvent: mocks.countPaidOrdersForEvent },
}))
vi.mock('./calendar-repository', () => ({
  calendarEventRepository: {
    createEvent: mocks.createEvent,
    updateEvent: mocks.updateEvent,
    getManagedEventPublisher: mocks.getManagedEventPublisher,
    cancelEvent: vi.fn(),
    attendEvent: mocks.attendEvent,
    withdrawAttendance: mocks.withdrawAttendance,
  },
}))

import { attendEventAction, createEventAction, updateEventAction, withdrawEventAttendanceAction } from './calendar-actions'

const userId = '11111111-1111-4111-8111-111111111111'
const eventId = '22222222-2222-4222-8222-222222222222'

function input(overrides: Partial<CalendarEventCreateInput> = {}): CalendarEventCreateInput {
  return {
    publisherType: 'personal',
    companyId: null,
    title: 'Engine room resource management',
    summary: 'Practical ERM for watchkeepers.',
    description: '',
    category: 'training',
    eventType: 'workshop',
    format: 'hybrid',
    status: 'published',
    startAt: '2030-05-10T09:00:00.000Z',
    endAt: '2030-05-10T12:00:00.000Z',
    timezone: 'Asia/Kolkata',
    locationName: 'Marine Engineering College',
    locationAddress: null,
    city: 'Kolkata',
    country: 'India',
    meetingUrl: 'https://meet.example.com/erm',
    topics: [],
    agenda: [],
    speakers: [],
    speakerDetails: [],
    capacity: 40,
    bannerUrl: null,
    registrationMode: 'open',
    registrationClosesAt: '2030-05-09T12:00:00.000Z',
    pricing: 'paid',
    priceMinor: 150000,
    currency: 'INR',
    ...overrides,
  }
}

function editable(overrides: Partial<CalendarEventCreateInput> = {}) {
  const { publisherType: _publisherType, companyId: _companyId, ...rest } = input(overrides)
  void _publisherType
  void _companyId
  return rest
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAwsUser.mockResolvedValue({ id: userId })
  mocks.requireCapability.mockResolvedValue(undefined)
  mocks.createEvent.mockResolvedValue(eventId)
  mocks.updateEvent.mockResolvedValue(undefined)
  mocks.getManagedEventPublisher.mockResolvedValue({ companyId: null })
  mocks.countPaidOrdersForEvent.mockResolvedValue(0)
})

describe('creating and publishing priced events', () => {
  it('stores a paid hybrid event with its price and currency', async () => {
    await expect(createEventAction(input())).resolves.toEqual({ ok: true, eventId })
    expect(mocks.createEvent).toHaveBeenCalledWith(userId, expect.objectContaining({
      pricing: 'paid',
      priceMinor: 150000,
      currency: 'INR',
      format: 'hybrid',
      meetingUrl: 'https://meet.example.com/erm',
      locationName: 'Marine Engineering College',
    }))
  })

  it('blocks publishing a paid online event without a link or price, with field-level errors', async () => {
    const result = await createEventAction(input({ format: 'online', meetingUrl: null, priceMinor: null, currency: null }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain("can't be published yet")
    expect(result.fieldErrors).toEqual({
      meetingUrl: 'Add the online meeting or registration link.',
      priceMinor: 'Add the ticket price.',
      currency: 'Choose the ticket currency.',
    })
    expect(mocks.createEvent).not.toHaveBeenCalled()
    expect(mocks.requireCapability).not.toHaveBeenCalled()
  })

  it('saves the same incomplete event as a draft', async () => {
    await expect(createEventAction(input({ status: 'draft', format: 'online', meetingUrl: null, priceMinor: null, currency: null, summary: '' })))
      .resolves.toEqual({ ok: true, eventId })
    expect(mocks.createEvent).toHaveBeenCalledWith(userId, expect.objectContaining({ status: 'draft', pricing: 'paid', priceMinor: null }))
  })

  it('blocks an offline event without venue, city and country', async () => {
    const result = await createEventAction(input({ format: 'in_person', pricing: 'free', locationName: null, city: null, country: null }))
    expect(result).toMatchObject({
      ok: false,
      fieldErrors: { locationName: 'Add the venue name.', city: 'Add the city.', country: 'Add the country.' },
    })
  })

  it('does not let an event with paid registrations switch to Free', async () => {
    mocks.countPaidOrdersForEvent.mockResolvedValue(3)
    const result = await updateEventAction(eventId, editable({ pricing: 'free', priceMinor: null, currency: null }))
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/already paid for this event/) })
    expect(mocks.updateEvent).not.toHaveBeenCalled()

    mocks.countPaidOrdersForEvent.mockResolvedValue(0)
    await expect(updateEventAction(eventId, editable({ pricing: 'free', priceMinor: null, currency: null }))).resolves.toEqual({ ok: true })
  })

  it('lets organisers change the price of a paid event', async () => {
    mocks.countPaidOrdersForEvent.mockResolvedValue(3)
    await expect(updateEventAction(eventId, editable({ priceMinor: 199900 }))).resolves.toEqual({ ok: true })
    expect(mocks.updateEvent).toHaveBeenCalledWith(userId, eventId, expect.objectContaining({ priceMinor: 199900 }))
  })
})

describe('free registration on paid events', () => {
  it('explains that paid events need checkout', async () => {
    mocks.attendEvent.mockRejectedValue(new Error('event_requires_payment'))
    await expect(attendEventAction(eventId)).resolves.toEqual({ ok: false, error: 'This is a paid event. Use Pay and register to buy a ticket.' })
  })

  it('explains how paid registrations are cancelled', async () => {
    mocks.withdrawAttendance.mockRejectedValue(new Error('event_paid_registration'))
    await expect(withdrawEventAttendanceAction(eventId)).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/Contact the organiser/) })
  })
})
