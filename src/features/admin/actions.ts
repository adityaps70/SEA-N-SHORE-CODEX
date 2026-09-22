'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { adminRepository, type AdminOrganizationDecision } from './repository'
import { MODERATION_TARGET_TYPES, type ModerationAction } from '@/features/moderation/types'

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

const moderationSchema = z.object({
  targetType: z.enum(MODERATION_TARGET_TYPES),
  targetId: z.string().uuid(),
  action: z.enum(['reviewing', 'dismiss', 'resolve', 'remove', 'restore']),
  note: z.preprocess(
    (value) => {
      if (typeof value !== 'string') return null
      const normalized = value.trim()
      return normalized || null
    },
    z.string().max(4000).nullable(),
  ),
}).superRefine((value, context) => {
  if (value.action !== 'reviewing' && !value.note) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['note'],
      message: 'Add a moderation note for this action.',
    })
  }
})

export type AdminModerationActionResult = { ok: true } | { ok: false; error: string }

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

export async function moderateContent(input: {
  targetType: (typeof MODERATION_TARGET_TYPES)[number]
  targetId: string
  action: ModerationAction
  note?: string | null
}): Promise<AdminModerationActionResult> {
  const parsed = moderationSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid moderation request.' }
  }

  const user = await requireAwsUser()
  try {
    await adminRepository.moderateContent(user.id, {
      targetType: parsed.data.targetType,
      targetId: parsed.data.targetId,
      action: parsed.data.action,
      note: parsed.data.note,
    })
  } catch (error) {
    const code = error instanceof Error ? error.message : ''
    if (code === 'admin_forbidden') {
      return { ok: false, error: 'You do not have permission to moderate platform content.' }
    }
    if (code === 'moderation_case_not_found') {
      return { ok: false, error: 'This moderation case could not be found.' }
    }
    if (code === 'moderation_target_not_found') {
      return { ok: false, error: 'The reported content is no longer available.' }
    }
    if (code === 'moderation_restore_forbidden') {
      return { ok: false, error: 'This content was not removed by moderation, so it cannot be restored from this console.' }
    }
    return { ok: false, error: 'The moderation action could not be saved. Please try again.' }
  }

  revalidatePath('/admin')
  revalidatePath('/admin/moderation')
  if (parsed.data.targetType === 'post' || parsed.data.targetType === 'comment') {
    revalidatePath('/home')
    revalidatePath('/posts/[id]', 'page')
  }
  if (parsed.data.targetType === 'job') {
    revalidatePath('/jobs')
    revalidatePath(`/jobs/${parsed.data.targetId}`)
  }
  if (parsed.data.targetType === 'event') {
    revalidatePath('/events')
    revalidatePath(`/events/${parsed.data.targetId}`)
  }
  return { ok: true }
}
