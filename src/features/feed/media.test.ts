import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PDFDocument } from 'pdf-lib'

const {
  createMediaReadUrl,
  createMediaUploadUrl,
  getMediaObject,
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
  getMediaObject: vi.fn(),
  putMediaObject: vi.fn<(input: { key: string; body: Uint8Array | Buffer; contentType: string }) => Promise<void>>(async () => undefined),
  deleteMediaObject: vi.fn<(key: string) => Promise<void>>(async () => undefined),
  createSignedUrls: vi.fn(async (paths: string[]) => ({
    data: paths.map((path) => ({ path, signedUrl: `https://supabase.example/${path}` })),
    error: null,
  })),
  upload: vi.fn(async () => ({ error: null })),
  remove: vi.fn(async () => ({ error: null })),
}))

const verifyUpload = vi.hoisted(() => ({
  verifyStoredUploadSignature: vi.fn<(key: string, mimeType: string, size: number) => Promise<'match' | 'mismatch' | 'unavailable'>>(async () => 'match'),
}))
vi.mock('@/lib/uploads/verify-stored-upload', () => verifyUpload)
vi.mock('@/lib/aws/storage', () => ({
  createMediaReadUrl,
  createMediaUploadUrl,
  getMediaObject,
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
    getMediaObject.mockReset()
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

  it('reuses a caller-provided pending post id for additional gallery objects', async () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValueOnce(randomId)

    const upload = await createPendingPostMediaUpload({
      profileId,
      postId,
      mimeType: 'image/jpeg',
      size: 1024,
    })

    expect(upload.postId).toBe(postId)
    expect(upload.storagePath).toBe(`${profileId}/${postId}/${randomId}.jpg`)
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

  it('rejects an upload whose bytes are not the declared type (Round P3)', async () => {
    verifyUpload.verifyStoredUploadSignature.mockResolvedValueOnce('mismatch')
    await expect(verifyPendingPostMedia({ profileId, postId, storagePath: videoPath, mimeType: 'video/mp4', size: 1024 }))
      .rejects.toThrow('feed_media_metadata_mismatch')
    expect(verifyUpload.verifyStoredUploadSignature).toHaveBeenCalledWith(videoPath, 'video/mp4', 1024)
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

  it('verifies the actual PDF page count server-side before publication', async () => {
    const pdf = await PDFDocument.create()
    pdf.addPage()
    pdf.addPage()
    const bytes = await pdf.save()
    const pdfPath = `${profileId}/${postId}/${randomId}.pdf`
    headMediaObject.mockResolvedValueOnce({ contentType: 'application/pdf', contentLength: bytes.byteLength })
    getMediaObject.mockResolvedValueOnce({
      body: bytes,
      contentType: 'application/pdf',
      contentLength: bytes.byteLength,
    })

    await expect(verifyPendingPostMedia({
      profileId,
      postId,
      storagePath: pdfPath,
      mimeType: 'application/pdf',
      size: bytes.byteLength,
      pageCount: 2,
    })).resolves.toBeUndefined()

    expect(getMediaObject).toHaveBeenCalledWith({
      key: pdfPath,
      maxBytes: 25 * 1024 * 1024,
    })
  })

  it('rejects a PDF when the submitted page count does not match the stored document', async () => {
    const pdf = await PDFDocument.create()
    pdf.addPage()
    pdf.addPage()
    const bytes = await pdf.save()
    const pdfPath = `${profileId}/${postId}/${randomId}.pdf`
    headMediaObject.mockResolvedValueOnce({ contentType: 'application/pdf', contentLength: bytes.byteLength })
    getMediaObject.mockResolvedValueOnce({
      body: bytes,
      contentType: 'application/pdf',
      contentLength: bytes.byteLength,
    })

    await expect(verifyPendingPostMedia({
      profileId,
      postId,
      storagePath: pdfPath,
      mimeType: 'application/pdf',
      size: bytes.byteLength,
      pageCount: 3,
    })).rejects.toThrow('feed_media_document_page_mismatch')
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

  it('resolves profile avatar storage keys with the profile-media signed read path', async () => {
    const avatarPath = `profiles/${profileId}/avatar-${randomId}.webp`
    const postPath = `${profileId}/${postId}/${randomId}.webp`

    const urls = await resolveFeedMediaUrls([avatarPath, postPath])

    expect(createMediaReadUrl).toHaveBeenCalledWith(avatarPath)
    expect(urls.get(avatarPath)).toBe(`https://s3.example/${avatarPath}`)
    expect(urls.get(postPath)).toBe(`/api/feed-media/${profileId}/${postId}/${randomId}.webp`)
  })

  it('resolves feed media to same-origin private paths without exposing the S3 hostname', async () => {
    const nestedPath = `${profileId}/${postId}/deck photo.webp`

    const urls = await resolveFeedMediaUrls([nestedPath, 'one.jpg'])

    expect(urls).toEqual(new Map([
      [nestedPath, `/api/feed-media/${profileId}/${postId}/deck%20photo.webp`],
      ['one.jpg', '/api/feed-media/one.jpg'],
    ]))
    expect(createMediaReadUrl).not.toHaveBeenCalled()
    expect([...urls.values()].every((url) => url.startsWith('/'))).toBe(true)
  })

  // Round P3 (B7): once the media CDN is configured, photos go straight to their signed sizes;
  // videos and PDFs keep the visibility-checking route.
  it('hands out signed CDN sizes for post photos once the media CDN is configured', async () => {
    const { generateKeyPairSync } = await import('node:crypto')
    const pem = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
    const saved = { ...process.env }
    Object.assign(process.env, { MEDIA_CDN_SIGNING_KEY: pem, MEDIA_CDN_KEY_PAIR_ID: 'K2JCJMDEHXQW5F', NEXT_PUBLIC_SITE_URL: 'https://seanshore.in' })
    try {
      const photo = `${profileId}/${postId}/${randomId}.jpg`
      const pdf = `${profileId}/${postId}/${randomId}.pdf`
      const urls = await resolveFeedMediaUrls([photo, videoPath, pdf])
      expect(urls.get(photo)).toMatch(/^\/m\/i\/[A-Za-z0-9_-]{32}\/768\.webp\?Policy=.+&Signature=.+&Key-Pair-Id=K2JCJMDEHXQW5F&Hash-Algorithm=SHA256$/)
      expect(urls.get(videoPath)).toBe(`/api/feed-media/${videoPath}`)
      expect(urls.get(pdf)).toBe(`/api/feed-media/${pdf}`)
    } finally {
      process.env = saved
    }
  })

  it('deletes the exact S3 storage key', async () => {
    await removeFeedImage(`${profileId}/${postId}/image.webp`)

    expect(deleteMediaObject).toHaveBeenCalledWith(`${profileId}/${postId}/image.webp`)
  })
})
