import { createHmac } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db/client', () => ({
  query: vi.fn(),
  withTransaction: vi.fn(),
}))

import type { EventPaymentOrder } from './event-payment-repository'
import { EventRegistrationError } from './event-payment-repository'
import {
  createEventPaymentService,
  CustomerPhoneRejectedError,
  CustomerPhoneRequiredError,
  PaymentGatewayUnavailableError,
  PaymentsNotConfiguredError,
  PaymentVerificationError,
  RefundFailedError,
} from './event-payment-service'
import { createRazorpayGateway } from './razorpay'
import { PaymentProviderError, type OrderConfirmation, type PaymentGateway, type PaymentProviderName } from './types'

const razorpayConfig = { keyId: 'rzp_test_Key1', keySecret: 'checkout-secret', webhookSecret: 'webhook-secret' }
const profileId = '11111111-1111-4111-8111-111111111111'
const eventId = '22222222-2222-4222-8222-222222222222'
const orderId = '33333333-3333-4333-8333-333333333333'
const gatewayId = 'evt_33333333333343338333333333333333'
const customer = { id: profileId, email: 'officer@example.com', phone: '+919876543210', name: 'Capt. Rao' }

function order(overrides: Partial<EventPaymentOrder> = {}): EventPaymentOrder {
  return {
    id: orderId,
    eventId,
    profileId,
    eventTitle: 'Paid masterclass',
    amountMinor: 49900,
    currency: 'INR',
    provider: 'cashfree',
    providerOrderId: gatewayId,
    providerPaymentId: null,
    providerSessionId: 'session_1',
    status: 'created',
    registrationConfirmedAt: null,
    refundDueReason: null,
    refundStatus: null,
    refundAttempts: 0,
    providerRefundId: null,
    createdAt: '2030-01-01T10:00:00.000Z',
    ...overrides,
  }
}

function sign(secret: string, payload: string) {
  return createHmac('sha256', secret).update(payload).digest('hex')
}

function fakeRepository() {
  return {
    prepareCheckoutOrder: vi.fn(),
    attachProviderOrder: vi.fn(),
    markOrderFailed: vi.fn(async () => undefined),
    markFailedByProviderOrder: vi.fn(async () => undefined),
    recordAttemptFailure: vi.fn(async () => null),
    getOrderForProfile: vi.fn(),
    getOrderForProfileByProviderOrderId: vi.fn(),
    getOrderForManager: vi.fn(),
    getOrderById: vi.fn(),
    findOrderByProviderOrderId: vi.fn(),
    findOrderByProviderPaymentId: vi.fn(),
    confirmPaidOrder: vi.fn(),
    requestRefund: vi.fn(async () => ({ order: order({ status: 'paid', providerPaymentId: 'cf_pay_1', refundStatus: 'requested', refundAttempts: 1 }), attempt: 1 })),
    markOrderRefunded: vi.fn(async () => order({ status: 'refunded', providerPaymentId: 'cf_pay_1', refundStatus: 'processed' })),
    recordRefundFailure: vi.fn(async () => null),
    recordWebhookEvent: vi.fn(async () => true),
    listEventPaymentsForManager: vi.fn(),
    countPaidOrdersForEvent: vi.fn(),
  }
}

const paidConfirmation: OrderConfirmation = {
  status: 'paid',
  providerOrderId: gatewayId,
  providerPaymentId: 'cf_pay_1',
  amountMinor: 49900,
  currency: 'INR',
  lastAttempt: 'succeeded',
  failureMessage: null,
}

