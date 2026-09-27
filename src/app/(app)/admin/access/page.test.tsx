import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  listCompanyAccessRequests: vi.fn(),
  countCompanyAccessRequests: vi.fn(),
  reviewCompanyAccessRequest: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/features/admin/actions', () => ({ reviewCompanyAccessRequest: mocks.reviewCompanyAccessRequest }))
vi.mock('@/features/admin/repository', () => ({
  ADMIN_COMPANY_ACCESS_FILTERS: ['needs_platform', 'with_organization', 'approved', 'rejected', 'cancelled'],
  adminRepository: {
    listCompanyAccessRequests: mocks.listCompanyAccessRequests,
    countCompanyAccessRequests: mocks.countCompanyAccessRequests,
  },
}))

import AdminOrganizationAccessPage from './page'

function request(overrides: Record<string, unknown> = {}) {
  return {
    id: '66666666-6666-4666-8666-666666666666',
    status: 'pending',
    requestedRole: 'recruiter',
    grantedRole: null,
    requestType: 'recruiter_access',
    message: 'I run crewing.',
    requestedAt: new Date().toISOString(),
    reviewedAt: null,
    reviewerNote: null,
    reviewer: null,
    decidedVia: null,
    escalatedAt: null,
    escalationNote: null,
    fallbackReason: null,
    activeAuthorityCount: 2,
    company: { id: 'c1', name: 'Oceanic Shipping', slug: 'oceanic', verified: true, suspended: false },
    requester: { id: 'u1', fullName: 'Asha Singh', slug: 'asha-singh', headline: 'Crewing Manager' },
    ...overrides,
  }
}

afterEach(() => cleanup())

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAwsUser.mockResolvedValue({ id: 'admin-1' })
  mocks.countCompanyAccessRequests.mockResolvedValue({ needs_platform: 1, with_organization: 4, approved: 2, rejected: 0, cancelled: 0 })
})

describe('/admin/access', () => {
  it('defaults to the requests that need Sea N Shore and offers decisions only there', async () => {
    mocks.listCompanyAccessRequests.mockResolvedValue([
      request({ fallbackReason: 'no_active_admin', activeAuthorityCount: 0 }),
    ])
    render(await AdminOrganizationAccessPage({ searchParams: Promise.resolve({}) }))

    expect(mocks.listCompanyAccessRequests).toHaveBeenCalledWith('admin-1', 'needs_platform')
    expect(screen.getByRole('link', { name: /Needs Sea N Shore/ })).toHaveAttribute('aria-current', 'true')
    expect(screen.getByText('No active owner or admin')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve access' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Role to grant' })).toHaveValue('recruiter')
    expect(screen.getByText(/owner and administrators approve or decline/)).toBeInTheDocument()
  })

  it('shows requests still with the organization read-only', async () => {
    mocks.listCompanyAccessRequests.mockResolvedValue([request()])
    render(await AdminOrganizationAccessPage({ searchParams: Promise.resolve({ status: 'with_organization' }) }))

    expect(mocks.listCompanyAccessRequests).toHaveBeenCalledWith('admin-1', 'with_organization')
    expect(screen.queryByRole('button', { name: 'Approve access' })).not.toBeInTheDocument()
    expect(screen.getByText(/Read-only. The organization decides this request/)).toBeInTheDocument()
    expect(screen.getByText('2 active owners or administrators can decide this.')).toBeInTheDocument()
  })

  it('names who decided and how, and shows escalation context', async () => {
    mocks.listCompanyAccessRequests.mockResolvedValue([
      request({
        status: 'approved',
        grantedRole: 'member',
        reviewedAt: '2026-09-25T10:00:00.000Z',
        reviewer: { id: 'o1', fullName: 'Ravi Owner' },
        decidedVia: 'organization',
        escalatedAt: '2026-09-24T10:00:00.000Z',
        escalationNote: 'Nobody answered.',
      }),
    ])
    render(await AdminOrganizationAccessPage({ searchParams: Promise.resolve({ status: 'approved' }) }))
    const item = screen.getByRole('listitem')
    expect(within(item).getByText(/Approved by Ravi Owner \(Organization admin\)/)).toBeInTheDocument()
    expect(within(item).getByText(/granted Member \/ employee/)).toBeInTheDocument()
    expect(within(item).getByText('Nobody answered.')).toBeInTheDocument()
    expect(within(item).queryByRole('button')).not.toBeInTheDocument()
  })

  it('maps the old pending filter to the Sea N Shore queue and explains an empty view', async () => {
    mocks.listCompanyAccessRequests.mockResolvedValue([])
    render(await AdminOrganizationAccessPage({ searchParams: Promise.resolve({ status: 'pending' }) }))
    expect(mocks.listCompanyAccessRequests).toHaveBeenCalledWith('admin-1', 'needs_platform')
    expect(screen.getByText('Nothing needs Sea N Shore right now.')).toBeInTheDocument()
  })
})
