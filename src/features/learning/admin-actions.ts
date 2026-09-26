'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAwsUser } from '@/features/auth/aws-queries'
import {
  learningAdminRepository,
  type CourseAdminDecision,
  type MentorReviewDecision,
} from './admin-repository'

const mentorReviewSchema = z.object({
  applicationId: z.string().uuid(),
  decision: z.enum(['approved', 'changes_requested', 'rejected']),
  reviewerNote: z.preprocess(
    (value) => {
      if (typeof value !== 'string') return null
      const normalized = value.trim()
      return normalized || null
    },
    z.string().max(4000).nullable(),
  ),
}).superRefine((value, context) => {
  if (value.decision !== 'approved' && !value.reviewerNote) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['reviewerNote'],
      message: 'A reviewer note is required for this decision.',
    })
  }
})

const courseReviewSchema = z.object({
  courseId: z.string().uuid(),
  decision: z.enum(['changes_requested', 'approved', 'published', 'archived']),
  reviewerNote: z.preprocess(
    (value) => {
      if (typeof value !== 'string') return null
      const normalized = value.trim()
      return normalized || null
    },
    z.string().max(4000).nullable(),
  ),
}).superRefine((value, context) => {
  if (value.decision === 'changes_requested' && !value.reviewerNote) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['reviewerNote'],
      message: 'A reviewer note is required when requesting course changes.',
    })
  }
})

export type MentorReviewActionResult =
  | { ok: true; status: MentorReviewDecision; mentorId: string | null }
  | { ok: false; error: string }

export type CourseReviewActionResult =
  | { ok: true; status: CourseAdminDecision }
  | { ok: false; error: string }

function reviewError(error: unknown) {
  const code = error instanceof Error ? error.message : ''
  if (code === 'admin_forbidden') return 'You are not authorized to review trainer verification applications.'
  if (code === 'mentor_application_transition_forbidden') return 'This trainer verification application cannot move to that review state.'
  if (code === 'mentor_application_not_found') return 'This trainer verification application could not be found.'
  return 'The trainer verification application review could not be saved. Please try again.'
}

function courseReviewError(error: unknown) {
  const code = error instanceof Error ? error.message : ''
  if (code === 'admin_forbidden') return 'You are not authorized to review learning courses.'
  if (code === 'course_not_found') return 'This learning course could not be found.'
  if (code === 'course_transition_forbidden') return 'This course cannot move to that review state.'
  if (code === 'course_review_note_required') return 'A reviewer note is required when requesting course changes.'
  return 'The learning course review could not be saved. Please try again.'
}

function refreshMentorReview() {
  revalidatePath('/admin')
  revalidatePath('/admin/learning')
  revalidatePath('/learn')
  revalidatePath('/learn/teach')
}

function refreshCourseReview(courseId: string) {
  revalidatePath('/admin')
  revalidatePath('/admin/learning')
  revalidatePath('/admin/learning/courses')
  revalidatePath('/learn')
  revalidatePath('/learn/studio')
  revalidatePath('/learn/studio/courses')
  revalidatePath(`/learn/studio/courses/${courseId}/edit`)
}

export async function reviewMentorApplication(
  applicationId: string,
  decision: MentorReviewDecision,
  reviewerNote: string | null,
): Promise<MentorReviewActionResult> {
  const parsed = mentorReviewSchema.safeParse({ applicationId, decision, reviewerNote })
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid trainer verification review request.' }
  }

  const user = await requireAwsUser()

  try {
    const result = await learningAdminRepository.reviewMentorApplication(
      user.id,
      parsed.data.applicationId,
      parsed.data.decision,
      parsed.data.reviewerNote,
    )
    refreshMentorReview()
    return { ok: true, status: result.status, mentorId: result.mentorId }
  } catch (error) {
    return { ok: false, error: reviewError(error) }
  }
}

export async function reviewCourse(
  courseId: string,
  decision: CourseAdminDecision,
  reviewerNote: string | null,
): Promise<CourseReviewActionResult> {
  const parsed = courseReviewSchema.safeParse({ courseId, decision, reviewerNote })
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    if (issue?.path[0] === 'reviewerNote') return { ok: false, error: issue.message }
    return { ok: false, error: 'Invalid course review request.' }
  }

  const user = await requireAwsUser()

  try {
    const result = await learningAdminRepository.reviewCourse(
      user.id,
      parsed.data.courseId,
      parsed.data.decision,
      parsed.data.reviewerNote,
    )
    refreshCourseReview(parsed.data.courseId)
    return { ok: true, status: result.status }
  } catch (error) {
    return { ok: false, error: courseReviewError(error) }
  }
}
