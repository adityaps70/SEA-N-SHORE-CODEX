import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db/client', () => ({ query: vi.fn(), withTransaction: vi.fn() }))

import { PaymentProviderError, type PaymentGateway } from '@/features/payments/types'
import type { CoursePaymentOrder } from './course-payment-repository'
import { createCoursePaymentService } from './course-payment-service'

const profileId = '11111111-1111-4111-8111-111111111111'
const courseId = '22222222-2222-4222-8222-222222222222'
const orderId = '33333333-3333-4333-8333-333333333333'
const gatewayId = 'crs_33333333333343338333333333333333'
const now = new Date('2030-01-01T10:00:00.000Z')
const customer = { id: profileId, email: 'officer@example.com', phone: '+919876543210', name: 'Capt. Rao' }

const baseOrder: CoursePaymentOrder = {
  id: orderId,
  courseId,
  profileId,
  courseTitle: 'SIRE 2.0 Masterclass',
  listPriceMinor: 500000,
  discountPriceMinor: 400000,
  amountMinor: 400000,
  currency: 'INR',
  provider: 'cashfree',
  providerOrderId: null,
  providerPaymentId: null,
  providerSessionId: null,
  status: 'created',
  enrollmentId: null,
  enrollmentConfirmedAt: null,
  refundDueReason: null,
  failureReason: null,
  paidAt: null,
  refundedAt: null,
  refundStatus: null,
  refundAttempts: 0,
  providerRefundId: null,
  createdAt: '2030-01-01T09:59:00.000Z',
}

function makeGateway(overrides: Partial<PaymentGateway> = {}): PaymentGateway {
  return {
    name: 'cashfree',
    requiresCustomerPhone: true,
    currencies: ['INR'],
    createCheckout: vi.fn(async () => ({
      providerOrderId: gatewayId,
      providerSessionId: 'session_1',
      client: { provider: 'cashfree' as const, providerOrderId: gatewayId, paymentSessionId: 'session_1', mode: 'sandbox' as const },
    })),
    restoreCheckout: vi.fn(() => ({ provider: 'cashfree' as const, providerOrderId: gatewayId, paymentSessionId: 'session_1', mode: 'sandbox' as const })),
    confirmOrder: vi.fn(async () => ({ status: 'paid' as const, providerOrderId: gatewayId, providerPaymentId: 'cf_pay_1', amountMinor: 400000, currency: 'INR', lastAttempt: 'succeeded' as const, failureMessage: null })),
    refund: vi.fn(async () => ({ providerRefundId: 'cf_refund_1', status: 'processed' as const })),
    verifyWebhook: vi.fn(() => true),
    ...overrides,
  }
}

function makeRepository() {
  return {
    prepareCheckoutOrder: vi.fn(async () => ({ order: baseOrder, reused: false })),
    attachProviderOrder: vi.fn(async (_id: string, providerOrderId: string, providerSessionId: string | null) => ({ ...baseOrder, providerOrderId, providerSessionId })),
    markOrderFailed: vi.fn(async () => undefined),
    recordAttemptFailure: vi.fn(async () => null),
    getOrderForProfile: vi.fn(async () => ({ ...baseOrder, providerOrderId: gatewayId }) as CoursePaymentOrder | null),
    getOrderForProfileByProviderOrderId: vi.fn(async () => ({ ...baseOrder, providerOrderId: gatewayId }) as CoursePaymentOrder | null),
    getOrderForManager: vi.fn(),
    getOrderById: vi.fn(async () => ({ ...baseOrder, providerOrderId: gatewayId, providerPaymentId: 'cf_pay_1', status: 'paid' }) as CoursePaymentOrder | null),
    findOrderByProviderOrderId: vi.fn(async () => ({ ...baseOrder, providerOrderId: gatewayId }) as CoursePaymentOrder | null),
    confirmPaidOrder: vi.fn(async () => ({ state: 'enrolled', order: { ...baseOrder, status: 'paid', enrollmentConfirmedAt: now.toISOString() } }) as never),
    requestRefund: vi.fn(async () => ({ order: { ...baseOrder, providerOrderId: gatewayId, providerPaymentId: 'cf_pay_1', status: 'paid', refundStatus: 'requested', refundAttempts: 1 } as CoursePaymentOrder, attempt: 1 })),
    markOrderRefunded: vi.fn(async () => ({ ...baseOrder, status: 'refunded' }) as CoursePaymentOrder | null),
    recordRefundFailure: vi.fn(async () => null),
    listLearnerPurchases: vi.fn(),
    listCourseSales: vi.fn(),
    getRecentOpenOrder: vi.fn(),
    getRefundDueOrder: vi.fn(),
    isCourseManager: vi.fn(),
    getCourseSlug: vi.fn(),
  }
}

