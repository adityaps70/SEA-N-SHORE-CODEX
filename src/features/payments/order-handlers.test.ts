import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db/client', () => ({ query: vi.fn(), withTransaction: vi.fn() }))
vi.mock('./event-payment-runtime', () => ({ eventPaymentService: { applyGatewayEvent: vi.fn(), confirmByProviderOrderId: vi.fn() } }))
const courseMocks = vi.hoisted(() => ({ applyGatewayEvent: vi.fn(), confirmByProviderOrderId: vi.fn(), getCourseSlug: vi.fn() }))
vi.mock('@/features/learning/course-payment-runtime', () => ({
  coursePaymentService: { applyGatewayEvent: courseMocks.applyGatewayEvent, confirmByProviderOrderId: courseMocks.confirmByProviderOrderId },
}))
vi.mock('@/features/learning/course-payment-repository', () => ({ coursePaymentRepository: { getCourseSlug: courseMocks.getCourseSlug } }))

import { confirmCourseCheckoutForViewer, confirmCoursePaymentOrder } from './course-order-handler'
import { eventViewerResult } from './event-order-handler'
import type { EventPaymentOrder } from './event-payment-repository'
import { ORDER_HANDLERS, orderHandlerFor } from './order-handlers'

const order: EventPaymentOrder = {
  id: '33333333-3333-4333-8333-333333333333',
  eventId: '22222222-2222-4222-8222-222222222222',
  profileId: '11111111-1111-4111-8111-111111111111',
  eventTitle: 'Paid masterclass',
  amountMinor: 49950,
  currency: 'INR',
  provider: 'cashfree',
  providerOrderId: 'evt_33333333333343338333333333333333',
  providerPaymentId: 'cf_1',
  providerSessionId: 's',
  status: 'paid',
  registrationConfirmedAt: '2030-01-01T10:05:00.000Z',
  refundDueReason: null,
  refundStatus: null,
  refundAttempts: 0,
  providerRefundId: null,
  createdAt: '2030-01-01T10:00:00.000Z',
}

describe('order handler registry', () => {
  it('routes by gateway order id prefix', () => {
    expect(orderHandlerFor('evt_33333333333343338333333333333333')).toBe(ORDER_HANDLERS.event)
    expect(orderHandlerFor('order_Nb2zVf5ha')).toBe(ORDER_HANDLERS.event)
    expect(orderHandlerFor('crs_33333333333343338333333333333333')).toBe(ORDER_HANDLERS.course)
    expect(orderHandlerFor('pln_33333333333343338333333333333333')).toBeNull()
    expect(orderHandlerFor('something_else')).toBeNull()
  })

  it('hands course orders to the paid-courses service and says where the learner goes next', async () => {
    const tx = { query: vi.fn() }
    const event = {
      kind: 'payment_succeeded' as const, provider: 'cashfree' as const, providerOrderId: 'crs_1', providerPaymentId: 'p', amountMinor: 1, currency: 'INR', occurredAt: null,
    }
    courseMocks.applyGatewayEvent.mockResolvedValueOnce({ handled: true, revalidatePaths: ['/learn/my-learning'] })
    await expect(confirmCoursePaymentOrder(tx, event)).resolves.toEqual({ handled: true, revalidatePaths: ['/learn/my-learning'] })
    expect(courseMocks.applyGatewayEvent).toHaveBeenCalledWith(tx, event)

    courseMocks.confirmByProviderOrderId.mockResolvedValueOnce({
      state: 'enrolled',
      order: { id: order.id, courseId: 'course-1', courseTitle: 'SIRE 2.0 Masterclass', amountMinor: 499900, currency: 'INR' },
    })
    courseMocks.getCourseSlug.mockResolvedValueOnce('sire-2-masterclass')
    await expect(confirmCourseCheckoutForViewer({ profileId: order.profileId!, providerOrderId: 'crs_1' })).resolves.toMatchObject({
      state: 'paid',
      message: 'We received ₹4,999 for SIRE 2.0 Masterclass. The course is now in My Learning.',
      returnHref: '/learn/courses/sire-2-masterclass/learn',
    })

    courseMocks.confirmByProviderOrderId.mockResolvedValueOnce(null)
    await expect(confirmCourseCheckoutForViewer({ profileId: order.profileId!, providerOrderId: 'crs_1' })).resolves.toMatchObject({ state: 'not_found', returnHref: '/learn/my-learning' })
  })
})

describe('event payment results for the return page', () => {
  it('says exactly what was paid and where to go next', () => {
    expect(eventViewerResult({ state: 'registered', order })).toEqual({
      state: 'paid',
      title: 'Payment received — your seat is confirmed',
      message: "We received ₹499.50 for Paid masterclass. You'll find the event in My events.",
      returnHref: `/events/${order.eventId}`,
      returnLabel: 'Back to the event',
    })
  })

  it('explains every unhappy outcome in plain words', () => {
    expect(eventViewerResult({ state: 'processing', order }).message).toMatch(/has not confirmed the payment of ₹499.50 yet/)
    expect(eventViewerResult({ state: 'failed', order, message: 'Card declined.' }).message).toBe('Card declined. No money was taken. Go back to the event to try again or use a different payment method.')
    expect(eventViewerResult({ state: 'not_paid', order }).message).toMatch(/no money was taken/)
    expect(eventViewerResult({ state: 'expired', order }).title).toBe('This checkout has expired')
    expect(eventViewerResult({ state: 'refunded', order: { ...order, refundDueReason: 'event_full' } }).message).toMatch(/The event was full when the payment arrived/)
    expect(eventViewerResult({ state: 'refund_due', order, reason: 'event_full' }).message).toMatch(/will refund the full amount/)
    expect(eventViewerResult(null)).toMatchObject({ state: 'not_found', returnHref: '/events/my' })
  })
})
