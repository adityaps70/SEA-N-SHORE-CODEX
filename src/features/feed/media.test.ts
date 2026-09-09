import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  createMediaReadUrl,
  createMediaUploadUrl,
  headMediaObject,
  putMediaObject,
  deleteMediaObject,
  createSignedUrls,
  upload,
  remove,
} = vi.hoisted(() => ({
  createMediaReadUrl: vi.fn<(key: string) => Promise<string>>(async (key) => `https://s3.example/${key}`),
  createMediaUploadUrl: vi.fn<(input: { key: string; contentType: string }) => Promise<string>>(async () => 'https://s3.example/upload'),
  headMediaObject: vi.fn<(key: string) => Promise<{ contentType: string | null; contentLength: number | null }>>(async () => ({
    contentType: 'video/mp4',
    contentLength: 1024,
  })),
  putMediaObject: vi.fn<(input: { key: string; body: Uint8Array | Buffer; contentType: string }) => Promise<void>>(async () => undefined),
  deleteMediaObject: vi.fn<(key: string) => Promise<void>>(async () => undefined),
  createSignedUrls: vi.fn(async (paths: string[]) => ({
    data: paths.map((path) => ({ path, signedUrl: `https://supabase.example/${path}` })),
    error: null,
  })),
  upload: vi.fn(async () => ({ error: null })),
  remove: vi.fn(async () => ({ error: null })),
}))

vi.mock('@/lib/aws/storage', () => ({
  createMediaReadUrl,
  createMediaUploadUrl,
  headMediaObject,
  putMediaObject,
  deleteMediaObject,
}))

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    storage: {
      from: vi.fn(() => ({ createSignedUrls, upload, remove })),
    },
  })),
}))

import {
  createPendingPostMediaUpload,
  removeFeedImage,
  resolveFeedMediaUrls,
  uploadFeedImage,
  verifyPendingPostMedia,
} from './media'

const profileId = '11111111-1111-4111-8111-111111111111'
const otherProfileId = '22222222-2222-4222-8222-222222222222'
const postId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const otherPostId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const randomId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const videoPath = `${profileId}/${postId}/${randomId}.mp4`

