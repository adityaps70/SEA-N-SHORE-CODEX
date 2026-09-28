import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import ShippingPage from './page'

afterEach(() => cleanup())

describe('/shipping', () => {
  it('says only digital services are sold and nothing is shipped', () => {
    render(<ShippingPage />)
    expect(screen.getByRole('heading', { level: 1, name: 'Shipping & delivery policy' })).toBeVisible()
    expect(screen.getByText('digital services only')).toBeVisible()
    expect(screen.getByText(/Nothing physical is shipped/)).toBeVisible()
    expect(screen.getByText(/Beaufort Marine Services LLP/)).toBeVisible()
  })

  it('explains where access appears and what to do after 24 hours', () => {
    render(<ShippingPage />)
    expect(screen.getByText(/as soon as the payment is confirmed — usually within minutes/)).toBeVisible()
    expect(screen.getByRole('link', { name: 'My events' })).toHaveAttribute('href', '/events/my')
    expect(screen.getByRole('link', { name: 'My learning' })).toHaveAttribute('href', '/learn/my-learning')
    expect(screen.getByText(/does not appear within 24 hours/)).toBeVisible()
    expect(screen.getByRole('link', { name: 'contact us' })).toHaveAttribute('href', '/contact')
    expect(screen.getByRole('link', { name: /Refund & cancellation policy/ })).toHaveAttribute('href', '/refunds')
  })
})
