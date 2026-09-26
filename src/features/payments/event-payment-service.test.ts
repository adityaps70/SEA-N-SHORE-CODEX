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
  PaymentGatewayUnavailableError,
  PaymentsNotConfiguredError,
  PaymentVerificationError,
} from './event-payment-service'
import { createRazorpayProvider } from './razorpay'
import type { PaymentProvider } from './types'

const config = { keyId: 'rzp_test_Key1', keySecret: 'checkout-secret', webhookSecret: 'webhook-secret' }
const profileId = '11111111-1111-4111-8111-111111111111'
const eventId = '22222222-2222-4222-8222-222222222222'
const orderId = '33333333-3333-4333-8333-333333333333'

function order(overrides: Partial<EventPaymentOrder> = {}): EventPaymentOrder {
  return {
    id: orderId,
    eventId,
    profileId,
    eventTitle: 'Paid masterclass',
    amountMinor: 49900,
    currency: 'INR',
    provider: 'razorpay',
    providerOrderId: 'order_abc',
    providerPaymentId: null,
    status: 'created',
    registrationConfirmedAt: null,
    refundDueReason: null,
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
    getOrderForProfile: vi.fn(),
    findOrderByProviderOrderId: vi.fn(),
    findOrderByProviderPaymentId: vi.fn(),
    confirmPaidOrder: vi.fn(),
    markOrderRefunded: vi.fn(),
    recordWebhookEvent: vi.fn(async () => true),
    listEventPaymentsForManager: vi.fn(),
    countPaidOrdersForEvent: vi.fn(),
  }
}

function fakeProvider(overrides: Partial<PaymentProvider> = {}): PaymentProvider {
  const real = createRazorpayProvider(config, async () => { throw new Error('network disabled in tests') })
  return {
    name: 'razorpay',
    publicKeyId: config.keyId,
    createOrder: vi.fn(async () => ({ providerOrderId: 'order_abc', amountMinor: 49900, currency: 'INR' as const })),
    verifyCheckoutSignature: real.verifyCheckoutSignature,
    verifyWebhookSignature: real.verifyWebhookSignature,
    fetchPayment: vi.fn(async () => ({ providerPaymentId: 'pay_1', providerOrderId: 'order_abc', amountMinor: 49900, currency: 'INR', status: 'captured' as const })),
    capturePayment: vi.fn(),
    refundPayment: vi.fn(async () => ({ providerRefundId: 'rfnd_1' })),
    ...overrides,
  }
}

const tx = { query: vi.fn() }
const transaction = vi.fn(async <T,>(fn: (client: typeof tx) => Promise<T>) => fn(tx))

let repository: ReturnType<typeof fakeRepository>
let provider: PaymentProvider
const log = vi.fn()

function service(getProvider: () => Promise<PaymentProvider | null> = async () => provider) {
  return createEventPaymentService({
    getProvider,
    repository: repository as never,
    transaction: transaction as never,
    log,
  })
}

beforeEach(() => {
  repository = fakeRepository()
  provider = fakeProvider()
  transaction.mockClear()
  log.mockClear()
})

