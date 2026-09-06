import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  createMediaReadUrl,
  putMediaObject,
  deleteMediaObject,
  createSignedUrls,
  upload,
  remove,
} = vi.hoisted(() => ({
  createMediaReadUrl: vi.fn<(key: string) => Promise<string>>(async (key) => `https://s3.example/${key}`),
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

import { removeFeedImage, resolveFeedMediaUrls, uploadFeedImage } from './media'

const profileId = '11111111-1111-4111-8111-111111111111'
const postId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const randomId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

describe('feed media adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createMediaReadUrl.mockImplementation(async (key) => `https://s3.example/${key}`)
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
