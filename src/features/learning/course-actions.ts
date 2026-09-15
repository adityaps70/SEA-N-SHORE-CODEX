'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAwsUser } from '@/features/auth/aws-queries'
import {
  CourseSubmissionReadinessError,
  courseRepository,
  type CourseDraftInput,
} from './course-repository'
import { verifyLearningMediaObject } from './media'

const courseIdSchema = z.string().uuid()
const courseCategories = new Set([
  'Deck',
  'Engine',
  'Tankers',
  'LNG/LPG',
  'Offshore',
  'SIRE 2.0',
  'Safety',
  'Maritime Law',
  'Leadership',
  'Human Factors',
  'Shore Careers',
  'Mental Health',
  'Exams & Assessments',
])

function normalizedList(maxItems: number) {
  return z.array(z.string()).max(maxItems * 2).transform((values, context) => {
    const seen = new Set<string>()
    const normalized: string[] = []
    for (const value of values) {
      const item = value.trim()
      if (!item) continue
      const key = item.toLocaleLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      normalized.push(item)
    }
    if (normalized.length > maxItems) {
      context.addIssue({ code: 'custom', message: `Use no more than ${maxItems} items.` })
      return z.NEVER
    }
    return normalized
  })
}

const nullableShortText = z.union([
  z.null(),
  z.string().trim().transform((value) => value || null),
]).pipe(z.union([z.null(), z.string().min(4).max(240)]))

const nullableAssetPath = z.union([
  z.null(),
  z.string().trim().transform((value) => value || null),
]).pipe(z.union([z.null(), z.string().min(1).max(1024)]))

const courseDraftSchema = z.object({
  slug: z.string()
    .transform((value) => value.trim().toLowerCase())
    .pipe(z.string().min(1).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use a URL-safe course slug.')),
  title: z.string().trim().min(4).max(180),
  subtitle: nullableShortText,
  description: z.string().trim().min(40).max(12000),
  category: z.string().trim().min(2).max(120).refine((value) => courseCategories.has(value), 'Choose a supported maritime learning category.'),
  level: z.enum(['beginner', 'intermediate', 'advanced', 'all_levels']),
  language: z.string().trim().min(2).max(80),
  thumbnailPath: nullableAssetPath,
  trailerPath: nullableAssetPath,
  learningOutcomes: normalizedList(30),
  requirements: normalizedList(30),
  targetAudience: normalizedList(30),
  accessType: z.enum(['free', 'paid']),
  priceMinor: z.number().int().nonnegative(),
  discountPriceMinor: z.number().int().nonnegative().nullable(),
  currency: z.string().trim().transform((value) => value.toUpperCase()).pipe(z.string().regex(/^[A-Z]{3}$/, 'Use a three-letter currency code.')),
  certificateEnabled: z.boolean(),
  courseFormat: z.enum(['recorded', 'live_cohort', 'hybrid']),
}).superRefine((course, context) => {
  if (course.accessType === 'free' && course.priceMinor !== 0) {
    context.addIssue({ code: 'custom', path: ['priceMinor'], message: 'Free courses must have a zero price.' })
  }
  if (course.accessType === 'paid' && course.priceMinor <= 0) {
    context.addIssue({ code: 'custom', path: ['priceMinor'], message: 'Paid courses must have a positive price.' })
  }
  if (course.discountPriceMinor !== null && course.discountPriceMinor > course.priceMinor) {
    context.addIssue({ code: 'custom', path: ['discountPriceMinor'], message: 'Discount price cannot exceed the course price.' })
  }
})

type CourseActionResult = { ok: true } | { ok: false; error: string }
type CourseCreateActionResult = { ok: true; courseId: string } | { ok: false; error: string }

function validationError(error: z.ZodError) {
  return error.issues[0]?.message ?? 'Review the course details and try again.'
}

function detailText(error: CourseSubmissionReadinessError, key: string) {
  const value = error.details[key]
  return typeof value === 'string' ? value : ''
}

function detailNumber(error: CourseSubmissionReadinessError, key: string) {
  const value = error.details[key]
  return typeof value === 'number' ? value : 0
}

function readinessErrorCopy(error: CourseSubmissionReadinessError) {
  const lessonTitle = detailText(error, 'lessonTitle')
  const lessonType = detailText(error, 'lessonType')
  const sectionTitle = detailText(error, 'sectionTitle')
  const questionNumber = detailNumber(error, 'questionNumber')

  if (error.code === 'course_curriculum_empty') return 'Add at least one curriculum section before submitting for review.'
  if (error.code === 'course_section_empty') return `Section “${sectionTitle}” needs at least one lesson.`
  if (error.code === 'course_lesson_content_missing') {
    if (lessonType === 'article') return `Lesson “${lessonTitle}” is missing required article content.`
    return `Lesson “${lessonTitle}” needs an uploaded asset or external URL.`
  }
  if (error.code === 'course_activity_not_supported') return `Lesson “${lessonTitle}” uses ${lessonType.replaceAll('_', ' ')}, which cannot be published until its native learner completion flow is connected.`
  if (error.code === 'course_quiz_missing') return `Quiz “${lessonTitle}” needs an assessment definition before submission.`
  if (error.code === 'course_quiz_pass_invalid') return `Quiz “${lessonTitle}” needs a pass percentage from 1 to 100.`
  if (error.code === 'course_quiz_questions_missing') return `Quiz “${lessonTitle}” needs at least one question.`
  if (error.code === 'course_quiz_options_invalid') return `Question ${questionNumber} in quiz “${lessonTitle}” needs at least two answer options.`
  return `Question ${questionNumber} in quiz “${lessonTitle}” must have exactly one correct answer.`
}

function mutationError(error: unknown) {
  if (error instanceof CourseSubmissionReadinessError) return readinessErrorCopy(error)
  if (error instanceof Error) {
    if (error.message === 'mentor_required') return 'Approved mentor access is required to manage courses.'
    if (error.message === 'course_not_found') return 'We could not find this course in your Mentor Studio.'
    if (error.message === 'course_edit_forbidden') return 'This course cannot be edited while it is in review or published.'
    if (error.message === 'course_submit_forbidden') return 'This course cannot be submitted for review in its current state.'
  }
  if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') return 'A course with this URL slug already exists.'
  return 'We could not save the course. Please try again.'
}

function refreshStudio() {
  revalidatePath('/learn/studio')
  revalidatePath('/learn/studio/courses')
}

export async function createCourseDraft(input: CourseDraftInput): Promise<CourseCreateActionResult> {
  const parsed = courseDraftSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: validationError(parsed.error) }
  if (parsed.data.thumbnailPath || parsed.data.trailerPath) {
    return { ok: false, error: 'Create the draft course first, then add its thumbnail and trailer.' }
  }

  try {
    const user = await requireAwsUser()
    const result = await courseRepository.createCourse(user.id, parsed.data)
    refreshStudio()
    return { ok: true, courseId: result.courseId }
  } catch (error) {
    return { ok: false, error: mutationError(error) }
  }
}

