import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CalendarEventCreateInput } from './calendar-types'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  verifyEventBannerReference: vi.fn(),
  createEvent: vi.fn(),
  updateEvent: vi.fn(),
  getManagedEventPublisher: vi.fn(),
  flagContentAutomatically: vi.fn(),
  revalidatePath: vi.fn(),
  requireCapability: vi.fn(async () => undefined),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/features/access/server', () => ({ requireCapability: mocks.requireCapability }))
vi.mock('@/features/moderation/repository', () => ({
  moderationRepository: { flagContentAutomatically: mocks.flagContentAutomatically },
}))
vi.mock('./event-banner-media', () => ({
  prepareEventBannerUpload: vi.fn(),
  verifyEventBannerReference: mocks.verifyEventBannerReference,
}))
vi.mock('./calendar-repository', () => ({
  calendarEventRepository: {
    createEvent: mocks.createEvent,
    updateEvent: mocks.updateEvent,
    getManagedEventPublisher: mocks.getManagedEventPublisher,
    cancelEvent: vi.fn(),
    attendEvent: vi.fn(),
    withdrawAttendance: vi.fn(),
  },
}))

import { createEventAction, updateEventAction } from './calendar-actions'

const eventId = '22222222-2222-4222-8222-222222222222'

function input(overrides: Partial<CalendarEventCreateInput> = {}): CalendarEventCreateInput {
  return {
    publisherType: 'personal',
    companyId: null,
    title: 'SIRE 2.0 Readiness',
    summary: 'Practical inspection-readiness session.',
    description: 'A professional training session for tanker officers.',
    category: 'training',
    eventType: 'masterclass',
    format: 'online',
    status: 'published',
    startAt: '2026-10-10T09:00:00.000Z',
    endAt: '2026-10-10T10:00:00.000Z',
    timezone: 'UTC',
    locationName: null,
    locationAddress: null,
    city: null,
    country: null,
    meetingUrl: 'https://example.com/session',
    topics: ['SIRE 2.0'],
    agenda: ['Readiness'],
    speakers: ['Capt. Example'],
    speakerDetails: [{ name: 'Capt. Example', title: 'Master Mariner', organization: 'Sea N Shore' }],
    capacity: 100,
    bannerUrl: null,
    registrationMode: 'open',
    registrationClosesAt: null,
    ...overrides,
  }
}

describe('calendar actions automated moderation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAwsUser.mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111' })
    mocks.verifyEventBannerReference.mockResolvedValue(undefined)
    mocks.createEvent.mockResolvedValue(eventId)
    mocks.updateEvent.mockResolvedValue(undefined)
    mocks.getManagedEventPublisher.mockResolvedValue({ companyId: null })
    mocks.flagContentAutomatically.mockResolvedValue(undefined)
    mocks.requireCapability.mockResolvedValue(undefined)
  })

  it('blocks high-confidence unsafe published event text before mutation', async () => {
    const result = await createEventAction(input({
      description: 'Send your OTP and password to verify your account immediately.',
    }))

    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/community safety rules/i) })
    expect(mocks.createEvent).not.toHaveBeenCalled()
  })

  it('requires personal event publishing capability for published events but not private drafts', async () => {
    await expect(createEventAction(input())).resolves.toEqual({ ok: true, eventId })
    expect(mocks.requireCapability).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      'event.publish',
    )

    mocks.requireCapability.mockClear()
    await expect(createEventAction(input({ status: 'draft' }))).resolves.toEqual({ ok: true, eventId })
    expect(mocks.requireCapability).not.toHaveBeenCalled()
  })

  it('requires organization-scoped event publishing capability when publishing for an organization', async () => {
    const companyId = '33333333-3333-4333-8333-333333333333'

    await expect(createEventAction(input({
      publisherType: 'organization',
      companyId,
    }))).resolves.toEqual({ ok: true, eventId })

    expect(mocks.requireCapability).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      'event.publish',
      { companyId },
    )
    expect(mocks.createEvent).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      expect.objectContaining({ publisherType: 'organization', companyId }),
    )
  })

  it('fails closed when published event access is missing', async () => {
    mocks.requireCapability.mockRejectedValueOnce(new Error('capability_required'))

    await expect(createEventAction(input())).resolves.toEqual({
      ok: false,
      error: expect.stringMatching(/creator pro|organization pro|event publishing/i),
    })
    expect(mocks.createEvent).not.toHaveBeenCalled()
  })

  it('opens an automated moderation case for review-level published event text', async () => {
    await expect(createEventAction(input({
      description: 'Guaranteed job. Pay the registration fee now and contact us on WhatsApp.',
    }))).resolves.toEqual({ ok: true, eventId })

    expect(mocks.flagContentAutomatically).toHaveBeenCalledWith(expect.objectContaining({
      targetType: 'event',
      targetId: eventId,
      reason: 'scam',
      details: expect.stringContaining('[AUTOMATED MODERATION]'),
    }))
  })

  it('uses the stored organization publisher scope when republishing an organization event', async () => {
    const companyId = '33333333-3333-4333-8333-333333333333'
    mocks.getManagedEventPublisher.mockResolvedValueOnce({ companyId })

    const { publisherType: _publisherType, companyId: _companyId, ...editable } = input()
    void _publisherType
    void _companyId

    await expect(updateEventAction(eventId, editable)).resolves.toEqual({ ok: true })

    expect(mocks.requireCapability).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      'event.publish',
      { companyId },
    )
  })

  it('rechecks published event edits', async () => {
    const { publisherType: _publisherType, companyId: _companyId, ...editable } = input({
      summary: 'You are a useless idiot and should never work here.',
    })
    void _publisherType
    void _companyId

    await expect(updateEventAction(eventId, editable)).resolves.toEqual({ ok: true })

    expect(mocks.updateEvent).toHaveBeenCalled()
    expect(mocks.flagContentAutomatically).toHaveBeenCalledWith(expect.objectContaining({
      targetType: 'event',
      targetId: eventId,
      reason: 'harassment',
    }))
  })
})
