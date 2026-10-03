import { cleanup, render, screen, within } from '@testing-library/react'
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

describe('/privacy on phones', () => {
  it('has a "Jump to" chip row for its sections', () => {
    const { container } = render(<PrivacyPage />)
    const jump = screen.getByRole('navigation', { name: 'Jump to' })
    expect(jump).toHaveClass('md:hidden')
    const hrefs = within(jump).getAllByRole('link').map((link) => link.getAttribute('href'))
    expect(hrefs).toEqual(['#how-we-use', '#payments', '#your-rights'])
    for (const href of hrefs) expect(container.querySelector(href as string)).not.toBeNull()
  })
})
