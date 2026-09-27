import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  confirmForViewer: vi.fn(),
}))

vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/features/payments/order-handlers', () => ({
  orderHandlerFor: (id: string) => (id.startsWith('evt_') ? { confirmForViewer: mocks.confirmForViewer, applyGatewayEvent: vi.fn() } : null),
}))

import PaymentReturnPage from './page'

const userId = '11111111-1111-4111-8111-111111111111'
const orderId = 'evt_33333333333343338333333333333333'

async function renderPage(params: Record<string, string>) {
  render(await PaymentReturnPage({ searchParams: Promise.resolve(params) }))
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAwsUser.mockResolvedValue({ id: userId, email: 'officer@example.com' })
})
afterEach(() => cleanup())

describe('/payments/return', () => {
  it('asks the order’s handler (never the URL) and shows the confirmed result', async () => {
    mocks.confirmForViewer.mockResolvedValue({
      state: 'paid',
      title: 'Payment received — your seat is confirmed',
      message: "We received ₹499 for Paid masterclass. You'll find the event in My events.",
      returnHref: '/events/22222222-2222-4222-8222-222222222222',
      returnLabel: 'Back to the event',
    })
    await renderPage({ order: orderId, status: 'PAID' })
    expect(mocks.confirmForViewer).toHaveBeenCalledWith({ profileId: userId, providerOrderId: orderId })
    expect(screen.getByRole('heading', { name: 'Payment received — your seat is confirmed' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to the event' })).toHaveAttribute('href', '/events/22222222-2222-4222-8222-222222222222')
    expect(screen.queryByRole('link', { name: 'Check again' })).not.toBeInTheDocument()
  })

  it('offers "Check again" while the bank is still processing', async () => {
    mocks.confirmForViewer.mockResolvedValue({ state: 'processing', title: 'Waiting for your bank', message: 'Check again shortly.', returnHref: '/events/x', returnLabel: 'Back to the event' })
    await renderPage({ order_id: orderId })
    expect(screen.getByRole('link', { name: 'Check again' })).toHaveAttribute('href', `/payments/return?order=${orderId}`)
  })

  it('shows a clear message for an unknown link and when the gateway cannot be reached', async () => {
    await renderPage({ order: '../../etc' })
    expect(screen.getByRole('heading', { name: 'We could not find this payment' })).toBeInTheDocument()
    expect(mocks.confirmForViewer).not.toHaveBeenCalled()
    cleanup()

    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.confirmForViewer.mockRejectedValue(new Error('provider_unreachable'))
    await renderPage({ order: orderId })
    expect(screen.getByRole('heading', { name: 'We could not check your payment yet' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Check again' })).toBeInTheDocument()
    error.mockRestore()
  })
})
