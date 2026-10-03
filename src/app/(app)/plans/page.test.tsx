import { existsSync, readFileSync } from 'node:fs'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const path = 'src/app/(app)/plans/page.tsx'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  listActivePrices: vi.fn(),
  getAccessContext: vi.fn(),
  listUserOrganizations: vi.fn(),
  getUserOrganizationState: vi.fn(),
}))

vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/features/billing/subscription-repository', () => ({ subscriptionRepository: { listActivePrices: mocks.listActivePrices } }))
vi.mock('@/features/access/server', () => ({ getAccessContext: mocks.getAccessContext }))
vi.mock('@/features/organizations/repository', () => ({
  organizationRepository: { listUserOrganizations: mocks.listUserOrganizations, getUserOrganizationState: mocks.getUserOrganizationState },
}))

import PlansPage from './page'

const OCEANIC = { id: '11111111-1111-4111-8111-111111111111', slug: 'oceanic-ship-management', name: 'Oceanic Ship Management', verified: true, role: 'owner' }
const HARBOUR = { id: '22222222-2222-4222-8222-222222222222', slug: 'harbour-crew', name: 'Harbour Crew Services', verified: true, role: 'administrator' }

function access(memberships: Array<{ companyId: string; role: string; verified?: boolean; plan?: string }>) {
  return {
    personalPlan: 'free',
    personalEntitlements: [],
    verifications: [],
    organizationMemberships: memberships.map((entry) => ({ plan: 'free', verified: true, entitlements: [], ...entry })),
    accountActive: true,
  }
}

async function renderPlans() {
  render(await PlansPage())
  return screen.getByRole('heading', { level: 2, name: 'Organization Pro' }).closest('article') as HTMLElement
}

afterEach(() => cleanup())
beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAwsUser.mockResolvedValue({ id: 'user-1' })
  mocks.listActivePrices.mockResolvedValue([
    { id: 'p0', planCode: 'creator_pro', interval: 'month', amountMinor: 9900, currency: 'INR', active: true },
    { id: 'p1', planCode: 'organization_pro', interval: 'month', amountMinor: 199900, currency: 'INR', active: true },
    { id: 'p2', planCode: 'organization_pro', interval: 'half_year', amountMinor: 1000000, currency: 'INR', active: true },
    { id: 'p3', planCode: 'organization_pro', interval: 'year', amountMinor: 1499900, currency: 'INR', active: true },
  ])
  mocks.getUserOrganizationState.mockResolvedValue({ kind: 'none' })
})

describe('membership plans page contract', () => {
  it('presents the three simple Sea N Shore plans and separates payment from verification', () => {
    expect(existsSync(path)).toBe(true)
    // The plan cards are shared with the public /pricing page.
    expect(readFileSync(path, 'utf8')).toContain('<PlanCards')
    const page = readFileSync(path, 'utf8') + readFileSync('src/features/billing/components/plan-cards.tsx', 'utf8')

    expect(page).toContain('Sea N Shore Member')
    expect(page).toContain('FREE')
    expect(page).toContain('Creator Pro')
    expect(page).toContain('Organization Pro')
    expect(page).toContain('Post Jobs')
    expect(page).toContain('Create Events')
    expect(page).toContain('Create Courses / LMS')
    expect(page).toContain('Multiple admins')
    expect(page).toContain('Applicant management')
    expect(page).toContain('Student management')
    expect(page).toContain('Company verification')
    expect(page).toContain('Verification and payment are separate')
  })
})

describe('/plans prices and free trials', () => {
  it('shows the monthly, half-yearly and yearly prices with their savings and the trial badges', async () => {
    mocks.getAccessContext.mockResolvedValue(access([]))
    mocks.listUserOrganizations.mockResolvedValue([])
    const organization = await renderPlans()
    const creator = screen.getByRole('heading', { level: 2, name: 'Creator Pro' }).closest('article') as HTMLElement

    expect(organization).toHaveTextContent('₹1,999 / month')
    expect(organization).toHaveTextContent('or ₹10,000 / 6 months — save ₹1,994')
    expect(organization).toHaveTextContent('or ₹14,999 / year — save ₹8,989')
    expect(organization).toHaveTextContent('2 months free')
    expect(creator).toHaveTextContent('₹99 / month')
    expect(creator).toHaveTextContent('3 months free')
    expect(creator).not.toHaveTextContent('/ year')
    expect(screen.getAllByText('Start with a free trial, no payment details needed.')).toHaveLength(2)
  })
})

