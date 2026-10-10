'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { ADMIN_MFA_REQUIRED_MESSAGE, adminActionMfaMissing } from '@/features/admin/mfa-gate'
import { moderationBlockMessage } from '@/features/moderation/automated'
import { firstPlainIssue, plainFieldErrors, type PlainFieldErrors } from '@/lib/validation/plain-messages'
import { courseRatingRepository, REVIEW_BODY_MAX_LENGTH, type OwnCourseReview } from './course-rating-repository'

/** Learning round C (C5a): a learner rates a course; Sea N Shore approves or rejects reviews before they are public. */

export type SaveCourseReviewResult =
  | { ok: true; review: OwnCourseReview }
  | { ok: false; error: string; fieldErrors?: PlainFieldErrors }

const reviewSchema = z.object({
  rating: z.number({ error: 'Choose from 1 to 5 stars.' }).int('Choose from 1 to 5 stars.').min(1, 'Choose from 1 to 5 stars.').max(5, 'Choose from 1 to 5 stars.'),
  body: z.string().max(REVIEW_BODY_MAX_LENGTH, 'Your review can be at most 2,000 characters.').default(''),
})

const REVIEW_LABELS = { rating: 'Rating', body: 'Your review' }

const REVIEW_ERRORS: Record<string, string> = {
  review_not_enrolled: 'Only learners enrolled in this course can rate it.',
  review_course_team: 'People who run this course can’t rate it.',
  review_access_ended: 'Your access to this course has ended, so you can’t rate it now.',
  review_progress_too_low: 'You can rate this course once you’ve completed at least 20% of it.',
}

export async function saveCourseReview(courseId: string, input: { rating: number; body?: string }): Promise<SaveCourseReviewResult> {
  if (!z.string().uuid().safeParse(courseId).success) return { ok: false, error: 'This course link is no longer valid. Reload the page and try again.' }
  const parsed = reviewSchema.safeParse({ rating: input?.rating, body: typeof input?.body === 'string' ? input.body : '' })
  if (!parsed.success) {
    return {
      ok: false,
      error: firstPlainIssue(parsed.error, 'Check your rating and try again.', REVIEW_LABELS),
      fieldErrors: plainFieldErrors(parsed.error, REVIEW_LABELS),
    }
  }

  const user = await requireAwsUser()
  try {
    const review = await courseRatingRepository.saveReview(user.id, courseId, parsed.data)
    revalidatePath('/learn/courses/[slug]/learn', 'page')
    return { ok: true, review }
  } catch (error) {
    const code = error instanceof Error ? error.message : ''
    if (code === 'review_blocked') return { ok: false, error: moderationBlockMessage(), fieldErrors: { body: [moderationBlockMessage()] } }
    if (REVIEW_ERRORS[code]) return { ok: false, error: REVIEW_ERRORS[code]! }
    console.error('[course_review_save_failed]', { code: code.slice(0, 80) || 'unknown_error' })
    return { ok: false, error: 'We could not save your rating. Please try again.' }
  }
}

export type DecideCourseReviewResult = { ok: true } | { ok: false; error: string }

const decisionSchema = z.object({
  reviewId: z.string().uuid(),
  decision: z.enum(['approved', 'rejected']),
  note: z.string().trim().max(4000, 'The note can be at most 4,000 characters.').optional(),
  expectedUpdatedAt: z.string().max(64).optional(),
})

const DECISION_ERRORS: Record<string, string> = {
  admin_forbidden: 'You do not have permission to moderate platform content.',
  review_not_found: 'This review no longer exists.',
  review_not_pending: 'Someone has already decided on this review. Refresh the page to see the current list.',
  review_changed: 'The learner changed this review after you opened the page. Refresh to read the new version before deciding.',
}

/** Platform administrators approve or reject a pending course review. */
export async function decideCourseReview(input: { reviewId: string; decision: 'approved' | 'rejected'; note?: string; expectedUpdatedAt?: string }): Promise<DecideCourseReviewResult> {
  const parsed = decisionSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: firstPlainIssue(parsed.error, 'Invalid moderation request.') }

  const user = await requireAwsUser()
  if (await adminActionMfaMissing(user.id)) return { ok: false, error: ADMIN_MFA_REQUIRED_MESSAGE }
  try {
    await courseRatingRepository.decideReview(user.id, {
      reviewId: parsed.data.reviewId,
      decision: parsed.data.decision,
      note: parsed.data.note || null,
      expectedUpdatedAt: parsed.data.expectedUpdatedAt ?? null,
    })
  } catch (error) {
    const code = error instanceof Error ? error.message : ''
    if (DECISION_ERRORS[code]) return { ok: false, error: DECISION_ERRORS[code]! }
    console.error('[course_review_decision_failed]', { code: code.slice(0, 80) || 'unknown_error' })
    return { ok: false, error: 'The decision could not be saved. Please try again.' }
  }
  revalidatePath('/admin/moderation')
  revalidatePath('/learn/courses/[slug]', 'page')
  return { ok: true }
}
