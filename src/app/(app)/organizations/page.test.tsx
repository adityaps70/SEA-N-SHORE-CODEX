import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  getAccessContext: vi.fn(),
  getUserOrganizationState: vi.fn(),
  listUserAccessRequests: vi.fn(),
  listUserOrganizations: vi.fn(),
  searchCompanies: vi.fn(),
  getOrganizationApplication: vi.fn(),
  listFollowedOrganizations: vi.fn(),
  countPendingForManager: vi.fn(),
  listOrganizationCards: vi.fn(),
  listDiscoverOrganizations: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('next/image', () => ({ default: (props: Record<string, unknown>) => <span data-testid="logo" data-src={String(props.src)} /> }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/features/access/server', () => ({ getAccessContext: mocks.getAccessContext }))
vi.mock('@/features/organizations/repository', () => ({
  organizationRepository: {
    getUserOrganizationState: mocks.getUserOrganizationState,
    listUserAccessRequests: mocks.listUserAccessRequests,
    listUserOrganizations: mocks.listUserOrganizations,
    searchCompanies: mocks.searchCompanies,
    getOrganizationApplication: mocks.getOrganizationApplication,
  },
}))
vi.mock('@/features/organizations/workspace-repository', () => ({
  organizationWorkspaceRepository: {
    listFollowedOrganizations: mocks.listFollowedOrganizations,
    listOrganizationCards: mocks.listOrganizationCards,
    listDiscoverOrganizations: mocks.listDiscoverOrganizations,
  },
}))
vi.mock('@/features/organizations/access-request-repository', () => ({
  organizationAccessRequestRepository: { countPendingForManager: mocks.countPendingForManager },
}))
vi.mock('@/features/organizations/actions', () => ({
  requestOrganizationAccess: vi.fn(),
  submitOrganizationApplication: vi.fn(),
  resubmitOrganizationApplication: vi.fn(),
}))
vi.mock('@/features/organizations/follow-actions', () => ({ followOrganizationAction: vi.fn(), unfollowOrganizationAction: vi.fn() }))
vi.mock('@/features/organizations/access-request-actions', () => ({
  escalateOrganizationAccessRequest: vi.fn(),
  withdrawOrganizationAccessRequest: vi.fn(),
}))

import OrganizationsPage from './page'

function card(overrides: Record<string, unknown>) {
  return {
    id: 'c1', slug: 'oceanic', name: 'Oceanic Shipping', logoPath: null, coverPath: null, tagline: 'Tanker management from Mumbai',
    description: null, companyType: 'Ship manager', organizationType: 'ship_manager', headquarters: 'Mumbai',
    verified: true, followerCount: 120, following: false, ...overrides,
  }
}

afterEach(() => cleanup())

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAwsUser.mockResolvedValue({ id: 'user-1' })
  mocks.getAccessContext.mockResolvedValue({
    personalPlan: 'free',
    personalEntitlements: [],
    verifications: [],
    organizationMemberships: [{ companyId: 'c1', plan: 'free', role: 'owner', verified: true, entitlements: [] }],
    accountActive: true,
  })
  mocks.getUserOrganizationState.mockResolvedValue({ kind: 'none' })
  mocks.listUserAccessRequests.mockResolvedValue([])
  mocks.listUserOrganizations.mockResolvedValue([{ id: 'c1', slug: 'oceanic', name: 'Oceanic Shipping', verified: true, role: 'owner' }])
  mocks.searchCompanies.mockResolvedValue([])
  mocks.listFollowedOrganizations.mockResolvedValue([])
  mocks.countPendingForManager.mockResolvedValue({ c1: 2 })
  mocks.listOrganizationCards.mockImplementation(async (ids: string[]) => ids.map((id) => card({ id })))
  mocks.listDiscoverOrganizations.mockResolvedValue([])
})