describe('/plans "Get Organization Pro" goes straight to the right place', () => {
  it('opens the checkout of the one organization the member owns', async () => {
    mocks.getAccessContext.mockResolvedValue(access([{ companyId: OCEANIC.id, role: 'owner' }]))
    mocks.listUserOrganizations.mockResolvedValue([OCEANIC])
    const card = await renderPlans()

    expect(screen.getByRole('link', { name: 'Get Organization Pro' }))
      .toHaveAttribute('href', `/settings/billing/organizations/${OCEANIC.id}?plan=organization_pro#organization-pro`)
    expect(card).toHaveTextContent('For Oceanic Ship Management.')
    expect(screen.getByRole('link', { name: 'Get Creator Pro' })).toHaveAttribute('href', '/settings/billing?plan=creator_pro#creator-pro')
  })

  it('opens the organization chooser when the member manages several organizations', async () => {
    mocks.getAccessContext.mockResolvedValue(access([{ companyId: OCEANIC.id, role: 'owner' }, { companyId: HARBOUR.id, role: 'administrator' }]))
    mocks.listUserOrganizations.mockResolvedValue([OCEANIC, HARBOUR])
    const card = await renderPlans()

    expect(screen.getByRole('link', { name: 'Get Organization Pro' })).toHaveAttribute('href', '/settings/billing?plan=organization_pro#organization-pro')
    expect(card).toHaveTextContent('Choose which of your 2 organizations to upgrade.')
  })

  it('explains verification and links the application status for an organization not verified yet', async () => {
    mocks.getAccessContext.mockResolvedValue(access([]))
    mocks.listUserOrganizations.mockResolvedValue([])
    mocks.getUserOrganizationState.mockResolvedValue({
      kind: 'application', applicationId: 'a1', status: 'pending', submittedAt: '', updatedAt: '', adminReviewNote: null,
      company: { id: 'c9', slug: 'blue-anchor', name: 'Blue Anchor Marine', verified: false }, membership: null,
    })
    const card = await renderPlans()

    expect(card).toHaveTextContent('Blue Anchor Marine isn’t verified yet. You can buy Organization Pro as soon as Sea N Shore verifies it.')
    expect(screen.getByRole('link', { name: 'View verification status' })).toHaveAttribute('href', '/organizations#your-pages')
    expect(screen.queryByRole('link', { name: 'Get Organization Pro' })).not.toBeInTheDocument()
  })

  it('offers "Create an organization page" when the member has no organization', async () => {
    mocks.getAccessContext.mockResolvedValue(access([]))
    mocks.listUserOrganizations.mockResolvedValue([])
    const card = await renderPlans()

    expect(card).toHaveTextContent('Organization Pro is bought for an organization page.')
    expect(screen.getByRole('link', { name: 'Create an organization page' })).toHaveAttribute('href', '/organizations?register=1#register-organization')
  })

  it('still shows a working button when the organizations cannot be loaded', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.getAccessContext.mockRejectedValue(new Error('db down'))
    mocks.listUserOrganizations.mockResolvedValue([])
    await renderPlans()

    expect(screen.getByRole('link', { name: 'Get Organization Pro' })).toHaveAttribute('href', '/settings/billing?plan=organization_pro#organization-pro')
    error.mockRestore()
  })

  it('keeps phones compact: page bar, smaller title, no lead, compact cards and the verification note behind a toggle', async () => {
    mocks.getAccessContext.mockResolvedValue(access([]))
    mocks.listUserOrganizations.mockResolvedValue([])
    const organization = await renderPlans()

    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/settings/billing')
    expect(screen.getByRole('heading', { level: 1 })).toHaveClass('max-md:text-xl')
    expect(screen.getByText(/Everyone can participate in the community for free/)).toHaveClass('max-md:hidden')
    expect(organization).toHaveClass('max-md:p-4')
    expect(screen.getByRole('heading', { level: 2, name: 'Verification and payment are separate' }).closest('section')).toHaveClass('max-md:hidden')
    const toggle = screen.getByText('Verification and payment are separate', { selector: 'summary' }).closest('details') as HTMLElement
    expect(toggle).toHaveClass('md:hidden')
    expect(toggle).not.toHaveAttribute('open')
  })
})