describe('starting a paid event checkout', () => {
  it('refuses cleanly when payments are not configured', async () => {
    await expect(service(async () => null).startCheckout({ profileId, eventId })).rejects.toBeInstanceOf(PaymentsNotConfiguredError)
    expect(repository.prepareCheckoutOrder).not.toHaveBeenCalled()
  })

  it('creates the gateway order for the amount stored on the event, not a client amount', async () => {
    repository.prepareCheckoutOrder.mockResolvedValue({ order: order({ providerOrderId: null }), reused: false })
    repository.attachProviderOrder.mockResolvedValue(order())

    const session = await service().startCheckout({ profileId, eventId })

    expect(repository.prepareCheckoutOrder).toHaveBeenCalledWith({ profileId, eventId, provider: 'razorpay' })
    expect(provider.createOrder).toHaveBeenCalledWith({
      amountMinor: 49900,
      currency: 'INR',
      receipt: orderId,
      notes: { sns_order_id: orderId, sns_event_id: eventId, sns_profile_id: profileId },
    })
    expect(repository.attachProviderOrder).toHaveBeenCalledWith(orderId, 'order_abc')
    expect(session).toEqual({ orderId, providerOrderId: 'order_abc', keyId: 'rzp_test_Key1', amountMinor: 49900, currency: 'INR', eventTitle: 'Paid masterclass' })
    expect(JSON.stringify(session)).not.toContain(config.keySecret)
  })

  it('reuses an open checkout instead of creating a second gateway order', async () => {
    repository.prepareCheckoutOrder.mockResolvedValue({ order: order(), reused: true })
    await service().startCheckout({ profileId, eventId })
    expect(provider.createOrder).not.toHaveBeenCalled()
  })

  it('passes registration blockers (full, closed) straight through', async () => {
    repository.prepareCheckoutOrder.mockRejectedValue(new EventRegistrationError('event_full'))
    await expect(service().startCheckout({ profileId, eventId })).rejects.toMatchObject({ code: 'event_full' })
    repository.prepareCheckoutOrder.mockRejectedValue(new EventRegistrationError('event_registration_closed'))
    await expect(service().startCheckout({ profileId, eventId })).rejects.toMatchObject({ code: 'event_registration_closed' })
    expect(provider.createOrder).not.toHaveBeenCalled()
  })

  it('marks the local order failed when the gateway cannot create an order', async () => {
    repository.prepareCheckoutOrder.mockResolvedValue({ order: order({ providerOrderId: null }), reused: false })
    provider = fakeProvider({ createOrder: vi.fn(async () => { throw new Error('provider_unreachable') }) })
    await expect(service().startCheckout({ profileId, eventId })).rejects.toBeInstanceOf(PaymentGatewayUnavailableError)
    expect(repository.markOrderFailed).toHaveBeenCalledWith(orderId, 'provider_order_failed')
  })
})

