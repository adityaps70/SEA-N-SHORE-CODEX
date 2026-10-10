'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { requireCapability } from '@/features/access/server'
import { PAYMENT_CURRENCIES } from '@/features/payments/types'
import {
  CourseEditConflictError,
  CourseEditLockedError,
  CourseSubmissionReadinessError,
  courseRepository,
  type CourseCreateInput,
  type CourseDraftInput,
} from './course-repository'
import { CourseRevisionError, courseRevisionRepository } from './course-revision-repository'
import { courseEditLockedCopy } from './course-workflow'
import { verifyLearningMediaObject } from './media'
import { learningMediaRepository } from './media-repository'
import { firstPlainIssue } from '@/lib/validation/plain-messages'

const courseIdSchema = z.string().uuid()
const revisionSchema = z.number().int().min(1).nullable()
const coursePublisherSchema = z.discriminatedUnion('publisherType', [
  z.object({ publisherType: z.literal('personal'), companyId: z.null() }),
  z.object({ publisherType: z.literal('organization'), companyId: z.string().uuid() }),
])
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

function normalizedList(maxItems: number, label: string) {
  return z.array(z.string(), { error: `${label}: add one item per line.` }).max(maxItems * 2, `${label}: use no more than ${maxItems} items.`).transform((values, context) => {
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
      context.addIssue({ code: 'custom', message: `${label}: use no more than ${maxItems} items.` })
      return z.NEVER
    }
    return normalized
  })
}

const nullableShortText = z.union([
  z.null(),
  z.string().trim().transform((value) => value || null),
]).pipe(z.union([
  z.null(),
  z.string()
    .min(4, 'Subtitle needs at least 4 characters, or leave it empty.')
    .max(240, 'Subtitle can be at most 240 characters.'),
]))

const nullableAssetPath = z.union([
  z.null(),
  z.string().trim().transform((value) => value || null),
]).pipe(z.union([z.null(), z.string().min(1).max(1024, 'The uploaded file path is too long. Upload the file again.')]))

