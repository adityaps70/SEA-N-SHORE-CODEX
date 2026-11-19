import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setAddedRoles } from '@/features/roles/taxonomy'

const mocks = vi.hoisted(() => ({
  requirePlatformAdministratorUser: vi.fn(),
  usage: vi.fn(),
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
vi.mock('@/features/roles/catalog-runtime', () => ({ ensureRoleCatalog: vi.fn(async () => undefined) }))
vi.mock('@/features/roles/admin-ranks-repository', () => ({ ADDED_RANK_LABEL_MAX: 60, adminRanksRepository: { usage: mocks.usage } }))
vi.mock('@/features/roles/admin-ranks-actions', () => ({ addMasterRank: vi.fn(), setMasterRankHidden: vi.fn() }))

import RanksAdminPage from './page'

const search = (params: Record<string, string> = {}) => Promise.resolve(params)

afterEach(() => {
  cleanup()
  setAddedRoles([])
})
beforeEach(() => {
  vi.clearAllMocks()
  mocks.requirePlatformAdministratorUser.mockResolvedValue({ id: 'admin-1' })
  mocks.usage.mockResolvedValue([{ code: 'added_junior_eto', profiles: 2, jobs: 1 }])
  setAddedRoles([{
    key: 'added_junior_eto', label: 'Junior ETO', department: 'engine_officers', ladder: 'electrical_officer', level: 2,
    position: 1.5, synonyms: [], anchorKey: 'eto', anchorRelation: 'below',
  }])
})

describe('/admin/ranks (P6b)', () => {
  it('is not found for members who are not platform administrators', async () => {
    mocks.requirePlatformAdministratorUser.mockRejectedValue(new Error('admin_forbidden'))
    await expect(RanksAdminPage({ searchParams: search() })).rejects.toThrow('NEXT_NOT_FOUND')
    expect(mocks.usage).not.toHaveBeenCalled()
  })

  it('lists every department\'s ranks in ladder order, marks added ones with usage and hide, and has the add form', async () => {
    render(await RanksAdminPage({ searchParams: search({ notice: 'added', code: 'added_junior_eto' }) }))
    expect(screen.getByRole('heading', { name: 'Ranks' })).toBeInTheDocument()
    expect(screen.getByText('1 rank added by administrators')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/within 30 seconds.*\(Junior ETO\)/)

    const engine = within(screen.getByRole('region', { name: 'Engine officers' }))
    const rows = engine.getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell').map((cell) => cell.textContent))
    const eto = rows.findIndex((cells) => cells[0] === 'Electro-Technical Officer (ETO)')
    expect(rows[eto]?.[1]).toBe('1')
    expect(rows[eto + 1]?.slice(0, 3)).toEqual(['Junior ETOAdded', '2', '2 profiles · 1 job'])
    expect(rows[eto + 2]?.slice(0, 2)).toEqual(['Electrical Officer', '3'])
    expect(engine.getByRole('button', { name: 'Hide Junior ETO' })).toBeInTheDocument()
    // Seeded ranks are never hidden from here.
    expect(engine.queryByRole('button', { name: /Chief Engineer/ })).toBeNull()

    const form = screen.getByRole('form', { name: 'Add a missing rank' })
    expect(within(form).getByRole('textbox', { name: 'Rank name' })).toBeRequired()
    expect(within(form).getByRole('combobox', { name: 'Next to' })).toBeRequired()
    expect(within(form).getAllByRole('radio')).toHaveLength(3)
    expect(within(form).getByRole('radio', { name: /Below it/ })).toBeChecked()
  })

  it('shows a refusal in words', async () => {
    render(await RanksAdminPage({ searchParams: search({ error: 'duplicate' }) }))
    expect(screen.getByRole('alert')).toHaveTextContent(/already a rank or one of its other names/)
  })
})
