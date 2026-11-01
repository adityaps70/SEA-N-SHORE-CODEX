import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { QueryResultRow } from 'pg'
import { createTestDatabase, type TestDatabase } from '@/lib/db/test-database'

/**
 * Learning round D (D2 live sessions) against the real schema (PGlite): a recurring series, staff and learner access,
 * the reminders (queued once per stage, in the learner's time zone), Join recording, attendance marking with the
 * certificate held back by the attendance rule and issued once it is met, recordings, and the member time zone.
 * Fixture names and addresses are placeholders.
 */

let db: TestDatabase

vi.mock('@/lib/db/client', () => ({
  query: (text: string, values?: readonly unknown[]) => db.query(text, values),
  withTransaction: <T,>(work: (client: { query: (text: string, values?: readonly unknown[]) => Promise<{ rows: QueryResultRow[] }> }) => Promise<T>) =>
    db.transaction((query) => work({ query: async (text, values) => ({ rows: await query(text, values) }) })),
}))

const { batchRepository } = await import('./batches/batch-repository')
const { enrollmentRepository } = await import('./enrollment-repository')
const { sessionRepository, SessionError } = await import('./sessions/session-repository')
const { sweepSessionReminders } = await import('./sessions/session-reminders')
const { memberTimeZoneRepository } = await import('./sessions/member-time-zone')
const { finalizeEnrollmentIfComplete } = await import('./learner-progress-repository')
const { learningNotificationCopy } = await import('./learning-notification-copy')
const { utcToZonedInputs } = await import('./sessions/session-time')
const fixtures = await import('./learning-test-fixtures')

beforeAll(async () => {
  db = await createTestDatabase()
}, 120_000)

afterAll(async () => {
  await db?.close()
})

const DAY = 24 * 60 * 60 * 1000
const HOUR = 60 * 60 * 1000

function code(promise: Promise<unknown>) {
  return promise.then(() => 'ok', (error: unknown) => (error instanceof SessionError ? error.code : error instanceof Error ? error.message : String(error)))
}

async function batchWithLearner(options: { minAttendancePercent?: number | null } = {}) {
  const mentor = await fixtures.createActiveMentor(db.query)
  const course = await fixtures.createPublishedCourse(db.query, mentor)
  await batchRepository.saveSettings({ actorId: mentor.userId }, course.courseId, { batchMode: 'batches', dripAnchor: 'enrolment', minAttendancePercent: options.minAttendancePercent ?? null })
  const batchId = await batchRepository.create({ actorId: mentor.userId }, course.courseId, {
    title: 'Fixture Evening batch', startsAt: new Date(Date.now() - 7 * DAY).toISOString(), endsAt: null, seatLimit: null, timeZone: 'Asia/Kolkata', enrolmentOpen: true, status: 'running',
  })
  const learnerId = await fixtures.createProfile(db.query, 'Fixture Batch Learner')
  const { enrollmentId } = await enrollmentRepository.enrollFreeCourse(learnerId, course.courseId, batchId)
  return { mentor, course, batchId, learnerId, enrollmentId }
}

function at(instant: Date) {
  return utcToZonedInputs(instant, 'Asia/Kolkata')
}

async function oneOff(actorId: string, batchId: string, startsAt: Date, title = 'Fixture session') {
  const { date, time } = at(startsAt)
  return sessionRepository.createOne({ actorId }, batchId, { title, description: null, date, time, timeZone: 'Asia/Kolkata', durationMinutes: 60, meetingUrl: 'https://meet.example.test/fixture' })
}