describe('feed media adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createMediaReadUrl.mockImplementation(async (key) => `https://s3.example/${key}`)
    createMediaUploadUrl.mockResolvedValue('https://s3.example/upload')
    headMediaObject.mockResolvedValue({ contentType: 'video/mp4', contentLength: 1024 })
    putMediaObject.mockResolvedValue(undefined)
  })

  it('creates a server-scoped pending upload with a server-generated post id and object key', async () => {
    vi.spyOn(crypto, 'randomUUID')
      .mockReturnValueOnce(postId)
      .mockReturnValueOnce(randomId)

    await expect(createPendingPostMediaUpload({
      profileId,
      mimeType: 'video/mp4',
      size: 1024,
    })).resolves.toEqual({
      postId,
      storagePath: videoPath,
      mimeType: 'video/mp4',
      size: 1024,
      uploadUrl: 'https://s3.example/upload',
    })

    expect(createMediaUploadUrl).toHaveBeenCalledWith({
      key: videoPath,
      contentType: 'video/mp4',
    })
  })

  it('verifies the exact owned object MIME and byte length before finalization', async () => {
    await expect(verifyPendingPostMedia({
      profileId,
      postId,
      storagePath: videoPath,
      mimeType: 'video/mp4',
      size: 1024,
    })).resolves.toBeUndefined()

    expect(headMediaObject).toHaveBeenCalledWith(videoPath)
  })

  it.each([
    ['another profile', { profileId: otherProfileId, postId, storagePath: videoPath, mimeType: 'video/mp4' as const, size: 1024 }],
    ['another post', { profileId, postId: otherPostId, storagePath: videoPath, mimeType: 'video/mp4' as const, size: 1024 }],
    ['mismatched extension', { profileId, postId, storagePath: `${profileId}/${postId}/${randomId}.webm`, mimeType: 'video/mp4' as const, size: 1024 }],
  ])('rejects a pending path scoped to %s', async (_case, input) => {
    await expect(verifyPendingPostMedia(input)).rejects.toThrow('feed_media_reference_invalid')
    expect(headMediaObject).not.toHaveBeenCalled()
  })

  it('rejects an unavailable uploaded object', async () => {
    headMediaObject.mockRejectedValueOnce(new Error('NoSuchKey'))

    await expect(verifyPendingPostMedia({
      profileId,
      postId,
      storagePath: videoPath,
      mimeType: 'video/mp4',
      size: 1024,
    })).rejects.toThrow('feed_media_unavailable')
  })

  it('rejects a stored MIME mismatch', async () => {
    headMediaObject.mockResolvedValueOnce({ contentType: 'video/webm', contentLength: 1024 })

    await expect(verifyPendingPostMedia({
      profileId,
      postId,
      storagePath: videoPath,
      mimeType: 'video/mp4',
      size: 1024,
    })).rejects.toThrow('feed_media_metadata_mismatch')
  })

  it('rejects a stored byte-length mismatch', async () => {
    headMediaObject.mockResolvedValueOnce({ contentType: 'video/mp4', contentLength: 2048 })

    await expect(verifyPendingPostMedia({
      profileId,
      postId,
      storagePath: videoPath,
      mimeType: 'video/mp4',
      size: 1024,
    })).rejects.toThrow('feed_media_metadata_mismatch')
  })

  it('rejects an oversized/tampered media reference before HEAD verification', async () => {
    await expect(verifyPendingPostMedia({
      profileId,
      postId,
      storagePath: videoPath,
      mimeType: 'video/mp4',
      size: 200 * 1024 * 1024 + 1,
    })).rejects.toThrow('feed_media_policy_invalid')

    expect(headMediaObject).not.toHaveBeenCalled()
  })

  it('uploads through S3 while preserving the existing storage key shape and MIME type', async () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(randomId)
    const bytes = new TextEncoder().encode('image-bytes')
    const arrayBuffer = vi.fn(async () => bytes.buffer)
    const file = {
      type: 'image/jpeg',
      arrayBuffer,
    } as unknown as File

    const storagePath = await uploadFeedImage({
      profileId,
      postId,
      file,
      extension: 'jpg',
    })

    expect(arrayBuffer).toHaveBeenCalledTimes(1)
    expect(storagePath).toBe(`${profileId}/${postId}/${randomId}.jpg`)
    expect(putMediaObject).toHaveBeenCalledTimes(1)
    expect(putMediaObject).toHaveBeenCalledWith({
      key: storagePath,
      body: expect.any(Uint8Array),
      contentType: 'image/jpeg',
    })
  })

  it('logs only the AWS error class when an S3 upload fails', async () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(randomId)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const denied = new Error('sensitive provider detail that must not be logged')
    denied.name = 'AccessDenied'
    putMediaObject.mockRejectedValueOnce(denied)
    const file = {
      type: 'image/jpeg',
      arrayBuffer: vi.fn(async () => new TextEncoder().encode('image-bytes').buffer),
    } as unknown as File

    await expect(uploadFeedImage({
      profileId,
      postId,
      file,
      extension: 'jpg',
    })).rejects.toThrow('feed_media_upload_failed')

    expect(errorSpy).toHaveBeenCalledWith('[feed_media_upload_failed]', {
      errorName: 'AccessDenied',
    })
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('sensitive provider detail')
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(profileId)
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(postId)
    errorSpy.mockRestore()
  })

  it('resolves readable S3 keys independently so one failed key does not fail the feed', async () => {
    createMediaReadUrl
      .mockResolvedValueOnce('https://s3.example/one.jpg')
      .mockRejectedValueOnce(new Error('missing'))

    const urls = await resolveFeedMediaUrls(['one.jpg', 'missing.jpg'])

    expect(urls).toEqual(new Map([['one.jpg', 'https://s3.example/one.jpg']]))
    expect(createMediaReadUrl).toHaveBeenCalledWith('one.jpg')
    expect(createMediaReadUrl).toHaveBeenCalledWith('missing.jpg')
  })

  it('deletes the exact S3 storage key', async () => {
    await removeFeedImage(`${profileId}/${postId}/image.webp`)

    expect(deleteMediaObject).toHaveBeenCalledWith(`${profileId}/${postId}/image.webp`)
  })
})
