'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { verifyLearningMediaObject } from './media'
import {
  mentorCurriculumRepository,
  type MentorLessonDraft,
  type MentorQuizDefinitionInput,
} from './mentor-curriculum-repository'

const uuidSchema = z.string().uuid()
const directionSchema = z.enum(['up', 'down'])
const lessonTypeSchema = z.enum([
  'video', 'article', 'pdf', 'presentation_document', 'audio', 'quiz', 'assignment', 'downloadable_resource', 'live_session',
])

const nullableText = (max: number) => z.union([
  z.null(),
  z.string().transform((value) => value.trim() || null),
]).pipe(z.union([z.null(), z.string().max(max)]))

const nullableUrl = z.union([
  z.null(),
  z.string().transform((value) => value.trim() || null),
]).pipe(z.union([
  z.null(),
  z.string().max(2048).refine((value) => {
    try {
      const url = new URL(value)
      return url.protocol === 'https:' || url.protocol === 'http:'
    } catch {
      return false
    }
  }, 'Use a valid http(s) URL.'),
]))

const lessonSchema = z.object({
  title: z.string().trim().min(1, 'Lesson title is required.').max(180),
  lessonType: lessonTypeSchema,
  summary: nullableText(2000),
  articleBody: nullableText(100000),
  assetPath: z.union([
    z.null(),
    z.string().transform((value) => value.trim() || null),
  ]).pipe(z.union([z.null(), z.string().min(1).max(1024)])),
  externalUrl: nullableUrl,
  durationSeconds: z.union([z.null(), z.number().int().nonnegative()]),
  isPreview: z.boolean(),
  isDownloadable: z.boolean(),
}).superRefine((lesson, context) => {
  if (lesson.lessonType === 'article' && !lesson.articleBody) {
    context.addIssue({ code: 'custom', path: ['articleBody'], message: 'Article lessons require article content.' })
  }
  const sourceLabels: Partial<Record<MentorLessonDraft['lessonType'], string>> = {
    video: 'Video', audio: 'Audio', pdf: 'PDF', presentation_document: 'Presentation/document', downloadable_resource: 'Downloadable resource',
  }
  const sourceLabel = sourceLabels[lesson.lessonType]
  if (sourceLabel && !lesson.assetPath && !lesson.externalUrl) {
    context.addIssue({ code: 'custom', path: ['assetPath'], message: `${sourceLabel} lessons require an uploaded asset or external URL.` })
  }
  if (lesson.lessonType === 'live_session' && !lesson.externalUrl) {
    context.addIssue({ code: 'custom', path: ['externalUrl'], message: 'Live session lessons require an external meeting URL.' })
  }
})

const quizSchema = z.object({
  passPercentage: z.number().int().min(1).max(100),
  instructions: nullableText(4000),
  questions: z.array(z.object({
    prompt: z.string().trim().min(1, 'Quiz question prompt is required.').max(4000),
    options: z.array(z.object({
      label: z.string().trim().min(1, 'Quiz answer text is required.').max(2000),
      isCorrect: z.boolean(),
    })).min(2, 'Each quiz question needs at least two answer options.').max(20),
  })).min(1, 'Add at least one quiz question.').max(100),
}).superRefine((quiz, context) => {
  for (const [questionIndex, question] of quiz.questions.entries()) {
    const correctCount = question.options.filter((option) => option.isCorrect).length
    if (correctCount !== 1) {
      context.addIssue({ code: 'custom', path: ['questions', questionIndex, 'options'], message: 'Each quiz question must have exactly one correct answer.' })
    }
  }
})

const sectionTitleSchema = z.string().trim().min(1, 'Section title is required.').max(180)

type ActionResult = { ok: true } | { ok: false; error: string }
type CreateSectionResult = { ok: true; sectionId: string } | { ok: false; error: string }
type CreateLessonResult = { ok: true; lessonId: string } | { ok: false; error: string }

function validationError(error: z.ZodError) {
  return error.issues[0]?.message ?? 'Review the curriculum details and try again.'
}

