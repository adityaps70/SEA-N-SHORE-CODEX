import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  userCan: vi.fn(),
  canAccessPlatformAdmin: vi.fn(),
  revalidatePath: vi.fn(),
  loadCheckoutCustomer: vi.fn(),
  service: {
    startCheckout: vi.fn(),
    confirmCheckout: vi.fn(),
    refundOrder: vi.fn(),
  },
  repository: {
    getOrderForManager: vi.fn(),
    getOrderById: vi.fn(),
  },
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/features/access/server', () => ({ userCan: mocks.userCan }))
vi.mock('@/features/admin/access', () => ({ canAccessPlatformAdmin: mocks.canAccessPlatformAdmin }))
vi.mock('@/lib/db/client', () => ({ query: vi.fn(), withTransaction: vi.fn() }))
vi.mock('./event-payment-runtime', () => ({ eventPaymentService: mocks.service }))
vi.mock('./customer-contact', async () => {
  const actual = await vi.importActual<typeof import('./customer-contact')>('./customer-contact')
  return { ...actual, loadCheckoutCustomer: mocks.loadCheckoutCustomer }
})
vi.mock('./event-payment-repository', () => {
  class EventRegistrationError extends Error {
    constructor(readonly code: string) {
      super(code)
    }
  }
  return { EventRegistrationError, eventPaymentRepository: mocks.repository }
})

import { confirmEventPaymentAction, refundEventPaymentAction, startEventCheckoutAction } from './event-payment-actions'
import { EventRegistrationError } from './event-payment-repository'
import {
  CustomerPhoneRejectedError,
  CustomerPhoneRequiredError,
  PaymentsNotConfiguredError,
  PaymentVerificationError,
  RefundFailedError,
} from './event-payment-service'

const userId = '11111111-1111-4111-8111-111111111111'
const eventId = '22222222-2222-4222-8222-222222222222'
const orderId = '33333333-3333-4333-8333-333333333333'
const gatewayId = 'evt_33333333333343338333333333333333'
const order = {
  id: orderId, eventId, profileId: userId, eventTitle: 'Paid masterclass', amountMinor: 49900, currency: 'INR',
  provider: 'cashfree', providerOrderId: gatewayId, providerPaymentId: null, providerSessionId: 'session_1', status: 'created',
  registrationConfirmedAt: null, refundDueReason: null, refundStatus: null, refundAttempts: 0, providerRefundId: null,
  createdAt: '2030-01-01T10:00:00.000Z',
}
const customer = { id: userId, email: 'officer@example.com', phone: '+919876543210', name: 'Capt. Rao' }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAwsUser.mockResolvedValue({ id: userId, email: 'officer@example.com' })
  mocks.userCan.mockResolvedValue(true)
  mocks.canAccessPlatformAdmin.mockResolvedValue(false)
  mocks.loadCheckoutCustomer.mockResolvedValue({ customer, invalidPhone: false })
  mocks.service.startCheckout.mockResolvedValue({
    orderId,
    client: { provider: 'cashfree', providerOrderId: gatewayId, paymentSessionId: 'session_1', mode: 'sandbox' },
    amountMinor: 49900,
    currency: 'INR',
    eventTitle: 'Paid masterclass',
  })
})