function fakeCashfree(overrides: Partial<PaymentGateway> = {}): PaymentGateway {
  return {
    name: 'cashfree',
    requiresCustomerPhone: true,
    currencies: ['INR'],
    createCheckout: vi.fn(async () => ({
      providerOrderId: gatewayId,
      providerSessionId: 'session_1',
      client: { provider: 'cashfree' as const, providerOrderId: gatewayId, paymentSessionId: 'session_1', mode: 'sandbox' as const },
    })),
    restoreCheckout: vi.fn((stored) => stored.providerSessionId
      ? { provider: 'cashfree' as const, providerOrderId: stored.providerOrderId, paymentSessionId: stored.providerSessionId, mode: 'sandbox' as const }
      : null),
    confirmOrder: vi.fn(async () => paidConfirmation),
    refund: vi.fn(async () => ({ providerRefundId: 'cf_refund_1', status: 'processed' as const })),
    verifyWebhook: vi.fn(() => true),
    ...overrides,
  }
}

const tx = { query: vi.fn() }
const transaction = vi.fn(async <T,>(fn: (client: typeof tx) => Promise<T>) => fn(tx))

let repository: ReturnType<typeof fakeRepository>
let cashfree: PaymentGateway
let razorpay: ReturnType<typeof createRazorpayGateway>
let razorpayFetch: ReturnType<typeof vi.fn>
const log = vi.fn()

function service(active: () => Promise<PaymentGateway | null> = async () => cashfree) {
  return createEventPaymentService({
    getGateway: active,
    getGatewayByName: async (name: PaymentProviderName) => (name === 'cashfree' ? cashfree : razorpay),
    repository: repository as never,
    transaction: transaction as never,
    log,
    siteUrl: () => 'https://seanshore.example',
    now: () => new Date('2030-01-01T10:00:00.000Z'),
  })
}

beforeEach(() => {
  repository = fakeRepository()
  cashfree = fakeCashfree()
  razorpayFetch = vi.fn(async (url: string) => {
    if (url.endsWith('/refund')) return new Response(JSON.stringify({ id: 'rfnd_1', status: 'processed' }))
    return new Response(JSON.stringify({ items: [{ id: 'pay_1', order_id: 'order_abc', amount: 49900, currency: 'INR', status: 'captured', created_at: 1 }] }))
  })
  razorpay = createRazorpayGateway(razorpayConfig, razorpayFetch as never)
  transaction.mockClear()
  log.mockClear()
})

