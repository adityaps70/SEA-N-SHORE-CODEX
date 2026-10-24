import { describe, expect, it, vi } from 'vitest'
import {
  POST_DOCUMENT_MAX_BYTES,
  POST_DOCUMENT_MAX_PAGES,
  POST_IMAGE_MAX_BYTES,
  POST_IMAGE_MAX_COUNT,
  POST_MEDIA_MIME_EXTENSION,
  POST_VIDEO_MAX_BYTES,
  POST_VIDEO_MAX_SECONDS,
  POST_VIDEO_720P_HINT,
  POST_VIDEO_TOO_LONG_MESSAGE,
  validatePostVideoDetails,
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
      'application/pdf': 'pdf',
    })
    expect(POST_IMAGE_MAX_BYTES).toBe(5 * 1024 * 1024)
    expect(POST_IMAGE_MAX_COUNT).toBe(10)
    // Round P3: feed videos are served as uploaded, so they are capped at 100 MB (was 200 MB).
    expect(POST_VIDEO_MAX_BYTES).toBe(100 * 1024 * 1024)
    expect(POST_DOCUMENT_MAX_BYTES).toBe(25 * 1024 * 1024)
    expect(POST_DOCUMENT_MAX_PAGES).toBe(50)
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

  it('accepts videos at the 100 MB boundary and rejects larger videos', () => {
    expect(validatePostMediaMetadata({ mimeType: 'video/mp4', size: POST_VIDEO_MAX_BYTES })).toEqual({
      ok: true,
      mimeType: 'video/mp4',
      extension: 'mp4',
    })
    expect(validatePostMediaMetadata({ mimeType: 'video/mp4', size: POST_VIDEO_MAX_BYTES + 1 })).toEqual({
      ok: false,
      error: 'Videos must be 100 MB or smaller.',
    })
  })

  it('accepts PDFs at the Sea N Shore 25 MB boundary and rejects larger documents', () => {
    expect(validatePostMediaMetadata({ mimeType: 'application/pdf', size: POST_DOCUMENT_MAX_BYTES })).toEqual({
      ok: true,
      mimeType: 'application/pdf',
      extension: 'pdf',
    })
    expect(validatePostMediaMetadata({ mimeType: 'application/pdf', size: POST_DOCUMENT_MAX_BYTES + 1 })).toEqual({
      ok: false,
      error: 'PDF documents must be 25 MB or smaller.',
    })
  })

  it.each([
    ['video/quicktime', 1024],
    ['image/gif', 1024],
  ])('rejects unsupported MIME type %s', (mimeType, size) => {
    expect(validatePostMediaMetadata({ mimeType, size })).toEqual({
      ok: false,
      error: 'Choose a JPEG, PNG, WebP, MP4, WebM, or PDF file.',
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
    expect(isVideoPostMediaMime('application/pdf')).toBe(false)
  })

  it('builds the existing profile/post/object key shape with the MIME-derived extension', () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(objectId)

    expect(buildPostMediaStoragePath({ profileId, postId, mimeType: 'video/webm' })).toBe(
      `${profileId}/${postId}/${objectId}.webm`,
    )
    expect(buildPostMediaStoragePath({ profileId, postId, mimeType: 'image/webp', objectId })).toBe(
      `${profileId}/${postId}/${objectId}.webp`,
    )
    expect(buildPostMediaStoragePath({ profileId, postId, mimeType: 'application/pdf', objectId })).toBe(
      `${profileId}/${postId}/${objectId}.pdf`,
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

  it('caps feed videos at 3 minutes and suggests 720p for larger frames (Round P3)', () => {
    expect(POST_VIDEO_MAX_SECONDS).toBe(180)
    expect(validatePostVideoDetails({ durationSeconds: 180, width: 1280, height: 720 })).toEqual({ ok: true, hint: null })
    expect(validatePostVideoDetails({ durationSeconds: 720, width: 720, height: 1280 })).toEqual({ ok: false, error: POST_VIDEO_TOO_LONG_MESSAGE })
    expect(validatePostVideoDetails({ durationSeconds: 45, width: 1080, height: 1920 })).toEqual({ ok: true, hint: POST_VIDEO_720P_HINT })
    expect(validatePostVideoDetails({ durationSeconds: 45, width: 3840, height: 2160 })).toEqual({ ok: true, hint: POST_VIDEO_720P_HINT })
    // Unreadable details: only the size cap applies.
    expect(validatePostVideoDetails(null)).toEqual({ ok: true, hint: null })
    expect(validatePostVideoDetails({ durationSeconds: Number.NaN, width: 0, height: 0 })).toEqual({ ok: true, hint: null })
  })
})
