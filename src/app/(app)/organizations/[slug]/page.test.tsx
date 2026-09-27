import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  getAccessContext: vi.fn(),
  getBySlug: vi.fn(),
  getFollowState: vi.fn(),
  getViewer: vi.fn(),
  listForOrganization: vi.fn(),
  listUserAccessRequests: vi.fn(),
  getUserOrganizationState: vi.fn(),
  notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND') }),
}))

vi.mock('next/navigation', () => ({ notFound: mocks.notFound, useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('next/image', () => ({ default: (props: Record<string, unknown>) => <span data-testid="logo" data-src={String(props.src)} /> }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/features/access/server', () => ({ getAccessContext: mocks.getAccessContext }))
vi.mock('@/features/organizations/workspace-repository', () => ({
  organizationWorkspaceRepository: { getBySlug: mocks.getBySlug, getFollowState: mocks.getFollowState },
}))
vi.mock('@/features/organizations/access-request-repository', () => ({
  organizationAccessRequestRepository: { getViewer: mocks.getViewer, listForOrganization: mocks.listForOrganization },
}))
vi.mock('@/features/organizations/repository', () => ({
  organizationRepository: {
    listUserAccessRequests: mocks.listUserAccessRequests,
    getUserOrganizationState: mocks.getUserOrganizationState,
  },
}))
vi.mock('@/features/organizations/actions', () => ({ requestOrganizationAccess: vi.fn() }))
vi.mock('@/features/organizations/follow-actions', () => ({ followOrganization: vi.fn(), unfollowOrganization: vi.fn() }))
vi.mock('@/features/organizations/access-request-actions', () => ({ decideOrganizationAccessRequest: vi.fn() }))

import OrganizationWorkspacePage from './page'

const workspace = {
  id: 'c1',
  slug: 'harbour-minds',
  name: 'Harbour Minds',
  logoPath: null,
  companyType: 'Mental-health & wellbeing provider',
  organizationType: 'mental_health_provider',
  details: { servicesOffered: ['counselling', 'crisis_support'], languages: ['English', 'Tagalog'], helpline24x7: true, accreditation: 'PRC registered' },
  website: 'https://harbourminds.org/',
  description: 'Confidential counselling for seafarers.',
  fleetSummary: null,
  vesselTypes: [],
  officeLocations: ['Manila'],
  verified: true,
}

function access(role: string | null) {
  return {
    personalPlan: 'free',
    personalEntitlements: [],
    verifications: [],
    organizationMemberships: role ? [{ companyId: 'c1', plan: 'free', role, verified: true, entitlements: [] }] : [],
    accountActive: true,
  }
}

const params = Promise.resolve({ slug: 'harbour-minds' })

afterEach(() => cleanup())
beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAwsUser.mockResolvedValue({ id: 'user-1' })
  mocks.getBySlug.mockResolvedValue(workspace)
  mocks.getFollowState.mockResolvedValue({ following: false, followerCount: 3 })
  mocks.listUserAccessRequests.mockResolvedValue([])
  mocks.getUserOrganizationState.mockResolvedValue({ kind: 'none' })
  mocks.getViewer.mockResolvedValue(null)
  mocks.listForOrganization.mockResolvedValue({ viewer: { kind: 'organization', role: 'owner' }, requests: [] })
})

describe('/organizations/[slug]', () => {
  it('shows wellbeing details and a direct request-access control to visitors', async () => {
    mocks.getAccessContext.mockResolvedValue(access(null))
    render(await OrganizationWorkspacePage({ params }))

    expect(screen.getByRole('heading', { level: 1, name: 'Harbour Minds' })).toBeInTheDocument()
    expect(screen.getByRole('banner')).toHaveTextContent('24/7 helpline')
    const support = screen.getByRole('region', { name: 'Support offered' })
    expect(within(support).getByText('Counselling & therapy')).toBeInTheDocument()
    expect(within(support).getByText('English, Tagalog')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Operations' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Request access' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /Requests/ })).not.toBeInTheDocument()
    expect(mocks.listForOrganization).not.toHaveBeenCalled()
  })

  it('gives owners the Requests section and shows locked tools without dead-end links', async () => {
    mocks.getAccessContext.mockResolvedValue(access('owner'))
    mocks.getViewer.mockResolvedValue({ kind: 'organization', role: 'owner' })
    render(await OrganizationWorkspacePage({ params }))

    expect(mocks.listForOrganization).toHaveBeenCalledWith('user-1', 'c1')
    expect(screen.getByRole('region', { name: /Requests/ })).toHaveAttribute('id', 'requests')
    const tools = screen.getByRole('region', { name: 'Your workspace' })
    expect(within(tools).getByText('Owner · Free plan')).toBeInTheDocument()
    expect(within(tools).queryByRole('link', { name: /Team & roles/ })).not.toBeInTheDocument()
    expect(within(tools).getByText('Needs Organization Pro and an admin role')).toBeInTheDocument()
    expect(within(tools).getByRole('link', { name: 'Compare plans' })).toHaveAttribute('href', '/plans')
  })

  it('does not ask the owner of an unverified organization to request access to it', async () => {
    mocks.getAccessContext.mockResolvedValue(access(null))
    mocks.getUserOrganizationState.mockResolvedValue({
      kind: 'application',
      applicationId: 'a1',
      status: 'pending',
      submittedAt: '2026-09-20T10:00:00.000Z',
      updatedAt: '2026-09-20T10:00:00.000Z',
      adminReviewNote: null,
      company: { id: 'c1', slug: 'harbour-minds', name: 'Harbour Minds', verified: false },
      membership: { role: 'owner', approvedAt: null },
    })
    render(await OrganizationWorkspacePage({ params }))
    expect(screen.getByText('Sea N Shore is verifying this organization')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Request access' })).not.toBeInTheDocument()
  })

  it('shows platform administrators the Requests section read-only', async () => {
    mocks.getAccessContext.mockResolvedValue(access(null))
    mocks.getViewer.mockResolvedValue({ kind: 'platform' })
    render(await OrganizationWorkspacePage({ params }))
    expect(screen.getByText(/Read-only: the owner and administrators of Harbour Minds decide/)).toBeInTheDocument()
  })
})
