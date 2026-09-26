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
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
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
  organizationWorkspaceRepository: { listFollowedOrganizations: mocks.listFollowedOrganizations },
}))
vi.mock('@/features/organizations/access-request-repository', () => ({
  organizationAccessRequestRepository: { countPendingForManager: mocks.countPendingForManager },
}))
vi.mock('@/features/organizations/actions', () => ({
  requestOrganizationAccess: vi.fn(),
  submitOrganizationApplication: vi.fn(),
  resubmitOrganizationApplication: vi.fn(),
}))
vi.mock('@/features/organizations/access-request-actions', () => ({
  escalateOrganizationAccessRequest: vi.fn(),
  withdrawOrganizationAccessRequest: vi.fn(),
}))

import OrganizationsPage from './page'

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
})

describe('/organizations hub', () => {
  it('lists the user\'s organizations with role chips and links owners to waiting requests', async () => {
    render(await OrganizationsPage({ searchParams: Promise.resolve({}) }))

    expect(screen.getByRole('heading', { level: 1, name: 'Organizations' })).toBeInTheDocument()
    expect(screen.getByText('2 requests need your decision')).toBeInTheDocument()
    const organizations = screen.getByRole('region', { name: 'Your organizations' })
    expect(within(organizations).getByText('Owner')).toBeInTheDocument()
    expect(within(organizations).getByText('Free plan')).toBeInTheDocument()
    expect(within(organizations).getByRole('link', { name: '2 requests waiting' })).toHaveAttribute('href', '/organizations/oceanic#requests')
    // The long registration form stays collapsed until asked for.
    expect(screen.getByRole('button', { name: 'Register a new organization' })).toBeInTheDocument()
    expect(screen.queryByRole('form', { name: 'Register a new organization' })).not.toBeInTheDocument()
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
