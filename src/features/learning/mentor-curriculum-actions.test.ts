import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MentorLessonDraft, MentorQuizDefinitionInput } from './mentor-curriculum-repository'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  revalidatePath: vi.fn(),
  createSection: vi.fn(),
  updateSection: vi.fn(),
  deleteSection: vi.fn(),
  moveSection: vi.fn(),
  createLesson: vi.fn(),
  updateLesson: vi.fn(),
  deleteLesson: vi.fn(),
  moveLesson: vi.fn(),
  saveQuizDefinition: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('./mentor-curriculum-repository', async (importOriginal) => {
  const original = await importOriginal<typeof import('./mentor-curriculum-repository')>()
  return {
    ...original,
    mentorCurriculumRepository: {
      createSection: mocks.createSection,
      updateSection: mocks.updateSection,
      deleteSection: mocks.deleteSection,
      moveSection: mocks.moveSection,
      createLesson: mocks.createLesson,
      updateLesson: mocks.updateLesson,
      deleteLesson: mocks.deleteLesson,
      moveLesson: mocks.moveLesson,
      saveQuizDefinition: mocks.saveQuizDefinition,
    },
  }
})

import {
  createCurriculumLesson,
  createCurriculumSection,
  deleteCurriculumLesson,
  deleteCurriculumSection,
  moveCurriculumLesson,
  moveCurriculumSection,
  saveCurriculumQuiz,
  updateCurriculumLesson,
  updateCurriculumSection,
} from './mentor-curriculum-actions'

const courseId = '33333333-3333-4333-8333-333333333333'
const sectionId = '44444444-4444-4444-8444-444444444444'
const lessonId = '55555555-5555-4555-8555-555555555555'

function articleLesson(overrides: Partial<MentorLessonDraft> = {}): MentorLessonDraft {
  return {
    title: ' Inspection evidence ',
    lessonType: 'article',
    summary: ' Practical preparation notes ',
    articleBody: ' Review records, procedures and crew readiness before the inspection. ',
    assetPath: null,
    externalUrl: null,
    durationSeconds: 420,
    isPreview: false,
    isDownloadable: false,
    ...overrides,
  }
}

function validQuiz(overrides: Partial<MentorQuizDefinitionInput> = {}): MentorQuizDefinitionInput {
  return {
    passPercentage: 80,
    instructions: ' Choose the best answer. ',
    questions: [
      {
        prompt: ' What should be prepared before inspection? ',
        options: [
          { label: ' Only certificates ', isCorrect: false },
          { label: ' Evidence, procedures and crew readiness ', isCorrect: true },
        ],
      },
    ],
    ...overrides,
  }
}

