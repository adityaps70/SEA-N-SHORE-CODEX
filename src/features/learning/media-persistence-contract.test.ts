import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CourseDraftInput } from './course-repository'
import type { MentorLessonDraft } from './mentor-curriculum-repository'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  updateCourse: vi.fn(),
  updateLesson: vi.fn(),
  verifyLearningMediaObject: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('./media', () => ({ verifyLearningMediaObject: mocks.verifyLearningMediaObject }))
vi.mock('./course-repository', async (importOriginal) => {
  const original = await importOriginal<typeof import('./course-repository')>()
  return {
    ...original,
    courseRepository: {
      createCourse: vi.fn(),
      updateCourse: mocks.updateCourse,
      submitCourse: vi.fn(),
    },
  }
})
vi.mock('./mentor-curriculum-repository', async (importOriginal) => {
  const original = await importOriginal<typeof import('./mentor-curriculum-repository')>()
  return {
    ...original,
    mentorCurriculumRepository: {
      createSection: vi.fn(),
      updateSection: vi.fn(),
      deleteSection: vi.fn(),
      moveSection: vi.fn(),
      createLesson: vi.fn(),
      updateLesson: mocks.updateLesson,
      deleteLesson: vi.fn(),
      moveLesson: vi.fn(),
      saveQuizDefinition: vi.fn(),
    },
  }
})

import { updateCourseDraft } from './course-actions'
import { updateCurriculumLesson } from './mentor-curriculum-actions'

const courseId = '33333333-3333-4333-8333-333333333333'
const lessonId = '55555555-5555-4555-8555-555555555555'
const thumbnailPath = `learning/user-1/${courseId}/course_thumbnail/77777777-7777-4777-8777-777777777777.webp`
const videoPath = `learning/user-1/${courseId}/lesson_video/88888888-8888-4888-8888-888888888888.mp4`

function courseInput(): CourseDraftInput {
  return {
    slug: 'bridge-resource-management',
    title: 'Bridge Resource Management',
    subtitle: null,
    description: 'A practical bridge resource management course for maritime officers covering communication, situational awareness and decision making.',
    category: 'Leadership',
    level: 'intermediate',
    language: 'English',
    thumbnailPath,
    trailerPath: null,
    learningOutcomes: ['Improve bridge communication'],
    requirements: [],
    targetAudience: ['Deck Officers'],
    accessType: 'free',
    priceMinor: 0,
    discountPriceMinor: null,
    currency: 'INR',
    certificateEnabled: true,
    courseFormat: 'recorded',
  }
}

function videoLesson(): MentorLessonDraft {
  return {
    title: 'Bridge walkthrough',
    lessonType: 'video',
    summary: null,
    articleBody: null,
    assetPath: videoPath,
    externalUrl: null,
    durationSeconds: 600,
    isPreview: false,
    isDownloadable: false,
  }
}

describe('learning media persistence verification', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAwsUser.mockResolvedValue({ id: 'user-1', email: 'mentor@example.com' })
    mocks.verifyLearningMediaObject.mockResolvedValue({ contentType: 'video/mp4', contentLength: 1024 })
    mocks.updateCourse.mockResolvedValue(true)
    mocks.updateLesson.mockResolvedValue(true)
  })

  it('HEAD-verifies an owned uploaded course image before persisting its storage path', async () => {
    await expect(updateCourseDraft(courseId, courseInput())).resolves.toEqual({ ok: true })

    expect(mocks.verifyLearningMediaObject).toHaveBeenCalledWith({
      userId: 'user-1',
      courseId,
      kind: 'course_thumbnail',
      storagePath: thumbnailPath,
    })
    expect(mocks.verifyLearningMediaObject.mock.invocationCallOrder[0]).toBeLessThan(mocks.updateCourse.mock.invocationCallOrder[0])
  })

  it('HEAD-verifies an owned uploaded lesson video before persisting its storage path', async () => {
    await expect(updateCurriculumLesson(courseId, lessonId, videoLesson())).resolves.toEqual({ ok: true })

    expect(mocks.verifyLearningMediaObject).toHaveBeenCalledWith({
      userId: 'user-1',
      courseId,
      kind: 'lesson_video',
      storagePath: videoPath,
    })
    expect(mocks.verifyLearningMediaObject.mock.invocationCallOrder[0]).toBeLessThan(mocks.updateLesson.mock.invocationCallOrder[0])
  })

  it('does not persist a media path when S3 metadata verification fails', async () => {
    mocks.verifyLearningMediaObject.mockRejectedValueOnce(new Error('learning_media_metadata_mismatch'))

    await expect(updateCurriculumLesson(courseId, lessonId, videoLesson())).resolves.toEqual({
      ok: false,
      error: 'We could not verify the uploaded lesson video. Please upload it again.',
    })
    expect(mocks.updateLesson).not.toHaveBeenCalled()
  })
})
