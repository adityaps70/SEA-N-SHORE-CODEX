import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  user: { id: '11111111-1111-4111-8111-111111111111', email: 'viewer@example.com' },
  canUsePlatformAdminAuthority: vi.fn(async () => false),
  isPostMediaAttached: vi.fn(async () => true),
  createMediaUploadUrl: vi.fn(async () => 'https://s3.example/poster-put'),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: vi.fn(async () => mocks.user), getAwsVerifiedUser: vi.fn(async () => mocks.user) }))
vi.mock('@/features/admin/mfa-gate', () => ({ canUsePlatformAdminAuthority: mocks.canUsePlatformAdminAuthority }))
vi.mock('./repository', () => ({ feedRepository: { isPostMediaAttached: mocks.isPostMediaAttached } }))
vi.mock('@/lib/aws/storage', () => ({ createMediaUploadUrl: mocks.createMediaUploadUrl }))

import { createPostVideoPosterUpload } from './actions'
import { POST_VIDEO_POSTER_MAX_BYTES } from './media-policy'

const POST = '22222222-2222-4222-8222-222222222222'
const OBJECT = '33333333-3333-4333-8333-333333333333'
const OTHER = '44444444-4444-4444-8444-444444444444'

describe('createPostVideoPosterUpload (Round H, H1)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.canUsePlatformAdminAuthority.mockResolvedValue(false)
    mocks.isPostMediaAttached.mockResolvedValue(true)
  })

  it('signs a size-bound JPEG PUT next to the author\'s own video', async () => {
    const result = await createPostVideoPosterUpload({ videoStoragePath: `${mocks.user.id}/${POST}/${OBJECT}.mp4`, size: 4000 })
    expect(result).toEqual({ ok: true, uploadUrl: 'https://s3.example/poster-put', posterPath: `${mocks.user.id}/${POST}/${OBJECT}.poster.jpg` })
    expect(mocks.createMediaUploadUrl).toHaveBeenCalledWith({ key: `${mocks.user.id}/${POST}/${OBJECT}.poster.jpg`, contentType: 'image/jpeg', contentLength: 4000 })
  })

  it('refuses another member\'s video unless an administrator backfills a posted one', async () => {
    const path = `${OTHER}/${POST}/${OBJECT}.mp4`
    expect(await createPostVideoPosterUpload({ videoStoragePath: path, size: 4000 })).toEqual({ ok: false, error: 'Invalid poster.' })

    mocks.canUsePlatformAdminAuthority.mockResolvedValue(true)
    mocks.isPostMediaAttached.mockResolvedValueOnce(false)
    expect((await createPostVideoPosterUpload({ videoStoragePath: path, size: 4000 })).ok).toBe(false)

    expect((await createPostVideoPosterUpload({ videoStoragePath: path, size: 4000 })).ok).toBe(true)
    expect(mocks.isPostMediaAttached).toHaveBeenLastCalledWith(path)
  })

  it('refuses non-video paths and oversized posters', async () => {
    expect((await createPostVideoPosterUpload({ videoStoragePath: `${mocks.user.id}/${POST}/${OBJECT}.jpg`, size: 10 })).ok).toBe(false)
    expect((await createPostVideoPosterUpload({ videoStoragePath: `${mocks.user.id}/${POST}/${OBJECT}.mp4`, size: POST_VIDEO_POSTER_MAX_BYTES + 1 })).ok).toBe(false)
    expect(mocks.createMediaUploadUrl).not.toHaveBeenCalled()
  })
})
