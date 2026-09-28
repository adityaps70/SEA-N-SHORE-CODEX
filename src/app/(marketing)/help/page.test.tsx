import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import HelpPage from './page'

afterEach(() => cleanup())

describe('/help', () => {
  it('links pricing, refunds, delivery and contact, and shows the support inbox and phone', () => {
    render(<HelpPage />)
    expect(screen.getByRole('link', { name: /See pricing/ })).toHaveAttribute('href', '/pricing')
    expect(screen.getByRole('link', { name: /Read the refund policy/ })).toHaveAttribute('href', '/refunds')
    expect(screen.getByRole('link', { name: /Read the delivery policy/ })).toHaveAttribute('href', '/shipping')
    expect(screen.getByRole('link', { name: 'Contact us' })).toHaveAttribute('href', '/contact')
    expect(screen.getByRole('link', { name: 'info@beaufortmarine.in' })).toHaveAttribute('href', 'mailto:info@beaufortmarine.in')
    expect(screen.getByRole('link', { name: '+91 85914 63321' })).toHaveAttribute('href', 'tel:+918591463321')
    expect(screen.getByText('Sea N Shore is operated by Beaufort Marine Services LLP · Navi Mumbai, India')).toBeVisible()
  })
})