export async function updateCourseDraft(courseId: string, input: CourseDraftInput): Promise<CourseActionResult> {
  const parsedId = courseIdSchema.safeParse(courseId)
  if (!parsedId.success) return { ok: false, error: 'Invalid course.' }
  const parsed = courseDraftSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: validationError(parsed.error) }

  try {
    const user = await requireAwsUser()
    if (parsed.data.thumbnailPath) {
      try {
        await verifyLearningMediaObject({ userId: user.id, courseId: parsedId.data, kind: 'course_thumbnail', storagePath: parsed.data.thumbnailPath })
      } catch {
        return { ok: false, error: 'We could not verify the uploaded course thumbnail. Please upload it again.' }
      }
    }
    if (parsed.data.trailerPath) {
      try {
        await verifyLearningMediaObject({ userId: user.id, courseId: parsedId.data, kind: 'course_trailer', storagePath: parsed.data.trailerPath })
      } catch {
        return { ok: false, error: 'We could not verify the uploaded course trailer. Please upload it again.' }
      }
    }
    await courseRepository.updateCourse(user.id, parsedId.data, parsed.data)
    refreshStudio()
    return { ok: true }
  } catch (error) {
    return { ok: false, error: mutationError(error) }
  }
}

export async function submitCourseForReview(courseId: string): Promise<CourseActionResult> {
  const parsedId = courseIdSchema.safeParse(courseId)
  if (!parsedId.success) return { ok: false, error: 'Invalid course.' }

  try {
    const user = await requireAwsUser()
    await courseRepository.submitCourse(user.id, parsedId.data)
    refreshStudio()
    revalidatePath(`/learn/studio/courses/${parsedId.data}/edit`)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: mutationError(error) }
  }
}
