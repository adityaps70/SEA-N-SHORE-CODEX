import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requirePlatformAdministratorUser: vi.fn(),
  restoreDeletedPost: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/features/admin/access', () => ({
  requirePlatformAdministratorUser: mocks.requirePlatformAdministratorUser,
}))
vi.mock('@/features/admin/repository', () => ({
  adminRepository: {
    restoreDeletedPost: mocks.restoreDeletedPost,
  },
}))

import { POST } from './route'

const postId = '22222222-2222-4222-8222-222222222222'

describe('POST /api/admin/deleted-posts/[postId]/restore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requirePlatformAdministratorUser.mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      cognitoSub: 'admin-sub',
      email: 'admin@example.com',
    })
    mocks.restoreDeletedPost.mockResolvedValue(true)
  })

  it('restores a retained post with an auditable admin reason', async () => {
    const request = new Request('https://example.test/api/admin/deleted-posts/' + postId + '/restore', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'Author confirmed accidental deletion.' }),
    })

    const response = await POST(request, { params: Promise.resolve({ postId }) })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
    expect(mocks.restoreDeletedPost).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      postId,
      'Author confirmed accidental deletion.',
    )
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin/deleted-content')
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/home')
  })

  it('rejects short recovery reasons', async () => {
    const request = new Request('https://example.test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'oops' }),
    })

    const response = await POST(request, { params: Promise.resolve({ postId }) })

    expect(response.status).toBe(400)
    expect(mocks.restoreDeletedPost).not.toHaveBeenCalled()
  })

  it('returns conflict when the recovery deadline has passed', async () => {
    mocks.restoreDeletedPost.mockRejectedValueOnce(new Error('deleted_post_retention_expired'))
    const request = new Request('https://example.test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'Recovery requested after review.' }),
    })

    const response = await POST(request, { params: Promise.resolve({ postId }) })

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'This post has passed its recovery deadline and can no longer be restored.',
    })
  })
})
