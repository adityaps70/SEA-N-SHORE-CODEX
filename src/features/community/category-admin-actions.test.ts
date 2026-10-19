import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requirePlatformAdministratorUser: vi.fn(),
  redirect: vi.fn((href: string) => {
    throw new Error(`NEXT_REDIRECT ${href}`)
  }),
  repository: {
    create: vi.fn(async () => ({ id: 'c-new' })),
    update: vi.fn(),
    move: vi.fn(),
    setHidden: vi.fn(),
    moveCommunities: vi.fn(async () => 3),
    remove: vi.fn(),
  },
}))

vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))
vi.mock('./category-revalidate', () => ({ revalidateCategoryPages: vi.fn() }))
vi.mock('@/features/admin/access', () => ({ requirePlatformAdministratorUser: mocks.requirePlatformAdministratorUser }))
vi.mock('./category-repository', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./category-repository')>()),
  communityCategoryRepository: mocks.repository,
}))

import { CommunityCategoryError } from './category-repository'
import {
  createCommunityCategory,
  deleteCommunityCategory,
  moveCommunityCategory,
  moveCommunityCategoryCommunities,
  setCommunityCategoryHidden,
  updateCommunityCategory,
} from './category-admin-actions'

const ID = '11111111-1111-4111-8111-111111111111'
const TARGET = '22222222-2222-4222-8222-222222222222'
function form(fields: Record<string, string>) {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.append(key, value)
  return data
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requirePlatformAdministratorUser.mockResolvedValue({ id: 'admin-1' })
})

describe('community category admin actions (Round I, I2)', () => {
  it('refuse anyone who is not a platform administrator and change nothing', async () => {
    mocks.requirePlatformAdministratorUser.mockRejectedValue(new Error('admin_forbidden'))
    const calls = [
      () => createCommunityCategory(form({ name: 'Offshore' })),
      () => updateCommunityCategory(form({ categoryId: ID, name: 'Offshore' })),
      () => moveCommunityCategory(form({ categoryId: ID, direction: 'up' })),
      () => setCommunityCategoryHidden(form({ categoryId: ID, hidden: 'true' })),
      () => moveCommunityCategoryCommunities(form({ categoryId: ID, targetId: TARGET, thenDelete: 'true' })),
      () => deleteCommunityCategory(form({ categoryId: ID })),
    ]
    for (const call of calls) await expect(call()).rejects.toThrow('NEXT_REDIRECT /admin/communities/categories?error=forbidden')
    for (const method of Object.values(mocks.repository)) expect(method).not.toHaveBeenCalled()
  })

  it('save as the administrator and say what happened', async () => {
    await expect(createCommunityCategory(form({ name: 'Offshore', description: '', icon: 'LifeBuoy' }))).rejects.toThrow('notice=created')
    expect(mocks.repository.create).toHaveBeenCalledWith('admin-1', { name: 'Offshore', description: '', icon: 'LifeBuoy' })
    await expect(moveCommunityCategoryCommunities(form({ categoryId: ID, targetId: TARGET, thenDelete: 'true' }))).rejects.toThrow('notice=moved_deleted&count=3')
    expect(mocks.repository.moveCommunities).toHaveBeenCalledWith('admin-1', ID, TARGET)
    expect(mocks.repository.remove).toHaveBeenCalledWith('admin-1', ID)
  })

  it('come back with the reason when a category in use cannot be deleted', async () => {
    mocks.repository.remove.mockRejectedValueOnce(new CommunityCategoryError('category_in_use'))
    await expect(deleteCommunityCategory(form({ categoryId: ID }))).rejects.toThrow('NEXT_REDIRECT /admin/communities/categories?error=category_in_use')
  })
})