describe('confirming a checkout from the browser', () => {
  const signature = sign(config.keySecret, 'order_abc|pay_1')

  it('rejects an invalid signature without touching the order', async () => {
    repository.getOrderForProfile.mockResolvedValue(order())
    await expect(service().confirmCheckout({ profileId, orderId, providerOrderId: 'order_abc', providerPaymentId: 'pay_1', signature: sign('guess', 'order_abc|pay_1') }))
      .rejects.toBeInstanceOf(PaymentVerificationError)
    expect(repository.confirmPaidOrder).not.toHaveBeenCalled()
  })

  it("rejects another attendee's order or a mismatched gateway order id", async () => {
    repository.getOrderForProfile.mockResolvedValue(null)
    await expect(service().confirmCheckout({ profileId, orderId, providerOrderId: 'order_abc', providerPaymentId: 'pay_1', signature }))
      .rejects.toMatchObject({ code: 'order_not_found' })
    repository.getOrderForProfile.mockResolvedValue(order({ providerOrderId: 'order_other' }))
    await expect(service().confirmCheckout({ profileId, orderId, providerOrderId: 'order_abc', providerPaymentId: 'pay_1', signature }))
      .rejects.toMatchObject({ code: 'order_not_found' })
  })

  it('confirms the seat for a valid signature', async () => {
    repository.getOrderForProfile.mockResolvedValue(order())
    repository.confirmPaidOrder.mockResolvedValue({ state: 'registered', order: order({ status: 'paid' }) })
    await expect(service().confirmCheckout({ profileId, orderId, providerOrderId: 'order_abc', providerPaymentId: 'pay_1', signature }))
      .resolves.toMatchObject({ state: 'registered' })
    expect(repository.confirmPaidOrder).toHaveBeenCalledWith(tx, { orderId, providerPaymentId: 'pay_1' })
    expect(provider.refundPayment).not.toHaveBeenCalled()
  })

  it('captures an authorised payment before confirming', async () => {
    provider = fakeProvider({
      fetchPayment: vi.fn(async () => ({ providerPaymentId: 'pay_1', providerOrderId: 'order_abc', amountMinor: 49900, currency: 'INR', status: 'authorized' as const })),
      capturePayment: vi.fn(async () => ({ providerPaymentId: 'pay_1', providerOrderId: 'order_abc', amountMinor: 49900, currency: 'INR', status: 'captured' as const })),
    })
    repository.getOrderForProfile.mockResolvedValue(order())
    repository.confirmPaidOrder.mockResolvedValue({ state: 'registered', order: order({ status: 'paid' }) })
    await service().confirmCheckout({ profileId, orderId, providerOrderId: 'order_abc', providerPaymentId: 'pay_1', signature })
    expect(provider.capturePayment).toHaveBeenCalledWith('pay_1', 49900, 'INR')
  })

  it('refunds automatically when the last seat went while the attendee was paying', async () => {
    repository.getOrderForProfile.mockResolvedValue(order())
    const due = order({ status: 'paid', providerPaymentId: 'pay_1', refundDueReason: 'event_full' })
    repository.confirmPaidOrder.mockResolvedValue({ state: 'refund_due', order: due, reason: 'event_full' })
    repository.markOrderRefunded.mockResolvedValue({ ...due, status: 'refunded' })

    await expect(service().confirmCheckout({ profileId, orderId, providerOrderId: 'order_abc', providerPaymentId: 'pay_1', signature }))
      .resolves.toMatchObject({ state: 'refunded' })
    expect(provider.refundPayment).toHaveBeenCalledWith('pay_1', 49900, { sns_order_id: orderId, reason: 'event_full' })
    expect(repository.markOrderRefunded).toHaveBeenCalledWith(tx, orderId)
  })

  it('leaves the refund for the team when the automatic refund fails', async () => {
    provider = fakeProvider({ refundPayment: vi.fn(async () => { throw new Error('provider_request_failed') }) })
    repository.getOrderForProfile.mockResolvedValue(order())
    const due = order({ status: 'paid', providerPaymentId: 'pay_1', refundDueReason: 'event_full' })
    repository.confirmPaidOrder.mockResolvedValue({ state: 'refund_due', order: due, reason: 'event_full' })
    await expect(service().confirmCheckout({ profileId, orderId, providerOrderId: 'order_abc', providerPaymentId: 'pay_1', signature }))
      .resolves.toMatchObject({ state: 'refund_due' })
    expect(repository.markOrderRefunded).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith('event_payment_auto_refund_failed', expect.objectContaining({ orderId }))
  })
})

