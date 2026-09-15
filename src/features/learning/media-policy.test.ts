import { describe, expect, it } from 'vitest'
import {
  buildLearningMediaStoragePath,
  isOwnedLearningMediaStoragePath,
  validateLearningMediaMetadata,
} from './media-policy'

const courseId = '33333333-3333-4333-8333-333333333333'
const objectId = '77777777-7777-4777-8777-777777777777'

describe('learning media policy', () => {
  it('accepts supported course thumbnail and video media within their bounded limits', () => {
    expect(validateLearningMediaMetadata({ kind: 'course_thumbnail', mimeType: 'image/webp', size: 5 * 1024 * 1024 })).toEqual({
      ok: true,
      mimeType: 'image/webp',
      extension: 'webp',
    })
    expect(validateLearningMediaMetadata({ kind: 'course_trailer', mimeType: 'video/mp4', size: 200 * 1024 * 1024 }).ok).toBe(true)
    expect(validateLearningMediaMetadata({ kind: 'lesson_video', mimeType: 'video/webm', size: 500 * 1024 * 1024 }).ok).toBe(true)
  })

  it('rejects unsupported formats and oversized assets using the media-kind limits', () => {
    expect(validateLearningMediaMetadata({ kind: 'course_thumbnail', mimeType: 'image/gif', size: 1024 }).ok).toBe(false)
    expect(validateLearningMediaMetadata({ kind: 'course_thumbnail', mimeType: 'image/jpeg', size: (5 * 1024 * 1024) + 1 }).ok).toBe(false)
    expect(validateLearningMediaMetadata({ kind: 'course_trailer', mimeType: 'video/mp4', size: (200 * 1024 * 1024) + 1 }).ok).toBe(false)
    expect(validateLearningMediaMetadata({ kind: 'lesson_video', mimeType: 'video/mp4', size: (500 * 1024 * 1024) + 1 }).ok).toBe(false)
  })

  it('builds an owner/course/kind scoped S3 key and rejects cross-course or cross-kind references', () => {
    const storagePath = buildLearningMediaStoragePath({
      userId: 'user-1',
      courseId,
      kind: 'course_thumbnail',
      mimeType: 'image/png',
      objectId,
    })

    expect(storagePath).toBe(`learning/user-1/${courseId}/course_thumbnail/${objectId}.png`)
    expect(isOwnedLearningMediaStoragePath({ userId: 'user-1', courseId, kind: 'course_thumbnail', storagePath, mimeType: 'image/png' })).toBe(true)
    expect(isOwnedLearningMediaStoragePath({ userId: 'user-1', courseId: '44444444-4444-4444-8444-444444444444', kind: 'course_thumbnail', storagePath, mimeType: 'image/png' })).toBe(false)
    expect(isOwnedLearningMediaStoragePath({ userId: 'user-1', courseId, kind: 'course_trailer', storagePath, mimeType: 'video/mp4' })).toBe(false)
  })
})
