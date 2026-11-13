import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requirePlatformAdministratorUser: vi.fn(),
  redirect: vi.fn((href: string) => {
    throw new Error(`NEXT_REDIRECT ${href}`)
  }),
  setHidden: vi.fn(async () => true),
}))

vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))
vi.mock('@/features/admin/access', () => ({ requirePlatformAdministratorUser: mocks.requirePlatformAdministratorUser }))
vi.mock('./extra-ranks-repository', () => ({ extraRanksRepository: { setHidden: mocks.setHidden } }))

import { setJobExtraRankHidden } from './extra-ranks-admin-actions'

function form(fields: Record<string, string>) {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.append(key, value)
  return data
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requirePlatformAdministratorUser.mockResolvedValue({ id: 'admin-1' })
  mocks.setHidden.mockResolvedValue(true)
})

describe('job extra rank admin action (P6)', () => {
  it('refuses anyone who is not a platform administrator and changes nothing', async () => {
    mocks.requirePlatformAdministratorUser.mockRejectedValue(new Error('admin_forbidden'))
    await expect(setJobExtraRankHidden(form({ departmentKey: 'hseq_vetting', roleKey: 'master', hidden: 'true' }))).rejects.toThrow('NEXT_REDIRECT /admin/jobs/ranks?error=forbidden')
    expect(mocks.setHidden).not.toHaveBeenCalled()
  })

  it('hides and shows a department\'s extra rank', async () => {
    await expect(setJobExtraRankHidden(form({ departmentKey: 'hseq_vetting', roleKey: 'master', hidden: 'true' }))).rejects.toThrow('NEXT_REDIRECT /admin/jobs/ranks?notice=hidden')
    expect(mocks.setHidden).toHaveBeenLastCalledWith('admin-1', 'hseq_vetting', 'master', true)
    await expect(setJobExtraRankHidden(form({ departmentKey: 'hseq_vetting', roleKey: 'master', hidden: 'false' }))).rejects.toThrow('NEXT_REDIRECT /admin/jobs/ranks?notice=shown')
    expect(mocks.setHidden).toHaveBeenLastCalledWith('admin-1', 'hseq_vetting', 'master', false)
  })

  it('rejects an unknown department or rank, and a link that does not exist', async () => {
    await expect(setJobExtraRankHidden(form({ departmentKey: 'starfleet', roleKey: 'master', hidden: 'true' }))).rejects.toThrow('error=not_found')
    await expect(setJobExtraRankHidden(form({ departmentKey: 'hseq_vetting', roleKey: 'sea_wizard', hidden: 'true' }))).rejects.toThrow('error=not_found')
    expect(mocks.setHidden).not.toHaveBeenCalled()
    mocks.setHidden.mockResolvedValue(false)
    await expect(setJobExtraRankHidden(form({ departmentKey: 'hseq_vetting', roleKey: 'cook', hidden: 'true' }))).rejects.toThrow('error=not_found')
  })

  it('reports a failed save without saying more', async () => {
    mocks.setHidden.mockRejectedValue(new Error('boom'))
    await expect(setJobExtraRankHidden(form({ departmentKey: 'hseq_vetting', roleKey: 'master', hidden: 'true' }))).rejects.toThrow('NEXT_REDIRECT /admin/jobs/ranks?error=failed')
  })
})