describe('Razorpay webhook handling', () => {
  function webhook(payload: unknown, deliveryId = 'evt_1') {
    const rawBody = JSON.stringify(payload)
    return { rawBody, signature: sign(config.webhookSecret, rawBody), deliveryId }
  }

  const captured = {
    event: 'payment.captured',
    payload: { payment: { entity: { id: 'pay_1', order_id: 'order_abc', amount: 49900, currency: 'INR', status: 'captured' } } },
  }

  it('rejects a body whose signature does not match', async () => {
    const request = webhook(captured)
    await expect(service().handleWebhook({ ...request, signature: sign('other', request.rawBody) })).rejects.toBeInstanceOf(PaymentVerificationError)
    await expect(service().handleWebhook({ ...request, rawBody: request.rawBody.replace('49900', '100') })).rejects.toBeInstanceOf(PaymentVerificationError)
    expect(repository.recordWebhookEvent).not.toHaveBeenCalled()
  })

  it('confirms the seat from payment.captured with the amount Razorpay reports', async () => {
    repository.findOrderByProviderOrderId.mockResolvedValue(order())
    repository.confirmPaidOrder.mockResolvedValue({ state: 'registered', order: order({ status: 'paid' }) })
    await expect(service().handleWebhook(webhook(captured))).resolves.toMatchObject({ handled: true })
    expect(repository.recordWebhookEvent).toHaveBeenCalledWith(tx, 'razorpay', 'evt_1', 'payment.captured')
    expect(repository.confirmPaidOrder).toHaveBeenCalledWith(tx, { orderId, providerPaymentId: 'pay_1', amountMinor: 49900, currency: 'INR' })
  })

  it('processes each delivery once', async () => {
    repository.recordWebhookEvent.mockResolvedValue(false)
    await expect(service().handleWebhook(webhook(captured))).resolves.toEqual({ handled: false, reason: 'duplicate' })
    expect(repository.confirmPaidOrder).not.toHaveBeenCalled()
  })

  it('falls back to a body hash when Razorpay sends no delivery id', async () => {
    repository.findOrderByProviderOrderId.mockResolvedValue(null)
    const request = webhook(captured)
    await service().handleWebhook({ ...request, deliveryId: null })
    expect(repository.recordWebhookEvent).toHaveBeenCalledWith(tx, 'razorpay', expect.stringMatching(/^[0-9a-f]{64}$/), 'payment.captured')
  })

  it('records failed payments and refunds', async () => {
    await service().handleWebhook(webhook({
      event: 'payment.failed',
      payload: { payment: { entity: { id: 'pay_2', order_id: 'order_abc', error_description: 'Card declined' } } },
    }, 'evt_2'))
    expect(repository.markFailedByProviderOrder).toHaveBeenCalledWith(tx, 'razorpay', 'order_abc', 'Card declined')

    repository.findOrderByProviderPaymentId.mockResolvedValue(order({ status: 'paid', providerPaymentId: 'pay_1' }))
    await service().handleWebhook(webhook({
      event: 'refund.processed',
      payload: {
        refund: { entity: { id: 'rfnd_1', payment_id: 'pay_1', amount: 49900 } },
        payment: { entity: { id: 'pay_1', amount: 49900, amount_refunded: 49900, status: 'refunded' } },
      },
    }, 'evt_3'))
    expect(repository.markOrderRefunded).toHaveBeenCalledWith(tx, orderId)
  })

  it('ignores partial refunds and unrelated events', async () => {
    repository.findOrderByProviderPaymentId.mockResolvedValue(order({ status: 'paid', providerPaymentId: 'pay_1' }))
    await expect(service().handleWebhook(webhook({
      event: 'refund.processed',
      payload: { refund: { entity: { payment_id: 'pay_1' } }, payment: { entity: { id: 'pay_1', amount: 49900, amount_refunded: 10000, status: 'captured' } } },
    }, 'evt_4'))).resolves.toEqual({ handled: false, reason: 'partial_refund' })
    await expect(service().handleWebhook(webhook({ event: 'settlement.processed', payload: {} }, 'evt_5'))).resolves.toEqual({ handled: false, reason: 'ignored' })
    expect(repository.markOrderRefunded).not.toHaveBeenCalled()
  })

  it('refunds a webhook-confirmed payment that could not get a seat', async () => {
    repository.findOrderByProviderOrderId.mockResolvedValue(order())
    const due = order({ status: 'paid', providerPaymentId: 'pay_1' })
    repository.confirmPaidOrder.mockResolvedValue({ state: 'refund_due', order: due, reason: 'event_registration_closed' })
    repository.markOrderRefunded.mockResolvedValue({ ...due, status: 'refunded' })
    await service().handleWebhook(webhook(captured))
    expect(provider.refundPayment).toHaveBeenCalledWith('pay_1', 49900, expect.objectContaining({ reason: 'event_registration_closed' }))
  })

  it('does not process webhooks when payments are not configured', async () => {
    await expect(service(async () => null).handleWebhook(webhook(captured))).rejects.toBeInstanceOf(PaymentsNotConfiguredError)
  })
})