describe('/organizations hub', () => {
  it('lists the user\'s organizations with role chips and links owners to waiting requests', async () => {
    render(await OrganizationsPage({ searchParams: Promise.resolve({}) }))

    expect(screen.getByRole('heading', { level: 1, name: 'Organizations' })).toBeInTheDocument()
    expect(screen.getByText('2 requests need your decision')).toBeInTheDocument()
    const organizations = screen.getByRole('region', { name: 'Your pages' })
    expect(mocks.listOrganizationCards).toHaveBeenCalledWith(['c1'], 'user-1')
    expect(within(organizations).getByText('Tanker management from Mumbai')).toBeInTheDocument()
    expect(within(organizations).getByText('Owner')).toBeInTheDocument()
    expect(within(organizations).getByText('Free plan')).toBeInTheDocument()
    expect(within(organizations).getByRole('link', { name: '2 requests waiting' })).toHaveAttribute('href', '/organizations/oceanic/manage?section=requests')
    expect(within(organizations).getByRole('link', { name: 'View Oceanic Shipping page' })).toHaveAttribute('href', '/organizations/oceanic')
    expect(within(organizations).getByRole('link', { name: 'Manage Oceanic Shipping' })).toHaveAttribute('href', '/organizations/oceanic/manage')
    // The long registration form stays collapsed until asked for.
    expect(screen.getByRole('button', { name: 'Register a new organization' })).toBeInTheDocument()
    expect(screen.queryByRole('form', { name: 'Register a new organization' })).not.toBeInTheDocument()
  })

  it('gives owners of a free organization an Upgrade button to its Plan & billing', async () => {
    render(await OrganizationsPage({ searchParams: Promise.resolve({}) }))

    const organizations = screen.getByRole('region', { name: 'Your pages' })
    expect(within(organizations).getByRole('link', { name: 'Upgrade Oceanic Shipping to Organization Pro' }))
      .toHaveAttribute('href', '/organizations/oceanic/manage?section=billing')
  })

  it('shows Plan & billing instead of Upgrade once the organization has Organization Pro', async () => {
    mocks.getAccessContext.mockResolvedValue({
      personalPlan: 'free', personalEntitlements: [], verifications: [], accountActive: true,
      organizationMemberships: [{ companyId: 'c1', plan: 'organization_pro', role: 'owner', verified: true, entitlements: [] }],
    })
    render(await OrganizationsPage({ searchParams: Promise.resolve({}) }))

    const organizations = screen.getByRole('region', { name: 'Your pages' })
    expect(within(organizations).getByText('Organization Pro')).toBeInTheDocument()
    expect(within(organizations).queryByRole('link', { name: /Upgrade/ })).not.toBeInTheDocument()
    expect(within(organizations).getByRole('link', { name: 'Plan & billing for Oceanic Shipping' })).toHaveAttribute('href', '/organizations/oceanic/manage?section=billing')
  })

  it('does not offer the upgrade to members who cannot buy', async () => {
    mocks.getAccessContext.mockResolvedValue({
      personalPlan: 'free', personalEntitlements: [], verifications: [], accountActive: true,
      organizationMemberships: [{ companyId: 'c1', plan: 'free', role: 'recruiter', verified: true, entitlements: [] }],
    })
    mocks.listUserOrganizations.mockResolvedValue([{ id: 'c1', slug: 'oceanic', name: 'Oceanic Shipping', verified: true, role: 'recruiter' }])
    render(await OrganizationsPage({ searchParams: Promise.resolve({}) }))

    const organizations = screen.getByRole('region', { name: 'Your pages' })
    expect(within(organizations).queryByRole('link', { name: /Upgrade|Plan & billing/ })).not.toBeInTheDocument()
  })

  it('searches once and lets the member request access from each result', async () => {
    mocks.searchCompanies.mockResolvedValue([
      { id: 'c1', slug: 'oceanic', name: 'Oceanic Shipping', companyType: 'Ship manager', verified: true, website: null },
      { id: 'c2', slug: 'harbour-minds', name: 'Harbour Minds', companyType: 'Mental-health & wellbeing provider', verified: false, website: 'https://harbourminds.org' },
    ])
    render(await OrganizationsPage({ searchParams: Promise.resolve({ q: 'har' }) }))

    expect(mocks.searchCompanies).toHaveBeenCalledWith('har')
    expect(screen.getAllByRole('searchbox')).toHaveLength(1)
    const results = screen.getByText(/Organization search results for/).parentElement!.parentElement!
    expect(within(results).getByText('You are a member')).toBeInTheDocument()
    expect(within(results).getByText(/Mental-health & wellbeing provider · harbourminds.org/)).toBeInTheDocument()
    expect(within(results).getByRole('button', { name: 'Request access' })).toBeInTheDocument()
  })

  it('marks unclaimed results and offers to claim them instead of requesting to join', async () => {
    mocks.searchCompanies.mockResolvedValue([
      { id: 'c9', slug: 'blue-anchor-abc123', name: 'Blue Anchor Marine', companyType: 'Ship manager', verified: false, unclaimed: true, website: null },
    ])
    render(await OrganizationsPage({ searchParams: Promise.resolve({ q: 'blue' }) }))

    const results = screen.getByText(/Organization search results for/).parentElement!.parentElement!
    expect(within(results).getByText('Unclaimed')).toBeInTheDocument()
    expect(within(results).getByRole('link', { name: 'Claim this page' })).toHaveAttribute('href', '/organizations/blue-anchor-abc123/claim')
    expect(within(results).queryByRole('button', { name: 'Request access' })).not.toBeInTheDocument()
  })

  it('marks unclaimed organizations on cards', async () => {
    mocks.listDiscoverOrganizations.mockResolvedValue([card({ id: 'c8', slug: 'harbour-crew', name: 'Harbour Crew', verified: false, unclaimed: true, followerCount: 0 })])
    render(await OrganizationsPage({ searchParams: Promise.resolve({}) }))
    const discover = screen.getByRole('region', { name: 'Discover organizations' })
    expect(within(discover).getByText('Unclaimed')).toBeInTheDocument()
  })

  it('shows the requester\'s own requests with plain status, never "Sea N Shore review"', async () => {
    mocks.listUserAccessRequests.mockResolvedValue([{
      id: 'r1',
      status: 'pending',
      requestedRole: 'member',
      grantedRole: null,
      requestType: 'join_company',
      message: null,
      requestedAt: new Date().toISOString(),
      reviewedAt: null,
      reviewerNote: null,
      decidedVia: null,
      escalatedAt: null,
      escalationNote: null,
      company: { id: 'c2', slug: 'harbour-minds', name: 'Harbour Minds', verified: false },
    }])
    render(await OrganizationsPage({ searchParams: Promise.resolve({}) }))
    const requests = screen.getByRole('region', { name: 'Your requests' })
    expect(within(requests).getByText('Waiting for the organization')).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent(/submitted for Sea N Shore review/i)
  })

  it('explains why registration is unavailable while an application is being reviewed', async () => {
    mocks.listUserOrganizations.mockResolvedValue([])
    mocks.countPendingForManager.mockResolvedValue({})
    mocks.getUserOrganizationState.mockResolvedValue({
      kind: 'application',
      applicationId: 'a1',
      status: 'pending',
      submittedAt: '2026-09-20T10:00:00.000Z',
      updatedAt: '2026-09-20T10:00:00.000Z',
      adminReviewNote: null,
      company: { id: 'c9', slug: 'new-org', name: 'New Org', verified: false },
      membership: { role: 'owner', approvedAt: null },
    })
    render(await OrganizationsPage({ searchParams: Promise.resolve({}) }))
    expect(screen.getByText('Sea N Shore is reviewing')).toBeInTheDocument()
    expect(screen.getByText('Organization verification in progress')).toBeInTheDocument()
    expect(screen.getByText('You can register another organization once Sea N Shore has reviewed New Org.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Register a new organization' })).not.toBeInTheDocument()
  })
})

