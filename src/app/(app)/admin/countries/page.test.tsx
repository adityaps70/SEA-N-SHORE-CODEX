import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(async () => ({ id: '11111111-1111-4111-8111-111111111111' })),
  listCountryStats: vi.fn(),
}))

// Round GP (Part C): pages check access through requireAdminAccess; here it follows the existing mock above.
vi.mock('@/features/admin/admin-access', async () => {
  const auth = await import('@/features/auth/aws-queries')
  // Like the real gate: anyone who is not an administrator gets the not-found page.
  return {
    requireAdminAccess: async () => {
      try {
        return { kind: 'platform', user: await auth.requireAwsUser() }
      } catch (error) {
        if (error instanceof Error && error.message === 'admin_forbidden') (await import('next/navigation')).notFound()
        throw error
      }
    },
  }
})
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/features/countries/admin-country-repository', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/features/countries/admin-country-repository')>(),
  adminCountryRepository: { listCountryStats: mocks.listCountryStats },
}))

import AdminCountriesPage from './page'

const stats = [
  { code: 'IN', registered: 40, verified: 6, newThisWeek: 2, newThisMonth: 9, estimated: 11, organizations: 3, activeJobs: 7 },
  { code: 'PH', registered: 12, verified: 1, newThisWeek: 4, newThisMonth: 5, estimated: 0, organizations: 5, activeJobs: 1 },
  { code: null, registered: 3, verified: 0, newThisWeek: 0, newThisMonth: 1, estimated: 0, organizations: 1, activeJobs: 0 },
]

afterEach(() => cleanup())

describe('Admin › Members by country (Round GP)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listCountryStats.mockResolvedValue(stats)
  })

  it('lists every country with its counts, estimates marked, and links to its members and organizations', async () => {
    render(await AdminCountriesPage({ searchParams: Promise.resolve({}) }))
    expect(mocks.listCountryStats).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', 'residence')
    expect(screen.getByRole('heading', { name: 'Members by country' })).toBeInTheDocument()
    expect(screen.getByText('55 registered members in 2 countries')).toBeInTheDocument()

    const table = screen.getByRole('table')
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows.map((row) => within(row).getByRole('rowheader').textContent)).toEqual(['IndiaIN11 estimated', 'PhilippinesPH', 'Country not set'])
    expect(within(rows[0]!).getAllByRole('cell').slice(0, 6).map((cell) => cell.textContent)).toEqual(['40', '6', '2', '9', '3', '7'])
    expect(within(rows[0]!).getByRole('link', { name: 'India' })).toHaveAttribute('href', '/admin/countries/IN')
    expect(within(rows[1]!).getByRole('link', { name: 'Members' })).toHaveAttribute('href', '/admin/users?country=PH')
    expect(within(rows[2]!).getByRole('link', { name: 'Organizations' })).toHaveAttribute('href', '/admin/organizations?country=unset')
    expect(within(table).getByRole('columnheader', { name: /Registered members/ })).toHaveAttribute('aria-sort', 'descending')
  })

  it('sorts by the chosen column, searches, and counts by nationality on request', async () => {
    render(await AdminCountriesPage({ searchParams: Promise.resolve({ sort: 'organizations', q: 'phil', basis: 'nationality' }) }))
    expect(mocks.listCountryStats).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', 'nationality')
    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(1)
    expect(within(rows[0]!).getByRole('link', { name: 'Philippines' })).toHaveAttribute('href', '/admin/countries/PH?basis=nationality')
    // The member list filters by country of residence, so it is not offered on the nationality view.
    expect(within(rows[0]!).queryByRole('link', { name: 'Members' })).toBeNull()
  })
})