describe('session calendar (D2)', () => {
  it('creates a recurring series as separate sessions and cancels the rest of it', async () => {
    const { mentor, batchId, learnerId, course } = await batchWithLearner()
    const created = await sessionRepository.createSeries({ actorId: mentor.userId }, batchId, {
      title: 'Fixture class', weekdays: [1, 3], time: '19:00', timeZone: 'Asia/Kolkata', firstDate: '2026-11-02', weekCount: 2, durationMinutes: 90, meetingUrl: 'https://zoom.example.test/j/1',
    })
    expect(created.count).toBe(4)
    const { sessions } = await sessionRepository.listForStaff({ actorId: mentor.userId }, batchId)
    expect(sessions.map((session) => [session.title, session.startsAt])).toEqual([
      ['Fixture class · 1', '2026-11-02T13:30:00.000Z'],
      ['Fixture class · 2', '2026-11-04T13:30:00.000Z'],
      ['Fixture class · 3', '2026-11-09T13:30:00.000Z'],
      ['Fixture class · 4', '2026-11-11T13:30:00.000Z'],
    ])
    expect(await sessionRepository.cancel({ actorId: mentor.userId }, sessions[2]!.id, { restOfSeries: true })).toBe(2)

    const learnerView = await sessionRepository.listForLearner(learnerId, course.courseId)
    expect(learnerView?.sessions.map((session) => session.status)).toEqual(['scheduled', 'scheduled', 'cancelled', 'cancelled'])

    const stranger = await fixtures.createProfile(db.query, 'Fixture Stranger')
    expect(await code(sessionRepository.listForStaff({ actorId: stranger }, batchId))).toBe('batch_not_found')
    expect(await sessionRepository.getForViewer({ actorId: stranger }, sessions[0]!.id)).toBeNull()
    expect(await code(sessionRepository.listForStaff({ actorId: learnerId }, batchId))).toBe('batch_not_found')
    expect(await sessionRepository.listForLearner(stranger, course.courseId)).toBeNull()
  })
})

describe('reminders (D2)', () => {
  it('queues the 24-hour and the 1-hour reminder once each, in the learner’s time zone', async () => {
    const { mentor, batchId, learnerId } = await batchWithLearner()
    await memberTimeZoneRepository.save(learnerId, { source: 'manual', timeZone: 'Europe/London' })
    // A fixed clock, far from every other fixture's dates. The sweep covers every batch, so on the real clock this
    // test also picked up the series test's sessions (2–11 Nov 2026) whenever it ran within 24 hours of them.
    const NOW = new Date('2031-03-10T06:00:00.000Z')
    const startsAt = new Date(NOW.getTime() + 20 * HOUR)
    await oneOff(mentor.userId, batchId, startsAt, 'Fixture reminder session')

    expect((await sweepSessionReminders(db.query, NOW)).queued).toBe(1)
    expect((await sweepSessionReminders(db.query, NOW)).queued).toBe(0)
    const later = new Date(startsAt.getTime() - 30 * 60_000)
    expect((await sweepSessionReminders(db.query, later)).queued).toBe(1)
    expect((await sweepSessionReminders(db.query, later)).queued).toBe(0)

    const emails = await db.query(`select kind, payload from public.learning_notification_emails where recipient_id = $1 and kind = 'session_reminder' order by created_at`, [learnerId])
    expect(emails.map((row) => (row.payload as { details: { stage: string } }).details.stage)).toEqual(['24h', '1h'])
    const details = (emails[0]!.payload as { details: Parameters<typeof learningNotificationCopy>[1] }).details
    expect(details.timeZone).toBe('Europe/London')
    const copy = learningNotificationCopy('session_reminder', details)
    expect(copy.message).toMatch(/“Fixture reminder session” in Fixture SIRE Readiness is coming up: .* \(Europe\/London\) \(.* UTC\)\./)
    expect(copy.path).toMatch(/\?tab=sessions$/)
  })
})

