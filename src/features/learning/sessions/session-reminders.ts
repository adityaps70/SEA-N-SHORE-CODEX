import type { QueryResultRow } from 'pg'
import { query as databaseQuery } from '@/lib/db/client'
import { enrollmentAccessOpenSql } from '../course-access'
import { recordLearningNotification } from '../learning-notifications'
import { DEFAULT_TIME_ZONE, isValidTimeZone } from './session-time'

/**
 * Learning round D (D2): reminders 1 day and 1 hour before each live session, for every learner in the batch with open
 * access. Run every few minutes by the outbox worker. Each reminder is a Learning notification (in-app + email, so the
 * Learning email opt-out applies), written once: the dedupe key names the session, the learner and the stage, and rows
 * already written are skipped in SQL. The time in the email is in the learner's own time zone (else Asia/Kolkata).
 */

type Query = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>

export const SESSION_REMINDER_SWEEP_MS = 5 * 60 * 1000

function dedupeKey(sessionId: string, learnerId: string, stage: string) {
  return `learning_session_reminder:${sessionId}:${learnerId}:${stage}`
}

export async function sweepSessionReminders(query: Query = (text, values) => databaseQuery<QueryResultRow>(text, values), now = new Date(), limit = 500) {
  const rows = await query(
    `with due as (
       select session.id as session_id, session.title as session_title, session.starts_at, session.duration_minutes,
              batch.course_id, course.title as course_title, course.slug as course_slug,
              enrollment.learner_id, profile.time_zone,
              case when session.starts_at <= $1::timestamptz + interval '1 hour' then '1h' else '24h' end as stage
       from public.learning_batch_sessions session
       inner join public.learning_course_batches batch on batch.id = session.batch_id and batch.status in ('upcoming', 'running')
       inner join public.learning_courses course on course.id = batch.course_id and course.batch_mode = 'batches'
       inner join public.learning_enrollments enrollment
         on enrollment.batch_id = batch.id and enrollment.status in ('active', 'completed') and ${enrollmentAccessOpenSql('enrollment')}
       inner join public.profiles profile on profile.id = enrollment.learner_id
       where session.status = 'scheduled'
         and session.starts_at > $1::timestamptz
         and session.starts_at <= $1::timestamptz + interval '24 hours'
     )
     select due.*
     from due
     where not exists (
       select 1 from public.notifications existing
       where existing.recipient_id = due.learner_id
         and existing.dedupe_key = 'learning_session_reminder:' || due.session_id || ':' || due.learner_id || ':' || due.stage
     )
     order by due.starts_at
     limit $2`,
    [now.toISOString(), limit],
  )
  let queued = 0
  for (const row of rows) {
    const sessionId = String(row.session_id)
    const learnerId = String(row.learner_id)
    const stage = row.stage === '1h' ? '1h' : '24h'
    const zone = typeof row.time_zone === 'string' && isValidTimeZone(row.time_zone) ? row.time_zone : DEFAULT_TIME_ZONE
    const written = await recordLearningNotification(query, {
      recipientId: learnerId,
      kind: 'session_reminder',
      courseId: String(row.course_id),
      details: {
        courseTitle: String(row.course_title),
        courseSlug: String(row.course_slug),
        sessionId,
        sessionTitle: String(row.session_title),
        startsAt: new Date(String(row.starts_at)).toISOString(),
        durationMinutes: Number(row.duration_minutes),
        timeZone: zone,
        stage,
      },
      dedupeKey: dedupeKey(sessionId, learnerId, stage),
    }, { inTransaction: false })
    if (written) queued += 1
  }
  return { checked: rows.length, queued }
}