function mutationError(error: unknown) {
  if (error instanceof Error) {
    if (error.message === 'course_not_found') return 'We could not find this course in your Mentor Studio.'
    if (error.message === 'course_edit_forbidden') return 'This curriculum is frozen while the course is in review or published.'
    if (error.message === 'section_not_found') return 'We could not find this section in the course.'
    if (error.message === 'lesson_not_found') return 'We could not find this lesson in the course.'
    if (error.message === 'lesson_not_quiz') return 'This lesson is not configured as a quiz.'
  }
  return 'We could not save the curriculum. Please try again.'
}

function refreshCurriculum(courseId: string) {
  revalidatePath(`/learn/studio/courses/${courseId}/edit`)
  revalidatePath('/learn/studio')
}

function parseCourseId(courseId: string): { ok: true; id: string } | { ok: false; error: string } {
  const parsed = uuidSchema.safeParse(courseId)
  return parsed.success ? { ok: true, id: parsed.data } : { ok: false, error: 'Invalid course.' }
}
function parseSectionId(sectionId: string): { ok: true; id: string } | { ok: false; error: string } {
  const parsed = uuidSchema.safeParse(sectionId)
  return parsed.success ? { ok: true, id: parsed.data } : { ok: false, error: 'Invalid section.' }
}
function parseLessonId(lessonId: string): { ok: true; id: string } | { ok: false; error: string } {
  const parsed = uuidSchema.safeParse(lessonId)
  return parsed.success ? { ok: true, id: parsed.data } : { ok: false, error: 'Invalid lesson.' }
}

async function verifyVideoUpload(userId: string, courseId: string, lesson: MentorLessonDraft): Promise<ActionResult> {
  if (lesson.lessonType !== 'video' || !lesson.assetPath) return { ok: true }
  try {
    await verifyLearningMediaObject({ userId, courseId, kind: 'lesson_video', storagePath: lesson.assetPath })
    return { ok: true }
  } catch {
    return { ok: false, error: 'We could not verify the uploaded lesson video. Please upload it again.' }
  }
}

export async function createCurriculumSection(courseId: string, title: string): Promise<CreateSectionResult> {
  const parsedCourse = parseCourseId(courseId)
  if (!parsedCourse.ok) return parsedCourse
  const parsedTitle = sectionTitleSchema.safeParse(title)
  if (!parsedTitle.success) return { ok: false, error: validationError(parsedTitle.error) }
  try {
    const user = await requireAwsUser()
    const result = await mentorCurriculumRepository.createSection(user.id, parsedCourse.id, parsedTitle.data)
    refreshCurriculum(parsedCourse.id)
    return { ok: true, sectionId: result.sectionId }
  } catch (error) {
    return { ok: false, error: mutationError(error) }
  }
}

export async function updateCurriculumSection(courseId: string, sectionId: string, title: string): Promise<ActionResult> {
  const parsedCourse = parseCourseId(courseId)
  if (!parsedCourse.ok) return parsedCourse
  const parsedSection = parseSectionId(sectionId)
  if (!parsedSection.ok) return parsedSection
  const parsedTitle = sectionTitleSchema.safeParse(title)
  if (!parsedTitle.success) return { ok: false, error: validationError(parsedTitle.error) }
  try {
    const user = await requireAwsUser()
    await mentorCurriculumRepository.updateSection(user.id, parsedCourse.id, parsedSection.id, parsedTitle.data)
    refreshCurriculum(parsedCourse.id)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: mutationError(error) }
  }
}

export async function deleteCurriculumSection(courseId: string, sectionId: string): Promise<ActionResult> {
  const parsedCourse = parseCourseId(courseId)
  if (!parsedCourse.ok) return parsedCourse
  const parsedSection = parseSectionId(sectionId)
  if (!parsedSection.ok) return parsedSection
  try {
    const user = await requireAwsUser()
    await mentorCurriculumRepository.deleteSection(user.id, parsedCourse.id, parsedSection.id)
    refreshCurriculum(parsedCourse.id)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: mutationError(error) }
  }
}

export async function moveCurriculumSection(courseId: string, sectionId: string, direction: 'up' | 'down'): Promise<ActionResult> {
  const parsedCourse = parseCourseId(courseId)
  if (!parsedCourse.ok) return parsedCourse
  const parsedSection = parseSectionId(sectionId)
  if (!parsedSection.ok) return parsedSection
  const parsedDirection = directionSchema.safeParse(direction)
  if (!parsedDirection.success) return { ok: false, error: 'Invalid move direction.' }
  try {
    const user = await requireAwsUser()
    await mentorCurriculumRepository.moveSection(user.id, parsedCourse.id, parsedSection.id, parsedDirection.data)
    refreshCurriculum(parsedCourse.id)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: mutationError(error) }
  }
}

