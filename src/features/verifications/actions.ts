'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAwsUser } from '@/features/auth/aws-queries'
import {
  CREATOR_VERIFICATION_TYPES,
  creatorVerificationApplicationSchema,
  type CreatorVerificationType,
} from './application'
import { creatorVerificationRepository } from './repository'

export type CreatorVerificationActionState = {
  ok?: boolean
  verificationId?: string
  error?: string
  fieldErrors?: Record<string, string[] | undefined>
  values?: {
    professionalRole?: string
    organizationName?: string
    experienceYears?: string
    specializations?: string
    experienceSummary?: string
    evidenceUrl?: string
    additionalNote?: string
  }
}

function preservedValues(formData: FormData): CreatorVerificationActionState['values'] {
  const value = (name: string) => {
    const entry = formData.get(name)
    return typeof entry === 'string' ? entry : undefined
  }
  return {
    professionalRole: value('professionalRole'),
    organizationName: value('organizationName'),
    experienceYears: value('experienceYears'),
    specializations: value('specializations'),
    experienceSummary: value('experienceSummary'),
    evidenceUrl: value('evidenceUrl'),
    additionalNote: value('additionalNote'),
  }
}

export async function submitCreatorVerification(
  type: CreatorVerificationType,
  _previousState: CreatorVerificationActionState,
  formData: FormData,
): Promise<CreatorVerificationActionState> {
  const values = preservedValues(formData)

  if (!CREATOR_VERIFICATION_TYPES.includes(type)) {
    return { ok: false, error: 'Choose a supported verification type.', values }
  }

  const parsed = creatorVerificationApplicationSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Please correct the highlighted information and try again.',
      fieldErrors: parsed.error.flatten().fieldErrors,
      values,
    }
  }

  try {
    const user = await requireAwsUser()
    const result = await creatorVerificationRepository.submitApplication(user.id, type, parsed.data)

    revalidatePath('/settings/verifications')
    revalidatePath(`/settings/verifications/${type === 'event_host' ? 'event-host' : 'recruiter'}`)
    revalidatePath('/hiring')
    revalidatePath('/hiring/jobs/new')
    revalidatePath('/events/create')
    return { ok: true, verificationId: result.verificationId }
  } catch (error) {
    const code = error instanceof Error ? error.message : ''
    if (code === 'verification_application_pending') {
      return { ok: false, error: 'This verification application is already under review.', values }
    }
    if (code === 'verification_already_approved') {
      return { ok: false, error: 'This professional capability is already verified.', values }
    }
    if (code === 'verification_suspended') {
      return { ok: false, error: 'This verification is suspended. Contact Sea N Shore support before submitting again.', values }
    }
    if (/authentication required/i.test(code)) {
      return { ok: false, error: 'Your session may have expired. Sign in again and retry.', values }
    }
    return {
      ok: false,
      error: 'We could not submit the verification application. Your entries are still here; please try again.',
      values,
    }
  }
}

const reviewSchema = z.object({
  verificationId: z.string().uuid(),
  decision: z.enum(['approved', 'rejected']),
  reviewNote: z.preprocess(
    (value) => {
      if (typeof value !== 'string') return null
      const normalized = value.trim()
      return normalized || null
    },
    z.string().max(4000).nullable(),
  ),
}).superRefine((value, context) => {
  if (value.decision === 'rejected' && !value.reviewNote) {
    context.addIssue({
      code: 'custom',
      path: ['reviewNote'],
      message: 'Add a review note when rejecting a verification application.',
    })
  }
})

export type CreatorVerificationReviewResult = { ok: true } | { ok: false; error: string }

export async function reviewCreatorVerificationApplication(
  verificationId: string,
  decision: 'approved' | 'rejected',
  reviewNote: string | null,
): Promise<CreatorVerificationReviewResult> {
  const parsed = reviewSchema.safeParse({ verificationId, decision, reviewNote })
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Check the verification review and try again.',
    }
  }

  try {
    const user = await requireAwsUser()
    await creatorVerificationRepository.reviewApplication(
      user.id,
      parsed.data.verificationId,
      parsed.data.decision,
      parsed.data.reviewNote,
    )
  } catch (error) {
    const code = error instanceof Error ? error.message : ''
    if (code === 'admin_forbidden') {
      return { ok: false, error: 'You do not have permission to review verification applications.' }
    }
    if (code === 'verification_application_not_found') {
      return { ok: false, error: 'This verification application could not be found.' }
    }
    if (code === 'verification_review_forbidden') {
      return { ok: false, error: 'This verification application has already been reviewed.' }
    }
    return { ok: false, error: 'The verification review could not be saved. Please try again.' }
  }

  revalidatePath('/admin')
  revalidatePath('/admin/verifications')
  revalidatePath('/settings/verifications')
  revalidatePath('/hiring')
  revalidatePath('/events/create')
  return { ok: true }
}