describe('starting a paid event checkout', () => {
  it('refuses cleanly when payments are not configured', async () => {
    await expect(service(async () => null).startCheckout({ profileId, eventId, customer })).rejects.toBeInstanceOf(PaymentsNotConfiguredError)
    expect(repository.prepareCheckoutOrder).not.toHaveBeenCalled()
  })

  it('asks for a phone number before creating anything when the gateway needs one', async () => {
    await expect(service().startCheckout({ profileId, eventId, customer: { ...customer, phone: null } })).rejects.toBeInstanceOf(CustomerPhoneRequiredError)
    expect(repository.prepareCheckoutOrder).not.toHaveBeenCalled()
  })

  it('creates the Cashfree order for the amount stored on the event, with our evt_ id, return and webhook URLs', async () => {
    repository.prepareCheckoutOrder.mockResolvedValue({ order: order({ providerOrderId: null, providerSessionId: null }), reused: false })
    repository.attachProviderOrder.mockResolvedValue(order())

    const session = await service().startCheckout({ profileId, eventId, customer })

    expect(repository.prepareCheckoutOrder).toHaveBeenCalledWith({ profileId, eventId, provider: 'cashfree', currencies: ['INR'] })
    expect(cashfree.createCheckout).toHaveBeenCalledWith({
      gatewayOrderId: gatewayId,
      amountMinor: 49900,
      currency: 'INR',
      customer,
      description: 'Paid masterclass',
      returnUrl: `https://seanshore.example/payments/return?order=${gatewayId}`,
      notifyUrl: 'https://seanshore.example/api/payments/cashfree/webhook',
      expiresAt: new Date('2030-01-01T10:30:00.000Z'),
      notes: { sns_order_id: orderId, sns_event_id: eventId, sns_profile_id: profileId },
    })
    expect(repository.attachProviderOrder).toHaveBeenCalledWith(orderId, gatewayId, 'session_1')
    expect(session).toEqual({
      orderId,
      client: { provider: 'cashfree', providerOrderId: gatewayId, paymentSessionId: 'session_1', mode: 'sandbox' },
      amountMinor: 49900,
      currency: 'INR',
      eventTitle: 'Paid masterclass',
    })
  })

  it('reopens the same checkout on a double click instead of creating a second order', async () => {
    repository.prepareCheckoutOrder.mockResolvedValue({ order: order(), reused: true })
    const session = await service().startCheckout({ profileId, eventId, customer })
    expect(cashfree.createCheckout).not.toHaveBeenCalled()
    expect(session.client).toMatchObject({ paymentSessionId: 'session_1' })
  })

  it('works the same way with Razorpay as the active gateway (no phone needed)', async () => {
    razorpayFetch.mockImplementation(async () => new Response(JSON.stringify({ id: 'order_abc', amount: 49900, currency: 'INR' })))
    repository.prepareCheckoutOrder.mockResolvedValue({ order: order({ provider: 'razorpay', providerOrderId: null }), reused: false })
    repository.attachProviderOrder.mockResolvedValue(order({ provider: 'razorpay', providerOrderId: 'order_abc' }))
    const session = await service(async () => razorpay).startCheckout({ profileId, eventId, customer: { ...customer, phone: null } })
    expect(session.client).toEqual({ provider: 'razorpay', providerOrderId: 'order_abc', keyId: 'rzp_test_Key1', amountMinor: 49900, currency: 'INR' })
    expect(JSON.stringify(session)).not.toContain(razorpayConfig.keySecret)
  })

  it('passes registration blockers (full, closed, currency) straight through', async () => {
    repository.prepareCheckoutOrder.mockRejectedValue(new EventRegistrationError('event_full'))
    await expect(service().startCheckout({ profileId, eventId, customer })).rejects.toMatchObject({ code: 'event_full' })
    repository.prepareCheckoutOrder.mockRejectedValue(new EventRegistrationError('event_currency_unsupported'))
    await expect(service().startCheckout({ profileId, eventId, customer })).rejects.toMatchObject({ code: 'event_currency_unsupported' })
    expect(cashfree.createCheckout).not.toHaveBeenCalled()
  })

  it('asks for another number when Cashfree rejects the phone', async () => {
    repository.prepareCheckoutOrder.mockResolvedValue({ order: order({ providerOrderId: null }), reused: false })
    cashfree = fakeCashfree({ createCheckout: vi.fn(async () => { throw new PaymentProviderError('provider_request_failed', 400, 'customer_details.customer_phone : should be 10 digits') }) })
    await expect(service().startCheckout({ profileId, eventId, customer })).rejects.toBeInstanceOf(CustomerPhoneRejectedError)
    expect(repository.markOrderFailed).toHaveBeenCalledWith(orderId, 'provider_order_failed')
  })

  it('marks the local order failed when the gateway cannot create an order', async () => {
    repository.prepareCheckoutOrder.mockResolvedValue({ order: order({ providerOrderId: null }), reused: false })
    cashfree = fakeCashfree({ createCheckout: vi.fn(async () => { throw new Error('provider_unreachable') }) })
    await expect(service().startCheckout({ profileId, eventId, customer })).rejects.toBeInstanceOf(PaymentGatewayUnavailableError)
    expect(repository.markOrderFailed).toHaveBeenCalledWith(orderId, 'provider_order_failed')
  })
})