describe('mentor curriculum server actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAwsUser.mockResolvedValue({ id: 'user-1', cognitoSub: 'sub-1', email: 'mentor@example.com' })
    mocks.createSection.mockResolvedValue({ sectionId })
    mocks.updateSection.mockResolvedValue(true)
    mocks.deleteSection.mockResolvedValue(true)
    mocks.moveSection.mockResolvedValue(true)
    mocks.createLesson.mockResolvedValue({ lessonId })
    mocks.updateLesson.mockResolvedValue(true)
    mocks.deleteLesson.mockResolvedValue(true)
    mocks.moveLesson.mockResolvedValue(true)
    mocks.saveQuizDefinition.mockResolvedValue(true)
  })

  it('rejects invalid identifiers before authentication or mutation', async () => {
    await expect(createCurriculumSection('not-a-uuid', 'Module 1')).resolves.toEqual({ ok: false, error: 'Invalid course.' })
    await expect(moveCurriculumLesson(courseId, 'bad-lesson', 'up')).resolves.toEqual({ ok: false, error: 'Invalid lesson.' })

    expect(mocks.requireAwsUser).not.toHaveBeenCalled()
    expect(mocks.createSection).not.toHaveBeenCalled()
    expect(mocks.moveLesson).not.toHaveBeenCalled()
  })

  it('normalizes section titles, authenticates once and refreshes the course editor', async () => {
    await expect(createCurriculumSection(courseId, '  Module 1 · Inspection foundations  ')).resolves.toEqual({
      ok: true,
      sectionId,
    })

    expect(mocks.createSection).toHaveBeenCalledWith('user-1', courseId, 'Module 1 · Inspection foundations')
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/learn/studio/courses/${courseId}/edit`)
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/learn/studio')
  })

  it('validates article content before authentication and sends a normalized lesson draft to the repository', async () => {
    await expect(createCurriculumLesson(courseId, sectionId, articleLesson({ articleBody: '   ' }))).resolves.toEqual({
      ok: false,
      error: 'Article lessons require article content.',
    })
    expect(mocks.requireAwsUser).not.toHaveBeenCalled()

    await expect(createCurriculumLesson(courseId, sectionId, articleLesson())).resolves.toEqual({ ok: true, lessonId })
    expect(mocks.createLesson).toHaveBeenCalledWith('user-1', courseId, sectionId, {
      title: 'Inspection evidence',
      lessonType: 'article',
      summary: 'Practical preparation notes',
      articleBody: 'Review records, procedures and crew readiness before the inspection.',
      assetPath: null,
      externalUrl: null,
      durationSeconds: 420,
      isPreview: false,
      isDownloadable: false,
    })
  })

  it('requires a source for media and resource lessons and a meeting URL for live sessions', async () => {
    await expect(createCurriculumLesson(courseId, sectionId, articleLesson({
      lessonType: 'video',
      articleBody: null,
      assetPath: null,
      externalUrl: null,
    }))).resolves.toEqual({ ok: false, error: 'Video lessons require an uploaded asset or external URL.' })

    await expect(createCurriculumLesson(courseId, sectionId, articleLesson({
      lessonType: 'live_session',
      articleBody: null,
      externalUrl: null,
    }))).resolves.toEqual({ ok: false, error: 'Live session lessons require an external meeting URL.' })

    expect(mocks.requireAwsUser).not.toHaveBeenCalled()
  })

  it('rejects malformed quiz answer keys before authentication', async () => {
    const malformed = validQuiz({
      questions: [{
        prompt: 'Unsafe question',
        options: [
          { label: 'A', isCorrect: true },
          { label: 'B', isCorrect: true },
        ],
      }],
    })

    await expect(saveCurriculumQuiz(courseId, lessonId, malformed)).resolves.toEqual({
      ok: false,
      error: 'Each quiz question must have exactly one correct answer.',
    })
    expect(mocks.requireAwsUser).not.toHaveBeenCalled()
    expect(mocks.saveQuizDefinition).not.toHaveBeenCalled()
  })

  it('normalizes and persists a valid quiz definition without exposing learner scoring logic', async () => {
    await expect(saveCurriculumQuiz(courseId, lessonId, validQuiz())).resolves.toEqual({ ok: true })

    expect(mocks.saveQuizDefinition).toHaveBeenCalledWith('user-1', courseId, lessonId, {
      passPercentage: 80,
      instructions: 'Choose the best answer.',
      questions: [{
        prompt: 'What should be prepared before inspection?',
        options: [
          { label: 'Only certificates', isCorrect: false },
          { label: 'Evidence, procedures and crew readiness', isCorrect: true },
        ],
      }],
    })
  })

  it('wires update, delete and movement mutations through the authenticated owner identity', async () => {
    await expect(updateCurriculumSection(courseId, sectionId, ' Revised module ')).resolves.toEqual({ ok: true })
    await expect(deleteCurriculumSection(courseId, sectionId)).resolves.toEqual({ ok: true })
    await expect(moveCurriculumSection(courseId, sectionId, 'down')).resolves.toEqual({ ok: true })
    await expect(updateCurriculumLesson(courseId, lessonId, articleLesson())).resolves.toEqual({ ok: true })
    await expect(deleteCurriculumLesson(courseId, lessonId)).resolves.toEqual({ ok: true })
    await expect(moveCurriculumLesson(courseId, lessonId, 'up')).resolves.toEqual({ ok: true })

    expect(mocks.updateSection).toHaveBeenCalledWith('user-1', courseId, sectionId, 'Revised module')
    expect(mocks.deleteSection).toHaveBeenCalledWith('user-1', courseId, sectionId)
    expect(mocks.moveSection).toHaveBeenCalledWith('user-1', courseId, sectionId, 'down')
    expect(mocks.updateLesson).toHaveBeenCalledWith('user-1', courseId, lessonId, expect.objectContaining({ title: 'Inspection evidence' }))
    expect(mocks.deleteLesson).toHaveBeenCalledWith('user-1', courseId, lessonId)
    expect(mocks.moveLesson).toHaveBeenCalledWith('user-1', courseId, lessonId, 'up')
  })

  it('returns safe copy when a curriculum mutation is frozen by course workflow', async () => {
    mocks.updateSection.mockRejectedValueOnce(new Error('course_edit_forbidden'))

    await expect(updateCurriculumSection(courseId, sectionId, 'Module')).resolves.toEqual({
      ok: false,
      error: 'This curriculum is frozen while the course is in review or published.',
    })
  })
})
