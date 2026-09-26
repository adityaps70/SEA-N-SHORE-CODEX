import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  startEventCheckoutAction: vi.fn(),
  confirmEventPaymentAction: vi.fn(),
  loadRazorpayCheckout: vi.fn(),
  refresh: vi.fn(),
  options: null as null | Record<string, unknown>,
  failureHandler: null as null | ((response: { error?: { description?: string } }) => void),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))
vi.mock('../event-payment-actions', () => ({
  startEventCheckoutAction: mocks.startEventCheckoutAction,
  confirmEventPaymentAction: mocks.confirmEventPaymentAction,
}))
vi.mock('./load-razorpay-checkout', () => ({ loadRazorpayCheckout: mocks.loadRazorpayCheckout }))

import { EventCheckoutButton } from './event-checkout-button'

const eventId = '22222222-2222-4222-8222-222222222222'
const checkout = {
  orderId: '33333333-3333-4333-8333-333333333333',
  providerOrderId: 'order_abc',
  keyId: 'rzp_test_Key1',
  amountMinor: 49900,
  currency: 'INR',
  eventTitle: 'Paid masterclass',
  prefill: { email: 'officer@example.com' },
}

class FakeRazorpay {
  constructor(options: Record<string, unknown>) {
    mocks.options = options
  }
  on(_event: string, handler: (response: { error?: { description?: string } }) => void) {
    mocks.failureHandler = handler
  }
  open() {}
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.options = null
  mocks.startEventCheckoutAction.mockResolvedValue({ ok: true, checkout })
  mocks.confirmEventPaymentAction.mockResolvedValue({ ok: true, state: 'registered' })
  mocks.loadRazorpayCheckout.mockResolvedValue(FakeRazorpay)
})

afterEach(() => cleanup())

describe('EventCheckoutButton', () => {
  it('shows "Registration opens soon" and does nothing when payments are not set up', () => {
    render(<EventCheckoutButton eventId={eventId} eventTitle="Paid masterclass" priceLabel="₹499" paymentsConfigured={false} />)
    const button = screen.getByRole('button', { name: "Registration opens soon — payments aren't set up yet." })
    expect(button).toBeDisabled()
    fireEvent.click(button)
    expect(mocks.startEventCheckoutAction).not.toHaveBeenCalled()
    expect(mocks.loadRazorpayCheckout).not.toHaveBeenCalled()
  })

  it('opens Razorpay Checkout with the server order and confirms the seat on success', async () => {
    render(<EventCheckoutButton eventId={eventId} eventTitle="Paid masterclass" priceLabel="₹499" paymentsConfigured />)
    fireEvent.click(screen.getByRole('button', { name: 'Pay ₹499 and register' }))

    await waitFor(() => expect(mocks.options).not.toBeNull())
    expect(mocks.startEventCheckoutAction).toHaveBeenCalledWith(eventId)
    expect(mocks.options).toMatchObject({ key: 'rzp_test_Key1', order_id: 'order_abc', amount: 49900, currency: 'INR', prefill: { email: 'officer@example.com' } })
    expect(screen.getByRole('button', { name: /Complete payment in the window/ })).toBeDisabled()

    const handler = mocks.options!.handler as (response: Record<string, string>) => void
    handler({ razorpay_payment_id: 'pay_1', razorpay_order_id: 'order_abc', razorpay_signature: 'sig' })

    expect(await screen.findByText('Payment received. Your seat is confirmed.')).toBeInTheDocument()
    expect(mocks.confirmEventPaymentAction).toHaveBeenCalledWith({
      eventId,
      orderId: checkout.orderId,
      providerOrderId: 'order_abc',
      providerPaymentId: 'pay_1',
      signature: 'sig',
    })
    expect(mocks.refresh).toHaveBeenCalled()
  })

  it('shows why checkout could not start', async () => {
    mocks.startEventCheckoutAction.mockResolvedValue({ ok: false, error: 'Registration for this event has closed.' })
    render(<EventCheckoutButton eventId={eventId} eventTitle="Paid masterclass" priceLabel="₹499" paymentsConfigured />)
    fireEvent.click(screen.getByRole('button', { name: 'Pay ₹499 and register' }))
    expect(await screen.findByText('Registration for this event has closed.')).toBeInTheDocument()
    expect(mocks.loadRazorpayCheckout).not.toHaveBeenCalled()
  })

  it('explains a blocked checkout script and a declined payment', async () => {
    mocks.loadRazorpayCheckout.mockRejectedValueOnce(new Error('razorpay_checkout_unavailable'))
    render(<EventCheckoutButton eventId={eventId} eventTitle="Paid masterclass" priceLabel="₹499" paymentsConfigured />)
    fireEvent.click(screen.getByRole('button', { name: 'Pay ₹499 and register' }))
    expect(await screen.findByText(/secure payment window could not load/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Pay ₹499 and register' }))
    await waitFor(() => expect(mocks.failureHandler).not.toBeNull())
    mocks.failureHandler!({ error: { description: 'Your card was declined.' } })
    expect(await screen.findByText(/payment didn't go through: Your card was declined/)).toBeInTheDocument()
  })

  it('lets the attendee try again after closing the payment window', async () => {
    render(<EventCheckoutButton eventId={eventId} eventTitle="Paid masterclass" priceLabel="₹499" paymentsConfigured />)
    fireEvent.click(screen.getByRole('button', { name: 'Pay ₹499 and register' }))
    await waitFor(() => expect(mocks.options).not.toBeNull())
    const modal = mocks.options!.modal as { ondismiss: () => void }
    modal.ondismiss()
    expect(await screen.findByText(/Payment window closed. No money was taken/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pay ₹499 and register' })).toBeEnabled()
  })

  it('reports a refund when the seat could not be confirmed', async () => {
    mocks.confirmEventPaymentAction.mockResolvedValue({ ok: false, state: 'refunded', error: 'Your payment was received but we could not confirm a seat. The event was full when the payment arrived. The full amount has been refunded to your original payment method.' })
    render(<EventCheckoutButton eventId={eventId} eventTitle="Paid masterclass" priceLabel="₹499" paymentsConfigured />)
    fireEvent.click(screen.getByRole('button', { name: 'Pay ₹499 and register' }))
    await waitFor(() => expect(mocks.options).not.toBeNull())
    const handler = mocks.options!.handler as (response: Record<string, string>) => void
    handler({ razorpay_payment_id: 'pay_1', razorpay_order_id: 'order_abc', razorpay_signature: 'sig' })
    expect(await screen.findByText(/full amount has been refunded/)).toBeInTheDocument()
  })
})
