import type { QueryResultRow } from 'pg'
import { query as databaseQuery, withTransaction, type DatabaseQueryClient } from '@/lib/db/client'
import { batchStaffAccessSql, enrollmentAccessOpenSql } from '../course-access'
import { issueCertificateForCompletedEnrollmentWithQuery, issueCertificateForFinalQuizWithQuery } from '../certificate-repository'
import type { BatchActor } from '../batches/batch-repository'
import {
  attendanceSummary,
  seriesOccurrences,
  sessionStartUtc,
  type AttendanceMark,
  type BatchSession,
  type SeriesInput,
  type SessionInput,
} from './session-rules'

/**
 * Live sessions (learning round D, D2): public.learning_batch_sessions, learning_session_series and
 * learning_session_attendance (0078).
 *
 * Staff (the batch's manager and instructors, the course's managers, platform admins via `allCourses`) run a batch's
 * sessions, attendance and recordings. A learner reads only the sessions of the batch they are enrolled in, while their
 * access is open, and only their own attendance. Writes are audited with ids and counts, never names or emails.
 */

type Query = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>
type Transaction = <T>(work: (query: Query) => Promise<T>) => Promise<T>

export class SessionError extends Error {
  constructor(readonly code: 'batch_not_found' | 'session_not_found' | 'session_time_invalid' | 'series_too_long' | 'recording_invalid') {
    super(code)
  }
}

function clientQuery(client: DatabaseQueryClient): Query {
  return async (text, values) => (await client.query(text, values ? [...values] : undefined)).rows
}

