import { cleanup, render, screen, within } from '@testing-library/react'
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

describe('/help FAQ', () => {
  it('groups the full FAQ by audience and topic', () => {
    render(<HelpPage />)
    const faq = screen.getByRole('region', { name: 'Frequently asked questions' })
    for (const title of ['Seafarers & shore professionals', 'Companies & organizations', 'Courses & events', 'Payments & plans', 'Account & privacy']) {
      expect(within(faq).getByRole('heading', { level: 3, name: title })).toBeInTheDocument()
      expect(within(faq).getByRole('link', { name: title })).toHaveAttribute('href', expect.stringMatching(/^#faq-/))
    }
    expect(faq.querySelectorAll('details').length).toBeGreaterThanOrEqual(15)
    expect(within(faq).getByText('What do the paid plans cost?')).toBeInTheDocument()
    expect(within(faq).getByText(/₹100 a month or ₹1,000 a year/)).toBeInTheDocument()
    expect(within(faq).getAllByText(/₹2,000 a month or ₹20,000 a year/).length).toBeGreaterThan(0)
    expect(within(faq).getByText(/"Unclaimed"/)).toBeInTheDocument()
  })

  it('keeps the existing help topics and contact details', () => {
    render(<HelpPage />)
    expect(screen.getByRole('link', { name: /Open data controls/ })).toHaveAttribute('href', '/settings#your-data')
    expect(screen.getByRole('heading', { name: 'Contact support' })).toBeInTheDocument()
  })

  it('publishes FAQPage structured data for every question', () => {
    const { container } = render(<HelpPage />)
    const script = container.querySelector('script[type="application/ld+json"]')
    const data = JSON.parse(script?.textContent ?? '{}')
    expect(data['@type']).toBe('FAQPage')
    expect(data.mainEntity).toHaveLength(container.querySelectorAll('details').length)
    expect(data.mainEntity[0]).toMatchObject({ '@type': 'Question', acceptedAnswer: { '@type': 'Answer' } })
  })
})
