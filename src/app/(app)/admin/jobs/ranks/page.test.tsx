import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requirePlatformAdministratorUser: vi.fn(),
  listAll: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))

vi.mock('next/navigation', () => ({ notFound: mocks.notFound }))
// Round GP (Part C): pages check access through requireAdminAccess; here it follows the existing mock above.
vi.mock('@/features/admin/admin-access', async () => {
  const access = await import('@/features/admin/access')
  // Like the real gate: anyone who is not an administrator gets the not-found page.
  return {
    requireAdminAccess: async () => {
      try {
        return { kind: 'platform', user: await access.requirePlatformAdministratorUser() }
      } catch (error) {
        if (error instanceof Error && error.message === 'admin_forbidden') (await import('next/navigation')).notFound()
        throw error
      }
    },
  }
})
vi.mock('@/features/admin/access', () => ({ requirePlatformAdministratorUser: mocks.requirePlatformAdministratorUser }))
vi.mock('@/features/jobs/extra-ranks-repository', () => ({ extraRanksRepository: { listAll: mocks.listAll } }))
vi.mock('@/features/jobs/extra-ranks-admin-actions', () => ({ setJobExtraRankHidden: vi.fn() }))

import JobExtraRanksAdminPage from './page'

const search = (params: Record<string, string> = {}) => Promise.resolve(params)

afterEach(() => cleanup())
beforeEach(() => {
  vi.clearAllMocks()
  mocks.requirePlatformAdministratorUser.mockResolvedValue({ id: 'admin-1' })
  mocks.listAll.mockResolvedValue([
    { departmentKey: 'hseq_vetting', roleKey: 'chief_officer', timesUsed: 3, firstAddedAt: '2026-11-01T00:00:00.000Z', hidden: false },
    { departmentKey: 'hseq_vetting', roleKey: 'master', timesUsed: 1, firstAddedAt: '2026-11-02T00:00:00.000Z', hidden: true },
    { departmentKey: 'technical_fleet', roleKey: 'chief_engineer', timesUsed: 2, firstAddedAt: '2026-11-03T00:00:00.000Z', hidden: false },
  ])
})

describe('/admin/jobs/ranks (P6)', () => {
  it('is not found for members who are not platform administrators', async () => {
    mocks.requirePlatformAdministratorUser.mockRejectedValue(new Error('admin_forbidden'))
    await expect(JobExtraRanksAdminPage({ searchParams: search() })).rejects.toThrow('NEXT_NOT_FOUND')
    expect(mocks.listAll).not.toHaveBeenCalled()
  })

  it('lists each department\'s extra ranks with where they come from, usage counts and hide / show', async () => {
    render(await JobExtraRanksAdminPage({ searchParams: search({ notice: 'hidden' }) }))
    expect(screen.getByRole('heading', { name: 'Job extra ranks' })).toBeInTheDocument()
    expect(screen.getByText('3 ranks added across 2 departments · 1 hidden')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/jobs already posted keep it/)

    const hseq = within(screen.getByRole('region', { name: 'HSEQ & Vetting' }))
    const [, chiefOfficer, master] = hseq.getAllByRole('row')
    expect(within(chiefOfficer!).getByText('Chief Officer')).toBeInTheDocument()
    expect(within(chiefOfficer!).getByText('3 jobs')).toBeInTheDocument()
    expect(within(chiefOfficer!).getByRole('button', { name: 'Hide Chief Officer for HSEQ & Vetting' })).toBeInTheDocument()
    expect(within(master!).getByText('Hidden')).toBeInTheDocument()
    expect(within(master!).getByText('1 job')).toBeInTheDocument()
    expect(within(master!).getByRole('button', { name: 'Show Master / Captain for HSEQ & Vetting' })).toBeInTheDocument()

    expect(within(screen.getByRole('region', { name: 'Technical & Fleet' })).getByText('Chief Engineer')).toBeInTheDocument()
  })

  it('says so when no extras exist, and shows an error from an action', async () => {
    mocks.listAll.mockResolvedValue([])
    render(await JobExtraRanksAdminPage({ searchParams: search({ error: 'not_found' }) }))
    expect(screen.getByText('No posters have added ranks from other departments yet.')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('That rank is no longer linked to the department.')
  })
})