const courseDraftSchema = z.object({
  slug: z.string()
    .transform((value) => value.trim().toLowerCase())
    .pipe(z.string()
      .min(1, 'Add a course URL slug, for example “sire-2-readiness”.')
      .max(120, 'Course URL slug can be at most 120 characters.')
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Course URL slug can only use lowercase letters, numbers and single hyphens, for example “sire-2-readiness”.')),
  title: z.string().trim()
    .min(4, 'Course title needs at least 4 characters.')
    .max(180, 'Course title can be at most 180 characters.'),
  subtitle: nullableShortText,
  description: z.string().trim()
    .min(40, 'Course description needs at least 40 characters so learners understand what the course covers.')
    .max(12000, 'Course description can be at most 12,000 characters.'),
  category: z.string().trim().min(2, 'Choose a category.').max(120).refine((value) => courseCategories.has(value), 'Choose a supported maritime learning category.'),
  level: z.enum(['beginner', 'intermediate', 'advanced', 'all_levels'], 'Choose a course level.'),
  language: z.string().trim()
    .min(2, 'Language needs at least 2 characters, for example “English”.')
    .max(80, 'Language can be at most 80 characters.'),
  thumbnailPath: nullableAssetPath,
  trailerPath: nullableAssetPath,
  learningOutcomes: normalizedList(30, 'Learning outcomes'),
  requirements: normalizedList(30, 'Requirements'),
  targetAudience: normalizedList(30, 'Target audience'),
  accessType: z.enum(['free', 'paid'], 'Choose free or paid access.'),
  priceMinor: z.number('Enter the course price as a number.').int('Enter the course price in rupees and paise only.').nonnegative('Course price cannot be negative.'),
  discountPriceMinor: z.number('Enter the discount price as a number.').int('Enter the discount price in rupees and paise only.').nonnegative('Discount price cannot be negative.').nullable(),
  currency: z.string().trim().transform((value) => value.toUpperCase()).pipe(z.enum(PAYMENT_CURRENCIES, { message: 'Choose INR or USD.' })),
  certificateEnabled: z.boolean(),
  courseFormat: z.enum(['recorded', 'live_cohort', 'hybrid'], 'Choose a course format.'),
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
export type CourseSaveActionResult =
  | { ok: true; revision: number; savedAt: string; course: CourseDraftInput }
  | { ok: false; error: string }
export type CourseSubmitActionResult = CourseActionResult

function validationError(error: z.ZodError) {
  return firstPlainIssue(error, 'Review the course details and try again.')
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
  const materialTitle = detailText(error, 'materialTitle') || detailText(error, 'lessonTitle')
  const materialType = detailText(error, 'materialType') || detailText(error, 'lessonType')
  const sectionTitle = detailText(error, 'sectionTitle')
  const questionNumber = detailNumber(error, 'questionNumber')

  if (error.code === 'course_curriculum_empty') return 'Add at least one curriculum section before submitting for review.'
  if (error.code === 'course_section_empty') return `Section “${sectionTitle}” needs at least one published material.`
  if (error.code === 'course_lesson_content_missing') {
    if (materialType === 'article') return `Material “${materialTitle}” is missing required article content.`
    return `Material “${materialTitle}” needs its required content or uploaded file.`
  }
  if (error.code === 'course_material_content_missing') {
    if (materialType === 'article') return `Material “${materialTitle}” is missing required article content.`
    if (materialType === 'external_embed') return `Material “${materialTitle}” needs an embeddable URL.`
    return `Material “${materialTitle}” needs its required content or uploaded file.`
  }
  if (error.code === 'course_material_release_invalid') return `Material “${materialTitle}” has an invalid release schedule.`
  if (error.code === 'course_material_prerequisite_invalid') return `Material “${materialTitle}” must depend on another published material in this course.`
  if (error.code === 'course_material_completion_invalid') return `Material “${materialTitle}” has a completion rule that does not match its material type.`
  if (error.code === 'course_assignment_missing') return `Assignment “${materialTitle}” needs instructions before submission.`
  if (error.code === 'course_scorm_not_ready') return `SCORM material “${materialTitle}” must finish processing successfully before submission.`
  if (error.code === 'course_activity_not_supported') {
    if (materialType === 'live_session') return `Material “${materialTitle}” uses live session, which cannot be published until native attendance completion is connected.`
    return `Material “${materialTitle}” uses ${materialType.replaceAll('_', ' ')}, which cannot be published until its native learner completion flow is connected.`
  }
  if (error.code === 'course_quiz_missing') return `Quiz “${materialTitle}” needs an assessment definition before submission.`
  if (error.code === 'course_quiz_pass_invalid') return `Quiz “${materialTitle}” needs a pass percentage from 1 to 100.`
  if (error.code === 'course_quiz_questions_missing') return `Quiz “${materialTitle}” needs at least one question.`
  if (error.code === 'course_quiz_options_invalid') return `Question ${questionNumber} in quiz “${materialTitle}” needs at least two answer options.`
  if (error.code === 'course_quiz_correct_answer_invalid') return `Question ${questionNumber} in quiz “${materialTitle}” must have exactly one correct answer.`
  if (error.code === 'course_quiz_correct_answers_missing') return `Question ${questionNumber} in quiz “${materialTitle}” needs at least one correct answer.`
  if (error.code === 'course_quiz_accepted_answers_missing') return `Question ${questionNumber} in quiz “${materialTitle}” needs at least one accepted answer.`
  if (error.code === 'course_quiz_draw_too_large') return `Quiz “${materialTitle}” draws more questions than it has.`
  return 'Review the published curriculum materials and try again.'
}

function mutationError(error: unknown, context: 'save' | 'submit' | 'withdraw' = 'save') {
  if (error instanceof CourseSubmissionReadinessError) return readinessErrorCopy(error)
  if (error instanceof CourseEditLockedError) return courseEditLockedCopy(error.status)
  if (error instanceof CourseEditConflictError) {
    return context === 'submit'
      ? 'The course details changed after your last save (in another tab or by another manager), so it was not submitted. Reload the page, check the details, and submit again.'
      : 'Someone saved newer changes to this course (in another tab or another manager) after you opened it, so your changes were not saved. Copy anything you need, reload the page, and apply your changes again.'
  }
  if (error instanceof Error) {
    if (error.message === 'mentor_required') return 'Approved mentor access is required to manage personal courses.'
    if (error.message === 'course_forbidden') return 'Approved Owner, Administrator or LMS Manager access is required to manage courses for this organization.'
    if (error.message === 'capability_required') return 'Creator Pro or Organization Pro with verified course publishing access is required to submit courses for publication.'
    if (error.message === 'course_not_found') return 'We could not find this course in your Mentor Studio.'
    if (error.message === 'course_edit_forbidden') return courseEditLockedCopy(null)
    if (error.message === 'course_submit_forbidden') return 'This course is already in review or published, so it can’t be submitted again. Reload the page to see its current status.'
    if (error.message === 'course_withdraw_forbidden') return 'This course is no longer waiting for review, so there is nothing to withdraw. Reload the page to see its current status.'
  }
  if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') return 'A course with this URL slug already exists. Choose a different slug.'
  if (context === 'submit') return 'We could not submit the course for review. Your saved changes are safe. Please try again.'
  if (context === 'withdraw') return 'We could not withdraw the course from review. Please try again.'
  return 'We could not save the course. Your changes are still on this page. Please try again.'
}

function refreshStudio() {
  revalidatePath('/learn/studio')
  revalidatePath('/learn/studio/courses')
}

function refreshReviewQueues(courseId: string) {
  refreshStudio()
  revalidatePath(`/learn/studio/courses/${courseId}/edit`)
  revalidatePath('/admin/learning/courses')
}

export async function createCourseDraft(input: CourseDraftInput | CourseCreateInput): Promise<CourseCreateActionResult> {
  const parsed = courseDraftSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: validationError(parsed.error) }
  if (parsed.data.thumbnailPath || parsed.data.trailerPath) {
    return { ok: false, error: 'Create the draft course first, then add its thumbnail and trailer.' }
  }

  try {
    const user = await requireAwsUser()
    const publisher = 'publisherType' in input
      ? coursePublisherSchema.safeParse({ publisherType: input.publisherType, companyId: input.companyId })
      : null
    if (publisher && !publisher.success) return { ok: false, error: 'Choose a valid course publishing identity.' }

    const result = await courseRepository.createCourse(
      user.id,
      publisher?.success ? { ...parsed.data, ...publisher.data } : parsed.data,
    )
    refreshStudio()
    return { ok: true, courseId: result.courseId }
  } catch (error) {
    return { ok: false, error: mutationError(error) }
  }
}

/**
 * Saves the course details. `expectedRevision` is the revision the form was
 * loaded or last saved with; a save based on an older revision is refused so it
 * can't overwrite newer work. Returns the stored (normalized) values so the
 * form shows exactly what was saved.
 */
export async function updateCourseDraft(
  courseId: string,
  input: CourseDraftInput,
  expectedRevision: number | null = null,
): Promise<CourseSaveActionResult> {
  const parsedId = courseIdSchema.safeParse(courseId)
  if (!parsedId.success) return { ok: false, error: 'Invalid course.' }
  const parsed = courseDraftSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: validationError(parsed.error) }
  const parsedRevision = revisionSchema.safeParse(expectedRevision)
  if (!parsedRevision.success) return { ok: false, error: 'Reload the page and try saving again.' }

  try {
    const user = await requireAwsUser()
    if (parsed.data.thumbnailPath) {
      try {
        await verifyLearningMediaObject({
          userId: user.id,
          courseId: parsedId.data,
          kind: 'course_thumbnail',
          storagePath: parsed.data.thumbnailPath,
          alreadyAttached: await learningMediaRepository.isMediaReferenced(user.id, parsedId.data, parsed.data.thumbnailPath),
        })
      } catch {
        return { ok: false, error: 'We could not verify the uploaded course thumbnail. Please upload it again.' }
      }
    }
    if (parsed.data.trailerPath) {
      try {
        await verifyLearningMediaObject({
          userId: user.id,
          courseId: parsedId.data,
          kind: 'course_trailer',
          storagePath: parsed.data.trailerPath,
          alreadyAttached: await learningMediaRepository.isMediaReferenced(user.id, parsedId.data, parsed.data.trailerPath),
        })
      } catch {
        return { ok: false, error: 'We could not verify the uploaded course trailer. Please upload it again.' }
      }
    }
    const saved = await courseRepository.updateCourse(user.id, parsedId.data, parsed.data, { expectedRevision: parsedRevision.data })
    refreshStudio()
    return { ok: true, revision: saved.revision, savedAt: saved.updatedAt, course: parsed.data }
  } catch (error) {
    return { ok: false, error: mutationError(error) }
  }
}

/**
 * Sends the course for review. The Studio saves every unsaved change first and
 * passes the revision it just saved, so the review always sees the latest edits.
 */
export async function submitCourseForReview(
  courseId: string,
  expectedRevision: number | null = null,
): Promise<CourseSubmitActionResult> {
  const parsedId = courseIdSchema.safeParse(courseId)
  if (!parsedId.success) return { ok: false, error: 'Invalid course.' }
  const parsedRevision = revisionSchema.safeParse(expectedRevision)
  if (!parsedRevision.success) return { ok: false, error: 'Reload the page and submit again.' }

  try {
    const user = await requireAwsUser()
    const publisher = await courseRepository.getManagedCoursePublisher(user.id, parsedId.data)
    if (!publisher) throw new Error('course_not_found')
    if (publisher.companyId) {
      await requireCapability(user.id, 'course.publish', { companyId: publisher.companyId })
    } else {
      await requireCapability(user.id, 'course.publish')
    }
    await courseRepository.submitCourse(user.id, parsedId.data, { expectedRevision: parsedRevision.data })
    refreshReviewQueues(parsedId.data)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: mutationError(error, 'submit') }
  }
}

