import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requirePlatformAdministratorUser: vi.fn(),
  getAdminDashboardMetrics: vi.fn(),
  pathname: '/admin/users',
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))

vi.mock('next/navigation', () => ({
  notFound: mocks.notFound,
  usePathname: () => mocks.pathname,
}))
vi.mock('@/features/admin/access', () => ({
  requirePlatformAdministratorUser: mocks.requirePlatformAdministratorUser,
}))
vi.mock('@/features/admin/repository', () => ({
  adminRepository: { getAdminDashboardMetrics: mocks.getAdminDashboardMetrics },
}))

import AdminLayout from './layout'

const metrics = {
  pendingOrganizations: 2,
  changesRequested: 0,
  approvedOrganizations: 3,
  suspendedOrganizations: 0,
  pendingAccessRequests: 1,
  openReports: 4,
  reviewingReports: 1,
  highPriorityReports: 0,
  reportsLast24h: 0,
  activePosts: 25,
  publishedJobs: 4,
  publishedEvents: 1,
}

afterEach(() => cleanup())

describe('admin route boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.pathname = '/admin/users'
    mocks.requirePlatformAdministratorUser.mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      cognitoSub: 'sub-admin',
      email: 'admin@example.com',
    })
    mocks.getAdminDashboardMetrics.mockResolvedValue(metrics)
  })

  it('renders the admin workspace for an authorized administrator', async () => {
    render(await AdminLayout({ children: <div>Restricted workspace</div> }))

    expect(screen.getByText('Restricted workspace')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Deleted content' })).toHaveAttribute('href', '/admin/deleted-content')
    expect(screen.getByRole('link', { name: /Access requests/ })).toHaveAttribute('href', '/admin/access')
    expect(mocks.notFound).not.toHaveBeenCalled()
  })

  it('highlights only the section being viewed', async () => {
    render(await AdminLayout({ children: <div /> }))

    expect(screen.getByRole('link', { name: 'Users' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Overview' })).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('link', { name: /Moderation/ })).not.toHaveAttribute('aria-current')
  })

  it('marks Overview as current only on the overview itself', async () => {
    mocks.pathname = '/admin'
    render(await AdminLayout({ children: <div /> }))

    expect(screen.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page')
  })

  it('shows waiting counts for queues that have work', async () => {
    render(await AdminLayout({ children: <div /> }))

    expect(screen.getByLabelText('5 waiting')).toBeInTheDocument()
    expect(screen.getByLabelText('2 waiting')).toBeInTheDocument()
    expect(screen.getByLabelText('1 waiting')).toBeInTheDocument()
  })

  it('still renders when queue counts cannot be loaded', async () => {
    mocks.getAdminDashboardMetrics.mockRejectedValueOnce(new Error('db down'))
    render(await AdminLayout({ children: <div>Still here</div> }))

    expect(screen.getByText('Still here')).toBeInTheDocument()
    expect(screen.queryByLabelText(/waiting/)).not.toBeInTheDocument()
  })

  it('returns not found for a signed-in user without administrator access', async () => {
    mocks.requirePlatformAdministratorUser.mockRejectedValueOnce(new Error('admin_forbidden'))

    await expect(AdminLayout({ children: <div>Restricted workspace</div> })).rejects.toThrow('NEXT_NOT_FOUND')
    expect(mocks.notFound).toHaveBeenCalledTimes(1)
  })
})
