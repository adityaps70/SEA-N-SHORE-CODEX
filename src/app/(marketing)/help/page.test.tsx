import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
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
    for (const title of ['Joining Sea N Shore', 'Seafarers & shore professionals', 'Companies & organizations', 'Global partners', 'Courses & events', 'Payments & plans', 'Account & privacy']) {
      expect(within(faq).getByRole('heading', { level: 3, name: title })).toBeInTheDocument()
      expect(within(faq).getByRole('link', { name: title })).toHaveAttribute('href', expect.stringMatching(/^#faq-/))
    }
    expect(faq.querySelectorAll('details').length).toBeGreaterThanOrEqual(24)
    expect(within(faq).getByText('What do the paid plans cost?')).toBeInTheDocument()
    expect(within(faq).getByText(/₹99 a month or ₹999 a year/)).toBeInTheDocument()
    expect(within(faq).getAllByText(/₹1,999 a month, ₹10,000 for 6 months or ₹14,999 a year/).length).toBeGreaterThan(0)
    expect(within(faq).getByText('How can my company become a Sea N Shore Global Partner?')).toBeInTheDocument()
    expect(within(faq).getByRole('link', { name: 'Contact us about a global partnership' })).toHaveAttribute('href', '/contact')
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

describe('/help on phones', () => {
  it('starts with a "Jump to" chip row for the topics, every FAQ group and contact', () => {
    const { container } = render(<HelpPage />)
    const jump = screen.getByRole('navigation', { name: 'Jump to' })
    expect(jump).toHaveClass('md:hidden')
    expect(container.querySelector('main')?.firstElementChild).toBe(jump)
    const links = within(jump).getAllByRole('link')
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '#topics',
      ...[...container.querySelectorAll('#faq > div > div[id^="faq-"]')].map((group) => `#${group.id}`),
      '#contact',
    ])
    for (const link of links) expect(container.querySelector(link.getAttribute('href') as string)).not.toBeNull()
    expect(within(jump).getByRole('link', { name: 'Payments & plans' })).toHaveAttribute('href', '#faq-payments')
    // The in-card topic chips stay for desktop.
    expect(screen.getByRole('navigation', { name: 'FAQ topics' })).toHaveClass('max-md:hidden')
  })
})

describe('/help search and support (round H, H7)', () => {
  it('filters the questions as you type and reads the number of matches', () => {
    const { container } = render(<HelpPage />)
    const faq = screen.getByRole('region', { name: 'Frequently asked questions' })
    const search = within(faq).getByRole('searchbox', { name: 'Search the questions' })
    const status = within(faq).getByRole('status')
    expect(status).toHaveAttribute('aria-live', 'polite')
    expect(search).toHaveAttribute('aria-describedby', status.id)
    expect(status).toHaveTextContent('')

    fireEvent.change(search, { target: { value: 'password' } })
    const visible = [...faq.querySelectorAll('details')].filter((details) => !details.closest('[hidden]'))
    expect(visible.length).toBeGreaterThan(0)
    expect(status).toHaveTextContent(new RegExp(`^${visible.length} questions? match`))
    expect(within(faq).getByText('I forgot my password. How do I reset it?')).toBeVisible()
    expect(container.querySelector('#faq-payments')).toHaveAttribute('hidden')

    fireEvent.change(search, { target: { value: 'zzqxv' } })
    expect(status).toHaveTextContent('No questions match “zzqxv”.')
    expect(within(faq).getByRole('link', { name: 'contact support' })).toHaveAttribute('href', '/contact#contact-form')

    fireEvent.change(search, { target: { value: '' } })
    expect(faq.querySelectorAll('details:not([hidden] details)').length).toBe(faq.querySelectorAll('details').length)
  })

  it('answers messaging, connections, communities, password reset and a lost two-step device', () => {
    render(<HelpPage />)
    const faq = screen.getByRole('region', { name: 'Frequently asked questions' })
    expect(within(faq).getByRole('heading', { level: 3, name: 'Messages, connections & communities' })).toBeInTheDocument()
    for (const question of ['Who can message me, and how do messages work?', 'How do connections work?', 'How do communities work, and can I start one?', 'I forgot my password. How do I reset it?', 'I lost the phone or app I use for two-step verification. What can I do?']) {
      expect(within(faq).getByText(question)).toBeInTheDocument()
    }
    expect(within(faq).getByRole('link', { name: 'Contact support about a lost device' })).toHaveAttribute('href', '/contact?topic=account#contact-form')
  })

  it('links the Contact page form and My requests', () => {
    render(<HelpPage />)
    const contact = within(screen.getByRole('heading', { name: 'Contact support' }).parentElement!)
    expect(contact.getByRole('link', { name: 'Contact support' })).toHaveAttribute('href', '/contact#contact-form')
    expect(contact.getByRole('link', { name: 'My requests' })).toHaveAttribute('href', '/help/requests')
  })
})