describe('startEventCheckoutAction', () => {
  it('says registration opens soon when payments are not set up', async () => {
    mocks.service.startCheckout.mockRejectedValue(new PaymentsNotConfiguredError())
    await expect(startEventCheckoutAction(eventId)).resolves.toEqual({
      ok: false,
      error: "Registration opens soon — payments aren't set up yet.",
    })
  })

  it('returns only the public checkout details for the signed-in buyer', async () => {
    const result = await startEventCheckoutAction(eventId)
    expect(result).toEqual({
      ok: true,
      checkout: {
        orderId,
        client: { provider: 'cashfree', providerOrderId: gatewayId, paymentSessionId: 'session_1', mode: 'sandbox' },
        prefill: { email: 'officer@example.com', phone: '+919876543210', name: 'Capt. Rao' },
      },
    })
    expect(mocks.service.startCheckout).toHaveBeenCalledWith({ profileId: userId, eventId, customer })
    expect(mocks.loadCheckoutCustomer).toHaveBeenCalledWith({ id: userId, email: 'officer@example.com' }, undefined)
  })

  it('asks for a mobile number when the gateway needs one, and explains a bad one', async () => {
    mocks.service.startCheckout.mockRejectedValueOnce(new CustomerPhoneRequiredError())
    await expect(startEventCheckoutAction(eventId)).resolves.toMatchObject({ ok: false, needsPhone: true, error: expect.stringMatching(/mobile number/) })

    mocks.service.startCheckout.mockRejectedValueOnce(new CustomerPhoneRejectedError())
    await expect(startEventCheckoutAction(eventId, { phone: '9876543210' })).resolves.toMatchObject({ ok: false, needsPhone: true, error: expect.stringMatching(/did not accept that mobile number/) })

    mocks.loadCheckoutCustomer.mockResolvedValueOnce({ customer: { ...customer, phone: null }, invalidPhone: true })
    await expect(startEventCheckoutAction(eventId, { phone: '12' })).resolves.toMatchObject({ ok: false, needsPhone: true, error: expect.stringMatching(/valid mobile number/) })
    expect(mocks.loadCheckoutCustomer).toHaveBeenLastCalledWith({ id: userId, email: 'officer@example.com' }, '12')
  })

  it('explains full, closed and unsupported-currency events in plain language', async () => {
    mocks.service.startCheckout.mockRejectedValueOnce(new EventRegistrationError('event_full'))
    await expect(startEventCheckoutAction(eventId)).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/capacity/) })
    mocks.service.startCheckout.mockRejectedValueOnce(new EventRegistrationError('event_registration_closed'))
    await expect(startEventCheckoutAction(eventId)).resolves.toMatchObject({ ok: false, error: 'Registration for this event has closed.' })
    mocks.service.startCheckout.mockRejectedValueOnce(new EventRegistrationError('event_currency_unsupported'))
    await expect(startEventCheckoutAction(eventId)).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/US dollars/) })
  })

  it('requires an account that can attend events and a valid event id', async () => {
    mocks.userCan.mockResolvedValueOnce(false)
    await expect(startEventCheckoutAction(eventId)).resolves.toMatchObject({ ok: false, error: 'Your account cannot attend events right now.' })
    await expect(startEventCheckoutAction('not-an-id')).resolves.toMatchObject({ ok: false })
    expect(mocks.service.startCheckout).not.toHaveBeenCalled()
  })
})

