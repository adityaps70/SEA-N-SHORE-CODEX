import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import PrivacyPage from './page'

afterEach(() => cleanup())

describe('/privacy', () => {
  it('names the operator, keeps the existing content and explains payments and data requests', () => {
    render(<PrivacyPage />)
    expect(screen.getByText('Beaufort Marine Services LLP')).toBeVisible()
    expect(screen.getByText(/Navi Mumbai, Maharashtra, India/)).toBeVisible()
    expect(screen.getByText(/uses account and professional-profile information/)).toBeVisible()
    expect(screen.getByText(/processed by our payment gateway, Cashfree Payments/)).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Your data requests and grievances' }).closest('section')).toHaveAttribute('aria-labelledby', 'your-rights')
    expect(screen.getByRole('link', { name: 'info@beaufortmarine.in' })).toHaveAttribute('href', 'mailto:info@beaufortmarine.in')
    expect(screen.getByRole('link', { name: /Your data & privacy/ })).toHaveAttribute('href', '/settings#your-data')
    expect(screen.getByRole('link', { name: 'Contact us' })).toHaveAttribute('href', '/contact')
  })
})
