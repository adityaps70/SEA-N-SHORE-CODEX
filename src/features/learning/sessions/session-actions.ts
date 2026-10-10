'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { canUsePlatformAdminAuthority } from '@/features/admin/mfa-gate'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { headMediaObject } from '@/lib/aws/storage'
import { firstPlainIssue } from '@/lib/validation/plain-messages'
import type { BatchActor } from '../batches/batch-repository'
import { createPendingLearningMediaUpload } from '../media'
import { isOwnedLearningMediaStoragePath, validateLearningMediaMetadata } from '../media-policy'
import { SessionError, sessionRepository } from './session-repository'
import {
  recordingLinkSchema,
  seriesInputSchema,
  SESSION_LIMITS,
  type AttendanceMark,
  type SeriesInput,
  type SessionInput,
  sessionInputSchema,
} from './session-rules'

/**
 * Learning round D (D2): sessions, attendance and recordings for a batch's staff, and the member's own time zone. The
 * repository checks access and audits every change; these actions validate input and give plain messages.
 */

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string }

const uuid = z.string().uuid()

const SESSION_LABELS = { title: 'Title', description: 'Description', date: 'Date', time: 'Time', timeZone: 'Time zone', durationMinutes: 'Length', meetingUrl: 'Meeting link', weekdays: 'Days', firstDate: 'First date', weekCount: 'Weeks' }

async function actor(): Promise<BatchActor> {
  const user = await requireAwsUser()
  return { actorId: user.id, allCourses: await canUsePlatformAdminAuthority(user.id) }
}

function sessionError(error: unknown) {
  if (error instanceof SessionError) {
    if (error.code === 'batch_not_found' || error.code === 'session_not_found') return 'Only this batch’s manager, instructors and the course’s trainers can do this. Reload the page.'
    if (error.code === 'session_time_invalid') return 'That date and time do not work. Check them (attendance can be marked once a session has started).'
    if (error.code === 'series_too_long') return `A series can have at most ${SESSION_LIMITS.maxSeriesSessions} sessions. Choose fewer days or weeks.`
    if (error.code === 'recording_invalid') return 'The recording upload could not be confirmed. Upload it again.'
  }
  return 'We could not save this. Please try again.'
}

function refresh(courseId: string, batchId: string) {
  revalidatePath(`/learn/studio/courses/${courseId}/batches/${batchId}/sessions`)
}

export async function createSessionAction(courseId: string, batchId: string, input: SessionInput): Promise<Result<{ sessionId: string }>> {
  const ids = z.tuple([uuid, uuid]).safeParse([courseId, batchId])
  if (!ids.success) return { ok: false, error: 'This batch link is no longer valid. Reload the page.' }
  const parsed = sessionInputSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: firstPlainIssue(parsed.error, 'Check the session details and try again.', SESSION_LABELS) }
  try {
    const sessionId = await sessionRepository.createOne(await actor(), batchId, parsed.data)
    refresh(courseId, batchId)
    return { ok: true, sessionId }
  } catch (error) {
    return { ok: false, error: sessionError(error) }
  }
}

export async function createSessionSeriesAction(courseId: string, batchId: string, input: SeriesInput): Promise<Result<{ count: number }>> {
  const ids = z.tuple([uuid, uuid]).safeParse([courseId, batchId])
  if (!ids.success) return { ok: false, error: 'This batch link is no longer valid. Reload the page.' }
  const parsed = seriesInputSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: firstPlainIssue(parsed.error, 'Check the series details and try again.', SESSION_LABELS) }
  try {
    const { count } = await sessionRepository.createSeries(await actor(), batchId, parsed.data)
    refresh(courseId, batchId)
    return { ok: true, count }
  } catch (error) {
    return { ok: false, error: sessionError(error) }
  }
}

export async function updateSessionAction(courseId: string, batchId: string, sessionId: string, input: SessionInput): Promise<Result> {
  const ids = z.tuple([uuid, uuid, uuid]).safeParse([courseId, batchId, sessionId])
  if (!ids.success) return { ok: false, error: 'This session link is no longer valid. Reload the page.' }
  const parsed = sessionInputSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: firstPlainIssue(parsed.error, 'Check the session details and try again.', SESSION_LABELS) }
  try {
    await sessionRepository.update(await actor(), sessionId, parsed.data)
    refresh(courseId, batchId)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: sessionError(error) }
  }
}

export async function cancelSessionAction(courseId: string, batchId: string, sessionId: string, restOfSeries: boolean): Promise<Result<{ cancelled: number }>> {
  const ids = z.tuple([uuid, uuid, uuid]).safeParse([courseId, batchId, sessionId])
  if (!ids.success) return { ok: false, error: 'This session link is no longer valid. Reload the page.' }
  try {
    const cancelled = await sessionRepository.cancel(await actor(), sessionId, { restOfSeries })
    refresh(courseId, batchId)
    return { ok: true, cancelled }
  } catch (error) {
    return { ok: false, error: sessionError(error) }
  }
}

