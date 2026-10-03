import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdminOrganizationDirectoryEntry } from '@/features/admin/repository'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  listOrganizations: vi.fn(),
  listOrganizationApplications: vi.fn(),
}))

vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/features/admin/repository', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/features/admin/repository')>()
  return {
    ...original,
    adminRepository: {
      listOrganizations: mocks.listOrganizations,
      listOrganizationApplications: mocks.listOrganizationApplications,
    },
  }
})

import AdminOrganizationsPage from './page'

function organization(overrides: Partial<AdminOrganizationDirectoryEntry> = {}): AdminOrganizationDirectoryEntry {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    slug: 'oceanic-shipping',
    name: 'Oceanic Shipping',
    logoPath: 'companies/33333333/logo-abc123.png',
    type: 'Ship manager',
    location: 'Mumbai, India',
    owner: { id: '44444444-4444-4444-8444-444444444444', fullName: 'Asha Singh', slug: 'asha-singh' },
    memberCount: 3,
    plan: 'organization_pro',
    status: 'verified',
    applicationId: '22222222-2222-4222-8222-222222222222',
    claimStatus: 'claimed',
    createdAt: '2026-09-11T10:00:00.000Z',
    ...overrides,
  }
}

afterEach(() => cleanup())

describe('/admin/organizations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAwsUser.mockResolvedValue({ id: 'admin-1' })
    mocks.listOrganizations.mockResolvedValue({ organizations: [], total: 0 })
    mocks.listOrganizationApplications.mockResolvedValue([])
  })

  it('lists all organizations with logo, type, location, owner, members, plan, created date, status and links', async () => {
    mocks.listOrganizations.mockResolvedValue({
      organizations: [
        organization(),
        organization({
          id: '55555555-5555-4555-8555-555555555555', slug: 'harbour-crew', name: 'Harbour Crew', logoPath: null, type: null, location: null,
          owner: null, memberCount: 0, plan: 'free', status: 'no_application', applicationId: null, claimStatus: 'unclaimed',
        }),
      ],
      total: 2,
    })

    render(await AdminOrganizationsPage({ searchParams: Promise.resolve({}) }))

    expect(mocks.listOrganizations).toHaveBeenCalledWith('admin-1', { query: '', status: 'all', limit: 51, offset: 0 })
    expect(screen.getByRole('heading', { name: 'Organizations' })).toBeInTheDocument()
    expect(screen.getByText('2 organizations')).toBeInTheDocument()

    const [oceanic, harbour] = screen.getAllByRole('row').slice(1)
    expect(within(oceanic!).getByRole('link', { name: 'Oceanic Shipping' })).toHaveAttribute('href', '/organizations/oceanic-shipping')
    expect(oceanic!.querySelector('img')).toHaveAttribute('src', expect.stringContaining('/api/company-logo/33333333-3333-4333-8333-333333333333'))
    expect(within(oceanic!).getByText('Ship manager')).toBeInTheDocument()
    expect(within(oceanic!).getByText('Mumbai, India')).toBeInTheDocument()
    expect(within(oceanic!).getByRole('link', { name: 'Asha Singh' })).toHaveAttribute('href', '/admin/users/44444444-4444-4444-8444-444444444444')
    expect(within(oceanic!).getByText('3')).toBeInTheDocument()
    expect(within(oceanic!).getByText('Organization Pro')).toBeInTheDocument()
    expect(within(oceanic!).getByText('11 Sept 2026')).toBeInTheDocument()
    expect(within(oceanic!).getByText('Verified')).toBeInTheDocument()
    expect(within(oceanic!).getByRole('link', { name: 'View page: Oceanic Shipping' })).toHaveAttribute('href', '/organizations/oceanic-shipping')
    expect(within(oceanic!).getByRole('link', { name: 'Manage: Oceanic Shipping' })).toHaveAttribute('href', '/organizations/oceanic-shipping/manage')
    expect(within(oceanic!).getByRole('link', { name: 'Review: Oceanic Shipping' })).toHaveAttribute('href', '/admin/organizations/22222222-2222-4222-8222-222222222222')

    expect(within(harbour!).getByText('Free')).toBeInTheDocument()
    expect(within(harbour!).getByText('No owner')).toBeInTheDocument()
    expect(within(harbour!).getByText('No application')).toBeInTheDocument()
    expect(within(harbour!).getByText('Unclaimed')).toBeInTheDocument()
    expect(within(harbour!).queryByRole('link', { name: /Review/ })).not.toBeInTheDocument()
  })

  it('filters by status including pending, verified, rejected and unclaimed, and keeps the search in filter links', async () => {
    render(await AdminOrganizationsPage({ searchParams: Promise.resolve({ q: 'oceanic', status: 'unclaimed' }) }))

    expect(mocks.listOrganizations).toHaveBeenCalledWith('admin-1', { query: 'oceanic', status: 'unclaimed', limit: 51, offset: 0 })
    const filters = screen.getByRole('navigation', { name: 'Organization status filters' })
    expect(within(filters).getAllByRole('link').map((link) => link.textContent)).toEqual([
      'All organizations', 'Pending', 'Changes requested', 'Verified', 'Rejected', 'Suspended', 'Unclaimed',
    ])
    expect(within(filters).getByRole('link', { name: 'Unclaimed' })).toHaveAttribute('aria-current', 'true')
    expect(within(filters).getByRole('link', { name: 'Pending' })).toHaveAttribute('href', '/admin/organizations?q=oceanic&status=pending')
    expect(screen.getByRole('searchbox', { name: 'Search organizations' })).toHaveValue('oceanic')
    expect(screen.getByText('No organizations match this view.')).toBeInTheDocument()
  })

  it('pages 50 at a time like the users list', async () => {
    mocks.listOrganizations.mockResolvedValue({
      organizations: Array.from({ length: 51 }, (_, index) => organization({ id: `org-${index}`, slug: `org-${index}`, name: `Organization ${index}` })),
      total: 140,
    })

    render(await AdminOrganizationsPage({ searchParams: Promise.resolve({ status: 'verified', page: '2' }) }))

    expect(mocks.listOrganizations).toHaveBeenCalledWith('admin-1', { query: '', status: 'verified', limit: 51, offset: 50 })
    expect(screen.getAllByRole('row')).toHaveLength(51)
    expect(screen.getByText('140 organizations · page 2')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Previous' })).toHaveAttribute('href', '/admin/organizations?status=verified')
    expect(screen.getByRole('link', { name: 'Next' })).toHaveAttribute('href', '/admin/organizations?status=verified&page=3')
  })

  it('keeps the review queue, oldest submissions first, with its own state filters', async () => {
    render(await AdminOrganizationsPage({ searchParams: Promise.resolve({ view: 'queue', status: 'changes_requested' }) }))

    expect(mocks.listOrganizationApplications).toHaveBeenCalledWith('admin-1', 'changes_requested')
    expect(mocks.listOrganizations).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: 'Organization reviews' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Review queue' })).toHaveAttribute('aria-current', 'true')
    const filters = screen.getByRole('navigation', { name: 'Organization review filters' })
    expect(within(filters).getByRole('link', { name: 'Pending' })).toHaveAttribute('href', '/admin/organizations?view=queue&status=pending')
    expect(screen.getByText('No changes requested organization applications.')).toBeInTheDocument()
  })

  it('maps the old "approved" review link to the Verified directory filter', async () => {
    render(await AdminOrganizationsPage({ searchParams: Promise.resolve({ status: 'approved' }) }))
    expect(mocks.listOrganizations).toHaveBeenCalledWith('admin-1', expect.objectContaining({ status: 'verified' }))
  })
})
