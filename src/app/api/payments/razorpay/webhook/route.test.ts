import { createHmac } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  provider: null as unknown,
  revalidatePath: vi.fn(),
  recordWebhookEvent: vi.fn(),
  findOrderByProviderOrderId: vi.fn(),
  confirmPaidOrder: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/lib/db/client', () => ({
  query: vi.fn(),
  withTransaction: async (fn: (client: unknown) => unknown) => fn({ query: vi.fn() }),
}))
vi.mock('@/features/payments/provider', () => ({
  getPaymentProvider: async () => mocks.provider,
}))
vi.mock('@/features/payments/event-payment-repository', () => ({
  EventRegistrationError: class EventRegistrationError extends Error {},
  eventPaymentRepository: {
    recordWebhookEvent: mocks.recordWebhookEvent,
    findOrderByProviderOrderId: mocks.findOrderByProviderOrderId,
    confirmPaidOrder: mocks.confirmPaidOrder,
    markFailedByProviderOrder: vi.fn(),
    findOrderByProviderPaymentId: vi.fn(),
    markOrderRefunded: vi.fn(),
  },
}))

import { createRazorpayProvider } from '@/features/payments/razorpay'
import { POST } from './route'

const webhookSecret = 'whsec-test'
const order = {
  id: '33333333-3333-4333-8333-333333333333',
  eventId: '22222222-2222-4222-8222-222222222222',
  profileId: '11111111-1111-4111-8111-111111111111',
  amountMinor: 49900,
  currency: 'INR',
  providerOrderId: 'order_abc',
  providerPaymentId: 'pay_1',
  status: 'paid',
  registrationConfirmedAt: '2030-01-01T10:00:00.000Z',
  refundDueReason: null,
}

const body = JSON.stringify({
  event: 'payment.captured',
  payload: { payment: { entity: { id: 'pay_1', order_id: 'order_abc', amount: 49900, currency: 'INR', status: 'captured' } } },
})

function request(rawBody: string, signature: string | null, deliveryId = 'evt_1') {
  const headers = new Headers({ 'content-type': 'application/json', 'x-razorpay-event-id': deliveryId })
  if (signature) headers.set('x-razorpay-signature', signature)
  return new Request('https://example.com/api/payments/razorpay/webhook', { method: 'POST', body: rawBody, headers })
}

function sign(payload: string, secret = webhookSecret) {
  return createHmac('sha256', secret).update(payload).digest('hex')
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.provider = createRazorpayProvider(
    { keyId: 'rzp_test_Key1', keySecret: 'key-secret', webhookSecret },
    async () => new Response(JSON.stringify({ id: 'pay_1', amount: 49900, currency: 'INR', status: 'captured' }), { status: 200 }),
  )
  mocks.recordWebhookEvent.mockResolvedValue(true)
  mocks.findOrderByProviderOrderId.mockResolvedValue({ ...order, status: 'created', registrationConfirmedAt: null })
  mocks.confirmPaidOrder.mockResolvedValue({ state: 'registered', order })
})

describe('POST /api/payments/razorpay/webhook', () => {
  it('rejects requests whose signature does not match the raw body', async () => {
    const response = await POST(request(body, sign(body, 'wrong')))
    expect(response.status).toBe(400)
    expect(mocks.recordWebhookEvent).not.toHaveBeenCalled()

    const unsigned = await POST(request(body, null))
    expect(unsigned.status).toBe(400)
  })

  it('confirms the registration for a signed payment.captured event', async () => {
    const response = await POST(request(body, sign(body)))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, handled: true })
    expect(mocks.recordWebhookEvent).toHaveBeenCalledWith(expect.anything(), 'razorpay', 'evt_1', 'payment.captured')
    expect(mocks.confirmPaidOrder).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ providerPaymentId: 'pay_1', amountMinor: 49900 }))
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/events/${order.eventId}`)
  })

  it('acknowledges a repeated delivery without processing it again', async () => {
    mocks.recordWebhookEvent.mockResolvedValue(false)
    const response = await POST(request(body, sign(body)))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, handled: false })
    expect(mocks.confirmPaidOrder).not.toHaveBeenCalled()
  })

  it('asks Razorpay to retry when processing fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.confirmPaidOrder.mockRejectedValue(new Error('connection reset'))
    const response = await POST(request(body, sign(body)))
    expect(response.status).toBe(500)
    error.mockRestore()
  })

  it('answers 503 while payments are not configured', async () => {
    mocks.provider = null
    const response = await POST(request(body, sign(body)))
    expect(response.status).toBe(503)
  })

  it('refuses oversized bodies before reading them', async () => {
    const huge = 'x'.repeat(300 * 1024)
    const response = await POST(request(huge, sign(huge)))
    expect(response.status).toBe(413)
  })
})
