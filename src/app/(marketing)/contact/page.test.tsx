import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ContactPage from './page'

const mocks = vi.hoisted(() => ({
  getSupportViewer: vi.fn(),
  getGrievanceOfficer: vi.fn(),
}))

vi.mock('@/features/support/viewer', () => ({ getSupportViewer: mocks.getSupportViewer }))
vi.mock('@/features/site-settings/queries', () => ({ getGrievanceOfficer: mocks.getGrievanceOfficer }))
vi.mock('@/features/support/actions', () => ({ submitContactForm: vi.fn(async () => ({ status: 'idle' })) }))

const EMPTY_OFFICER = { name: '', email: '', responseTime: '' }

async function renderPage(params: Record<string, string> = {}) {
  render(await ContactPage({ searchParams: Promise.resolve(params) }))
}

beforeEach(() => {
  mocks.getSupportViewer.mockResolvedValue(null)
  mocks.getGrievanceOfficer.mockResolvedValue(EMPTY_OFFICER)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('/contact', () => {
  it('names the operating business, its full registered address and how to reach it', async () => {
    await renderPage()
    expect(screen.getByRole('heading', { level: 1, name: 'Contact us' })).toBeVisible()
    expect(screen.getAllByText(/Beaufort Marine Services LLP/).length).toBeGreaterThan(0)
    expect(screen.getByText('0502, Hermes Hiranandani Fortune City, Bhokarpada, Panvel, Raigad, Maharashtra 410206, India')).toBeVisible()
    expect(screen.getAllByRole('link', { name: 'info@beaufortmarine.in' })[0]).toHaveAttribute('href', 'mailto:info@beaufortmarine.in')
    expect(screen.getByRole('link', { name: '+91 85914 63321' })).toHaveAttribute('href', 'tel:+918591463321')
    expect(screen.getAllByText(/Monday to Saturday, 10:00–18:00 IST/).length).toBeGreaterThan(0)
  })

  it('asks for the order ID, gives the reply time and links help, refunds and privacy', async () => {
    await renderPage()
    expect(screen.getByText('order ID')).toBeVisible()
    expect(screen.getByText(/We reply within 2 working days/)).toBeVisible()
    expect(screen.getByRole('link', { name: 'Help' })).toHaveAttribute('href', '/help')
    expect(screen.getAllByRole('link', { name: /Refund/ })[0]).toHaveAttribute('href', '/refunds')
    expect(screen.getAllByRole('link', { name: 'Privacy Policy' })[0]).toHaveAttribute('href', '/privacy#your-rights')
    expect(screen.getByRole('heading', { name: 'Grievances and data requests' })).toBeVisible()
  })
})

describe('/contact form (round H, H7)', () => {
  it('shows a labelled form with a hidden honeypot for visitors, nothing prefilled', async () => {
    await renderPage()
    const form = screen.getByRole('form', { name: 'Send us a message' })
    expect(form.closest('#contact-form')).not.toBeNull()
    expect(within(form).getByLabelText('Your name')).toHaveValue('')
    expect(within(form).getByLabelText('Email address')).toHaveValue('')
    expect(within(form).getByLabelText('Topic')).toBeRequired()
    expect(within(form).getByLabelText('Message')).toBeRequired()
    const honeypot = form.querySelector('input[name="website"]')
    expect(honeypot).toHaveAttribute('tabindex', '-1')
    expect(honeypot?.closest('[aria-hidden="true"]')).not.toBeNull()
    expect(screen.queryByRole('link', { name: 'My requests' })).not.toBeInTheDocument()
  })

  it('prefills a signed-in member’s name and email and links My requests', async () => {
    mocks.getSupportViewer.mockResolvedValue({ profileId: '11111111-1111-4111-8111-111111111111', name: 'Placeholder Sender', email: 'sender@example.com' })
    await renderPage({ topic: 'account' })
    const form = screen.getByRole('form', { name: 'Send us a message' })
    expect(within(form).getByLabelText('Your name')).toHaveValue('Placeholder Sender')
    expect(within(form).getByLabelText('Email address')).toHaveValue('sender@example.com')
    expect(within(form).getByLabelText('Topic')).toHaveValue('account')
    expect(screen.getByRole('link', { name: 'My requests' })).toHaveAttribute('href', '/help/requests')
  })
})

describe('/contact Grievance Officer (round H, H7)', () => {
  it('says an officer is being appointed and gives the support email while none is set', async () => {
    await renderPage()
    const section = screen.getByRole('heading', { name: 'Grievance Officer' }).closest('section')!
    expect(within(section).getByText(/A Grievance Officer is being appointed/)).toBeVisible()
    expect(within(section).getByRole('link', { name: 'info@beaufortmarine.in' })).toHaveAttribute('href', 'mailto:info@beaufortmarine.in')
  })

  it('names the officer from Admin › Site settings', async () => {
    mocks.getGrievanceOfficer.mockResolvedValue({ name: 'Placeholder Officer', email: 'grievance@example.com', responseTime: 'Within 15 days' })
    await renderPage()
    const section = screen.getByRole('heading', { name: 'Grievance Officer' }).closest('section')!
    expect(within(section).getByText('Placeholder Officer')).toBeVisible()
    expect(within(section).getByRole('link', { name: 'grievance@example.com' })).toHaveAttribute('href', 'mailto:grievance@example.com')
    expect(within(section).getByText('Within 15 days')).toBeVisible()
    expect(within(section).queryByText(/being appointed/)).not.toBeInTheDocument()
  })
})
