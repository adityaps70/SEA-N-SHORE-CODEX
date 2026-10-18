import { existsSync, readFileSync } from 'node:fs'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildPlanBillingView } from '@/features/billing/billing-view'
import { testPrice } from '@/features/billing/testing/memory-billing-store'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  getAccessContext: vi.fn(),
  listUserOrganizations: vi.fn(),
  getUserOrganizationState: vi.fn(),
  loadPlanBillingView: vi.fn(),
  loadCheckoutNotice: vi.fn(),
  listActivePrices: vi.fn(),
  // Round H (H7): Payment history (default: no payments).
  listForProfile: vi.fn(async () => [] as unknown[]),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/features/access/server', () => ({ getAccessContext: mocks.getAccessContext }))
vi.mock('@/features/organizations/repository', () => ({
  organizationRepository: { listUserOrganizations: mocks.listUserOrganizations, getUserOrganizationState: mocks.getUserOrganizationState },
}))
vi.mock('@/features/billing/page-data', () => ({ loadPlanBillingView: mocks.loadPlanBillingView, loadCheckoutNotice: mocks.loadCheckoutNotice }))
vi.mock('@/features/billing/subscription-repository', () => ({ subscriptionRepository: { listActivePrices: mocks.listActivePrices } }))
vi.mock('@/features/billing/payment-history', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/billing/payment-history')>()),
  paymentHistoryRepository: { listForProfile: mocks.listForProfile },
}))
vi.mock('@/features/billing/actions', () => ({
  startPlanCheckoutAction: vi.fn(),
  checkPlanCheckoutAction: vi.fn(),
  cancelAutoRenewAction: vi.fn(),
}))

import BillingSettingsPage from './page'

const OCEANIC = { id: '11111111-1111-4111-8111-111111111111', slug: 'oceanic-ship-management', name: 'Oceanic Ship Management', verified: true, role: 'owner' }
const HARBOUR = { id: '22222222-2222-4222-8222-222222222222', slug: 'harbour-crew', name: 'Harbour Crew Services', verified: true, role: 'administrator' }

const prices = [
  testPrice(),
  testPrice({ id: 'y', interval: 'year', amountMinor: 100000 }),
  testPrice({ id: 'om', planCode: 'organization_pro', amountMinor: 500000 }),
  testPrice({ id: 'oy', planCode: 'organization_pro', interval: 'year', amountMinor: 5000000 }),
]

const freeCreatorView = buildPlanBillingView({
  plan: 'creator_pro',
  billing: { access: null, accessIsCurrent: false, checkout: null, pendingCheckout: null, payments: [], trial: null },
  prices,
  configured: true,
})

function access(memberships: Array<{ companyId: string; role: string; plan?: string; verified?: boolean }>) {
  return {
    personalPlan: 'free',
    personalEntitlements: [],
    verifications: [],
    organizationMemberships: memberships.map((entry) => ({ plan: 'free', verified: true, entitlements: [], ...entry })),
    accountActive: true,
  }
}

function params(plan?: string) {
  return Promise.resolve(plan ? { plan } : {})
}

/** Top-level sections in page order, by their accessible name. */
function sectionOrder() {
  // Round H (H8): the page no longer draws its own <main> (the app layout's MemberChrome does), so look at every top-level section.
  const sections = Array.from(document.body.querySelectorAll('section')).filter((section) => !section.parentElement?.closest('section'))
  return sections.map((section) => {
    const labelledBy = section.getAttribute('aria-labelledby')
    return (labelledBy ? document.getElementById(labelledBy)?.textContent : section.querySelector('h2')?.textContent) ?? ''
  })
}

afterEach(() => cleanup())
beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAwsUser.mockResolvedValue({ id: 'user-1' })
  mocks.loadPlanBillingView.mockResolvedValue(freeCreatorView)
  mocks.loadCheckoutNotice.mockResolvedValue(null)
  mocks.listActivePrices.mockResolvedValue(prices)
  mocks.getUserOrganizationState.mockResolvedValue({ kind: 'none' })
  mocks.getAccessContext.mockResolvedValue(access([{ companyId: OCEANIC.id, role: 'owner' }]))
  mocks.listUserOrganizations.mockResolvedValue([OCEANIC])
})

describe('billing settings surface', () => {
  it('shows plan status without pretending checkout is configured', () => {
    const path = 'src/app/(app)/settings/billing/page.tsx'
    expect(existsSync(path)).toBe(true)
    const page = readFileSync(path, 'utf8')

    expect(page).toContain('Membership & billing')
    expect(page).toContain('Creator Pro')
    expect(page).toContain('Organization Pro')
    expect(page).toContain('getAccessContext')
    expect(page).toContain('payment provider')
    expect(page).toContain('/plans')
  })

  it('links Settings to membership and billing', () => {
    const settings = readFileSync('src/app/(app)/settings/page.tsx', 'utf8')
    expect(settings).toContain('/settings/billing')
    expect(settings).toContain('Membership & billing')
  })
})