describe('confirming a checkout from the browser', () => {
  it('confirms the seat only with the gateway’s own paid answer and amount', async () => {
    repository.getOrderForProfile.mockResolvedValue(order())
    repository.confirmPaidOrder.mockResolvedValue({ state: 'registered', order: order({ status: 'paid' }) })
    await expect(service().confirmCheckout({ profileId, orderId })).resolves.toMatchObject({ state: 'registered' })
    expect(cashfree.confirmOrder).toHaveBeenCalledWith(gatewayId, undefined)
    expect(repository.confirmPaidOrder).toHaveBeenCalledWith(tx, {
      orderId, providerPaymentId: 'cf_pay_1', amountMinor: 49900, currency: 'INR', actor: { type: 'member', profileId },
    })
    expect(cashfree.refund).not.toHaveBeenCalled()
  })

  it("rejects another attendee's order", async () => {
    repository.getOrderForProfile.mockResolvedValue(null)
    await expect(service().confirmCheckout({ profileId, orderId })).rejects.toMatchObject({ code: 'order_not_found' })
    expect(cashfree.confirmOrder).not.toHaveBeenCalled()
  })

  it('reports unpaid, processing, failed and expired orders without marking anything paid', async () => {
    repository.getOrderForProfile.mockResolvedValue(order())
    const answers: [Partial<OrderConfirmation>, string][] = [
      [{ status: 'pending', lastAttempt: 'none' }, 'not_paid'],
      [{ status: 'pending', lastAttempt: 'dropped' }, 'not_paid'],
      [{ status: 'pending', lastAttempt: 'processing' }, 'processing'],
      [{ status: 'failed', lastAttempt: 'failed', failureMessage: 'Card declined' }, 'failed'],
      [{ status: 'cancelled', lastAttempt: 'none' }, 'expired'],
    ]
    for (const [answer, state] of answers) {
      cashfree = fakeCashfree({ confirmOrder: vi.fn(async () => ({ ...paidConfirmation, providerPaymentId: null, ...answer })) })
      await expect(service().confirmCheckout({ profileId, orderId })).resolves.toMatchObject({ state })
    }
    expect(repository.confirmPaidOrder).not.toHaveBeenCalled()
    expect(repository.markOrderFailed).toHaveBeenCalledWith(orderId, 'checkout_expired')
  })

  it('confirms a Razorpay order with the order’s own gateway and refuses a forged signature', async () => {
    repository.getOrderForProfile.mockResolvedValue(order({ provider: 'razorpay', providerOrderId: 'order_abc' }))
    repository.confirmPaidOrder.mockResolvedValue({ state: 'registered', order: order({ provider: 'razorpay', status: 'paid' }) })
    const signature = sign(razorpayConfig.keySecret, 'order_abc|pay_1')
    await expect(service().confirmCheckout({ profileId, orderId, proof: { providerPaymentId: 'pay_1', signature } })).resolves.toMatchObject({ state: 'registered' })
    expect(repository.confirmPaidOrder).toHaveBeenCalledWith(tx, expect.objectContaining({ providerPaymentId: 'pay_1', amountMinor: 49900 }))

    repository.confirmPaidOrder.mockClear()
    await expect(service().confirmCheckout({ profileId, orderId, proof: { providerPaymentId: 'pay_1', signature: sign('guess', 'order_abc|pay_1') } }))
      .rejects.toBeInstanceOf(PaymentVerificationError)
    expect(repository.confirmPaidOrder).not.toHaveBeenCalled()
  })

  it('refunds automatically when the last seat went while the attendee was paying', async () => {
    repository.getOrderForProfile.mockResolvedValue(order())
    const due = order({ status: 'paid', providerPaymentId: 'cf_pay_1', refundDueReason: 'event_full' })
    repository.confirmPaidOrder.mockResolvedValue({ state: 'refund_due', order: due, reason: 'event_full' })
    repository.getOrderById.mockResolvedValue(due)

    await expect(service().confirmCheckout({ profileId, orderId })).resolves.toMatchObject({ state: 'refunded' })
    expect(repository.requestRefund).toHaveBeenCalledWith(tx, { orderId, actor: { type: 'system' }, reason: 'event_full' })
    expect(cashfree.refund).toHaveBeenCalledWith({
      providerOrderId: gatewayId,
      providerPaymentId: 'cf_pay_1',
      amountMinor: 49900,
      currency: 'INR',
      refundId: 'rf333333333333433383333333333333331',
      note: 'Sea N Shore event ticket refund',
    })
    expect(repository.markOrderRefunded).toHaveBeenCalledWith(tx, orderId, { providerRefundId: 'cf_refund_1', refundStatus: 'processed', actor: { type: 'system' }, reason: 'event_full' })
  })

  it('leaves the refund for the team when the automatic refund fails', async () => {
    cashfree = fakeCashfree({ refund: vi.fn(async () => { throw new Error('provider_request_failed') }) })
    repository.getOrderForProfile.mockResolvedValue(order())
    const due = order({ status: 'paid', providerPaymentId: 'cf_pay_1', refundDueReason: 'event_full' })
    repository.confirmPaidOrder.mockResolvedValue({ state: 'refund_due', order: due, reason: 'event_full' })
    repository.getOrderById.mockResolvedValue(due)
    await expect(service().confirmCheckout({ profileId, orderId })).resolves.toMatchObject({ state: 'refund_due' })
    expect(repository.markOrderRefunded).not.toHaveBeenCalled()
    expect(repository.recordRefundFailure).toHaveBeenCalledWith(tx, expect.objectContaining({ orderId }))
    expect(log).toHaveBeenCalledWith('event_payment_auto_refund_failed', expect.objectContaining({ orderId }))
  })
})

