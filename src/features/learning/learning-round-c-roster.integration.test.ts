import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { QueryResultRow } from 'pg'
import { createTestDatabase, type TestDatabase } from '@/lib/db/test-database'

/**
 * Learning round C (C1) against the real schema (PGlite): the roster columns, adding a member or an invitation by
 * email, the per-person limit, invitations claimed after sign-up, and the audited export (no personal data in the
 * audit row). Fixture names and addresses are placeholders.
 */

let db: TestDatabase

vi.mock('@/lib/db/client', () => ({
  query: (text: string, values?: readonly unknown[]) => db.query(text, values),
  withTransaction: <T,>(work: (client: { query: (text: string, values?: readonly unknown[]) => Promise<{ rows: QueryResultRow[] }> }) => Promise<T>) =>
    db.transaction((query) => work({ query: async (text, values) => ({ rows: await query(text, values) }) })),
}))

const { courseRosterRepository, courseInvitationClaims } = await import('./course-roster-repository')
const { createCourseInvitationEmailRepository, createCourseInvitationWorker } = await import('./course-invitation-email')
const { rosterToCsv, ROSTER_ENROL_LIMITS } = await import('./course-roster')
const fixtures = await import('./learning-test-fixtures')

beforeAll(async () => {
  db = await createTestDatabase()
}, 120_000)

afterAll(async () => {
  await db?.close()
})

let sequence = 0
async function member(label: string) {
  sequence += 1
  const profileId = await fixtures.createProfile(db.query, label)
  const email = `fixture-member-${sequence}@example.test`
  await db.query(
    `insert into public.identity_accounts (profile_id, provider, provider_subject, email, email_verified) values ($1, 'cognito', $2, $3, true)`,
    [profileId, `fixture-sub-${sequence}`, email],
  )
  return { profileId, email }
}

async function signUp(email: string, label: string) {
  sequence += 1
  const profileId = await fixtures.createProfile(db.query, label)
  await db.query(
    `insert into public.identity_accounts (profile_id, provider, provider_subject, email, email_verified) values ($1, 'cognito', $2, $3, true)`,
    [profileId, `fixture-sub-${sequence}`, email],
  )
  return profileId
}