/** Takes a course out of review so it can be edited again. Nothing is discarded. */
export async function withdrawCourseFromReview(courseId: string): Promise<CourseActionResult> {
  const parsedId = courseIdSchema.safeParse(courseId)
  if (!parsedId.success) return { ok: false, error: 'Invalid course.' }

  try {
    const user = await requireAwsUser()
    await courseRepository.withdrawCourse(user.id, parsedId.data)
    refreshReviewQueues(parsedId.data)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: mutationError(error, 'withdraw') }
  }
}

type CourseRevisionActionResult =
  | { ok: true; revisionCourseId: string }
  | { ok: false; error: string }

type CourseDiscardActionResult =
  | { ok: true; liveCourseId: string }
  | { ok: false; error: string }

function revisionError(error: unknown) {
  if (error instanceof CourseRevisionError) {
    if (error.message === 'course_not_found') return 'We could not find this course in your Learning Studio.'
    if (error.message === 'course_revision_not_published') return 'Only a published course is edited through a draft copy. Edit this course directly.'
    if (error.message === 'course_revision_of_revision') return 'This is already the draft copy of a published course.'
    if (error.message === 'course_revision_not_found') return 'We could not find this draft copy.'
    if (error.message === 'course_revision_closed') return 'These changes were already applied or discarded. Reload the page to see the current course.'
    if (error.message === 'course_revision_in_review') return 'Withdraw these changes from review before discarding them.'
  }
  return 'We could not open the course for editing. Please try again.'
}

