import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requirePlatformAdministratorUser: vi.fn(),
  redirect: vi.fn((href: string) => {
    throw new Error(`NEXT_REDIRECT ${href}`)
  }),
  addRank: vi.fn(),
  setHidden: vi.fn(async () => true),
  ensureRoleCatalog: vi.fn(async () => undefined),
  reloadRoleCatalog: vi.fn(async () => undefined),
}))

vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))
vi.mock('@/features/admin/access', () => ({ requirePlatformAdministratorUser: mocks.requirePlatformAdministratorUser }))
vi.mock('./admin-ranks-repository', () => ({ adminRanksRepository: { addRank: mocks.addRank, setHidden: mocks.setHidden } }))
vi.mock('./catalog-runtime', () => ({ ensureRoleCatalog: mocks.ensureRoleCatalog, reloadRoleCatalog: mocks.reloadRoleCatalog }))

import { addMasterRank, setMasterRankHidden } from './admin-ranks-actions'

function form(fields: Record<string, string>) {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.append(key, value)
  return data
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requirePlatformAdministratorUser.mockResolvedValue({ id: 'admin-1' })
  mocks.addRank.mockResolvedValue({ status: 'added', code: 'added_junior_eto' })
  mocks.setHidden.mockResolvedValue(true)
})

describe('Admin › Ranks actions (P6b)', () => {
  it('refuses anyone who is not a platform administrator (with admin two-step) and changes nothing', async () => {
    mocks.requirePlatformAdministratorUser.mockRejectedValue(new Error('admin_forbidden'))
    await expect(addMasterRank(form({ label: 'Junior ETO', anchorKey: 'eto', relation: 'below' }))).rejects.toThrow('NEXT_REDIRECT /admin/ranks?error=forbidden')
    await expect(setMasterRankHidden(form({ code: 'added_junior_eto', hidden: 'true' }))).rejects.toThrow('NEXT_REDIRECT /admin/ranks?error=forbidden')
    expect(mocks.addRank).not.toHaveBeenCalled()
    expect(mocks.setHidden).not.toHaveBeenCalled()
    expect(mocks.reloadRoleCatalog).not.toHaveBeenCalled()
  })

  it('adds a rank in its anchor\'s department, reloads this server\'s rank list and says so', async () => {
    await expect(addMasterRank(form({ label: 'Junior ETO', anchorKey: 'eto', relation: 'below', synonyms: 'Assistant ETO, , Junior Electro-Technical Officer' })))
      .rejects.toThrow('NEXT_REDIRECT /admin/ranks?notice=added&code=added_junior_eto')
    expect(mocks.addRank).toHaveBeenCalledWith('admin-1', {
      label: 'Junior ETO', departmentKey: 'engine_officers', anchorKey: 'eto', relation: 'below',
      synonyms: ['Assistant ETO', 'Junior Electro-Technical Officer'],
    })
    expect(mocks.reloadRoleCatalog).toHaveBeenCalledTimes(1)
  })

  it('passes refusals back as ?error= without reloading, and a failure as failed', async () => {
    mocks.addRank.mockResolvedValue({ status: 'error', error: 'duplicate' })
    await expect(addMasterRank(form({ label: 'Chief Mate', anchorKey: 'chief_officer', relation: 'same' }))).rejects.toThrow('error=duplicate')
    expect(mocks.reloadRoleCatalog).not.toHaveBeenCalled()
    mocks.addRank.mockRejectedValue(new Error('db down'))
    await expect(addMasterRank(form({ label: 'Deck Fitter', anchorKey: 'bosun', relation: 'below' }))).rejects.toThrow('error=failed')
    // An unknown anchor gives no department; the repository refuses it.
    mocks.addRank.mockResolvedValue({ status: 'error', error: 'invalid_department' })
    await expect(addMasterRank(form({ label: 'Deck Fitter', anchorKey: 'sea_wizard', relation: 'below' }))).rejects.toThrow('error=invalid_department')
    expect(mocks.addRank).toHaveBeenLastCalledWith('admin-1', expect.objectContaining({ departmentKey: '', anchorKey: 'sea_wizard' }))
  })

  it('hides and shows an added rank, and reports one that cannot change', async () => {
    await expect(setMasterRankHidden(form({ code: 'added_junior_eto', hidden: 'true' }))).rejects.toThrow('notice=hidden')
    expect(mocks.setHidden).toHaveBeenLastCalledWith('admin-1', 'added_junior_eto', true)
    await expect(setMasterRankHidden(form({ code: 'added_junior_eto', hidden: 'false' }))).rejects.toThrow('notice=shown')
    mocks.setHidden.mockResolvedValue(false)
    await expect(setMasterRankHidden(form({ code: 'chief_engineer', hidden: 'true' }))).rejects.toThrow('error=not_found')
  })
})
