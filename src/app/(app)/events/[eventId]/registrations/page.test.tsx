import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  getEvent: vi.fn(),
  listEventPaymentsForManager: vi.fn(),
  arePaymentsConfigured: vi.fn(),
  redirect: vi.fn((href: string) => { throw new Error(`NEXT_REDIRECT ${href}`) }),
}))

vi.mock('next/navigation', () => ({ notFound: vi.fn(), redirect: mocks.redirect, useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/features/events/calendar-repository', () => ({ calendarEventRepository: { getEvent: mocks.getEvent } }))
vi.mock('@/features/payments/event-payment-repository', () => ({ eventPaymentRepository: { listEventPaymentsForManager: mocks.listEventPaymentsForManager } }))
vi.mock('@/features/payments/provider', () => ({ arePaymentsConfigured: mocks.arePaymentsConfigured }))
vi.mock('@/features/payments/components/event-refund-button', () => ({ EventRefundButton: () => <button type="button">Refund</button> }))

import EventRegistrationsPage from './page'

afterEach(() => cleanup())
beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAwsUser.mockResolvedValue({ id: 'host-1' })
  mocks.arePaymentsConfigured.mockResolvedValue(true)
  mocks.getEvent.mockResolvedValue({ id: 'e1', title: 'SIRE workshop', viewerIsHost: true, pricing: 'paid', priceMinor: 49900, currency: 'INR', capacity: 20, companyId: null })
  mocks.listEventPaymentsForManager.mockResolvedValue([{
    id: 'o1', attendeeName: 'Grace Santos', attendeeSlug: 'grace', status: 'paid', registrationConfirmedAt: '2026-09-20T00:00:00.000Z',
    amountMinor: 49900, currency: 'INR', paidAt: '2026-09-20T00:00:00.000Z', createdAt: '2026-09-20T00:00:00.000Z', refundedAt: null,
    refundStatus: null, refundDueReason: null, providerPaymentId: null,
  }])
})

describe('/events/[eventId]/registrations', () => {
  it('links attendee names to their public profile at /people/{slug}', async () => {
    render(await EventRegistrationsPage({ params: Promise.resolve({ eventId: 'e1' }) }))
    expect(screen.getByRole('link', { name: 'Grace Santos' })).toHaveAttribute('href', '/people/grace')
    expect(document.querySelector('a[href^="/profile/"]')).toBeNull()
  })

  it('has a phone page bar back to the event', async () => {
    render(await EventRegistrationsPage({ params: Promise.resolve({ eventId: 'e1' }) }))
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/events/e1')
  })
})