describe('join, attendance and the certificate rule (D2)', () => {
  it('records Join, holds the certificate until attendance is met, then issues it', async () => {
    const { mentor, course, batchId, learnerId, enrollmentId } = await batchWithLearner({ minAttendancePercent: 50 })
    const first = await oneOff(mentor.userId, batchId, new Date(Date.now() - 3 * DAY), 'Fixture week 1')
    const second = await oneOff(mentor.userId, batchId, new Date(Date.now() - 2 * DAY), 'Fixture week 2')
    const live = await oneOff(mentor.userId, batchId, new Date(Date.now() - 10 * 60_000), 'Fixture live now')

    const viewer = await sessionRepository.getForViewer({ actorId: learnerId }, live)
    expect(viewer?.enrollmentId).toBe(enrollmentId)
    await sessionRepository.recordJoin(learnerId, enrollmentId, live)
    await sessionRepository.recordJoin(learnerId, enrollmentId, live)
    expect(await db.query(`select join_count, status from public.learning_session_attendance where session_id = $1`, [live])).toEqual([{ join_count: 2, status: null }])

    // Every lesson complete, but 1 of 3 sessions (the live one, joined) is 33%: below the 50% rule.
    await fixtures.completeLessons(db.query, enrollmentId, Object.values(course.lessons))
    await db.transaction((query) => finalizeEnrollmentIfComplete(query, enrollmentId, course.courseId))
    expect(await db.query(`select id from public.learning_certificates where enrollment_id = $1`, [enrollmentId])).toEqual([])
    expect(await sessionRepository.certificateAttendance(learnerId, course.courseId)).toEqual({ required: 50, attended: 1, total: 3, percent: 33 })

    // The trainer excuses week 1 and marks week 2 present: 2 of 2 counted.
    expect(await code(sessionRepository.mark({ actorId: learnerId }, second, { marks: [{ learnerId, mark: 'present' }] }))).toBe('session_not_found')
    await sessionRepository.mark({ actorId: mentor.userId }, first, { marks: [{ learnerId, mark: 'excused' }] })
    await sessionRepository.mark({ actorId: mentor.userId }, second, { marks: [{ learnerId, mark: 'present' }] })
    expect(await db.query(`select count(*)::int as count from public.learning_certificates where enrollment_id = $1`, [enrollmentId])).toEqual([{ count: 1 }])

    const view = await sessionRepository.listForLearner(learnerId, course.courseId)
    expect(view?.sessions.map((session) => session.mark)).toEqual(['excused', 'present', null])
    const audit = await db.query(`select metadata from public.audit_events where action = 'learning.session_attendance_marked' and target_id = $1`, [course.courseId])
    expect(JSON.stringify(audit)).not.toContain('Fixture Batch Learner')
  })

  it('refuses to mark a session that has not started, and marks everyone who joined in one step', async () => {
    const { mentor, batchId, learnerId, enrollmentId } = await batchWithLearner()
    const future = await oneOff(mentor.userId, batchId, new Date(Date.now() + DAY))
    expect(await code(sessionRepository.mark({ actorId: mentor.userId }, future, { joinedPresent: true }))).toBe('session_time_invalid')
    const past = await oneOff(mentor.userId, batchId, new Date(Date.now() - HOUR))
    await sessionRepository.recordJoin(learnerId, enrollmentId, past)
    expect(await sessionRepository.mark({ actorId: mentor.userId }, past, { joinedPresent: true })).toBe(1)
    expect((await sessionRepository.attendees({ actorId: mentor.userId }, past)).attendees).toEqual([
      expect.objectContaining({ learnerId, mark: 'present', joinCount: 1 }),
    ])
  })
})

describe('recordings and time zones (D2)', () => {
  it('shows a recording to the batch only', async () => {
    const { mentor, batchId, learnerId, course } = await batchWithLearner()
    const session = await oneOff(mentor.userId, batchId, new Date(Date.now() - DAY))
    await sessionRepository.attachRecording({ actorId: mentor.userId }, session, { kind: 'link', url: 'https://video.example.test/recording' })
    expect((await sessionRepository.getForViewer({ actorId: learnerId }, session))?.session.recording).toEqual({ kind: 'link', url: 'https://video.example.test/recording' })
    expect((await sessionRepository.listForLearner(learnerId, course.courseId))?.sessions[0]?.recording?.kind).toBe('link')
    const other = await fixtures.createProfile(db.query, 'Fixture Other Learner')
    expect(await sessionRepository.getForViewer({ actorId: other }, session)).toBeNull()
    await sessionRepository.removeRecording({ actorId: mentor.userId }, session)
    expect((await sessionRepository.getForViewer({ actorId: learnerId }, session))?.session.recording).toBeNull()
  })

  it('follows the device zone on Automatic and keeps a chosen zone on manual', async () => {
    const member = await fixtures.createProfile(db.query, 'Fixture Sailor')
    expect(await memberTimeZoneRepository.get(member)).toEqual({ timeZone: null, source: 'auto' })
    expect(await memberTimeZoneRepository.syncDevice(member, 'Asia/Singapore')).toBe(true)
    expect(await memberTimeZoneRepository.syncDevice(member, 'Asia/Singapore')).toBe(false)
    await memberTimeZoneRepository.save(member, { source: 'manual', timeZone: 'Asia/Kolkata' })
    expect(await memberTimeZoneRepository.syncDevice(member, 'Europe/Athens')).toBe(false)
    expect(await memberTimeZoneRepository.get(member)).toEqual({ timeZone: 'Asia/Kolkata', source: 'manual' })
    expect(await memberTimeZoneRepository.syncDevice(member, 'Not/AZone')).toBe(false)
  })
})
