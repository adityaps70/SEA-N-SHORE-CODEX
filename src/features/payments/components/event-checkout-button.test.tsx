import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  startEventCheckoutAction: vi.fn(),
  confirmEventPaymentAction: vi.fn(),
  loadRazorpayCheckout: vi.fn(),
  refresh: vi.fn(),
  options: null as null | Record<string, unknown>,
  failureHandler: null as null | ((response: { error?: { description?: string } }) => void),
  cashfreeMode: null as null | string,
  cashfreeCheckout: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))
vi.mock('../event-payment-actions', () => ({
  startEventCheckoutAction: mocks.startEventCheckoutAction,
  confirmEventPaymentAction: mocks.confirmEventPaymentAction,
}))
vi.mock('./load-razorpay-checkout', () => ({ loadRazorpayCheckout: mocks.loadRazorpayCheckout }))

import { EventCheckoutButton } from './event-checkout-button'

const eventId = '22222222-2222-4222-8222-222222222222'
const orderId = '33333333-3333-4333-8333-333333333333'
const prefill = { email: 'officer@example.com', phone: '+919876543210', name: 'Capt. Rao' }
const cashfreeCheckout = {
  orderId,
  client: { provider: 'cashfree', providerOrderId: 'evt_33333333333343338333333333333333', paymentSessionId: 'session_abc', mode: 'sandbox' },
  prefill,
}
const razorpayCheckout = {
  orderId,
  client: { provider: 'razorpay', providerOrderId: 'order_abc', keyId: 'rzp_test_Key1', amountMinor: 49900, currency: 'INR' },
  prefill,
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

function renderButton(props: Partial<Parameters<typeof EventCheckoutButton>[0]> = {}) {
  return render(<EventCheckoutButton eventId={eventId} eventTitle="Paid masterclass" priceLabel="₹499" paymentsConfigured {...props} />)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.options = null
  mocks.failureHandler = null
  mocks.cashfreeMode = null
  mocks.startEventCheckoutAction.mockResolvedValue({ ok: true, checkout: cashfreeCheckout })
  mocks.confirmEventPaymentAction.mockResolvedValue({ ok: true, state: 'paid', message: 'Payment of ₹499 received. Your seat is confirmed.' })
  mocks.loadRazorpayCheckout.mockResolvedValue(FakeRazorpay)
  mocks.cashfreeCheckout.mockResolvedValue({ paymentDetails: { paymentMessage: 'Payment finished. Check status.' } })
  window.Cashfree = (options: { mode: 'sandbox' | 'production' }) => {
    mocks.cashfreeMode = options.mode
    return { checkout: mocks.cashfreeCheckout }
  }
})

afterEach(() => {
  cleanup()
  delete window.Cashfree
})

