import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  getAccessContext: vi.fn(),
  getBySlug: vi.fn(),
  getViewer: vi.fn(),
  listForOrganization: vi.fn(),
  getUserOrganizationState: vi.fn(),
  notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND') }),
  redirect: vi.fn((path: string) => { throw new Error(`NEXT_REDIRECT:${path}`) }),
}))

vi.mock('next/navigation', () => ({ notFound: mocks.notFound, redirect: mocks.redirect, useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('next/image', () => ({ default: (props: Record<string, unknown>) => <span data-testid="logo" data-src={String(props.src)} /> }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/features/access/server', () => ({ getAccessContext: mocks.getAccessContext }))
vi.mock('@/features/organizations/workspace-repository', () => ({
  organizationWorkspaceRepository: { getBySlug: mocks.getBySlug },
}))
vi.mock('@/features/organizations/access-request-repository', () => ({
  organizationAccessRequestRepository: { getViewer: mocks.getViewer, listForOrganization: mocks.listForOrganization },
}))
vi.mock('@/features/organizations/repository', () => ({
  organizationRepository: { getUserOrganizationState: mocks.getUserOrganizationState },
}))
vi.mock('@/features/organizations/access-request-actions', () => ({ decideOrganizationAccessRequest: vi.fn() }))

import OrganizationManagePage from './page'

const workspace = {
  id: 'c1',
  slug: 'harbour-minds',
  name: 'Harbour Minds',
  logoPath: null,
  coverPath: null,
  verified: true,
}

const pendingRequest = {
  id: 'r1',
  status: 'pending',
  requestedRole: 'member',
  grantedRole: null,
  message: 'I work in the Manila office.',
  requestedAt: new Date().toISOString(),
  reviewedAt: null,
  reviewerNote: null,
  reviewerName: null,
  decidedVia: null,
  escalatedAt: null,
  escalationNote: null,
  requester: { id: 'u9', fullName: 'Grace Santos', slug: 'grace', headline: 'Counsellor' },
}

function access(role: string | null, plan = 'free') {
  return {
    personalPlan: 'free',
    personalEntitlements: [],
    verifications: [],
    organizationMemberships: role ? [{ companyId: 'c1', plan, role, verified: true, entitlements: [] }] : [],
    accountActive: true,
  }
}

const params = Promise.resolve({ slug: 'harbour-minds' })
const section = (value: string) => Promise.resolve({ section: value })

afterEach(() => cleanup())
beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAwsUser.mockResolvedValue({ id: 'user-1' })
  mocks.getBySlug.mockResolvedValue(workspace)
  mocks.getUserOrganizationState.mockResolvedValue({ kind: 'none' })
  mocks.getViewer.mockResolvedValue(null)
  mocks.listForOrganization.mockResolvedValue({ viewer: { kind: 'organization', role: 'owner' }, requests: [pendingRequest] })
})

describe('/organizations/[slug]/manage', () => {
  it('gives owners the overview with role, verification, waiting requests and locked tools without dead-end links', async () => {
    mocks.getAccessContext.mockResolvedValue(access('owner'))
    mocks.getViewer.mockResolvedValue({ kind: 'organization', role: 'owner' })
    render(await OrganizationManagePage({ params }))

    expect(screen.getByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: 'Manage page sections' })
    expect(within(nav).getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page')
    expect(within(nav).getByRole('link', { name: /Requests/ })).toHaveAttribute('href', '/organizations/harbour-minds/manage?section=requests')
    expect(within(nav).getByRole('link', { name: /Requests/ })).toHaveTextContent('1 waiting')
    expect(within(nav).getByRole('link', { name: /Team & roles/ })).toHaveAttribute('href', '/organizations/harbour-minds/team')
    expect(within(nav).getByRole('link', { name: /Branding/ })).toHaveAttribute('href', '/organizations/harbour-minds/branding')
    expect(within(nav).getByRole('link', { name: /Analytics/ })).toHaveAttribute('href', '/organizations/harbour-minds/analytics')
    expect(screen.getByRole('link', { name: /View page/ })).toHaveAttribute('href', '/organizations/harbour-minds')

    expect(screen.getByText('Verified by Sea N Shore')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Review requests/ })).toHaveAttribute('href', '/organizations/harbour-minds/manage?section=requests')
    const tools = screen.getByRole('region', { name: 'Your workspace' })
    expect(within(tools).getByText('Owner · Free plan')).toBeInTheDocument()
    expect(within(tools).queryByRole('link', { name: /Team & roles/ })).not.toBeInTheDocument()
    expect(within(tools).getByText('Needs Organization Pro and an admin role')).toBeInTheDocument()
    expect(within(tools).getByRole('link', { name: 'Compare plans' })).toHaveAttribute('href', '/plans')
  })

  it('shows the Requests section to owners so they can decide', async () => {
    mocks.getAccessContext.mockResolvedValue(access('owner'))
    mocks.getViewer.mockResolvedValue({ kind: 'organization', role: 'owner' })
    render(await OrganizationManagePage({ params, searchParams: section('requests') }))

    expect(mocks.listForOrganization).toHaveBeenCalledWith('user-1', 'c1')
    expect(screen.getByRole('region', { name: /Requests/ })).toHaveAttribute('id', 'requests')
    expect(screen.getByText('Grace Santos')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Requests/ })).toHaveAttribute('aria-current', 'page')
  })

  it('shows platform administrators the Requests section read-only', async () => {
    mocks.getAccessContext.mockResolvedValue(access(null))
    mocks.getViewer.mockResolvedValue({ kind: 'platform' })
    render(await OrganizationManagePage({ params, searchParams: section('requests') }))
    expect(screen.getByText(/Read-only: the owner and administrators of Harbour Minds decide/)).toBeInTheDocument()
  })

  it('hides Requests from members who cannot decide them and never loads the list', async () => {
    mocks.getAccessContext.mockResolvedValue(access('recruiter', 'organization_pro'))
    render(await OrganizationManagePage({ params, searchParams: section('requests') }))
    expect(mocks.listForOrganization).not.toHaveBeenCalled()
    expect(screen.queryByRole('link', { name: /Requests/ })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument()
    expect(screen.getByText('The owner and administrators decide who joins.')).toBeInTheDocument()
  })

  it('shows the verification status to the owner of an organization still being verified', async () => {
    mocks.getAccessContext.mockResolvedValue(access(null))
    mocks.getUserOrganizationState.mockResolvedValue({
      kind: 'application',
      applicationId: 'a1',
      status: 'changes_requested',
      submittedAt: '2026-09-20T10:00:00.000Z',
      updatedAt: '2026-09-20T10:00:00.000Z',
      adminReviewNote: 'Add your registration number.',
      company: { id: 'c1', slug: 'harbour-minds', name: 'Harbour Minds', verified: false },
      membership: { role: 'owner', approvedAt: null },
    })
    mocks.getBySlug.mockResolvedValue({ ...workspace, verified: false })
    render(await OrganizationManagePage({ params }))
    expect(screen.getByText('Your organization application needs attention')).toBeInTheDocument()
    expect(screen.getByText('Note from Sea N Shore: Add your registration number.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to your application' })).toHaveAttribute('href', '/organizations#update-application')
    expect(screen.queryByRole('region', { name: 'Your workspace' })).not.toBeInTheDocument()
  })

  it('sends people without a role back to the public page', async () => {
    mocks.getAccessContext.mockResolvedValue(access(null))
    await expect(OrganizationManagePage({ params })).rejects.toThrow('NEXT_REDIRECT:/organizations/harbour-minds')
    expect(mocks.listForOrganization).not.toHaveBeenCalled()
  })
})
