'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { mentorApplicationSchema, type MentorApplicationInput } from './mentor-application'
import { learningRepository } from './repository'

type LearningActionResult = { ok: true } | { ok: false; error: string }
type MentorApplicationSubmitResult = { ok: true; applicationId: string } | { ok: false; error: string }

const applicationIdSchema = z.string().uuid()

function validationError(error: z.ZodError) {
  return error.issues[0]?.message ?? 'Please check the trainer verification application and try again.'
}

function mutationError(error: unknown) {
  if (error instanceof Error) {
    if (error.message === 'mentor_application_already_exists') {
      return 'You already have a trainer verification application. Open Teach on Sea N Shore to view its status.'
    }
    if (error.message === 'mentor_application_resubmit_forbidden') {
      return 'This trainer verification application cannot be resubmitted in its current state.'
    }
    if (error.message === 'mentor_application_not_found') {
      return 'We could not find this trainer verification application.'
    }
  }
  return 'We could not save the trainer verification application. Please try again.'
}

function refreshMentorLearning() {
  revalidatePath('/learn')
  revalidatePath('/learn/teach')
  revalidatePath('/admin/learning')
}

export async function submitMentorApplication(input: MentorApplicationInput): Promise<MentorApplicationSubmitResult> {
  const parsed = mentorApplicationSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: validationError(parsed.error) }

  try {
    const user = await requireAwsUser()
    const result = await learningRepository.submitMentorApplication(user.id, parsed.data)
    refreshMentorLearning()
    return { ok: true, applicationId: result.applicationId }
  } catch (error) {
    return { ok: false, error: mutationError(error) }
  }
}

export async function resubmitMentorApplication(
  applicationId: string,
  input: MentorApplicationInput,
): Promise<LearningActionResult> {
  const parsedId = applicationIdSchema.safeParse(applicationId)
  const parsed = mentorApplicationSchema.safeParse(input)
  if (!parsedId.success) return { ok: false, error: 'Invalid trainer verification application.' }
  if (!parsed.success) return { ok: false, error: validationError(parsed.error) }

  try {
    const user = await requireAwsUser()
    await learningRepository.resubmitMentorApplication(user.id, parsedId.data, parsed.data)
    refreshMentorLearning()
    return { ok: true }
  } catch (error) {
    return { ok: false, error: mutationError(error) }
  }
}