describe('learner roster (C1)', () => {
  it('lists progress, last activity, best quiz score and certificate status for the course team only', async () => {
    const mentor = await fixtures.createActiveMentor(db.query)
    const course = await fixtures.createPublishedCourse(db.query, mentor)
    const learner = await fixtures.enrollLearner(db.query, course.courseId, 'Fixture Learner A', 3)
    await fixtures.completeLessons(db.query, learner.enrollmentId, [course.lessons.intro!, course.lessons.video!, course.lessons.quiz!])
    const quiz = course.quiz!
    await fixtures.recordQuizAttempt(db.query, { quizId: quiz.quizId, enrollmentId: learner.enrollmentId, learnerId: learner.learnerId, answers: [{ questionId: quiz.questionIds[0]!, optionId: quiz.optionIds[0]![1]!, correctOptionId: quiz.optionIds[0]![0]! }] })
    await db.query(`update public.learning_quiz_attempts set attempt_number = 1 where enrollment_id = $1`, [learner.enrollmentId])
    const second = await db.query(
      `insert into public.learning_quiz_attempts (quiz_id, enrollment_id, learner_id, score, total_questions, percentage, pass_percentage, passed, attempt_number)
       values ($1, $2, $3, 1, 1, 100, 70, true, 2) returning id`,
      [quiz.quizId, learner.enrollmentId, learner.learnerId],
    )
    expect(second).toHaveLength(1)

    const { learners, course: managed } = await courseRosterRepository.list({ actorId: mentor.userId, courseId: course.courseId })
    expect(managed.openToNewLearners).toBe(true)
    expect(learners).toHaveLength(1)
    expect(learners[0]).toMatchObject({
      name: 'Fixture Learner A',
      source: 'free',
      completedLessons: 3,
      totalLessons: 6,
      progressPercent: 50,
      certificate: 'none',
      quizScores: [{ bestPercentage: 100, passed: true }],
    })
    expect(Date.parse(learners[0]!.lastActiveAt)).toBeGreaterThan(Date.parse(learners[0]!.enrolledAt))

    const stranger = await fixtures.createActiveMentor(db.query)
    await expect(courseRosterRepository.list({ actorId: stranger.userId, courseId: course.courseId })).rejects.toThrow('course_not_found')
    // A learner of the course does not see its roster.
    await expect(courseRosterRepository.list({ actorId: learner.learnerId, courseId: course.courseId })).rejects.toThrow('course_not_found')
    // Platform administrators do.
    await expect(courseRosterRepository.list({ actorId: stranger.userId, courseId: course.courseId, allCourses: true })).resolves.toMatchObject({ learners: [{ name: 'Fixture Learner A' }] })
  }, 120_000)

  it('enrols a member by email now, with the trainer recorded and a notification, and reopens ended access', async () => {
    const mentor = await fixtures.createActiveMentor(db.query)
    const course = await fixtures.createPublishedCourse(db.query, mentor, { priceMinor: 100_000 })
    const learner = await member('Fixture Learner B')
    const access = { actorId: mentor.userId, courseId: course.courseId }

    await expect(courseRosterRepository.enrolByEmail(access, learner.email)).resolves.toEqual({ kind: 'enrolled', name: 'Fixture Learner B' })
    const [enrollment] = await db.query(
      `select id, enrollment_source, enrolled_by, status, access_expires_at from public.learning_enrollments where course_id = $1 and learner_id = $2`,
      [course.courseId, learner.profileId],
    )
    expect(enrollment).toMatchObject({ enrollment_source: 'trainer', enrolled_by: mentor.userId, status: 'active', access_expires_at: null })
    expect(await db.query(`select count(*)::int as count from public.notifications where recipient_id = $1 and notification_type = 'learning_enrolled'`, [learner.profileId])).toEqual([{ count: 1 }])
    await expect(courseRosterRepository.enrolByEmail(access, learner.email)).resolves.toEqual({ kind: 'already_enrolled', name: 'Fixture Learner B' })

    // Access that ended is reopened as lifetime access.
    await db.query(`update public.learning_enrollments set access_expires_at = now() - interval '1 day' where id = $1`, [enrollment!.id])
    await expect(courseRosterRepository.enrolByEmail(access, learner.email)).resolves.toMatchObject({ kind: 'enrolled' })
    expect(await db.query(`select access_expires_at from public.learning_enrollments where id = $1`, [enrollment!.id])).toEqual([{ access_expires_at: null }])

    const audits = await db.query(
      `select action, target_type, target_id, metadata from public.audit_events where actor_id = $1 and action = 'learning.roster_enrolled' order by id`,
      [mentor.userId],
    )
    expect(audits.map((row) => row.metadata)).toEqual([{ result: 'enrolled' }, { result: 'already_enrolled' }, { result: 'enrolled' }])
    expect(JSON.stringify(audits)).not.toContain(learner.email)
    expect(JSON.stringify(audits)).not.toContain('Fixture Learner B')
  }, 120_000)

  it('invites someone who is not a member, sends one email, and enrols them once they sign up with that address', async () => {
    const mentor = await fixtures.createActiveMentor(db.query)
    const course = await fixtures.createPublishedCourse(db.query, mentor)
    const access = { actorId: mentor.userId, courseId: course.courseId }
    const email = `fixture-invitee-${Date.now()}@example.test`

    await expect(courseRosterRepository.enrolByEmail(access, email)).resolves.toEqual({ kind: 'invited' })
    await expect(courseRosterRepository.enrolByEmail(access, email)).resolves.toEqual({ kind: 'already_invited' })
    expect((await courseRosterRepository.list(access)).invitations).toMatchObject([{ email, emailStatus: 'pending' }])

    const sent: Array<{ to: string; subject: string; idempotencyKey?: string }> = []
    const worker = createCourseInvitationWorker({
      repository: createCourseInvitationEmailRepository(),
      claims: { sweep: async () => 0 },
      resend: { sendEmail: async (message) => { sent.push(message); return { messageId: `msg-${sent.length}` } } },
      siteUrl: 'https://seanshore.test',
    })
    expect(await worker.runSweep()).toMatchObject({ claimed: 1, sent: 1 })
    expect(await worker.runSweep()).toMatchObject({ claimed: 0, sent: 0 })
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ to: email, idempotencyKey: expect.stringMatching(/^learning-course-invitation\//) })
    expect(sent[0]!.subject).toContain('on Sea N Shore')

    const profileId = await signUp(email, 'Fixture Invitee')
    await expect(courseInvitationClaims.forProfile(profileId)).resolves.toBe(1)
    await expect(courseInvitationClaims.forProfile(profileId)).resolves.toBe(0)
    expect(await db.query(
      `select enrollment_source, enrolled_by from public.learning_enrollments where course_id = $1 and learner_id = $2`,
      [course.courseId, profileId],
    )).toEqual([{ enrollment_source: 'trainer', enrolled_by: mentor.userId }])
    expect((await courseRosterRepository.list(access)).invitations).toEqual([])
  }, 120_000)

  it('cancels an invitation, and an unverified address is never claimed', async () => {
    const mentor = await fixtures.createActiveMentor(db.query)
    const course = await fixtures.createPublishedCourse(db.query, mentor)
    const access = { actorId: mentor.userId, courseId: course.courseId }
    const email = `fixture-unverified-${Date.now()}@example.test`
    await courseRosterRepository.enrolByEmail(access, email)
    const profileId = await fixtures.createProfile(db.query, 'Fixture Unverified')
    await db.query(
      `insert into public.identity_accounts (profile_id, provider, provider_subject, email, email_verified) values ($1, 'cognito', $2, $3, false)`,
      [profileId, `fixture-unverified-${Date.now()}`, email],
    )
    await expect(courseInvitationClaims.sweep()).resolves.toBe(0)

    const [invitation] = (await courseRosterRepository.list(access)).invitations
    await courseRosterRepository.cancelInvitation(access, invitation!.id)
    await expect(courseRosterRepository.cancelInvitation(access, invitation!.id)).rejects.toThrow('invitation_not_found')
    expect((await courseRosterRepository.list(access)).invitations).toEqual([])
  }, 120_000)

  it('limits how many learners one person can add in an hour', async () => {
    const mentor = await fixtures.createActiveMentor(db.query)
    const course = await fixtures.createPublishedCourse(db.query, mentor)
    await db.query(
      `insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
       select $1, 'learning.roster_enrolled', 'learning_course', $2, '{"result":"invited"}'::jsonb from generate_series(1, $3::int)`,
      [mentor.userId, course.courseId, ROSTER_ENROL_LIMITS.perHour],
    )
    await expect(courseRosterRepository.enrolByEmail({ actorId: mentor.userId, courseId: course.courseId }, 'fixture-over-limit@example.test'))
      .rejects.toThrow('roster_enrol_rate_limited')
  }, 120_000)

  it('exports the roster as CSV and records who exported which course and how many rows, without personal data', async () => {
    const mentor = await fixtures.createActiveMentor(db.query)
    const course = await fixtures.createPublishedCourse(db.query, mentor)
    await fixtures.enrollLearner(db.query, course.courseId, '=Fixture Formula')
    await fixtures.enrollLearner(db.query, course.courseId, 'Fixture Learner C')

    const { learners } = await courseRosterRepository.exportRoster({ actorId: mentor.userId, courseId: course.courseId })
    const csv = rosterToCsv(learners)
    expect(csv.split('\r\n')[0]).toBe('﻿Name,Rank,Enrolled,How,Status,Progress %,Lessons completed,Last active,Quiz best scores,Certificate,Access until')
    expect(csv).toContain("'=Fixture Formula")
    const audit = await db.query(
      `select target_type, target_id, metadata from public.audit_events where actor_id = $1 and action = 'learning.roster_exported'`,
      [mentor.userId],
    )
    expect(audit).toEqual([{ target_type: 'learning_course', target_id: course.courseId, metadata: { rows: 2 } }])

    const stranger = await fixtures.createActiveMentor(db.query)
    await expect(courseRosterRepository.exportRoster({ actorId: stranger.userId, courseId: course.courseId })).rejects.toThrow('course_not_found')
    expect(await db.query(`select count(*)::int as count from public.audit_events where actor_id = $1`, [stranger.userId])).toEqual([{ count: 0 }])
  }, 120_000)
})