export async function createCurriculumLesson(courseId: string, sectionId: string, input: MentorLessonDraft): Promise<CreateLessonResult> {
  const parsedCourse = parseCourseId(courseId)
  if (!parsedCourse.ok) return parsedCourse
  const parsedSection = parseSectionId(sectionId)
  if (!parsedSection.ok) return parsedSection
  const parsedLesson = lessonSchema.safeParse(input)
  if (!parsedLesson.success) return { ok: false, error: validationError(parsedLesson.error) }
  try {
    const user = await requireAwsUser()
    const media = await verifyVideoUpload(user.id, parsedCourse.id, parsedLesson.data)
    if (!media.ok) return media
    const result = await mentorCurriculumRepository.createLesson(user.id, parsedCourse.id, parsedSection.id, parsedLesson.data)
    refreshCurriculum(parsedCourse.id)
    return { ok: true, lessonId: result.lessonId }
  } catch (error) {
    return { ok: false, error: mutationError(error) }
  }
}

export async function updateCurriculumLesson(courseId: string, lessonId: string, input: MentorLessonDraft): Promise<ActionResult> {
  const parsedCourse = parseCourseId(courseId)
  if (!parsedCourse.ok) return parsedCourse
  const parsedLessonId = parseLessonId(lessonId)
  if (!parsedLessonId.ok) return parsedLessonId
  const parsedLesson = lessonSchema.safeParse(input)
  if (!parsedLesson.success) return { ok: false, error: validationError(parsedLesson.error) }
  try {
    const user = await requireAwsUser()
    const media = await verifyVideoUpload(user.id, parsedCourse.id, parsedLesson.data)
    if (!media.ok) return media
    await mentorCurriculumRepository.updateLesson(user.id, parsedCourse.id, parsedLessonId.id, parsedLesson.data)
    refreshCurriculum(parsedCourse.id)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: mutationError(error) }
  }
}

export async function deleteCurriculumLesson(courseId: string, lessonId: string): Promise<ActionResult> {
  const parsedCourse = parseCourseId(courseId)
  if (!parsedCourse.ok) return parsedCourse
  const parsedLesson = parseLessonId(lessonId)
  if (!parsedLesson.ok) return parsedLesson
  try {
    const user = await requireAwsUser()
    await mentorCurriculumRepository.deleteLesson(user.id, parsedCourse.id, parsedLesson.id)
    refreshCurriculum(parsedCourse.id)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: mutationError(error) }
  }
}

export async function moveCurriculumLesson(courseId: string, lessonId: string, direction: 'up' | 'down'): Promise<ActionResult> {
  const parsedCourse = parseCourseId(courseId)
  if (!parsedCourse.ok) return parsedCourse
  const parsedLesson = parseLessonId(lessonId)
  if (!parsedLesson.ok) return parsedLesson
  const parsedDirection = directionSchema.safeParse(direction)
  if (!parsedDirection.success) return { ok: false, error: 'Invalid move direction.' }
  try {
    const user = await requireAwsUser()
    await mentorCurriculumRepository.moveLesson(user.id, parsedCourse.id, parsedLesson.id, parsedDirection.data)
    refreshCurriculum(parsedCourse.id)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: mutationError(error) }
  }
}

export async function saveCurriculumQuiz(courseId: string, lessonId: string, input: MentorQuizDefinitionInput): Promise<ActionResult> {
  const parsedCourse = parseCourseId(courseId)
  if (!parsedCourse.ok) return parsedCourse
  const parsedLesson = parseLessonId(lessonId)
  if (!parsedLesson.ok) return parsedLesson
  const parsedQuiz = quizSchema.safeParse(input)
  if (!parsedQuiz.success) return { ok: false, error: validationError(parsedQuiz.error) }
  try {
    const user = await requireAwsUser()
    await mentorCurriculumRepository.saveQuizDefinition(user.id, parsedCourse.id, parsedLesson.id, parsedQuiz.data)
    refreshCurriculum(parsedCourse.id)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: mutationError(error) }
  }
}