describe('confirmEventPaymentAction', () => {
  it('confirms the seat when the gateway says paid', async () => {
    mocks.service.confirmCheckout.mockResolvedValue({ state: 'registered', order: { ...order, status: 'paid' } })
    await expect(confirmEventPaymentAction({ eventId, orderId })).resolves.toEqual({ ok: true, state: 'paid', message: 'Payment of ₹499 received. Your seat is confirmed.' })
    expect(mocks.service.confirmCheckout).toHaveBeenCalledWith({ profileId: userId, orderId, proof: undefined })
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/events/${eventId}`)
  })

  it('passes Razorpay browser evidence through and reports a forged one', async () => {
    mocks.service.confirmCheckout.mockRejectedValue(new PaymentVerificationError())
    await expect(confirmEventPaymentAction({ eventId, orderId, proof: { providerPaymentId: 'pay_1', signature: 'a'.repeat(64) } })).resolves.toMatchObject({
      ok: false,
      state: 'error',
      error: expect.stringMatching(/could not verify this payment/),
    })
    expect(mocks.service.confirmCheckout).toHaveBeenCalledWith({ profileId: userId, orderId, proof: { providerPaymentId: 'pay_1', signature: 'a'.repeat(64) } })
  })

  it('tells the buyer plainly what happened when nothing was paid', async () => {
    mocks.service.confirmCheckout.mockResolvedValue({ state: 'not_paid', order })
    await expect(confirmEventPaymentAction({ eventId, orderId })).resolves.toMatchObject({ ok: false, state: 'not_paid', error: expect.stringMatching(/No money was taken/) })
    mocks.service.confirmCheckout.mockResolvedValue({ state: 'processing', order })
    await expect(confirmEventPaymentAction({ eventId, orderId })).resolves.toMatchObject({ ok: false, state: 'processing', error: expect.stringMatching(/₹499/) })
    mocks.service.confirmCheckout.mockResolvedValue({ state: 'failed', order, message: 'Card declined.' })
    await expect(confirmEventPaymentAction({ eventId, orderId })).resolves.toMatchObject({ ok: false, state: 'failed', error: "The payment didn't go through: Card declined. No money was taken. You can try again or use a different payment method." })
  })

  it('tells the attendee plainly when their payment was refunded because the event filled up', async () => {
    mocks.service.confirmCheckout.mockResolvedValue({ state: 'refunded', order: { ...order, status: 'refunded', refundDueReason: 'event_full' } })
    const result = await confirmEventPaymentAction({ eventId, orderId })
    expect(result).toMatchObject({ ok: false, state: 'refunded' })
    if (!result.ok) {
      expect(result.error).toContain('The event was full when the payment arrived.')
      expect(result.error).toContain('refunded')
    }
  })

  it('rejects malformed input without calling the gateway', async () => {
    await expect(confirmEventPaymentAction({ eventId, orderId: 'nope' })).resolves.toMatchObject({ ok: false, state: 'error' })
    expect(mocks.service.confirmCheckout).not.toHaveBeenCalled()
  })
})

describe('refundEventPaymentAction', () => {
  const paid = { ...order, status: 'paid', providerPaymentId: 'cf_pay_1', registrationConfirmedAt: '2030-01-01T10:05:00.000Z' }

  it('lets the event organiser refund a ticket and says what happens next', async () => {
    mocks.repository.getOrderForManager.mockResolvedValue(paid)
    mocks.service.refundOrder.mockResolvedValue({ state: 'refunded', order: { ...paid, status: 'refunded' } })
    await expect(refundEventPaymentAction(orderId)).resolves.toEqual({
      ok: true,
      message: "Refunded ₹499. The attendee's seat has been released and the money is on its way back to their original payment method.",
    })
    expect(mocks.repository.getOrderForManager).toHaveBeenCalledWith(orderId, userId)
    expect(mocks.service.refundOrder).toHaveBeenCalledWith({ orderId, actor: { type: 'organizer', profileId: userId }, reason: 'organizer_refund' })
  })

  it('lets a platform admin refund any ticket', async () => {
    mocks.repository.getOrderForManager.mockResolvedValue(null)
    mocks.canAccessPlatformAdmin.mockResolvedValue(true)
    mocks.repository.getOrderById.mockResolvedValue(paid)
    mocks.service.refundOrder.mockResolvedValue({ state: 'refund_pending', order: paid })
    await expect(refundEventPaymentAction(orderId)).resolves.toMatchObject({ ok: true, message: expect.stringMatching(/Refund of ₹499 started/) })
    expect(mocks.service.refundOrder).toHaveBeenCalledWith({ orderId, actor: { type: 'admin', profileId: userId }, reason: 'admin_refund' })
  })

  it('refuses everyone else on the server', async () => {
    mocks.repository.getOrderForManager.mockResolvedValue(null)
    await expect(refundEventPaymentAction(orderId)).resolves.toEqual({ ok: false, error: 'Only the event organiser or the Sea N Shore team can refund this payment.' })
    expect(mocks.service.refundOrder).not.toHaveBeenCalled()
  })

  it('explains a double click, a rejected refund and an unfinished payment', async () => {
    mocks.repository.getOrderForManager.mockResolvedValue(paid)
    mocks.service.refundOrder.mockRejectedValueOnce(new EventRegistrationError('refund_in_progress'))
    await expect(refundEventPaymentAction(orderId)).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/already being processed/) })
    mocks.service.refundOrder.mockRejectedValueOnce(new RefundFailedError('Refund amount is greater than refundable amount'))
    await expect(refundEventPaymentAction(orderId)).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/did not accept the refund: Refund amount is greater than refundable amount\. Nothing was refunded/) })
    mocks.service.refundOrder.mockRejectedValueOnce(new EventRegistrationError('refund_not_allowed'))
    await expect(refundEventPaymentAction(orderId)).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/cannot be refunded here/) })
  })
})