describe('refunding a paid ticket', () => {
  it('refunds through the gateway that took the payment and reports a pending refund honestly', async () => {
    repository.getOrderById.mockResolvedValue(order({ status: 'paid', providerPaymentId: 'cf_pay_1' }))
    cashfree = fakeCashfree({ refund: vi.fn(async () => ({ providerRefundId: 'cf_refund_1', status: 'pending' as const })) })
    const actor = { type: 'organizer' as const, profileId }
    await expect(service(async () => razorpay).refundOrder({ orderId, actor, reason: 'organizer_refund' })).resolves.toMatchObject({ state: 'refund_pending' })
    expect(cashfree.refund).toHaveBeenCalled()
    expect(repository.markOrderRefunded).toHaveBeenCalledWith(tx, orderId, expect.objectContaining({ refundStatus: 'pending', actor }))
  })

  it('records a rejected refund and keeps the order refundable', async () => {
    repository.getOrderById.mockResolvedValue(order({ status: 'paid', providerPaymentId: 'cf_pay_1' }))
    cashfree = fakeCashfree({ refund: vi.fn(async () => ({ providerRefundId: 'cf_refund_1', status: 'failed' as const })) })
    await expect(service().refundOrder({ orderId, actor: { type: 'admin', profileId }, reason: 'admin_refund' })).rejects.toBeInstanceOf(RefundFailedError)
    expect(repository.recordRefundFailure).toHaveBeenCalledWith(tx, expect.objectContaining({ orderId, reason: 'gateway_rejected' }))
    expect(repository.markOrderRefunded).not.toHaveBeenCalled()
  })

  it('refuses when the order’s gateway is no longer set up', async () => {
    repository.getOrderById.mockResolvedValue(order({ status: 'paid', providerPaymentId: 'cf_pay_1' }))
    const offline = createEventPaymentService({
      getGateway: async () => null,
      getGatewayByName: async () => null,
      repository: repository as never,
      transaction: transaction as never,
      log,
    })
    await expect(offline.refundOrder({ orderId, actor: { type: 'admin', profileId }, reason: 'admin_refund' })).rejects.toBeInstanceOf(PaymentsNotConfiguredError)
    expect(repository.requestRefund).not.toHaveBeenCalled()
  })
})

