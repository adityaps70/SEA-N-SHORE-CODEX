// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requirePlatformAdministratorUser: vi.fn(),
  listAll: vi.fn(async () => [] as unknown[]),
  reorder: vi.fn(async () => undefined),
  revalidateCategoryPages: vi.fn(),
}))

vi.mock('@/features/admin/access', () => ({ requirePlatformAdministratorUser: mocks.requirePlatformAdministratorUser }))
vi.mock('@/features/community/category-revalidate', () => ({ revalidateCategoryPages: mocks.revalidateCategoryPages }))
vi.mock('@/features/community/category-repository', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/community/category-repository')>()),
  communityCategoryRepository: { listAll: mocks.listAll, reorder: mocks.reorder },
}))

import { AwsAuthenticationRequiredError } from '@/features/auth/aws-queries'
import { GET, PUT } from './route'

const ORDER = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222']
const put = (body: unknown) => PUT(new Request('https://seanshore.in/api/admin/community-categories', { method: 'PUT', body: JSON.stringify(body) }))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requirePlatformAdministratorUser.mockResolvedValue({ id: 'admin-1' })
})

describe('/api/admin/community-categories (Round I, I2)', () => {
  it('refuses members who are not platform administrators, and signed-out visitors, before touching the list', async () => {
    mocks.requirePlatformAdministratorUser.mockRejectedValue(new Error('admin_forbidden'))
    expect((await GET()).status).toBe(403)
    expect((await put({ order: ORDER })).status).toBe(403)
    mocks.requirePlatformAdministratorUser.mockRejectedValue(new AwsAuthenticationRequiredError())
    expect((await GET()).status).toBe(401)
    expect((await put({ order: ORDER })).status).toBe(401)
    expect(mocks.listAll).not.toHaveBeenCalled()
    expect(mocks.reorder).not.toHaveBeenCalled()
  })

  it('lets an administrator read the list and save a new order', async () => {
    const get = await GET()
    expect(get.status).toBe(200)
    expect(get.headers.get('cache-control')).toBe('private, no-store')
    const saved = await put({ order: ORDER })
    expect(saved.status).toBe(200)
    expect(mocks.reorder).toHaveBeenCalledWith('admin-1', ORDER)
    expect(mocks.revalidateCategoryPages).toHaveBeenCalled()
    expect((await put({ order: ['not-an-id'] })).status).toBe(400)
  })
})
