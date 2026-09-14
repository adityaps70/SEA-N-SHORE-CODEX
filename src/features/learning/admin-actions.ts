'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { learningAdminRepository, type MentorReviewDecision } from './admin-repository'

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

export type MentorReviewActionResult =
  | { ok: true; status: MentorReviewDecision; mentorId: string | null }
  | { ok: false; error: string }

function reviewError(error: unknown) {
  const code = error instanceof Error ? error.message : ''
  if (code === 'admin_forbidden') return 'You are not authorized to review mentor applications.'
  if (code === 'mentor_application_transition_forbidden') return 'This mentor application cannot move to that review state.'
  if (code === 'mentor_application_not_found') return 'This mentor application could not be found.'
  return 'The mentor application review could not be saved. Please try again.'
}

function refreshMentorReview() {
  revalidatePath('/admin')
  revalidatePath('/admin/learning')
  revalidatePath('/learn')
  revalidatePath('/learn/teach')
}

export async function reviewMentorApplication(
  applicationId: string,
  decision: MentorReviewDecision,
  reviewerNote: string | null,
): Promise<MentorReviewActionResult> {
  const parsed = mentorReviewSchema.safeParse({ applicationId, decision, reviewerNote })
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid mentor review request.' }
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