describe('Cashfree gateway events for event tickets', () => {
  it('confirms the seat from a verified payment event and refunds after commit when the seat is gone', async () => {
    repository.findOrderByProviderOrderId.mockResolvedValue(order())
    const due = order({ status: 'paid', providerPaymentId: 'cf_pay_1' })
    repository.confirmPaidOrder.mockResolvedValue({ state: 'refund_due', order: due, reason: 'event_full' })
    repository.getOrderById.mockResolvedValue(due)
    const result = await service().applyGatewayEvent(tx, {
      kind: 'payment_succeeded', provider: 'cashfree', providerOrderId: gatewayId, providerPaymentId: 'cf_pay_1', amountMinor: 49900, currency: 'INR', occurredAt: null,
    })
    expect(repository.confirmPaidOrder).toHaveBeenCalledWith(tx, {
      orderId, providerPaymentId: 'cf_pay_1', providerOrderId: gatewayId, amountMinor: 49900, currency: 'INR', actor: { type: 'provider' },
    })
    expect(result).toMatchObject({ handled: true, revalidatePaths: expect.arrayContaining([`/events/${eventId}`]) })
    expect(cashfree.refund).not.toHaveBeenCalled()
    await result.afterCommit?.()
    expect(cashfree.refund).toHaveBeenCalled()
  })

  it('notes failed attempts without closing the order, and applies refund updates', async () => {
    repository.findOrderByProviderOrderId.mockResolvedValue(order())
    await service().applyGatewayEvent(tx, { kind: 'payment_failed', provider: 'cashfree', providerOrderId: gatewayId, providerPaymentId: 'cf_2', reason: 'Card declined', dropped: false })
    expect(repository.recordAttemptFailure).toHaveBeenCalledWith(tx, { provider: 'cashfree', providerOrderId: gatewayId, providerPaymentId: 'cf_2', reason: 'Card declined', dropped: false })
    expect(repository.markOrderFailed).not.toHaveBeenCalled()

    await service().applyGatewayEvent(tx, { kind: 'refund_updated', provider: 'cashfree', providerOrderId: gatewayId, providerPaymentId: 'cf_pay_1', providerRefundId: 'cf_refund_1', refundId: null, amountMinor: 49900, status: 'processed' })
    expect(repository.markOrderRefunded).toHaveBeenCalledWith(tx, orderId, { providerRefundId: 'cf_refund_1', refundStatus: 'processed', actor: { type: 'provider' } })

    await service().applyGatewayEvent(tx, { kind: 'refund_updated', provider: 'cashfree', providerOrderId: gatewayId, providerPaymentId: 'cf_pay_1', providerRefundId: 'cf_refund_2', refundId: null, amountMinor: 49900, status: 'failed' })
    expect(repository.recordRefundFailure).toHaveBeenCalledWith(tx, expect.objectContaining({ orderId, providerRefundId: 'cf_refund_2' }))
  })

  it('ignores orders it does not know', async () => {
    repository.findOrderByProviderOrderId.mockResolvedValue(null)
    await expect(service().applyGatewayEvent(tx, {
      kind: 'payment_succeeded', provider: 'cashfree', providerOrderId: gatewayId, providerPaymentId: 'cf_pay_1', amountMinor: 49900, currency: 'INR', occurredAt: null,
    })).resolves.toEqual({ handled: false, reason: 'order_unknown' })
  })
})

