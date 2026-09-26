import { createHmac } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  provider: null as unknown,
  requireAwsUser: vi.fn(),
  userCan: vi.fn(),
  revalidatePath: vi.fn(),
  prepareCheckoutOrder: vi.fn(),
  attachProviderOrder: vi.fn(),
  getOrderForProfile: vi.fn(),
  confirmPaidOrder: vi.fn(),
  markOrderRefunded: vi.fn(),
  markOrderFailed: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/features/access/server', () => ({ userCan: mocks.userCan }))
vi.mock('@/lib/db/client', () => ({
  query: vi.fn(),
  withTransaction: async (fn: (client: unknown) => unknown) => fn({ query: vi.fn() }),
}))
vi.mock('./provider', () => ({ getPaymentProvider: async () => mocks.provider }))
vi.mock('./event-payment-repository', () => {
  class EventRegistrationError extends Error {
    constructor(readonly code: string) {
      super(code)
    }
  }
  return {
    EventRegistrationError,
    eventPaymentRepository: {
      prepareCheckoutOrder: mocks.prepareCheckoutOrder,
      attachProviderOrder: mocks.attachProviderOrder,
      getOrderForProfile: mocks.getOrderForProfile,
      confirmPaidOrder: mocks.confirmPaidOrder,
      markOrderRefunded: mocks.markOrderRefunded,
      markOrderFailed: mocks.markOrderFailed,
    },
  }
})

import { confirmEventPaymentAction, startEventCheckoutAction } from './event-payment-actions'
import { EventRegistrationError } from './event-payment-repository'
import { createRazorpayProvider } from './razorpay'

const userId = '11111111-1111-4111-8111-111111111111'
const eventId = '22222222-2222-4222-8222-222222222222'
const orderId = '33333333-3333-4333-8333-333333333333'
const keySecret = 'checkout-secret'
const order = {
  id: orderId, eventId, profileId: userId, eventTitle: 'Paid masterclass', amountMinor: 49900, currency: 'INR',
  provider: 'razorpay', providerOrderId: 'order_abc', providerPaymentId: null, status: 'created',
  registrationConfirmedAt: null, refundDueReason: null, createdAt: '2030-01-01T10:00:00.000Z',
}

function fetchStub(url: string) {
  if (url.endsWith('/orders')) return Promise.resolve(new Response(JSON.stringify({ id: 'order_abc', amount: 49900, currency: 'INR' })))
  if (url.endsWith('/refund')) return Promise.resolve(new Response(JSON.stringify({ id: 'rfnd_1' })))
  return Promise.resolve(new Response(JSON.stringify({ id: 'pay_1', amount: 49900, currency: 'INR', status: 'captured', order_id: 'order_abc' })))
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.provider = createRazorpayProvider({ keyId: 'rzp_test_Key1', keySecret, webhookSecret: 'hook' }, fetchStub)
  mocks.requireAwsUser.mockResolvedValue({ id: userId, email: 'officer@example.com' })
  mocks.userCan.mockResolvedValue(true)
  mocks.prepareCheckoutOrder.mockResolvedValue({ order: { ...order, providerOrderId: null }, reused: false })
  mocks.attachProviderOrder.mockResolvedValue(order)
  mocks.getOrderForProfile.mockResolvedValue(order)
})

describe('startEventCheckoutAction', () => {
  it('says registration opens soon when payments are not set up', async () => {
    mocks.provider = null
    await expect(startEventCheckoutAction(eventId)).resolves.toEqual({
      ok: false,
      error: "Registration opens soon — payments aren't set up yet.",
    })
    expect(mocks.prepareCheckoutOrder).not.toHaveBeenCalled()
  })

  it('returns the public checkout details and never the secret', async () => {
    const result = await startEventCheckoutAction(eventId)
    expect(result).toEqual({
      ok: true,
      checkout: {
        orderId,
        providerOrderId: 'order_abc',
        keyId: 'rzp_test_Key1',
        amountMinor: 49900,
        currency: 'INR',
        eventTitle: 'Paid masterclass',
        prefill: { email: 'officer@example.com' },
      },
    })
    expect(JSON.stringify(result)).not.toContain(keySecret)
    expect(mocks.prepareCheckoutOrder).toHaveBeenCalledWith({ profileId: userId, eventId, provider: 'razorpay' })
  })

  it('explains full and closed events in plain language', async () => {
    mocks.prepareCheckoutOrder.mockRejectedValueOnce(new EventRegistrationError('event_full'))
    await expect(startEventCheckoutAction(eventId)).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/capacity/) })
    mocks.prepareCheckoutOrder.mockRejectedValueOnce(new EventRegistrationError('event_registration_closed'))
    await expect(startEventCheckoutAction(eventId)).resolves.toMatchObject({ ok: false, error: 'Registration for this event has closed.' })
  })

  it('requires an account that can attend events and a valid event id', async () => {
    mocks.userCan.mockResolvedValueOnce(false)
    await expect(startEventCheckoutAction(eventId)).resolves.toMatchObject({ ok: false, error: 'Your account cannot attend events right now.' })
    await expect(startEventCheckoutAction('not-an-id')).resolves.toMatchObject({ ok: false })
  })
})

describe('confirmEventPaymentAction', () => {
  const valid = {
    eventId,
    orderId,
    providerOrderId: 'order_abc',
    providerPaymentId: 'pay_1',
    signature: createHmac('sha256', keySecret).update('order_abc|pay_1').digest('hex'),
  }

  it('confirms the seat when the signature is genuine', async () => {
    mocks.confirmPaidOrder.mockResolvedValue({ state: 'registered', order: { ...order, status: 'paid' } })
    await expect(confirmEventPaymentAction(valid)).resolves.toEqual({ ok: true, state: 'registered' })
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/events/${eventId}`)
  })

  it('does not confirm anything for a forged signature', async () => {
    await expect(confirmEventPaymentAction({ ...valid, signature: 'a'.repeat(64) })).resolves.toMatchObject({
      ok: false,
      state: 'error',
      error: expect.stringMatching(/could not verify this payment/),
    })
    expect(mocks.confirmPaidOrder).not.toHaveBeenCalled()
  })

  it('tells the attendee plainly when their payment was refunded because the event filled up', async () => {
    const due = { ...order, status: 'paid', providerPaymentId: 'pay_1', refundDueReason: 'event_full' }
    mocks.confirmPaidOrder.mockResolvedValue({ state: 'refund_due', order: due, reason: 'event_full' })
    mocks.markOrderRefunded.mockResolvedValue({ ...due, status: 'refunded' })
    const result = await confirmEventPaymentAction(valid)
    expect(result).toMatchObject({ ok: false, state: 'refunded' })
    if (!result.ok) {
      expect(result.error).toContain('The event was full when the payment arrived.')
      expect(result.error).toContain('refunded')
    }
  })
})