function iso(value: unknown) {
  if (value === null || value === undefined) return null
  const date = value instanceof Date ? value : new Date(String(value))
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

const SESSION_COLUMNS = `
  session.id, session.batch_id, session.series_id, session.title, session.description, session.starts_at,
  session.duration_minutes, session.meeting_url, session.status, session.recording_kind, session.recording_url,
  session.recording_content_type`

export function mapSession(row: QueryResultRow): BatchSession {
  const recording = row.recording_kind === 'link' && row.recording_url
    ? { kind: 'link' as const, url: String(row.recording_url) }
    : row.recording_kind === 'upload'
      ? { kind: 'upload' as const, contentType: String(row.recording_content_type ?? 'video/mp4') }
      : null
  return {
    id: String(row.id),
    batchId: String(row.batch_id),
    seriesId: row.series_id ? String(row.series_id) : null,
    title: String(row.title),
    description: row.description ? String(row.description) : null,
    startsAt: iso(row.starts_at) ?? new Date(0).toISOString(),
    durationMinutes: Number(row.duration_minutes),
    meetingUrl: row.meeting_url ? String(row.meeting_url) : null,
    status: row.status === 'cancelled' ? 'cancelled' : 'scheduled',
    recording,
  }
}

async function audit(query: Query, actorId: string, action: string, courseId: string, metadata: Record<string, unknown>) {
  await query(
    `insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
     values ($1::uuid, $2, 'learning_course', $3, $4::jsonb)`,
    [actorId, action, courseId, JSON.stringify(metadata)],
  )
}

/** The batch the actor may run (staff), with its course; batch_not_found otherwise. */
async function staffBatch(query: Query, actor: BatchActor, batchId: string, lock = false) {
  const rows = await query(
    `select batch.id, batch.course_id, batch.title, batch.time_zone
     from public.learning_course_batches batch
     where batch.id = $2::uuid
       and ($3::boolean or ${batchStaffAccessSql('batch', '$1::uuid')})${lock ? '\n     for update of batch' : ''}`,
    [actor.actorId, batchId, Boolean(actor.allCourses)],
  )
  const row = rows[0]
  if (!row) throw new SessionError('batch_not_found')
  return { id: String(row.id), courseId: String(row.course_id), title: String(row.title), timeZone: String(row.time_zone) }
}

/** A session the actor may run, locked for an update. */
async function staffSession(query: Query, actor: BatchActor, sessionId: string) {
  const rows = await query(
    `select ${SESSION_COLUMNS}, batch.course_id
     from public.learning_batch_sessions session
     inner join public.learning_course_batches batch on batch.id = session.batch_id
     where session.id = $2::uuid
       and ($3::boolean or ${batchStaffAccessSql('batch', '$1::uuid')})
     for update of session`,
    [actor.actorId, sessionId, Boolean(actor.allCourses)],
  )
  const row = rows[0]
  if (!row) throw new SessionError('session_not_found')
  return { session: mapSession(row), courseId: String(row.course_id) }
}

export type SessionAttendee = {
  learnerId: string
  enrollmentId: string
  name: string
  firstJoinedAt: string | null
  joinCount: number
  mark: AttendanceMark | null
}

export type LearnerSession = BatchSession & { mark: AttendanceMark | null; joined: boolean }

export type LearnerBatchSessions = {
  batch: { id: string; title: string; timeZone: string }
  enrollmentId: string
  sessions: LearnerSession[]
  /** Round D: the course's minimum attendance for the certificate (null = no rule). */
  minAttendancePercent: number | null
}

export type UpcomingLearnerSession = BatchSession & { courseTitle: string; courseSlug: string; batchTitle: string }

/** The learner's open enrolment in a batch of this course (null when self-paced, no batch, or access ended). */
async function learnerBatch(query: Query, learnerId: string, courseId: string) {
  const rows = await query(
    `select enrollment.id as enrollment_id, batch.id as batch_id, batch.title, batch.time_zone, course.min_attendance_percent
     from public.learning_enrollments enrollment
     inner join public.learning_courses course on course.id = enrollment.course_id and course.batch_mode = 'batches'
     inner join public.learning_course_batches batch on batch.id = enrollment.batch_id and batch.status <> 'archived'
     where enrollment.learner_id = $1::uuid and enrollment.course_id = $2::uuid
       and enrollment.status in ('active', 'completed') and ${enrollmentAccessOpenSql('enrollment')}`,
    [learnerId, courseId],
  )
  return rows[0] ?? null
}

/**
 * Issues a certificate that was waiting only on attendance: a completed enrolment (completion trigger), or a passed
 * final quiz (final-quiz trigger). The issue functions check the rule again, so this is safe to call any time.
 */
export async function recheckCertificateAfterAttendance(query: Query, enrollmentId: string) {
  const completed = await issueCertificateForCompletedEnrollmentWithQuery(query, enrollmentId)
  if (completed) return completed
  const passed = await query(
    `select lesson.id as lesson_id
     from public.learning_quiz_attempts attempt
     inner join public.learning_quizzes quiz on quiz.id = attempt.quiz_id
     inner join public.learning_lessons lesson on lesson.id = quiz.lesson_id and lesson.certificate_final = true and lesson.removed_at is null
     where attempt.enrollment_id = $1::uuid and attempt.status = 'completed' and attempt.passed = true
     limit 1`,
    [enrollmentId],
  )
  return passed[0] ? issueCertificateForFinalQuizWithQuery(query, enrollmentId, String(passed[0].lesson_id)) : null
}

export function createSessionRepository(input: { query?: Query; transaction?: Transaction } = {}) {
  const query: Query = input.query ?? ((text, values) => databaseQuery<QueryResultRow>(text, values))
  const transaction: Transaction = input.transaction ?? (<T>(work: (query: Query) => Promise<T>) => withTransaction((client) => work(clientQuery(client))))

  /** The batch's sessions for its staff, soonest first, with each session's join and mark counts. */
  async function listForStaff(actor: BatchActor, batchId: string) {
    const batch = await staffBatch(query, actor, batchId)
    const rows = await query(
      `select ${SESSION_COLUMNS},
              (select count(*)::int from public.learning_session_attendance attendance where attendance.session_id = session.id and attendance.first_joined_at is not null) as joined_count,
              (select count(*)::int from public.learning_session_attendance attendance where attendance.session_id = session.id and attendance.status = 'present') as present_count
       from public.learning_batch_sessions session
       where session.batch_id = $1::uuid
       order by session.starts_at asc, session.id
       limit 500`,
      [batch.id],
    )
    return {
      batch,
      sessions: rows.map((row) => ({ ...mapSession(row), joinedCount: Number(row.joined_count ?? 0), presentCount: Number(row.present_count ?? 0) })),
    }
  }

  async function createOne(actor: BatchActor, batchId: string, session: SessionInput) {
    const startsAt = sessionStartUtc(session)
    if (!startsAt) throw new SessionError('session_time_invalid')
    return transaction(async (tx) => {
      const batch = await staffBatch(tx, actor, batchId)
      const rows = await tx(
        `insert into public.learning_batch_sessions (batch_id, title, description, starts_at, duration_minutes, meeting_url, created_by)
         values ($1::uuid, $2, $3, $4::timestamptz, $5, $6, $7::uuid)
         returning id`,
        [batch.id, session.title, session.description, startsAt.toISOString(), session.durationMinutes, session.meetingUrl, actor.actorId],
      )
      await audit(tx, actor.actorId, 'learning.session_created', batch.courseId, { batchId: batch.id, sessions: 1 })
      return String(rows[0]!.id)
    })
  }

  /** A weekly series: the rule is kept, and each session is its own row (edited or cancelled on its own). */
  async function createSeries(actor: BatchActor, batchId: string, series: SeriesInput) {
    const occurrences = seriesOccurrences(series)
    if (occurrences === null) throw new SessionError('series_too_long')
    if (!occurrences.length) throw new SessionError('session_time_invalid')
    return transaction(async (tx) => {
      const batch = await staffBatch(tx, actor, batchId)
      const created = await tx(
        `insert into public.learning_session_series (batch_id, title, weekdays, local_time, time_zone, duration_minutes, first_date, week_count, meeting_url, created_by)
         values ($1::uuid, $2, $3::smallint[], $4::time, $5, $6, $7::date, $8, $9, $10::uuid)
         returning id`,
        [batch.id, series.title, series.weekdays, series.time, series.timeZone, series.durationMinutes, series.firstDate, series.weekCount, series.meetingUrl, actor.actorId],
      )
      const seriesId = String(created[0]!.id)
      for (const occurrence of occurrences) {
        await tx(
          `insert into public.learning_batch_sessions (batch_id, series_id, title, starts_at, duration_minutes, meeting_url, created_by)
           values ($1::uuid, $2::uuid, $3, $4::timestamptz, $5, $6, $7::uuid)`,
          [batch.id, seriesId, occurrence.title, occurrence.startsAt.toISOString(), series.durationMinutes, series.meetingUrl, actor.actorId],
        )
      }
      await audit(tx, actor.actorId, 'learning.session_series_created', batch.courseId, { batchId: batch.id, seriesId, sessions: occurrences.length })
      return { seriesId, count: occurrences.length }
    })
  }

  async function update(actor: BatchActor, sessionId: string, session: SessionInput) {
    const startsAt = sessionStartUtc(session)
    if (!startsAt) throw new SessionError('session_time_invalid')
    return transaction(async (tx) => {
      const current = await staffSession(tx, actor, sessionId)
      await tx(
        `update public.learning_batch_sessions
         set title = $2, description = $3, starts_at = $4::timestamptz, duration_minutes = $5, meeting_url = $6, updated_at = now()
         where id = $1::uuid`,
        [sessionId, session.title, session.description, startsAt.toISOString(), session.durationMinutes, session.meetingUrl],
      )
      await audit(tx, actor.actorId, 'learning.session_updated', current.courseId, { batchId: current.session.batchId, sessionId })
    })
  }

  /** Cancels one session, or (restOfSeries) it and every later session of its series. */
  async function cancel(actor: BatchActor, sessionId: string, options: { restOfSeries?: boolean } = {}) {
    return transaction(async (tx) => {
      const current = await staffSession(tx, actor, sessionId)
      const rows = options.restOfSeries && current.session.seriesId
        ? await tx(
          `update public.learning_batch_sessions
           set status = 'cancelled', cancelled_at = now(), updated_at = now()
           where series_id = $1::uuid and starts_at >= $2::timestamptz and status = 'scheduled'
           returning id`,
          [current.session.seriesId, current.session.startsAt],
        )
        : await tx(
          `update public.learning_batch_sessions
           set status = 'cancelled', cancelled_at = now(), updated_at = now()
           where id = $1::uuid and status = 'scheduled'
           returning id`,
          [sessionId],
        )
      await audit(tx, actor.actorId, 'learning.session_cancelled', current.courseId, { batchId: current.session.batchId, sessions: rows.length })
      return rows.length
    })
  }

  /** The batch's learners with their join time and mark for one session (staff). */
  async function attendees(actor: BatchActor, sessionId: string): Promise<{ session: BatchSession; attendees: SessionAttendee[] }> {
    const rows = await query(
      `select ${SESSION_COLUMNS}
       from public.learning_batch_sessions session
       inner join public.learning_course_batches batch on batch.id = session.batch_id
       where session.id = $2::uuid and ($3::boolean or ${batchStaffAccessSql('batch', '$1::uuid')})`,
      [actor.actorId, sessionId, Boolean(actor.allCourses)],
    )
    if (!rows[0]) throw new SessionError('session_not_found')
    const session = mapSession(rows[0])
    const people = await query(
      `select enrollment.id as enrollment_id, enrollment.learner_id, profile.full_name,
              attendance.first_joined_at, coalesce(attendance.join_count, 0) as join_count, attendance.status as mark
       from public.learning_enrollments enrollment
       inner join public.profiles profile on profile.id = enrollment.learner_id
       left join public.learning_session_attendance attendance
         on attendance.session_id = $2::uuid and attendance.learner_id = enrollment.learner_id
       where enrollment.batch_id = $1::uuid and enrollment.status in ('active', 'completed')
       order by profile.full_name, enrollment.id
       limit 2000`,
      [session.batchId, sessionId],
    )
    return {
      session,
      attendees: people.map((row) => ({
        learnerId: String(row.learner_id),
        enrollmentId: String(row.enrollment_id),
        name: String(row.full_name ?? '').trim() || 'Sea N Shore member',
        firstJoinedAt: iso(row.first_joined_at),
        joinCount: Number(row.join_count ?? 0),
        mark: row.mark === 'present' || row.mark === 'absent' || row.mark === 'excused' ? row.mark : null,
      })),
    }
  }

  /**
   * Marks attendance after a session has started (staff): explicit marks per learner, or everyone who joined as
   * present. Each changed learner's certificate is checked again (the attendance rule may now be met).
   */
  async function mark(actor: BatchActor, sessionId: string, input: { marks?: { learnerId: string; mark: AttendanceMark }[]; joinedPresent?: boolean }, now = new Date()) {
    return transaction(async (tx) => {
      const current = await staffSession(tx, actor, sessionId)
      if (Date.parse(current.session.startsAt) > now.getTime()) throw new SessionError('session_time_invalid')
      const changed = new Set<string>()
      if (input.joinedPresent) {
        const rows = await tx(
          `update public.learning_session_attendance
           set status = 'present', marked_by = $2::uuid, marked_at = now(), updated_at = now()
           where session_id = $1::uuid and first_joined_at is not null and status is null
           returning enrollment_id`,
          [sessionId, actor.actorId],
        )
        rows.forEach((row) => changed.add(String(row.enrollment_id)))
      }
      for (const entry of input.marks ?? []) {
        const rows = await tx(
          `insert into public.learning_session_attendance (session_id, learner_id, enrollment_id, status, marked_by, marked_at)
           select $1::uuid, enrollment.learner_id, enrollment.id, $3, $4::uuid, now()
           from public.learning_enrollments enrollment
           where enrollment.learner_id = $2::uuid and enrollment.batch_id = $5::uuid and enrollment.status in ('active', 'completed')
           on conflict (session_id, learner_id) do update
             set status = excluded.status, marked_by = excluded.marked_by, marked_at = now(), updated_at = now()
           returning enrollment_id`,
          [sessionId, entry.learnerId, entry.mark, actor.actorId, current.session.batchId],
        )
        rows.forEach((row) => changed.add(String(row.enrollment_id)))
      }
      for (const enrollmentId of changed) await recheckCertificateAfterAttendance(tx, enrollmentId)
      await audit(tx, actor.actorId, 'learning.session_attendance_marked', current.courseId, { batchId: current.session.batchId, sessionId, learners: changed.size })
      return changed.size
    })
  }

  /** Attaches a recording (a link, or an uploaded file the caller has already checked), replacing any earlier one. */
  async function attachRecording(actor: BatchActor, sessionId: string, recording: { kind: 'link'; url: string } | { kind: 'upload'; path: string; contentType: string }) {
    return transaction(async (tx) => {
      const current = await staffSession(tx, actor, sessionId)
      await tx(
        `update public.learning_batch_sessions
         set recording_kind = $2, recording_url = $3, recording_path = $4, recording_content_type = $5,
             recording_added_at = now(), recording_added_by = $6::uuid, updated_at = now()
         where id = $1::uuid`,
        recording.kind === 'link'
          ? [sessionId, 'link', recording.url, null, null, actor.actorId]
          : [sessionId, 'upload', null, recording.path, recording.contentType, actor.actorId],
      )
      await audit(tx, actor.actorId, 'learning.session_recording_attached', current.courseId, { batchId: current.session.batchId, sessionId, kind: recording.kind })
      return current
    })
  }

  async function removeRecording(actor: BatchActor, sessionId: string) {
    return transaction(async (tx) => {
      const current = await staffSession(tx, actor, sessionId)
      await tx(
        `update public.learning_batch_sessions
         set recording_kind = null, recording_url = null, recording_path = null, recording_content_type = null,
             recording_added_at = null, recording_added_by = null, updated_at = now()
         where id = $1::uuid`,
        [sessionId],
      )
      await audit(tx, actor.actorId, 'learning.session_recording_removed', current.courseId, { batchId: current.session.batchId, sessionId })
    })
  }

  /** The learner's batch sessions (their own marks only), or null when they are not in a batch of this course. */
  async function listForLearner(learnerId: string, courseId: string): Promise<LearnerBatchSessions | null> {
    const batch = await learnerBatch(query, learnerId, courseId)
    if (!batch) return null
    const rows = await query(
      `select ${SESSION_COLUMNS}, attendance.status as mark, (attendance.first_joined_at is not null) as joined
       from public.learning_batch_sessions session
       left join public.learning_session_attendance attendance
         on attendance.session_id = session.id and attendance.learner_id = $2::uuid
       where session.batch_id = $1::uuid
       order by session.starts_at asc, session.id
       limit 500`,
      [batch.batch_id, learnerId],
    )
    return {
      batch: { id: String(batch.batch_id), title: String(batch.title), timeZone: String(batch.time_zone) },
      enrollmentId: String(batch.enrollment_id),
      minAttendancePercent: batch.min_attendance_percent === null || batch.min_attendance_percent === undefined ? null : Number(batch.min_attendance_percent),
      sessions: rows.map((row) => ({
        ...mapSession(row),
        mark: row.mark === 'present' || row.mark === 'absent' || row.mark === 'excused' ? row.mark : null,
        joined: row.joined === true,
      })),
    }
  }

  /** The learner's next sessions across their batches (My Learning). */
  async function upcomingForLearner(learnerId: string, limit = 5, now = new Date()): Promise<UpcomingLearnerSession[]> {
    const rows = await query(
      `select ${SESSION_COLUMNS}, course.title as course_title, course.slug as course_slug, batch.title as batch_title
       from public.learning_enrollments enrollment
       inner join public.learning_courses course on course.id = enrollment.course_id and course.batch_mode = 'batches'
       inner join public.learning_course_batches batch on batch.id = enrollment.batch_id and batch.status <> 'archived'
       inner join public.learning_batch_sessions session on session.batch_id = batch.id
       where enrollment.learner_id = $1::uuid and enrollment.status in ('active', 'completed')
         and ${enrollmentAccessOpenSql('enrollment')}
         and session.status = 'scheduled'
         and session.starts_at + make_interval(mins => session.duration_minutes) > $2::timestamptz
       order by session.starts_at asc
       limit $3`,
      [learnerId, now.toISOString(), Math.max(1, Math.min(20, limit))],
    )
    return rows.map((row) => ({ ...mapSession(row), courseTitle: String(row.course_title), courseSlug: String(row.course_slug), batchTitle: String(row.batch_title) }))
  }

  /**
   * One session for a viewer: a learner in its batch (open access) or the batch's staff. Used by Join, the calendar
   * file and the recording. Null for anyone else (the routes answer 404).
   */
  async function getForViewer(viewer: BatchActor, sessionId: string) {
    const rows = await query(
      `select ${SESSION_COLUMNS}, session.recording_path, batch.title as batch_title, batch.course_id,
              course.title as course_title, course.slug as course_slug,
              ($3::boolean or ${batchStaffAccessSql('batch', '$1::uuid')}) as is_staff,
              (select enrollment.id from public.learning_enrollments enrollment
                where enrollment.batch_id = batch.id and enrollment.learner_id = $1::uuid
                  and enrollment.status in ('active', 'completed') and ${enrollmentAccessOpenSql('enrollment')}) as enrollment_id
       from public.learning_batch_sessions session
       inner join public.learning_course_batches batch on batch.id = session.batch_id
       inner join public.learning_courses course on course.id = batch.course_id
       where session.id = $2::uuid`,
      [viewer.actorId, sessionId, Boolean(viewer.allCourses)],
    )
    const row = rows[0]
    if (!row || (row.is_staff !== true && !row.enrollment_id)) return null
    return {
      session: mapSession(row),
      recordingPath: row.recording_path ? String(row.recording_path) : null,
      batchTitle: String(row.batch_title),
      courseId: String(row.course_id),
      courseTitle: String(row.course_title),
      courseSlug: String(row.course_slug),
      isStaff: row.is_staff === true,
      enrollmentId: row.enrollment_id ? String(row.enrollment_id) : null,
    }
  }

  /** Every session of a batch for its calendar file: a learner in it or its staff. */
  async function batchCalendar(viewer: BatchActor, batchId: string) {
    const rows = await query(
      `select batch.id, batch.title, course.title as course_title, course.slug as course_slug,
              ($3::boolean or ${batchStaffAccessSql('batch', '$1::uuid')}) as is_staff,
              exists (select 1 from public.learning_enrollments enrollment
                where enrollment.batch_id = batch.id and enrollment.learner_id = $1::uuid
                  and enrollment.status in ('active', 'completed') and ${enrollmentAccessOpenSql('enrollment')}) as is_learner
       from public.learning_course_batches batch
       inner join public.learning_courses course on course.id = batch.course_id
       where batch.id = $2::uuid`,
      [viewer.actorId, batchId, Boolean(viewer.allCourses)],
    )
    const row = rows[0]
    if (!row || (row.is_staff !== true && row.is_learner !== true)) return null
    const sessions = await query(
      `select ${SESSION_COLUMNS} from public.learning_batch_sessions session
       where session.batch_id = $1::uuid and session.status = 'scheduled'
       order by session.starts_at limit 500`,
      [batchId],
    )
    return { batchTitle: String(row.title), courseTitle: String(row.course_title), courseSlug: String(row.course_slug), sessions: sessions.map(mapSession) }
  }

  /** Records a learner's join (first and last time, count). Only while Join is open; the caller checked the window. */
  async function recordJoin(learnerId: string, enrollmentId: string, sessionId: string) {
    await query(
      `insert into public.learning_session_attendance (session_id, learner_id, enrollment_id, first_joined_at, last_joined_at, join_count)
       values ($1::uuid, $2::uuid, $3::uuid, now(), now(), 1)
       on conflict (session_id, learner_id) do update
         set first_joined_at = coalesce(learning_session_attendance.first_joined_at, now()),
             last_joined_at = now(),
             join_count = learning_session_attendance.join_count + 1,
             updated_at = now()`,
      [sessionId, learnerId, enrollmentId],
    )
  }

  /** The learner's attendance for the certificate rule (null when not in a batch or no rule). */
  async function certificateAttendance(learnerId: string, courseId: string, now = new Date()) {
    const sessions = await listForLearner(learnerId, courseId)
    if (!sessions || sessions.minAttendancePercent === null) return null
    const summary = attendanceSummary(sessions.sessions.map((session) => ({
      startsAt: session.startsAt,
      status: session.status,
      mark: session.mark,
      joined: session.joined && Date.parse(session.startsAt) <= now.getTime(),
    })))
    return { required: sessions.minAttendancePercent, ...summary }
  }

  return {
    listForStaff, createOne, createSeries, update, cancel, attendees, mark, attachRecording, removeRecording,
    listForLearner, upcomingForLearner, getForViewer, batchCalendar, recordJoin, certificateAttendance,
  }
}

export const sessionRepository = createSessionRepository()