describe('Razorpay webhook handling (kept working)', () => {
  function webhook(payload: unknown, deliveryId: string | null = 'evt_1', secret = razorpayConfig.webhookSecret) {
    const rawBody = JSON.stringify(payload)
    const headers = new Headers({ 'x-razorpay-signature': sign(secret, rawBody), ...(deliveryId ? { 'x-razorpay-event-id': deliveryId } : {}) })
    return { rawBody, headers }
  }

  const captured = {
    event: 'payment.captured',
    payload: { payment: { entity: { id: 'pay_1', order_id: 'order_abc', amount: 49900, currency: 'INR', status: 'captured' } } },
  }
  const razorpayOrder = order({ provider: 'razorpay', providerOrderId: 'order_abc' })

  it('rejects a body whose signature does not match', async () => {
    await expect(service().handleRazorpayWebhook(webhook(captured, 'evt_1', 'other'))).rejects.toBeInstanceOf(PaymentVerificationError)
    const request = webhook(captured)
    await expect(service().handleRazorpayWebhook({ ...request, rawBody: request.rawBody.replace('49900', '100') })).rejects.toBeInstanceOf(PaymentVerificationError)
    expect(repository.recordWebhookEvent).not.toHaveBeenCalled()
  })

  it('confirms the seat from payment.captured with the amount Razorpay reports', async () => {
    repository.findOrderByProviderOrderId.mockResolvedValue(razorpayOrder)
    repository.confirmPaidOrder.mockResolvedValue({ state: 'registered', order: { ...razorpayOrder, status: 'paid' } })
    await expect(service().handleRazorpayWebhook(webhook(captured))).resolves.toMatchObject({ handled: true })
    expect(repository.recordWebhookEvent).toHaveBeenCalledWith(tx, 'razorpay', 'evt_1', 'payment.captured')
    expect(repository.confirmPaidOrder).toHaveBeenCalledWith(tx, { orderId, providerPaymentId: 'pay_1', amountMinor: 49900, currency: 'INR', actor: { type: 'provider' } })
  })

  it('processes each delivery once, falling back to a body hash without a delivery id', async () => {
    repository.recordWebhookEvent.mockResolvedValue(false)
    await expect(service().handleRazorpayWebhook(webhook(captured))).resolves.toEqual({ handled: false, reason: 'duplicate' })
    expect(repository.confirmPaidOrder).not.toHaveBeenCalled()
    await service().handleRazorpayWebhook(webhook(captured, null))
    expect(repository.recordWebhookEvent).toHaveBeenLastCalledWith(tx, 'razorpay', expect.stringMatching(/^[0-9a-f]{64}$/), 'payment.captured')
  })

  it('records failed payments and full refunds, ignores partial ones', async () => {
    await service().handleRazorpayWebhook(webhook({
      event: 'payment.failed',
      payload: { payment: { entity: { id: 'pay_2', order_id: 'order_abc', error_description: 'Card declined' } } },
    }, 'evt_2'))
    expect(repository.markFailedByProviderOrder).toHaveBeenCalledWith(tx, 'razorpay', 'order_abc', 'Card declined')

    repository.findOrderByProviderPaymentId.mockResolvedValue({ ...razorpayOrder, status: 'paid', providerPaymentId: 'pay_1' })
    await service().handleRazorpayWebhook(webhook({
      event: 'refund.processed',
      payload: {
        refund: { entity: { id: 'rfnd_1', payment_id: 'pay_1', amount: 49900 } },
        payment: { entity: { id: 'pay_1', amount: 49900, amount_refunded: 49900, status: 'refunded' } },
      },
    }, 'evt_3'))
    expect(repository.markOrderRefunded).toHaveBeenCalledWith(tx, orderId, { providerRefundId: 'rfnd_1', refundStatus: 'processed', actor: { type: 'provider' } })

    await expect(service().handleRazorpayWebhook(webhook({
      event: 'refund.processed',
      payload: { refund: { entity: { payment_id: 'pay_1' } }, payment: { entity: { id: 'pay_1', amount: 49900, amount_refunded: 10000, status: 'captured' } } },
    }, 'evt_4'))).resolves.toEqual({ handled: false, reason: 'partial_refund' })
    await expect(service().handleRazorpayWebhook(webhook({ event: 'settlement.processed', payload: {} }, 'evt_5'))).resolves.toEqual({ handled: false, reason: 'ignored' })
  })

  it('does not process webhooks when Razorpay is not configured', async () => {
    const withoutRazorpay = createEventPaymentService({
      getGateway: async () => cashfree,
      getGatewayByName: async (name) => (name === 'cashfree' ? cashfree : null),
      repository: repository as never,
      transaction: transaction as never,
      log,
    })
    await expect(withoutRazorpay.handleRazorpayWebhook(webhook(captured))).rejects.toBeInstanceOf(PaymentsNotConfiguredError)
  })
})