describe('/organizations hub discovery', () => {
  it('suggests verified organizations with follow buttons', async () => {
    mocks.listDiscoverOrganizations.mockResolvedValue([card({ id: 'c7', slug: 'kochi-academy', name: 'Kochi Maritime Academy', companyType: 'Maritime training institute', followerCount: 1 })])
    render(await OrganizationsPage({ searchParams: Promise.resolve({}) }))
    const discover = screen.getByRole('region', { name: 'Discover organizations' })
    expect(discover).toHaveAttribute('id', 'discover')
    expect(within(discover).getByRole('link', { name: 'Kochi Maritime Academy' })).toHaveAttribute('href', '/organizations/kochi-academy')
    expect(within(discover).getByText('1 follower')).toBeInTheDocument()
    expect(within(discover).getByRole('button', { name: 'Follow Kochi Maritime Academy' })).toBeInTheDocument()
  })

  it('says so when suggestions cannot be loaded', async () => {
    mocks.listDiscoverOrganizations.mockRejectedValue(new Error('db down'))
    render(await OrganizationsPage({ searchParams: Promise.resolve({}) }))
    expect(within(screen.getByRole('region', { name: 'Discover organizations' })).getByRole('alert')).toHaveTextContent('Suggestions could not be loaded right now')
  })
})
