import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  updateMaterial: vi.fn(),
  createMaterial: vi.fn(),
  courseMediaScope: vi.fn(),
  isMediaReferenced: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('./media', () => ({ verifyLearningMediaObject: vi.fn() }))
vi.mock('./media-repository', () => ({
  learningMediaRepository: { courseMediaScope: mocks.courseMediaScope, isMediaReferenced: mocks.isMediaReferenced },
}))
vi.mock('./mentor-material-repository', () => ({
  mentorMaterialRepository: { updateMaterial: mocks.updateMaterial, createMaterial: mocks.createMaterial },
}))

import { updateCurriculumMaterial } from './mentor-material-actions'
import type { MentorMaterialDraft } from './mentor-material-repository'

const courseId = '33333333-3333-4333-8333-333333333333'
const liveCourseId = '55555555-5555-4555-8555-555555555555'
const materialId = '44444444-4444-4444-8444-444444444444'

function article(articleBody: string): MentorMaterialDraft {
  return {
    title: 'Before boarding',
    materialType: 'article',
    summary: null,
    articleBody,
    articleFormat: 'html',
    assetPath: null,
    externalUrl: null,
    durationSeconds: null,
    isPreview: false,
    isDownloadable: false,
    isPublished: true,
    releaseMode: 'immediate',
    releaseAt: null,
    dripDelayDays: null,
    prerequisiteLessonId: null,
    completionRule: 'view',
    completionThreshold: null,
    maxAttempts: null,
    embedKind: null,
    assignment: null,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAwsUser.mockResolvedValue({ id: 'trainer-1' })
  mocks.updateMaterial.mockResolvedValue(true)
  mocks.courseMediaScope.mockResolvedValue([courseId, liveCourseId])
})

describe('saving a rich-text article', () => {
  it('sanitizes the HTML on the server before it is stored', async () => {
    await expect(updateCurriculumMaterial(courseId, materialId, article('<h2 onclick="x()">Plan</h2><p>Go<script>alert(1)</script></p><iframe src="https://evil"></iframe>')))
      .resolves.toEqual({ ok: true })

    expect(mocks.updateMaterial).toHaveBeenCalledWith('trainer-1', courseId, materialId, expect.objectContaining({
      articleBody: '<h2>Plan</h2><p>Go</p>',
      articleFormat: 'html',
    }))
  })

  it('accepts images from this course and, for a draft revision, from the published course it copies', async () => {
    const own = `learning/trainer-1/${courseId}/lesson_image/66666666-6666-4666-8666-666666666666.png`
    const live = `learning/other-manager/${liveCourseId}/lesson_image/77777777-7777-4777-8777-777777777777.webp`
    await expect(updateCurriculumMaterial(courseId, materialId, article(`<p>Deck</p><img data-storage-path="${own}" src="https://signed"><img data-storage-path="${live}">`)))
      .resolves.toEqual({ ok: true })
    expect(mocks.updateMaterial.mock.lastCall?.[3].articleBody).toBe(`<p>Deck</p><img data-storage-path="${own}" /><img data-storage-path="${live}" />`)
  })

  it('refuses an image that belongs to another course', async () => {
    const foreign = 'learning/someone/88888888-8888-4888-8888-888888888888/lesson_image/99999999-9999-4999-8999-999999999999.png'
    await expect(updateCurriculumMaterial(courseId, materialId, article(`<p>x</p><img data-storage-path="${foreign}">`)))
      .resolves.toEqual({ ok: false, error: 'An image in this article belongs to another course. Upload it again here.' })
    expect(mocks.updateMaterial).not.toHaveBeenCalled()
  })

  it('refuses an article that is empty once sanitized', async () => {
    await expect(updateCurriculumMaterial(courseId, materialId, article('<p></p><script>alert(1)</script>')))
      .resolves.toEqual({ ok: false, error: 'Article materials require content.' })
    expect(mocks.updateMaterial).not.toHaveBeenCalled()
  })

  it('leaves a plain-text article exactly as written', async () => {
    await updateCurriculumMaterial(courseId, materialId, { ...article('Line one\n<b>literal</b>'), articleFormat: 'plain' })
    expect(mocks.updateMaterial.mock.lastCall?.[3]).toMatchObject({ articleBody: 'Line one\n<b>literal</b>', articleFormat: 'plain' })
  })
})
