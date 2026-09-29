import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import TermsPage from './page'

afterEach(() => cleanup())

describe('TermsPage', () => {
  it('explains user content ownership, platform licence and copyright complaints', () => {
    render(<TermsPage />)

    expect(screen.getByRole('heading', { name: /user content and intellectual property/i })).toBeVisible()
    expect(screen.getByText(/you retain ownership/i)).toBeVisible()
    expect(screen.getByText(/non-exclusive/i)).toBeVisible()
    expect(screen.getByRole('heading', { name: /copyright complaints and review/i })).toBeVisible()
    expect(screen.getByRole('link', { name: /copyright & ip policy/i })).toHaveAttribute('href', '/copyright')
  })

  it('names the operator and explains payments, auto-renewal and the marketplace role', () => {
    render(<TermsPage />)

    expect(screen.getAllByText(/Beaufort Marine Services LLP/).length).toBeGreaterThan(0)
    expect(screen.getByText(/Navi Mumbai, Maharashtra, India/)).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Payments, plans and paid content' })).toBeVisible()
    expect(screen.getByText(/processed by our payment gateway, Cashfree Payments/)).toBeVisible()
    expect(screen.getByText(/Prices are in Indian rupees \(INR\) and include applicable taxes where this is stated/)).toBeVisible()
    expect(screen.getByText(/renew automatically at the end of each monthly or yearly period/)).toBeVisible()
    expect(screen.getByText(/pay them their share, minus a platform fee/)).toBeVisible()
    expect(screen.getAllByRole('link', { name: /Refund & cancellation/ })[0]).toHaveAttribute('href', '/refunds')
    expect(screen.getAllByRole('link', { name: /Shipping & delivery/ })[0]).toHaveAttribute('href', '/shipping')
    expect(screen.getAllByRole('link', { name: /Contact us/i })[0]).toHaveAttribute('href', '/contact')
  })
})

describe('TermsPage on phones', () => {
  it('has a "Jump to" chip row whose chips all land on a section, and 16px body text', () => {
    const { container } = render(<TermsPage />)
    const jump = screen.getByRole('navigation', { name: 'Jump to' })
    expect(jump).toHaveClass('md:hidden')
    const hrefs = within(jump).getAllByRole('link').map((link) => link.getAttribute('href'))
    expect(hrefs).toEqual(['#responsible-use', '#user-content', '#platform-ip', '#copyright-complaints', '#payments', '#contact'])
    for (const href of hrefs) expect(container.querySelector(href as string)).not.toBeNull()
    expect(container.querySelector('article > div.space-y-7')).toHaveClass('text-sm', 'max-md:text-base')
  })
})
