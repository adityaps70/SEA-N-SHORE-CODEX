'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { ADMIN_MFA_REQUIRED_MESSAGE, adminActionMfaMissing } from '@/features/admin/mfa-gate'
import { moderationBlockMessage } from '@/features/moderation/automated'
import { firstPlainIssue, plainFieldErrors, type PlainFieldErrors } from '@/lib/validation/plain-messages'
import { courseRatingRepository, type OwnerCourseReviewReply } from './course-rating-repository'
import { REVIEW_REPLY_MAX_LENGTH } from './course-review-reply-rules'

/**
 * Round H: the course owner replies to a review (one reply per review); platform administrators hide or restore
 * replies from the moderation page.
 */

export type CourseReviewReplyActionResult =
  | { ok: true; reply: OwnerCourseReviewReply | null }
  | { ok: false; error: string; fieldErrors?: PlainFieldErrors }

const REPLY_LABELS = { body: 'Your reply' }

const replySchema = z.object({
  reviewId: z.string().uuid('This review link is no longer valid. Reload the page and try again.'),
  body: z.string()
    .trim()
    .min(1, 'Write your reply before saving.')
    .max(REVIEW_REPLY_MAX_LENGTH, 'Your reply can be at most 2,000 characters.'),
  mode: z.enum(['add', 'edit']),
})

const deleteSchema = z.object({
  reviewId: z.string().uuid('This review link is no longer valid. Reload the page and try again.'),
})

const REPLY_ERRORS: Record<string, string> = {
  reply_review_not_found: 'This review no longer exists. Reload the page.',
  reply_forbidden: 'Only the people who run this course can reply to its reviews.',
  reply_review_not_public: 'You can reply once the review is published on the course page.',
  reply_exists: 'This review already has a reply. Reload the page to see it and edit it instead.',
  reply_not_found: 'This reply has already been deleted. Reload the page.',
  reply_invalid: 'Write a reply of up to 2,000 characters.',
}

function refresh() {
  revalidatePath('/learn/courses/[slug]', 'page')
}

function failure(error: unknown, logCode: string, fallback: string): CourseReviewReplyActionResult {
  const code = error instanceof Error ? error.message : ''
  if (code === 'reply_blocked') return { ok: false, error: moderationBlockMessage(), fieldErrors: { body: [moderationBlockMessage()] } }
  if (REPLY_ERRORS[code]) return { ok: false, error: REPLY_ERRORS[code]! }
  console.error(logCode, { code: code.slice(0, 80) || 'unknown_error' })
  return { ok: false, error: fallback }
}

/** The course owner adds or edits the reply to one approved review. */
export async function saveCourseReviewReply(input: { reviewId: string; body: string; mode: 'add' | 'edit' }): Promise<CourseReviewReplyActionResult> {
  const parsed = replySchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      error: firstPlainIssue(parsed.error, 'Check your reply and try again.', REPLY_LABELS),
      fieldErrors: plainFieldErrors(parsed.error, REPLY_LABELS),
    }
  }
  const user = await requireAwsUser()
  try {
    const result = await courseRatingRepository.saveReply(user.id, parsed.data)
    refresh()
    return { ok: true, reply: result.reply }
  } catch (error) {
    return failure(error, '[course_review_reply_save_failed]', 'We could not save your reply. Please try again.')
  }
}

/** The course owner deletes the reply to one review. */
export async function deleteCourseReviewReply(input: { reviewId: string }): Promise<CourseReviewReplyActionResult> {
  const parsed = deleteSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: firstPlainIssue(parsed.error, 'This review link is no longer valid.') }
  const user = await requireAwsUser()
  try {
    await courseRatingRepository.deleteReply(user.id, parsed.data)
    refresh()
    return { ok: true, reply: null }
  } catch (error) {
    return failure(error, '[course_review_reply_delete_failed]', 'We could not delete your reply. Please try again.')
  }
}

export type SetCourseReviewReplyStatusResult = { ok: true } | { ok: false; error: string }

const statusSchema = z.object({
  reviewId: z.string().uuid(),
  status: z.enum(['visible', 'hidden']),
  note: z.string().trim().max(4000, 'The note can be at most 4,000 characters.').optional(),
})

const STATUS_ERRORS: Record<string, string> = {
  admin_forbidden: 'You do not have permission to moderate platform content.',
  reply_review_not_found: 'This review no longer exists.',
  learning_out_of_scope: 'This is not in your countries. A Sea N Shore administrator handles it.',
  reply_not_found: 'The course owner has deleted this reply. Refresh the page to see the current list.',
  reply_status_unchanged: 'Someone has already changed this reply. Refresh the page to see the current list.',
}

/** Platform administrators hide a course owner's reply, or restore a hidden one. */
export async function setCourseReviewReplyStatus(input: { reviewId: string; status: 'visible' | 'hidden'; note?: string }): Promise<SetCourseReviewReplyStatusResult> {
  const parsed = statusSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: firstPlainIssue(parsed.error, 'Invalid moderation request.') }

  const user = await requireAwsUser()
  if (await adminActionMfaMissing(user.id)) return { ok: false, error: ADMIN_MFA_REQUIRED_MESSAGE }
  try {
    await courseRatingRepository.setReplyStatus(user.id, {
      reviewId: parsed.data.reviewId,
      status: parsed.data.status,
      note: parsed.data.note || null,
    })
  } catch (error) {
    const code = error instanceof Error ? error.message : ''
    if (STATUS_ERRORS[code]) return { ok: false, error: STATUS_ERRORS[code]! }
    console.error('[course_review_reply_status_failed]', { code: code.slice(0, 80) || 'unknown_error' })
    return { ok: false, error: 'The change could not be saved. Please try again.' }
  }
  revalidatePath('/admin/moderation')
  refresh()
  return { ok: true }
}