const marksSchema = z.array(z.object({ learnerId: uuid, mark: z.enum(['present', 'absent', 'excused']) })).max(2000)

export async function markAttendanceAction(courseId: string, batchId: string, sessionId: string, input: { marks?: { learnerId: string; mark: AttendanceMark }[]; joinedPresent?: boolean }): Promise<Result<{ changed: number }>> {
  const ids = z.tuple([uuid, uuid, uuid]).safeParse([courseId, batchId, sessionId])
  if (!ids.success) return { ok: false, error: 'This session link is no longer valid. Reload the page.' }
  const marks = marksSchema.safeParse(input.marks ?? [])
  if (!marks.success) return { ok: false, error: 'Choose present, absent or excused for each learner.' }
  try {
    const changed = await sessionRepository.mark(await actor(), sessionId, { marks: marks.data, joinedPresent: input.joinedPresent === true })
    refresh(courseId, batchId)
    return { ok: true, changed }
  } catch (error) {
    return { ok: false, error: sessionError(error) }
  }
}

export async function attachRecordingLinkAction(courseId: string, batchId: string, sessionId: string, url: string): Promise<Result> {
  const ids = z.tuple([uuid, uuid, uuid]).safeParse([courseId, batchId, sessionId])
  if (!ids.success) return { ok: false, error: 'This session link is no longer valid. Reload the page.' }
  const parsed = recordingLinkSchema.safeParse({ url })
  if (!parsed.success) return { ok: false, error: firstPlainIssue(parsed.error, 'Paste the full recording link, starting with https://.') }
  try {
    await sessionRepository.attachRecording(await actor(), sessionId, { kind: 'link', url: parsed.data.url })
    refresh(courseId, batchId)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: sessionError(error) }
  }
}

/** Starts a private recording upload: a short-lived upload URL under the uploader's own folder for this course. */
export async function startRecordingUploadAction(courseId: string, batchId: string, sessionId: string, file: { mimeType: string; size: number }): Promise<Result<{ uploadUrl: string; storagePath: string; mimeType: string }>> {
  const ids = z.tuple([uuid, uuid, uuid]).safeParse([courseId, batchId, sessionId])
  if (!ids.success) return { ok: false, error: 'This session link is no longer valid. Reload the page.' }
  const metadata = validateLearningMediaMetadata({ kind: 'session_recording', mimeType: file.mimeType, size: file.size })
  if (!metadata.ok) return { ok: false, error: metadata.error }
  try {
    const viewer = await actor()
    const found = await sessionRepository.getForViewer(viewer, sessionId)
    if (!found?.isStaff || found.courseId !== courseId) throw new SessionError('session_not_found')
    const upload = await createPendingLearningMediaUpload({ userId: viewer.actorId, courseId, kind: 'session_recording', mimeType: metadata.mimeType, size: file.size })
    return { ok: true, uploadUrl: upload.uploadUrl, storagePath: upload.storagePath, mimeType: upload.mimeType }
  } catch (error) {
    return { ok: false, error: sessionError(error) }
  }
}

/** Saves an uploaded recording once the stored file is the uploader's own, of the declared type and size. */
export async function saveUploadedRecordingAction(courseId: string, batchId: string, sessionId: string, file: { storagePath: string; mimeType: string; size: number }): Promise<Result> {
  const ids = z.tuple([uuid, uuid, uuid]).safeParse([courseId, batchId, sessionId])
  if (!ids.success) return { ok: false, error: 'This session link is no longer valid. Reload the page.' }
  try {
    const viewer = await actor()
    const metadata = validateLearningMediaMetadata({ kind: 'session_recording', mimeType: file.mimeType, size: file.size })
    if (!metadata.ok || !isOwnedLearningMediaStoragePath({ userId: viewer.actorId, courseId, kind: 'session_recording', storagePath: file.storagePath, mimeType: metadata.mimeType })) {
      throw new SessionError('recording_invalid')
    }
    const stored = await headMediaObject(file.storagePath).catch(() => null)
    if (!stored || stored.contentLength !== file.size) throw new SessionError('recording_invalid')
    await sessionRepository.attachRecording(viewer, sessionId, { kind: 'upload', path: file.storagePath, contentType: metadata.mimeType })
    refresh(courseId, batchId)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: sessionError(error) }
  }
}

export async function removeRecordingAction(courseId: string, batchId: string, sessionId: string): Promise<Result> {
  const ids = z.tuple([uuid, uuid, uuid]).safeParse([courseId, batchId, sessionId])
  if (!ids.success) return { ok: false, error: 'This session link is no longer valid. Reload the page.' }
  try {
    await sessionRepository.removeRecording(await actor(), sessionId)
    refresh(courseId, batchId)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: sessionError(error) }
  }
}
