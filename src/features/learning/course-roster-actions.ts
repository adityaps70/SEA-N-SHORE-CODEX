'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { canUsePlatformAdminAuthority } from '@/features/admin/mfa-gate'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { firstPlainIssue } from '@/lib/validation/plain-messages'
import { ROSTER_EMAIL_MESSAGE, ROSTER_ENROL_LIMITS, rosterEmailSchema, type RosterEnrolOutcome } from './course-roster'
import { courseRosterRepository } from './course-roster-repository'
import { BatchError } from './batches/batch-repository'
import { batchRefusalMessage } from './batches/batch-rules'

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string }

const uuid = z.string().uuid()

function rosterError(error: unknown) {
  if (error instanceof BatchError) return error.code === 'batch_required' ? 'Choose the batch to add this learner to.' : batchRefusalMessage(error.code) ?? 'Choose another batch and try again.'
  if (error instanceof Error) {
    if (error.message === 'course_not_found') return 'Only this course’s trainers can add learners.'
    if (error.message === 'course_not_enrollable') return 'Learners can be added once the course is published and open to new learners.'
    if (error.message === 'roster_enrol_rate_limited') {
      return `You have added a lot of learners in a short time (the limit is ${ROSTER_ENROL_LIMITS.perHour} an hour and ${ROSTER_ENROL_LIMITS.perDay} a day). Please try again later.`
    }
    if (error.message === 'invitation_not_found') return 'This invitation was already used or cancelled. Reload the page.'
  }
  return 'We could not add this learner. Please try again.'
}

async function access(courseId: string, batchId: string | null = null) {
  const user = await requireAwsUser()
  return { actorId: user.id, courseId, allCourses: await canUsePlatformAdminAuthority(user.id), batchId }
}

/** Round C (C1): enrol a member by email now, or invite someone who is not a member yet. */
export async function enrolLearnerByEmail(courseId: string, email: string, batchId: string | null = null): Promise<Result<{ outcome: RosterEnrolOutcome }>> {
  const parsedCourse = uuid.safeParse(courseId)
  if (!parsedCourse.success) return { ok: false, error: 'This course link is no longer valid. Reload the page and try again.' }
  const parsedBatch = uuid.nullable().safeParse(batchId)
  if (!parsedBatch.success) return { ok: false, error: 'Choose a batch and try again.' }
  const parsedEmail = rosterEmailSchema.safeParse(email)
  if (!parsedEmail.success) return { ok: false, error: firstPlainIssue(parsedEmail.error, ROSTER_EMAIL_MESSAGE) }
  try {
    const outcome = await courseRosterRepository.enrolByEmail(await access(parsedCourse.data, parsedBatch.data), parsedEmail.data)
    revalidatePath(`/learn/studio/courses/${parsedCourse.data}/learners`)
    return { ok: true, outcome }
  } catch (error) {
    return { ok: false, error: rosterError(error) }
  }
}

export async function cancelCourseInvitation(courseId: string, invitationId: string): Promise<Result> {
  const parsedCourse = uuid.safeParse(courseId)
  const parsedInvitation = uuid.safeParse(invitationId)
  if (!parsedCourse.success || !parsedInvitation.success) return { ok: false, error: 'This invitation was already used or cancelled. Reload the page.' }
  try {
    await courseRosterRepository.cancelInvitation(await access(parsedCourse.data), parsedInvitation.data)
    revalidatePath(`/learn/studio/courses/${parsedCourse.data}/learners`)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: rosterError(error) }
  }
}
