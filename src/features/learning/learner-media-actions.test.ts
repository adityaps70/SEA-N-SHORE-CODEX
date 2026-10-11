import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  getLearnerCourse: vi.fn(),
  isCourseManager: vi.fn(),
  canAccessPlatformAdmin: vi.fn(),
  createLessonMediaUrl: vi.fn(),
}))

vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/features/admin/access', () => ({ canAccessPlatformAdmin: mocks.canAccessPlatformAdmin }))
vi.mock('@/lib/aws/storage', () => ({ createLessonMediaUrl: mocks.createLessonMediaUrl }))
vi.mock('./course-payment-repository', () => ({ coursePaymentRepository: { isCourseManager: mocks.isCourseManager } }))
vi.mock('./learner-course-repository', () => ({ learnerCourseRepository: { getLearnerCourse: mocks.getLearnerCourse } }))

import { refreshLessonMediaUrl } from './learner-media-actions'

const slug = 'sire-2-readiness'
const videoId = '11111111-1111-4111-8111-111111111111'
const lockedId = '22222222-2222-4222-8222-222222222222'
const articleId = '33333333-3333-4333-8333-333333333333'

function course(overrides: Record<string, unknown> = {}) {
  return {
    courseId: 'course-1',
    slug,
    enrollmentSource: 'purchase',
    sections: [{
      id: 'section-1',
      lessons: [
        { id: videoId, lessonType: 'video', isAvailable: true, assetPath: 'learning/lessons/v.mp4' },
        { id: lockedId, lessonType: 'video', isAvailable: false, assetPath: 'learning/lessons/l.mp4' },
        { id: articleId, lessonType: 'article', isAvailable: true, assetPath: 'learning/lessons/a.pdf' },
      ],
    }],
    ...overrides,
  }
}

describe('refreshLessonMediaUrl (round E)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAwsUser.mockResolvedValue({ id: 'learner-1' })
    mocks.getLearnerCourse.mockResolvedValue(course())
    mocks.createLessonMediaUrl.mockResolvedValue({ url: 'https://signed.example.com/v.mp4', expiresAt: '2026-10-11T10:20:00.000Z' })
  })

  it('signs a fresh short-lived URL for an available video in the learner’s course', async () => {
    await expect(refreshLessonMediaUrl(slug, videoId)).resolves.toEqual({ ok: true, url: 'https://signed.example.com/v.mp4', expiresAt: '2026-10-11T10:20:00.000Z' })
    expect(mocks.getLearnerCourse).toHaveBeenCalledWith('learner-1', slug)
    expect(mocks.createLessonMediaUrl).toHaveBeenCalledWith('learning/lessons/v.mp4')
  })

  it('refuses bad input, locked lessons, non-media lessons and other courses', async () => {
    expect((await refreshLessonMediaUrl('Bad Slug!', videoId)).ok).toBe(false)
    expect((await refreshLessonMediaUrl(slug, 'not-a-uuid')).ok).toBe(false)
    expect((await refreshLessonMediaUrl(slug, lockedId)).ok).toBe(false)
    expect((await refreshLessonMediaUrl(slug, articleId)).ok).toBe(false)
    mocks.getLearnerCourse.mockResolvedValueOnce(null)
    expect((await refreshLessonMediaUrl(slug, videoId)).ok).toBe(false)
    expect(mocks.createLessonMediaUrl).not.toHaveBeenCalled()
  })

  it('refuses course team access once the person has left the team', async () => {
    mocks.getLearnerCourse.mockResolvedValue(course({ enrollmentSource: 'admin' }))
    mocks.isCourseManager.mockResolvedValue(false)
    mocks.canAccessPlatformAdmin.mockResolvedValue(false)
    expect((await refreshLessonMediaUrl(slug, videoId)).ok).toBe(false)
    mocks.isCourseManager.mockResolvedValue(true)
    expect((await refreshLessonMediaUrl(slug, videoId)).ok).toBe(true)
  })

  it('fails gently when signing fails', async () => {
    mocks.createLessonMediaUrl.mockRejectedValue(new Error('boom'))
    await expect(refreshLessonMediaUrl(slug, videoId)).resolves.toEqual({ ok: false, error: 'We could not load this material. Please reload the page.' })
  })
})