/**
 * Opens a draft copy of a published course for editing (or the one already open). Learners keep
 * using the live course until the changes are approved.
 */
export async function startCourseRevision(courseId: string): Promise<CourseRevisionActionResult> {
  const parsedId = courseIdSchema.safeParse(courseId)
  if (!parsedId.success) return { ok: false, error: 'Invalid course.' }
  try {
    const user = await requireAwsUser()
    const result = await courseRevisionRepository.startRevision(user.id, parsedId.data)
    refreshReviewQueues(parsedId.data)
    return { ok: true, revisionCourseId: result.revisionCourseId }
  } catch (error) {
    return { ok: false, error: revisionError(error) }
  }
}

/** Throws away the draft copy of a published course. The live course is not changed. */
export async function discardCourseRevision(revisionCourseId: string): Promise<CourseDiscardActionResult> {
  const parsedId = courseIdSchema.safeParse(revisionCourseId)
  if (!parsedId.success) return { ok: false, error: 'Invalid course.' }
  try {
    const user = await requireAwsUser()
    const result = await courseRevisionRepository.discardRevision(user.id, parsedId.data)
    refreshReviewQueues(result.liveCourseId)
    revalidatePath(`/learn/studio/courses/${parsedId.data}/edit`)
    return { ok: true, liveCourseId: result.liveCourseId }
  } catch (error) {
    return { ok: false, error: revisionError(error) }
  }
}
