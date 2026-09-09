import { describe, expect, it, vi } from 'vitest'
import {
  POST_IMAGE_MAX_BYTES,
  POST_MEDIA_MIME_EXTENSION,
  POST_VIDEO_MAX_BYTES,
  buildPostMediaStoragePath,
  isOwnedPostMediaStoragePath,
  isVideoPostMediaMime,
  validatePostMediaMetadata,
} from './media-policy'

const profileId = '11111111-1111-4111-8111-111111111111'
const postId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const otherProfileId = '22222222-2222-4222-8222-222222222222'
const otherPostId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const objectId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

describe('post media policy', () => {
  it('defines the exact approved MIME-to-extension map and size limits', () => {
    expect(POST_MEDIA_MIME_EXTENSION).toEqual({
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'video/mp4': 'mp4',
      'video/webm': 'webm',
    })
    expect(POST_IMAGE_MAX_BYTES).toBe(5 * 1024 * 1024)
    expect(POST_VIDEO_MAX_BYTES).toBe(200 * 1024 * 1024)
  })

  it('accepts images at the 5 MiB boundary and rejects larger images', () => {
    expect(validatePostMediaMetadata({ mimeType: 'image/jpeg', size: POST_IMAGE_MAX_BYTES })).toEqual({
      ok: true,
      mimeType: 'image/jpeg',
      extension: 'jpg',
    })
    expect(validatePostMediaMetadata({ mimeType: 'image/jpeg', size: POST_IMAGE_MAX_BYTES + 1 })).toEqual({
      ok: false,
      error: 'Images must be 5 MiB or smaller.',
    })
  })

  it('accepts videos at the 200 MB boundary and rejects larger videos', () => {
    expect(validatePostMediaMetadata({ mimeType: 'video/mp4', size: POST_VIDEO_MAX_BYTES })).toEqual({
      ok: true,
      mimeType: 'video/mp4',
      extension: 'mp4',
    })
    expect(validatePostMediaMetadata({ mimeType: 'video/mp4', size: POST_VIDEO_MAX_BYTES + 1 })).toEqual({
      ok: false,
      error: 'Videos must be 200 MB or smaller.',
    })
  })

  it.each([
    ['video/quicktime', 1024],
    ['image/gif', 1024],
    ['application/pdf', 1024],
  ])('rejects unsupported MIME type %s', (mimeType, size) => {
    expect(validatePostMediaMetadata({ mimeType, size })).toEqual({
      ok: false,
      error: 'Choose a JPEG, PNG, WebP, MP4, or WebM file.',
    })
  })

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.5])('rejects invalid byte size %s', (size) => {
    expect(validatePostMediaMetadata({ mimeType: 'image/png', size })).toEqual({
      ok: false,
      error: 'Media file size is invalid.',
    })
  })

  it('identifies only the approved video MIME values', () => {
    expect(isVideoPostMediaMime('video/mp4')).toBe(true)
    expect(isVideoPostMediaMime('video/webm')).toBe(true)
    expect(isVideoPostMediaMime('image/jpeg')).toBe(false)
    expect(isVideoPostMediaMime('video/quicktime')).toBe(false)
  })

  it('builds the existing profile/post/object key shape with the MIME-derived extension', () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(objectId)

    expect(buildPostMediaStoragePath({ profileId, postId, mimeType: 'video/webm' })).toBe(
      `${profileId}/${postId}/${objectId}.webm`,
    )
    expect(buildPostMediaStoragePath({ profileId, postId, mimeType: 'image/webp', objectId })).toBe(
      `${profileId}/${postId}/${objectId}.webp`,
    )
  })

  it('accepts only an exact owned profile/post path with the expected extension', () => {
    const storagePath = `${profileId}/${postId}/${objectId}.mp4`

    expect(isOwnedPostMediaStoragePath({ profileId, postId, storagePath, mimeType: 'video/mp4' })).toBe(true)
    expect(isOwnedPostMediaStoragePath({ profileId: otherProfileId, postId, storagePath, mimeType: 'video/mp4' })).toBe(false)
    expect(isOwnedPostMediaStoragePath({ profileId, postId: otherPostId, storagePath, mimeType: 'video/mp4' })).toBe(false)
    expect(isOwnedPostMediaStoragePath({ profileId, postId, storagePath, mimeType: 'video/webm' })).toBe(false)
    expect(isOwnedPostMediaStoragePath({
      profileId,
      postId,
      storagePath: `prefix/${profileId}/${postId}/${objectId}.mp4`,
      mimeType: 'video/mp4',
    })).toBe(false)
  })
})
