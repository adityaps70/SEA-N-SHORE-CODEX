import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ refundEventPaymentAction: vi.fn(), refresh: vi.fn() }))

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))
vi.mock('../event-payment-actions', () => ({ refundEventPaymentAction: mocks.refundEventPaymentAction }))

import { EventRefundButton } from './event-refund-button'

const orderId = '33333333-3333-4333-8333-333333333333'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.refundEventPaymentAction.mockResolvedValue({ ok: true, message: "Refunded ₹499. The attendee's seat has been released and the money is on its way back to their original payment method." })
})
afterEach(() => cleanup())

describe('EventRefundButton', () => {
  it('asks for confirmation inline before refunding, then shows the result', async () => {
    render(<EventRefundButton orderId={orderId} amountLabel="₹499" attendeeName="Capt. Rao" seatConfirmed />)
    fireEvent.click(screen.getByRole('button', { name: 'Refund ₹499' }))
    expect(mocks.refundEventPaymentAction).not.toHaveBeenCalled()
    expect(screen.getByRole('group', { name: 'Refund ₹499 to Capt. Rao?' })).toBeInTheDocument()
    expect(screen.getByText(/Their seat will be released/)).toBeInTheDocument()
    const confirm = screen.getByRole('button', { name: 'Yes, refund ₹499' })
    await waitFor(() => expect(confirm).toHaveFocus())

    fireEvent.click(confirm)
    expect(await screen.findByRole('status')).toHaveTextContent('Refunded ₹499.')
    expect(mocks.refundEventPaymentAction).toHaveBeenCalledWith(orderId)
    expect(mocks.refresh).toHaveBeenCalled()
  })

  it('closes with Escape or "Keep payment" without refunding', async () => {
    render(<EventRefundButton orderId={orderId} amountLabel="₹499" attendeeName="Capt. Rao" seatConfirmed={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'Refund ₹499' }))
    expect(screen.queryByText(/Their seat will be released/)).not.toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('group'), { key: 'Escape' })
    expect(screen.queryByRole('group')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Refund ₹499' }))
    fireEvent.click(screen.getByRole('button', { name: 'Keep payment' }))
    expect(screen.getByRole('button', { name: 'Refund ₹499' })).toBeInTheDocument()
    expect(mocks.refundEventPaymentAction).not.toHaveBeenCalled()
  })

  it('shows a pending state and the reason when the refund is refused', async () => {
    let resolve: (value: unknown) => void = () => undefined
    mocks.refundEventPaymentAction.mockReturnValue(new Promise((done) => { resolve = done }))
    render(<EventRefundButton orderId={orderId} amountLabel="₹499" attendeeName="Capt. Rao" seatConfirmed retry />)
    fireEvent.click(screen.getByRole('button', { name: 'Try refund of ₹499 again' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, refund ₹499' }))
    expect(await screen.findByRole('button', { name: 'Refunding…' })).toBeDisabled()
    resolve({ ok: false, error: 'The payment provider did not accept the refund. Nothing was refunded. Try again later or contact the Sea N Shore team.' })
    expect(await screen.findByRole('alert')).toHaveTextContent('Nothing was refunded')
    expect(screen.getByRole('button', { name: 'Yes, refund ₹499' })).toBeEnabled()
  })
})
