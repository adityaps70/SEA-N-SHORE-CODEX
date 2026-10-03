import { readFileSync } from 'node:fs'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listActivePrices: vi.fn(),
  getVerifiedUser: vi.fn(),
}))

vi.mock('@/features/billing/subscription-repository', () => ({ subscriptionRepository: { listActivePrices: mocks.listActivePrices } }))
vi.mock('@/features/auth/queries', () => ({ getVerifiedUser: mocks.getVerifiedUser }))

import PricingPage from './page'

const PRICES = [
  { id: 'c1', planCode: 'creator_pro', interval: 'month', amountMinor: 9900, currency: 'INR', active: true },
  { id: 'c2', planCode: 'creator_pro', interval: 'year', amountMinor: 99900, currency: 'INR', active: true },
  { id: 'o1', planCode: 'organization_pro', interval: 'month', amountMinor: 199900, currency: 'INR', active: true },
  { id: 'o2', planCode: 'organization_pro', interval: 'half_year', amountMinor: 1000000, currency: 'INR', active: true },
  { id: 'o3', planCode: 'organization_pro', interval: 'year', amountMinor: 1499900, currency: 'INR', active: true },
]

function card(name: string) {
  return screen.getByRole('heading', { level: 2, name }).closest('article') as HTMLElement
}

afterEach(() => cleanup())
beforeEach(() => {
  vi.clearAllMocks()
  mocks.listActivePrices.mockResolvedValue(PRICES)
  mocks.getVerifiedUser.mockResolvedValue(null)
})

describe('/pricing (public checkout page for the payment gateway)', () => {
  it('shows the real plan prices from the database in rupees', async () => {
    render(await PricingPage())

    expect(screen.getByRole('heading', { level: 1, name: 'Plans and prices' })).toBeVisible()
    expect(card('Sea N Shore Member')).toHaveTextContent('FREE')
    expect(card('Creator Pro')).toHaveTextContent('₹99 / month')
    expect(card('Creator Pro')).toHaveTextContent('or ₹999 / year — save ₹189')
    expect(card('Creator Pro')).not.toHaveTextContent('6 months')
    expect(card('Organization Pro')).toHaveTextContent('₹1,999 / month')
    expect(card('Organization Pro')).toHaveTextContent('or ₹10,000 / 6 months — save ₹1,994')
    expect(card('Organization Pro')).toHaveTextContent('or ₹14,999 / year — save ₹8,989')
    expect(within(card('Organization Pro')).getByText('or ₹10,000 / 6 months — save ₹1,994').compareDocumentPosition(within(card('Organization Pro')).getByText('or ₹14,999 / year — save ₹8,989'))).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(screen.getByText(/renew automatically each month, six months or year/)).toBeInTheDocument()
    expect(card('Creator Pro')).toHaveTextContent('Post Jobs')
    expect(card('Organization Pro')).toHaveTextContent('Multiple admins')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(mocks.listActivePrices).toHaveBeenCalledTimes(1)
  })

  it('shows the free-trial badges and note on both paid plans', async () => {
    render(await PricingPage())

    expect(within(card('Creator Pro')).getByText('3 months free')).toHaveClass('rounded-full', 'bg-teal-50', 'text-teal-800')
    expect(within(card('Organization Pro')).getByText('2 months free')).toHaveClass('rounded-full', 'bg-white/15', 'text-white')
    expect(within(card('Creator Pro')).getByText('Start with a free trial, no payment details needed.')).toBeInTheDocument()
    expect(within(card('Organization Pro')).getByText('Start with a free trial, no payment details needed.')).toBeInTheDocument()
    expect(within(card('Organization Pro')).getByText('Renews automatically. Cancel auto-renew any time.')).toBeInTheDocument()
    expect(within(card('Sea N Shore Member')).queryByText(/months free/)).not.toBeInTheDocument()
  })

  it('offers "Sign in to buy" and "Create free account" to signed-out visitors', async () => {
    render(await PricingPage())

    expect(within(card('Sea N Shore Member')).getByRole('link', { name: 'Create free account' })).toHaveAttribute('href', '/auth/sign-up')
    expect(within(card('Creator Pro')).getByRole('link', { name: 'Sign in to buy' })).toHaveAttribute('href', '/auth/sign-in')
    expect(within(card('Organization Pro')).getByRole('link', { name: 'Sign in to buy' })).toHaveAttribute('href', '/auth/sign-in')
  })

  it('sends signed-in members straight to checkout', async () => {
    mocks.getVerifiedUser.mockResolvedValue({ id: 'user-1' })
    render(await PricingPage())

    expect(within(card('Creator Pro')).getByRole('link', { name: 'Get Creator Pro' })).toHaveAttribute('href', '/settings/billing?plan=creator_pro#creator-pro')
    expect(within(card('Organization Pro')).getByRole('link', { name: 'Get Organization Pro' }))
      .toHaveAttribute('href', '/settings/billing?plan=organization_pro#organization-pro')
    expect(screen.queryByRole('link', { name: 'Sign in to buy' })).not.toBeInTheDocument()
  })

  it('explains paid events and courses, Cashfree and links the refund and delivery policies', async () => {
    render(await PricingPage())

    expect(screen.getByRole('heading', { name: 'Paid events and courses' })).toBeVisible()
    expect(screen.getByText(/Event organisers and trainers set their own prices in Indian rupees \(INR\)/)).toBeVisible()
    expect(screen.getByText(/processed securely by our payment gateway, Cashfree Payments/)).toBeVisible()
    expect(screen.getByRole('link', { name: /Refund & cancellation policy/ })).toHaveAttribute('href', '/refunds')
    expect(screen.getByRole('link', { name: /Shipping & delivery policy/ })).toHaveAttribute('href', '/shipping')
    expect(screen.getByText(/Sea N Shore is operated by Beaufort Marine Services LLP · Navi Mumbai, India/)).toBeVisible()
  })

  it('still renders, with clear fallback text, when the database cannot be reached', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.listActivePrices.mockRejectedValue(new Error('connect ECONNREFUSED'))
    mocks.getVerifiedUser.mockRejectedValue(new Error('auth down'))
    render(await PricingPage())

    expect(screen.getByRole('status')).toHaveTextContent('Current plan prices could not be loaded just now. Refresh this page in a minute.')
    expect(card('Creator Pro')).toHaveTextContent('Price shown before you pay')
    expect(card('Organization Pro')).toHaveTextContent('Price shown before you pay')
    expect(card('Creator Pro')).toHaveTextContent('3 months free')
    expect(card('Organization Pro')).toHaveTextContent('2 months free')
    expect(screen.getAllByRole('link', { name: 'Sign in to buy' })).toHaveLength(2)
    error.mockRestore()
  })

  it('is public: it never requires sign-in', () => {
    const source = readFileSync('src/app/(marketing)/pricing/page.tsx', 'utf8')
    expect(source).not.toMatch(/require(Aws)?User/)
    expect(source).toContain('PlanCards')
  })
})