describe('EventCheckoutButton', () => {
  it('shows "Registration opens soon" and does nothing when payments are not set up', () => {
    renderButton({ paymentsConfigured: false })
    const button = screen.getByRole('button', { name: "Registration opens soon — payments aren't set up yet." })
    expect(button).toBeDisabled()
    fireEvent.click(button)
    expect(mocks.startEventCheckoutAction).not.toHaveBeenCalled()
  })

  it('opens the Cashfree pop-up with the server session, then asks the server to confirm', async () => {
    renderButton()
    fireEvent.click(screen.getByRole('button', { name: 'Pay ₹499 and register' }))

    expect(await screen.findByText('Payment of ₹499 received. Your seat is confirmed.')).toBeInTheDocument()
    expect(mocks.startEventCheckoutAction).toHaveBeenCalledWith(eventId, {})
    expect(mocks.cashfreeMode).toBe('sandbox')
    expect(mocks.cashfreeCheckout).toHaveBeenCalledWith({ paymentSessionId: 'session_abc', redirectTarget: '_modal' })
    expect(mocks.confirmEventPaymentAction).toHaveBeenCalledWith({ eventId, orderId, proof: null })
    expect(mocks.refresh).toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent('Your seat is confirmed')
  })

  it('still checks with the server when the Cashfree pop-up closes, and says nothing was taken', async () => {
    mocks.cashfreeCheckout.mockResolvedValue({ error: { message: 'Payment popup closed' } })
    mocks.confirmEventPaymentAction.mockResolvedValue({ ok: false, state: 'not_paid', error: 'Payment window closed before the payment was made. No money was taken. You can try again whenever you are ready.' })
    renderButton()
    fireEvent.click(screen.getByRole('button', { name: 'Pay ₹499 and register' }))
    expect(await screen.findByText(/No money was taken/)).toBeInTheDocument()
    expect(mocks.confirmEventPaymentAction).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Pay ₹499 and register' })).toBeEnabled()
  })

  it('asks for a mobile number when the gateway needs one, then continues with it', async () => {
    mocks.startEventCheckoutAction
      .mockResolvedValueOnce({ ok: false, needsPhone: true, error: 'Enter your mobile number to continue. Our payment partner needs it to send your payment receipt.' })
      .mockResolvedValueOnce({ ok: false, needsPhone: true, error: 'Enter a valid mobile number: 10 digits for India (for example 98765 43210), or your full number with the country code, like +44 7700 900123.' })
      .mockResolvedValueOnce({ ok: true, checkout: cashfreeCheckout })
    renderButton()
    fireEvent.click(screen.getByRole('button', { name: 'Pay ₹499 and register' }))

    const input = await screen.findByLabelText('Mobile number')
    await waitFor(() => expect(input).toHaveFocus())
    fireEvent.click(screen.getByRole('button', { name: /Continue to payment/ }))
    expect(await screen.findByText('Enter your mobile number to continue.')).toBeInTheDocument()

    fireEvent.change(input, { target: { value: '12' } })
    fireEvent.click(screen.getByRole('button', { name: /Continue to payment/ }))
    expect(await screen.findByText(/Enter a valid mobile number/)).toBeInTheDocument()
    expect(screen.getByLabelText('Mobile number')).toHaveAttribute('aria-invalid', 'true')

    fireEvent.change(screen.getByLabelText('Mobile number'), { target: { value: '98765 43210' } })
    fireEvent.click(screen.getByRole('button', { name: /Continue to payment/ }))
    expect(await screen.findByText('Payment of ₹499 received. Your seat is confirmed.')).toBeInTheDocument()
    expect(mocks.startEventCheckoutAction).toHaveBeenLastCalledWith(eventId, { phone: '98765 43210' })
  })

  it('lets the buyer back out of the mobile number step with Escape', async () => {
    mocks.startEventCheckoutAction.mockResolvedValueOnce({ ok: false, needsPhone: true, error: 'Enter your mobile number to continue.' })
    renderButton()
    fireEvent.click(screen.getByRole('button', { name: 'Pay ₹499 and register' }))
    const input = await screen.findByLabelText('Mobile number')
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(await screen.findByText(/No payment was started/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pay ₹499 and register' })).toBeEnabled()
  })

  it('opens Razorpay Checkout when Razorpay is the gateway and confirms with its signed response', async () => {
    mocks.startEventCheckoutAction.mockResolvedValue({ ok: true, checkout: razorpayCheckout })
    renderButton()
    fireEvent.click(screen.getByRole('button', { name: 'Pay ₹499 and register' }))

    await waitFor(() => expect(mocks.options).not.toBeNull())
    expect(mocks.options).toMatchObject({ key: 'rzp_test_Key1', order_id: 'order_abc', amount: 49900, currency: 'INR', prefill: { email: 'officer@example.com', contact: '+919876543210', name: 'Capt. Rao' } })
    expect(screen.getByRole('button', { name: /Complete payment in the window/ })).toBeDisabled()

    const handler = mocks.options!.handler as (response: Record<string, string>) => void
    handler({ razorpay_payment_id: 'pay_1', razorpay_order_id: 'order_abc', razorpay_signature: 'sig' })

    expect(await screen.findByText('Payment of ₹499 received. Your seat is confirmed.')).toBeInTheDocument()
    expect(mocks.confirmEventPaymentAction).toHaveBeenCalledWith({ eventId, orderId, proof: { providerPaymentId: 'pay_1', signature: 'sig' } })
  })

  it('lets the attendee try again after closing the Razorpay window, without asking the server', async () => {
    mocks.startEventCheckoutAction.mockResolvedValue({ ok: true, checkout: razorpayCheckout })
    renderButton()
    fireEvent.click(screen.getByRole('button', { name: 'Pay ₹499 and register' }))
    await waitFor(() => expect(mocks.options).not.toBeNull())
    mocks.failureHandler!({ error: { description: 'Your card was declined.' } })
    expect(await screen.findByText(/payment didn't go through: Your card was declined/)).toBeInTheDocument()
    ;(mocks.options!.modal as { ondismiss: () => void }).ondismiss()
    expect(await screen.findByText(/Payment window closed. No money was taken/)).toBeInTheDocument()
    expect(mocks.confirmEventPaymentAction).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Pay ₹499 and register' })).toBeEnabled()
  })

  it('shows why checkout could not start, and a blocked checkout script', async () => {
    mocks.startEventCheckoutAction.mockResolvedValueOnce({ ok: false, error: 'Registration for this event has closed.' })
    renderButton()
    fireEvent.click(screen.getByRole('button', { name: 'Pay ₹499 and register' }))
    expect(await screen.findByText('Registration for this event has closed.')).toBeInTheDocument()
    expect(mocks.cashfreeCheckout).not.toHaveBeenCalled()

    mocks.startEventCheckoutAction.mockResolvedValueOnce({ ok: true, checkout: razorpayCheckout })
    mocks.loadRazorpayCheckout.mockRejectedValueOnce(new Error('razorpay_checkout_unavailable'))
    fireEvent.click(screen.getByRole('button', { name: 'Pay ₹499 and register' }))
    expect(await screen.findByText(/secure payment window could not load/)).toBeInTheDocument()
  })

  it('reports a refund when the seat could not be confirmed', async () => {
    mocks.confirmEventPaymentAction.mockResolvedValue({ ok: false, state: 'refunded', error: 'Your payment was received but we could not confirm a seat. The event was full when the payment arrived. The full amount has been refunded to your original payment method.' })
    renderButton()
    fireEvent.click(screen.getByRole('button', { name: 'Pay ₹499 and register' }))
    expect(await screen.findByText(/full amount has been refunded/)).toBeInTheDocument()
  })

  it('explains a currency that cannot be paid yet instead of offering a broken button', () => {
    renderButton({ blockedMessage: "Tickets for this event are priced in US dollars, which Sea N Shore can't accept yet. Ask the organiser to switch the price to Indian rupees (INR)." })
    const button = screen.getByRole('button', { name: 'Tickets not on sale yet' })
    expect(button).toBeDisabled()
    expect(screen.getByText(/priced in US dollars/)).toBeInTheDocument()
    fireEvent.click(button)
    expect(mocks.startEventCheckoutAction).not.toHaveBeenCalled()
  })
})
