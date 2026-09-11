'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { adminRepository, type AdminOrganizationDecision } from './repository'

const reviewSchema = z.object({
  applicationId: z.string().uuid(),
  decision: z.enum(['approved', 'changes_requested', 'rejected', 'suspended']),
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

export type AdminReviewActionResult = { ok: true } | { ok: false; error: string }

export async function reviewOrganizationApplication(
  applicationId: string,
  decision: AdminOrganizationDecision,
  reviewerNote: string | null,
): Promise<AdminReviewActionResult> {
  const parsed = reviewSchema.safeParse({ applicationId, decision, reviewerNote })
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid organization review request.' }
  }

  const user = await requireAwsUser()

  try {
    await adminRepository.reviewOrganizationApplication(
      user.id,
      parsed.data.applicationId,
      parsed.data.decision,
      parsed.data.reviewerNote,
    )
  } catch (error) {
    const code = error instanceof Error ? error.message : ''
    if (code === 'admin_forbidden') {
      return { ok: false, error: 'You do not have permission to review organization applications.' }
    }
    if (code === 'organization_review_transition_forbidden') {
      return { ok: false, error: 'This organization application cannot move to that review state.' }
    }
    if (code === 'organization_application_not_found') {
      return { ok: false, error: 'This organization application could not be found.' }
    }
    return { ok: false, error: 'The organization review could not be saved. Please try again.' }
  }

  revalidatePath('/admin')
  revalidatePath('/admin/organizations')
  revalidatePath(`/admin/organizations/${parsed.data.applicationId}`)
  revalidatePath('/hiring')
  revalidatePath('/hiring/organization')
  return { ok: true }
}