let gateway: PaymentGateway
let repository: ReturnType<typeof makeRepository>
const tx = { query: vi.fn() }
const log = vi.fn()

function service(options: { configured?: boolean } = {}) {
  return createCoursePaymentService({
    getGateway: async () => (options.configured === false ? null : gateway),
    getGatewayByName: async () => (options.configured === false ? null : gateway),
    repository: repository as never,
    transaction: (async (work: (client: typeof tx) => unknown) => work(tx)) as never,
    log,
    siteUrl: () => 'https://seanshore.example',
    now: () => now,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  gateway = makeGateway()
  repository = makeRepository()
})

describe('course payment service: checkout', () => {
  it('stays safely off when no payment gateway is configured', async () => {
    await expect(service({ configured: false }).startCheckout({ profileId, courseId, customer })).rejects.toMatchObject({ name: 'PaymentsNotConfiguredError' })
    expect(repository.prepareCheckoutOrder).not.toHaveBeenCalled()
  })

  it('asks for a mobile number before creating anything when Cashfree needs one', async () => {
    await expect(service().startCheckout({ profileId, courseId, customer: { ...customer, phone: null } })).rejects.toMatchObject({ name: 'CustomerPhoneRequiredError' })
    expect(repository.prepareCheckoutOrder).not.toHaveBeenCalled()
  })

  it('creates a crs_ gateway order for the stored amount with return and webhook URLs', async () => {
    const session = await service().startCheckout({ profileId, courseId, customer })
    expect(repository.prepareCheckoutOrder).toHaveBeenCalledWith({ profileId, courseId, provider: 'cashfree', currencies: ['INR'], now })
    expect(gateway.createCheckout).toHaveBeenCalledWith(expect.objectContaining({
      gatewayOrderId: gatewayId,
      amountMinor: 400000,
      currency: 'INR',
      description: 'SIRE 2.0 Masterclass',
      returnUrl: `https://seanshore.example/payments/return?order=${gatewayId}`,
      notifyUrl: 'https://seanshore.example/api/payments/cashfree/webhook',
      expiresAt: new Date(now.getTime() + 30 * 60_000),
    }))
    expect(repository.attachProviderOrder).toHaveBeenCalledWith(orderId, gatewayId, 'session_1')
    expect(session).toMatchObject({ orderId, amountMinor: 400000, client: { provider: 'cashfree', paymentSessionId: 'session_1' } })
  })

  it('reopens the same checkout on a double click instead of creating a second order', async () => {
    repository.prepareCheckoutOrder.mockResolvedValueOnce({ order: { ...baseOrder, providerOrderId: gatewayId, providerSessionId: 'session_1' }, reused: true })
    await service().startCheckout({ profileId, courseId, customer })
    expect(gateway.createCheckout).not.toHaveBeenCalled()
    expect(gateway.restoreCheckout).toHaveBeenCalled()
  })

  it('marks the order failed and says the gateway is unavailable when order creation fails', async () => {
    gateway = makeGateway({ createCheckout: vi.fn(async () => { throw new PaymentProviderError('provider_unreachable') }) })
    await expect(service().startCheckout({ profileId, courseId, customer })).rejects.toMatchObject({ name: 'PaymentGatewayUnavailableError' })
    expect(repository.markOrderFailed).toHaveBeenCalledWith(orderId, 'provider_order_failed')
  })

  it('asks for another number when the gateway rejects the phone', async () => {
    gateway = makeGateway({ createCheckout: vi.fn(async () => { throw new PaymentProviderError('provider_request_failed', 400, 'customer_phone is invalid') }) })
    await expect(service().startCheckout({ profileId, courseId, customer })).rejects.toMatchObject({ name: 'CustomerPhoneRejectedError' })
  })
})

describe('course payment service: confirming', () => {
  it('only enrolls after the gateway says the order is paid', async () => {
    const outcome = await service().confirmCheckout({ profileId, orderId })
    expect(gateway.confirmOrder).toHaveBeenCalledWith(gatewayId, undefined)
    expect(repository.confirmPaidOrder).toHaveBeenCalledWith(tx, expect.objectContaining({ orderId, providerPaymentId: 'cf_pay_1', amountMinor: 400000, currency: 'INR', actor: { type: 'member', profileId } }))
    expect(outcome.state).toBe('enrolled')
  })

  it('reports processing, failed and expired checkouts without enrolling', async () => {
    gateway = makeGateway({ confirmOrder: vi.fn(async () => ({ status: 'pending' as const, providerOrderId: gatewayId, providerPaymentId: null, amountMinor: null, currency: null, lastAttempt: 'processing' as const, failureMessage: null })) })
    await expect(service().confirmCheckout({ profileId, orderId })).resolves.toMatchObject({ state: 'processing' })

    gateway = makeGateway({ confirmOrder: vi.fn(async () => ({ status: 'failed' as const, providerOrderId: gatewayId, providerPaymentId: null, amountMinor: null, currency: null, lastAttempt: 'failed' as const, failureMessage: 'Card declined.' })) })
    await expect(service().confirmCheckout({ profileId, orderId })).resolves.toMatchObject({ state: 'failed', message: 'Card declined.' })

    gateway = makeGateway({ confirmOrder: vi.fn(async () => ({ status: 'cancelled' as const, providerOrderId: gatewayId, providerPaymentId: null, amountMinor: null, currency: null, lastAttempt: 'none' as const, failureMessage: null })) })
    await expect(service().confirmCheckout({ profileId, orderId })).resolves.toMatchObject({ state: 'expired' })
    expect(repository.markOrderFailed).toHaveBeenCalledWith(orderId, 'checkout_expired')
    expect(repository.confirmPaidOrder).not.toHaveBeenCalled()
  })

  it('does not call the gateway again for an order that is already paid', async () => {
    repository.getOrderForProfile.mockResolvedValueOnce({ ...baseOrder, status: 'paid', providerOrderId: gatewayId, providerPaymentId: 'cf_pay_1' })
    await service().confirmCheckout({ profileId, orderId })
    expect(gateway.confirmOrder).not.toHaveBeenCalled()
    expect(repository.confirmPaidOrder).toHaveBeenCalledWith(tx, { orderId, providerPaymentId: 'cf_pay_1' })
  })

  it('refunds straight away when the payment could not unlock the course', async () => {
    repository.confirmPaidOrder.mockResolvedValueOnce({ state: 'refund_due', reason: 'already_enrolled', order: { ...baseOrder, status: 'paid', providerOrderId: gatewayId, providerPaymentId: 'cf_pay_1' } } as never)
    const outcome = await service().confirmCheckout({ profileId, orderId })
    expect(gateway.refund).toHaveBeenCalledWith(expect.objectContaining({ refundId: 'rf333333333333433383333333333333331', amountMinor: 400000 }))
    expect(outcome.state).toBe('refunded')
  })

  it('refuses an order that is not the learner’s', async () => {
    repository.getOrderForProfile.mockResolvedValueOnce(null)
    await expect(service().confirmCheckout({ profileId, orderId })).rejects.toMatchObject({ code: 'order_not_found' })
    expect(gateway.confirmOrder).not.toHaveBeenCalled()
  })
})

describe('course payment service: webhooks', () => {
  it('enrolls from a verified payment success inside the webhook transaction, using the payment time', async () => {
    const result = await service().applyGatewayEvent(tx, {
      kind: 'payment_succeeded', provider: 'cashfree', providerOrderId: gatewayId, providerPaymentId: 'cf_pay_1', amountMinor: 400000, currency: 'INR', occurredAt: '2030-01-01T09:58:00+00:00',
    })
    expect(result).toMatchObject({ handled: true })
    expect(result.afterCommit).toBeUndefined()
    expect(repository.confirmPaidOrder).toHaveBeenCalledWith(tx, expect.objectContaining({ orderId, providerOrderId: gatewayId, actor: { type: 'provider' }, now: new Date('2030-01-01T09:58:00Z') }))
  })

  it('schedules the refund after commit when a paid order is refund due', async () => {
    repository.confirmPaidOrder.mockResolvedValueOnce({ state: 'refund_due', reason: 'already_enrolled', order: { ...baseOrder, status: 'paid', providerOrderId: gatewayId, providerPaymentId: 'cf_pay_1' } } as never)
    const result = await service().applyGatewayEvent(tx, {
      kind: 'payment_succeeded', provider: 'cashfree', providerOrderId: gatewayId, providerPaymentId: 'cf_pay_1', amountMinor: 400000, currency: 'INR', occurredAt: null,
    })
    expect(gateway.refund).not.toHaveBeenCalled()
    await result.afterCommit?.()
    expect(gateway.refund).toHaveBeenCalledOnce()
  })

  it('notes failed attempts and refund webhooks', async () => {
    await service().applyGatewayEvent(tx, { kind: 'payment_failed', provider: 'cashfree', providerOrderId: gatewayId, providerPaymentId: 'cf_pay_2', reason: 'Insufficient funds', dropped: false })
    expect(repository.recordAttemptFailure).toHaveBeenCalledWith(tx, expect.objectContaining({ reason: 'Insufficient funds', dropped: false }))

    await service().applyGatewayEvent(tx, { kind: 'refund_updated', provider: 'cashfree', providerOrderId: gatewayId, providerPaymentId: 'cf_pay_1', providerRefundId: 'cf_refund_1', refundId: null, amountMinor: 400000, status: 'processed' })
    expect(repository.markOrderRefunded).toHaveBeenCalledWith(tx, orderId, { providerRefundId: 'cf_refund_1', refundStatus: 'processed', actor: { type: 'provider' } })

    await service().applyGatewayEvent(tx, { kind: 'refund_updated', provider: 'cashfree', providerOrderId: gatewayId, providerPaymentId: 'cf_pay_1', providerRefundId: 'cf_refund_2', refundId: null, amountMinor: 400000, status: 'failed' })
    expect(repository.recordRefundFailure).toHaveBeenCalledWith(tx, expect.objectContaining({ orderId, reason: 'gateway_refund_failed' }))
  })

  it('ignores orders it does not know', async () => {
    repository.findOrderByProviderOrderId.mockResolvedValueOnce(null)
    await expect(service().applyGatewayEvent(tx, { kind: 'payment_failed', provider: 'cashfree', providerOrderId: gatewayId, providerPaymentId: null, reason: 'x', dropped: true }))
      .resolves.toEqual({ handled: false, reason: 'order_unknown' })
  })
})

describe('course payment service: refunds', () => {
  it('requests, refunds through the gateway that took the money, then marks the order refunded', async () => {
    const outcome = await service().refundOrder({ orderId, actor: { type: 'admin', profileId }, reason: 'admin_refund' })
    expect(repository.requestRefund).toHaveBeenCalledWith(tx, { orderId, actor: { type: 'admin', profileId }, reason: 'admin_refund' })
    expect(gateway.refund).toHaveBeenCalledWith({ providerOrderId: gatewayId, providerPaymentId: 'cf_pay_1', amountMinor: 400000, currency: 'INR', refundId: 'rf333333333333433383333333333333331', note: 'Sea N Shore course refund' })
    expect(repository.markOrderRefunded).toHaveBeenCalledWith(tx, orderId, expect.objectContaining({ providerRefundId: 'cf_refund_1', refundStatus: 'processed' }))
    expect(outcome.state).toBe('refunded')
  })

  it('records a failed refund so it can be retried, and never marks the order refunded', async () => {
    gateway = makeGateway({ refund: vi.fn(async () => { throw new PaymentProviderError('provider_request_failed', 400, 'Refund amount exceeds.') }) })
    await expect(service().refundOrder({ orderId, actor: { type: 'admin', profileId }, reason: 'admin_refund' })).rejects.toMatchObject({ name: 'RefundFailedError', providerMessage: 'Refund amount exceeds.' })
    expect(repository.recordRefundFailure).toHaveBeenCalledWith(tx, expect.objectContaining({ orderId, reason: 'Refund amount exceeds.' }))
    expect(repository.markOrderRefunded).not.toHaveBeenCalled()
  })

  it('says a pending refund is on its way', async () => {
    gateway = makeGateway({ refund: vi.fn(async () => ({ providerRefundId: 'cf_refund_1', status: 'pending' as const })) })
    await expect(service().refundOrder({ orderId, actor: { type: 'organizer', profileId }, reason: 'course_team_refund' })).resolves.toMatchObject({ state: 'refund_pending' })
  })
})
