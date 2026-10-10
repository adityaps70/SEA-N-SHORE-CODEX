'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { canUsePlatformAdminAuthority } from '@/features/admin/mfa-gate'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { firstPlainIssue } from '@/lib/validation/plain-messages'
import { rosterEmailSchema, ROSTER_EMAIL_MESSAGE } from '../course-roster'
import { BatchError, batchRepository, type BatchActor } from './batch-repository'
import { batchInputSchema, batchRefusalMessage, batchSettingsSchema, type BatchInput, type CourseBatchSettings } from './batch-rules'

/**
 * Learning round D (D1): batch settings and batches for a course's managers. Every write is checked and audited in the
 * repository; these actions only validate input and turn refusals into plain messages.
 */

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string }

const uuid = z.string().uuid()

const BATCH_LABELS = { title: 'Batch name', startsAt: 'Start', endsAt: 'End', seatLimit: 'Seat limit', timeZone: 'Time zone' }

async function actor(): Promise<BatchActor> {
  const user = await requireAwsUser()
  return { actorId: user.id, allCourses: await canUsePlatformAdminAuthority(user.id) }
}

function batchError(error: unknown) {
  if (error instanceof BatchError) {
    if (error.code === 'course_not_found') return 'Only this course’s trainers can change its batches.'
    if (error.code === 'batch_not_found') return 'This batch is no longer available, or only the course’s trainers can change it. Reload the page.'
    if (error.code === 'member_not_found') return 'No Sea N Shore member has this verified email address. Ask them to sign up first, then try again.'
    if (error.code === 'enrollment_not_found') return 'This learner is no longer on the course. Reload the page.'
    return batchRefusalMessage(error.code) ?? 'Choose another batch and try again.'
  }
  return 'We could not save this. Please try again.'
}

function refresh(courseId: string, batchId?: string) {
  revalidatePath(`/learn/studio/courses/${courseId}/batches`)
  if (batchId) revalidatePath(`/learn/studio/courses/${courseId}/batches/${batchId}`)
  revalidatePath(`/learn/studio/courses/${courseId}/learners`)
}

export async function saveBatchSettingsAction(courseId: string, settings: CourseBatchSettings): Promise<Result<{ settings: CourseBatchSettings }>> {
  const parsedCourse = uuid.safeParse(courseId)
  if (!parsedCourse.success) return { ok: false, error: 'This course link is no longer valid. Reload the page and try again.' }
  const parsed = batchSettingsSchema.safeParse(settings)
  if (!parsed.success) return { ok: false, error: firstPlainIssue(parsed.error, 'Check the batch settings and try again.') }
  try {
    const saved = await batchRepository.saveSettings(await actor(), parsedCourse.data, parsed.data)
    refresh(parsedCourse.data)
    return { ok: true, settings: saved.settings }
  } catch (error) {
    return { ok: false, error: batchError(error) }
  }
}

export async function createBatchAction(courseId: string, input: BatchInput): Promise<Result<{ batchId: string }>> {
  const parsedCourse = uuid.safeParse(courseId)
  if (!parsedCourse.success) return { ok: false, error: 'This course link is no longer valid. Reload the page and try again.' }
  const parsed = batchInputSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: firstPlainIssue(parsed.error, 'Check the batch details and try again.', BATCH_LABELS) }
  try {
    const batchId = await batchRepository.create(await actor(), parsedCourse.data, parsed.data)
    refresh(parsedCourse.data, batchId)
    return { ok: true, batchId }
  } catch (error) {
    return { ok: false, error: batchError(error) }
  }
}

export async function updateBatchAction(courseId: string, batchId: string, input: BatchInput): Promise<Result> {
  const ids = z.tuple([uuid, uuid]).safeParse([courseId, batchId])
  if (!ids.success) return { ok: false, error: 'This batch link is no longer valid. Reload the page and try again.' }
  const parsed = batchInputSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: firstPlainIssue(parsed.error, 'Check the batch details and try again.', BATCH_LABELS) }
  try {
    await batchRepository.update(await actor(), batchId, parsed.data)
    refresh(courseId, batchId)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: batchError(error) }
  }
}

/** Sets the batch manager by a member's verified email; an empty email clears it. */
export async function setBatchManagerAction(courseId: string, batchId: string, email: string): Promise<Result> {
  const ids = z.tuple([uuid, uuid]).safeParse([courseId, batchId])
  if (!ids.success) return { ok: false, error: 'This batch link is no longer valid. Reload the page and try again.' }
  const trimmed = email.trim()
  const parsed = trimmed ? rosterEmailSchema.safeParse(trimmed) : null
  if (parsed && !parsed.success) return { ok: false, error: firstPlainIssue(parsed.error, ROSTER_EMAIL_MESSAGE) }
  try {
    await batchRepository.setManager(await actor(), batchId, parsed?.data ?? null)
    refresh(courseId, batchId)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: batchError(error) }
  }
}

export async function addBatchInstructorAction(courseId: string, batchId: string, email: string): Promise<Result<{ added: boolean }>> {
  const ids = z.tuple([uuid, uuid]).safeParse([courseId, batchId])
  if (!ids.success) return { ok: false, error: 'This batch link is no longer valid. Reload the page and try again.' }
  const parsed = rosterEmailSchema.safeParse(email)
  if (!parsed.success) return { ok: false, error: firstPlainIssue(parsed.error, ROSTER_EMAIL_MESSAGE) }
  try {
    const added = await batchRepository.addInstructor(await actor(), batchId, parsed.data)
    refresh(courseId, batchId)
    return { ok: true, added }
  } catch (error) {
    return { ok: false, error: batchError(error) }
  }
}

export async function removeBatchInstructorAction(courseId: string, batchId: string, profileId: string): Promise<Result> {
  const ids = z.tuple([uuid, uuid, uuid]).safeParse([courseId, batchId, profileId])
  if (!ids.success) return { ok: false, error: 'This instructor was already removed. Reload the page.' }
  try {
    await batchRepository.removeInstructor(await actor(), batchId, profileId)
    refresh(courseId, batchId)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: batchError(error) }
  }
}

export async function moveLearnerToBatchAction(courseId: string, enrollmentId: string, toBatchId: string): Promise<Result<{ moved: boolean }>> {
  const ids = z.tuple([uuid, uuid, uuid]).safeParse([courseId, enrollmentId, toBatchId])
  if (!ids.success) return { ok: false, error: 'Choose a batch and try again.' }
  try {
    const moved = await batchRepository.moveLearner(await actor(), { courseId, enrollmentId, toBatchId })
    refresh(courseId)
    return { ok: true, moved }
  } catch (error) {
    return { ok: false, error: batchError(error) }
  }
}