describe('/settings/billing order by ?plan', () => {
  it('?plan=organization_pro puts the organizations first and keeps Creator Pro collapsed until asked', async () => {
    render(await BillingSettingsPage({ searchParams: params('organization_pro') }))

    const order = sectionOrder()
    expect(order[0]).toBe('Organization Pro')
    // Round H (H7): the personal card is headed by the plan the member is on ("Free plan"), not "Creator Pro".
    expect(order[1]).toBe('Free plan')
    const organizations = screen.getByRole('list', { name: 'Organizations you manage' })
    expect(within(organizations).getByText('Oceanic Ship Management')).toBeInTheDocument()
    expect(within(organizations).getByText('Free plan')).toBeInTheDocument()
    expect(within(organizations).getByRole('link', { name: 'Upgrade Oceanic Ship Management to Organization Pro' }))
      .toHaveAttribute('href', `/settings/billing/organizations/${OCEANIC.id}?plan=organization_pro#organization-pro`)
    expect(screen.getByText('₹5,000 per month or ₹50,000 per year')).toBeInTheDocument()

    // No personal checkout until the member asks for it.
    expect(screen.queryByRole('group', { name: /How often do you want to pay/ })).not.toBeInTheDocument()
    const getCreator = screen.getByRole('button', { name: 'Get Creator Pro' })
    expect(getCreator).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(getCreator)
    // A member who never had a trial sees the free-trial offer first, then the paid plans.
    expect(screen.getByRole('heading', { level: 3, name: 'Try Creator Pro free for 3 months' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start free trial — 3 months of Creator Pro' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: 'Or choose a paid plan now' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: /How often do you want to pay/ })).toBeInTheDocument()
  })

  it('lists every organization the member manages with its plan and next step', async () => {
    mocks.getAccessContext.mockResolvedValue(access([
      { companyId: OCEANIC.id, role: 'owner' },
      { companyId: HARBOUR.id, role: 'administrator', plan: 'organization_pro' },
    ]))
    mocks.listUserOrganizations.mockResolvedValue([OCEANIC, HARBOUR])
    render(await BillingSettingsPage({ searchParams: params('organization_pro') }))

    const [oceanic, harbour] = within(screen.getByRole('list', { name: 'Organizations you manage' })).getAllByRole('listitem')
    expect(oceanic).toHaveTextContent('Owner·Free plan')
    expect(within(oceanic!).getByRole('link', { name: /Upgrade Oceanic Ship Management/ })).toBeInTheDocument()
    expect(harbour).toHaveTextContent('Administrator·Organization Pro')
    expect(within(harbour!).getByRole('link', { name: /Manage the Organization Pro plan of Harbour Crew Services/ }))
      .toHaveAttribute('href', `/settings/billing/organizations/${HARBOUR.id}`)
  })

  it('?plan=creator_pro keeps today’s behaviour: Creator Pro checkout first', async () => {
    render(await BillingSettingsPage({ searchParams: params('creator_pro') }))

    const order = sectionOrder()
    // Round H (H7): headed "Free plan" (the plan the member is on); the panel itself offers Creator Pro.
    expect(order[0]).toBe('Free plan')
    expect(order[order.length - 2]).toBe('Organization Pro')
    expect(screen.getByRole('group', { name: /How often do you want to pay/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Get Creator Pro' })).not.toBeInTheDocument()
  })

  it('lists payments with their tax invoice or payment receipt (Round H, H7)', async () => {
    mocks.listForProfile.mockResolvedValueOnce([
      { id: 'o1', kind: 'course', at: '2026-09-01T06:30:00.000Z', item: 'Course · Ballast basics', amountMinor: 49900, currency: 'INR', status: 'paid', invoiceId: '44444444-4444-4444-8444-444444444444', invoiceNumber: 'SNS/26-27/000001', creditNoteId: null, creditNoteNumber: null },
      { id: '55555555-5555-4555-8555-555555555555', kind: 'event', at: '2026-10-01T06:30:00.000Z', item: 'Event ticket · Placeholder Summit', amountMinor: 150000, currency: 'INR', status: 'paid', invoiceId: null, invoiceNumber: null, creditNoteId: null, creditNoteNumber: null },
    ])
    render(await BillingSettingsPage({ searchParams: params() }))
    const history = screen.getByRole('region', { name: 'Payment history' })
    expect(mocks.listForProfile).toHaveBeenCalledWith('user-1')
    expect(within(history).getByText('Course · Ballast basics')).toBeInTheDocument()
    expect(within(history).getByText('₹499')).toBeInTheDocument()
    expect(within(history).getByRole('link', { name: /Tax invoice SNS\/26-27\/000001 \(PDF\)/ })).toHaveAttribute('href', '/api/learn/invoices/44444444-4444-4444-8444-444444444444')
    expect(within(history).getByRole('link', { name: /Payment receipt \(PDF\), Event ticket · Placeholder Summit/ })).toHaveAttribute('href', '/api/billing/receipts/event/55555555-5555-4555-8555-555555555555')
  })

  it('says so when payments cannot be read, and still renders the page (Round H, H7)', async () => {
    mocks.listForProfile.mockRejectedValueOnce(new Error('database down'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(await BillingSettingsPage({ searchParams: params() }))
    expect(within(screen.getByRole('region', { name: 'Payment history' })).getByRole('status')).toHaveTextContent('can’t be shown right now')
  })

  it('mentions both free trials, from the plan constants, as Pricing does (Round H, H7)', async () => {
    render(await BillingSettingsPage({ searchParams: params() }))
    expect(screen.getByText('Try Creator Pro free for 3 months. No payment details needed.')).toBeInTheDocument()
    expect(screen.getByText('Try Organization Pro free for 2 months. No payment details needed.')).toBeInTheDocument()
    // Not subscribed: no badge that reads like a free Creator Pro.
    expect(document.getElementById('creator-pro')).not.toHaveTextContent(/Creator Pro\s*Free plan/)
  })

  it('without ?plan shows both as summaries when the member has an organization', async () => {
    render(await BillingSettingsPage({ searchParams: params() }))

    expect(screen.getByRole('button', { name: 'Get Creator Pro' })).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: /How often do you want to pay/ })).not.toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Organizations you manage' })).toBeInTheDocument()
  })

  it('gives phones a page bar and still shows the membership plan and its status (hidden from the phone profile page)', async () => {
    render(await BillingSettingsPage({ searchParams: params() }))

    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/settings')
    expect(screen.getByRole('heading', { name: 'Membership & billing' }).closest('header')).toHaveClass('max-md:hidden')
    const personal = document.getElementById('creator-pro') as HTMLElement
    expect(personal).not.toBeNull()
    expect(personal.closest('.max-md\\:hidden')).toBeNull()
    // Round H (H7): "Free plan" heads the card; Creator Pro is what it offers.
    expect(within(personal).getByText(freeCreatorView.headline)).toBeInTheDocument()
    expect(within(personal).getByRole('button', { name: 'Get Creator Pro' })).toBeInTheDocument()
    expect(within(personal).getByText(freeCreatorView.statusLabel)).toBeInTheDocument()
  })

  it('without ?plan opens Creator Pro for a member with no organization and offers to create one', async () => {
    mocks.getAccessContext.mockResolvedValue(access([]))
    mocks.listUserOrganizations.mockResolvedValue([])
    render(await BillingSettingsPage({ searchParams: params() }))

    expect(screen.getByRole('group', { name: /How often do you want to pay/ })).toBeInTheDocument()
    const organization = screen.getByRole('region', { name: 'Organization Pro' })
    expect(within(organization).getByText(/Organization Pro is bought for an organization page/)).toBeInTheDocument()
    expect(within(organization).getByRole('link', { name: 'Create an organization page' })).toHaveAttribute('href', '/organizations?register=1#register-organization')
  })

  it('explains verification when the organization is still being verified', async () => {
    mocks.getAccessContext.mockResolvedValue(access([]))
    mocks.listUserOrganizations.mockResolvedValue([])
    mocks.getUserOrganizationState.mockResolvedValue({
      kind: 'application', applicationId: 'a1', status: 'pending', submittedAt: '', updatedAt: '', adminReviewNote: null,
      company: { id: 'c9', slug: 'blue-anchor', name: 'Blue Anchor Marine', verified: false }, membership: null,
    })
    render(await BillingSettingsPage({ searchParams: params('organization_pro') }))

    const organization = screen.getByRole('region', { name: 'Organization Pro' })
    expect(within(organization).getByText('Blue Anchor Marine isn’t verified yet')).toBeInTheDocument()
    expect(within(organization).getByRole('link', { name: 'View verification status' })).toHaveAttribute('href', '/organizations#your-pages')
    expect(screen.getByRole('button', { name: 'Get Creator Pro' })).toBeInTheDocument()
  })

  it('shows a clear message when the organizations cannot be loaded', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.listUserOrganizations.mockRejectedValue(new Error('db down'))
    render(await BillingSettingsPage({ searchParams: params('organization_pro') }))

    expect(screen.getByRole('alert')).toHaveTextContent('We couldn’t load your organizations just now.')
    error.mockRestore()
  })
})
