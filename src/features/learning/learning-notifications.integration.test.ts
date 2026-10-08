import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createTestDatabase, type TestDatabase } from '@/lib/db/test-database'
import { createLearningAdminRepository } from './admin-repository'
import { createAssignmentGradingRepository } from './assignment-grading-repository'
import { createCertificateRepository } from './certificate-repository'
import { createEnrollmentRepository } from './enrollment-repository'
import { createLearningEmailPreferences, createLearningEmailRepository, createLearningEmailWorker } from './learning-email-sending'
import { recordLearningNotification, sweepReleasedLessons, sweepSubmissionsToGrade } from './learning-notifications'
import { createActiveMentor, createAdministrator, createProfile, createPublishedCourse, enrollLearner } from './learning-test-fixtures'

/**
 * Learning notifications (learning round A, A6) against the real schema (PGlite): each event
 * notifies once, digests group and never flood, a failed notification never breaks the action it
 * belongs to, and the email queue respects the Learning email setting and its unsubscribe link.
 */

let db: TestDatabase

beforeAll(async () => {
  db = await createTestDatabase()
}, 120_000)

afterAll(async () => {
  await db?.close()
})

async function notificationsFor(recipientId: string) {
  return db.query(
    `select notification_type::text as type, details, read_at from public.notifications where recipient_id = $1 order by created_at, id`,
    [recipientId],
  )
}

async function emailsFor(recipientId: string) {
  return db.query(`select id, kind, status, payload from public.learning_notification_emails where recipient_id = $1 order by created_at, id`, [recipientId])
}

async function verifyEmail(profileId: string, email: string) {
  await db.query(
    `insert into public.identity_accounts (profile_id, provider, provider_subject, email, email_verified)
     values ($1, 'cognito', gen_random_uuid()::text, $2, true)`,
    [profileId, email],
  )
}

async function submitAttempt(course: Awaited<ReturnType<typeof createPublishedCourse>>, enrollmentId: string, learnerId: string) {
  const rows = await db.query(
    `insert into public.learning_assignment_attempts (assignment_id, lesson_id, enrollment_id, learner_id, attempt_number, response_text, status, submitted_at)
     values ((select id from public.learning_assignments where lesson_id = $1), $1, $2, $3,
             (select coalesce(max(attempt_number), 0) + 1 from public.learning_assignment_attempts where enrollment_id = $2), 'My report.', 'submitted', now())
     returning id`,
    [course.lessons.assignment, enrollmentId, learnerId],
  )
  return rows[0]!.id as string
}

describe('learning notifications', () => {
  it('tells a learner once when they enrol in a free course', async () => {
    const trainer = await createActiveMentor(db.query)
    const course = await createPublishedCourse(db.query, trainer)
    const learnerId = await createProfile(db.query, 'Learner A')
    const repository = createEnrollmentRepository({ query: db.query })

    await repository.enrollFreeCourse(learnerId, course.courseId)
    await repository.enrollFreeCourse(learnerId, course.courseId)

    const notifications = await notificationsFor(learnerId)
    expect(notifications).toHaveLength(1)
    expect(notifications[0]).toMatchObject({ type: 'learning_enrolled', details: { courseTitle: 'Fixture SIRE Readiness', courseSlug: course.slug }, read_at: null })
    expect((await emailsFor(learnerId)).map((email) => [email.kind, email.status])).toEqual([['enrolled', 'pending']])
  }, 120_000)

  it('tells the learner about a grade, and about a certificate only when it is first issued', async () => {
    const trainer = await createActiveMentor(db.query)
    const course = await createPublishedCourse(db.query, trainer)
    const { enrollmentId, learnerId } = await enrollLearner(db.query, course.courseId, 'Learner B')
    // Everything except the assignment is done, so passing it completes the course.
    for (const lessonId of Object.values(course.lessons).filter((id) => id !== course.lessons.assignment)) {
      await db.query(`insert into public.learning_progress (enrollment_id, lesson_id, completed, completed_at, viewed_at) values ($1, $2, true, now(), now())`, [enrollmentId, lessonId])
    }
    const attemptId = await submitAttempt(course, enrollmentId, learnerId)

    const result = await createAssignmentGradingRepository({ transaction: db.transaction }).grade(trainer.userId, attemptId, { scorePoints: 90, feedback: 'Good work.', decision: 'pass' })
    expect(result.enrollmentCompleted).toBe(true)
    await createCertificateRepository({ transaction: db.transaction }).ensureCertificateForEnrollment(learnerId, enrollmentId)

    const types = (await notificationsFor(learnerId)).map((row) => row.type)
    expect(types.sort()).toEqual(['learning_assignment_graded', 'learning_certificate_issued'])
    const graded = (await notificationsFor(learnerId)).find((row) => row.type === 'learning_assignment_graded')
    expect(graded?.details).toMatchObject({ lessonTitle: 'Inspection report', percentage: 90, passed: true })
    const certificate = (await notificationsFor(learnerId)).find((row) => row.type === 'learning_certificate_issued')
    expect(certificate?.details).toMatchObject({ verificationCode: expect.any(String) })
  }, 120_000)

  it('tells the trainer when Sea N Shore approves a course or asks for changes', async () => {
    const trainer = await createActiveMentor(db.query)
    const adminId = await createAdministrator(db.query)
    const course = await createPublishedCourse(db.query, trainer)
    await db.query(`update public.learning_courses set status = 'submitted', published_at = null, approved_at = null where id = $1`, [course.courseId])
    await db.query(`insert into public.learning_course_submissions (course_id, submitted_by, outcome) values ($1, $2, 'pending')`, [course.courseId, trainer.userId])
    const admin = createLearningAdminRepository({ transaction: db.transaction })

    await admin.reviewCourse(adminId, course.courseId, 'changes_requested', 'Add a summary to each material.')
    await db.query(`update public.learning_courses set status = 'submitted' where id = $1`, [course.courseId])
    await db.query(`insert into public.learning_course_submissions (course_id, submitted_by, outcome, submitted_at) values ($1, $2, 'pending', now() + interval '1 minute')`, [course.courseId, trainer.userId])
    await admin.reviewCourse(adminId, course.courseId, 'approved', null)

    const rows = await notificationsFor(trainer.userId)
    expect(rows.map((row) => row.type)).toEqual(['learning_course_changes_requested', 'learning_course_approved'])
    expect(rows[1]!.details).toMatchObject({ studioCourseId: course.courseId, revision: false })
    const status = await db.query(`select status from public.learning_courses where id = $1`, [course.courseId])
    expect(status[0]!.status).toBe('published')
  }, 120_000)

  it('never breaks the action it belongs to when a notification cannot be written', async () => {
    const profileId = await createProfile(db.query, 'Learner C')
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    await db.transaction(async (query) => {
      await query(`update public.profiles set full_name = 'Learner C (edited)' where id = $1`, [profileId])
      // A course that does not exist: the insert fails on its foreign key, inside a savepoint.
      const ok = await recordLearningNotification(query, {
        recipientId: profileId,
        kind: 'enrolled',
        courseId: '00000000-0000-4000-8000-000000000000',
        details: { courseTitle: 'Missing', courseSlug: 'missing' },
        dedupeKey: 'test:missing-course',
      }, { inTransaction: true })
      expect(ok).toBe(false)
      await query(`update public.profiles set headline = 'Second officer' where id = $1`, [profileId])
    })
    errors.mockRestore()

    const profile = await db.query(`select full_name, headline from public.profiles where id = $1`, [profileId])
    expect(profile[0]).toMatchObject({ full_name: 'Learner C (edited)', headline: 'Second officer' })
    expect(await notificationsFor(profileId)).toEqual([])
  }, 120_000)

  it('sends one digest for materials released since enrolment, and never announces old releases', async () => {
    const trainer = await createActiveMentor(db.query)
    const course = await createPublishedCourse(db.query, trainer)
    await db.query(`update public.learning_lessons set release_mode = 'drip', drip_delay_days = 3 where id = any($1::uuid[])`, [[course.lessons.checklist, course.lessons.wrapUp]])
    // Enrolled three days ago: both drip materials opened within the last day.
    const recent = await enrollLearner(db.query, course.courseId, 'Learner D')
    await db.query(`update public.learning_enrollments set enrolled_at = now() - interval '3 days' + interval '1 hour' where id = $1`, [recent.enrollmentId])
    // Enrolled a month ago: the materials opened long ago; they are not news.
    const old = await enrollLearner(db.query, course.courseId, 'Learner E', 30)
    const now = new Date(Date.now() + 2 * 60 * 60 * 1000)

    const first = await sweepReleasedLessons(db.transaction, { now })
    const second = await sweepReleasedLessons(db.transaction, { now })

    expect(first.notified).toBe(1)
    expect(second).toEqual({ noticed: 0, notified: 0 })
    const rows = await notificationsFor(recent.learnerId)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ type: 'learning_lessons_released', details: { count: 2, lessonTitle: 'Checklist' } })
    expect(await notificationsFor(old.learnerId)).toEqual([])
  }, 120_000)

  it('gives trainers a daily digest of submissions waiting to be graded', async () => {
    const trainer = await createActiveMentor(db.query)
    const course = await createPublishedCourse(db.query, trainer)
    const one = await enrollLearner(db.query, course.courseId, 'Learner F')
    const two = await enrollLearner(db.query, course.courseId, 'Learner G')
    await submitAttempt(course, one.enrollmentId, one.learnerId)

    await sweepSubmissionsToGrade(db.transaction)
    await submitAttempt(course, two.enrollmentId, two.learnerId)
    await sweepSubmissionsToGrade(db.transaction)
    const idle = await sweepSubmissionsToGrade(db.transaction)

    expect(idle).toEqual({ submissions: 0, notified: 0 })
    const rows = (await notificationsFor(trainer.userId)).filter((row) => row.type === 'learning_submissions_to_grade')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.details).toMatchObject({ count: 2 })
    // One email a day per course, whatever the number of sweeps.
    expect((await emailsFor(trainer.userId)).filter((email) => email.kind === 'submissions_to_grade')).toHaveLength(1)
  }, 120_000)

  it('emails each notification once, honours the Learning email setting and its one-click unsubscribe', async () => {
    const trainer = await createActiveMentor(db.query)
    const course = await createPublishedCourse(db.query, trainer)
    const enrollments = createEnrollmentRepository({ query: db.query })
    const wants = await createProfile(db.query, 'Learner H')
    const optedOut = await createProfile(db.query, 'Learner I')
    const unverified = await createProfile(db.query, 'Learner J')
    await verifyEmail(wants, 'learner-h@example.test')
    await verifyEmail(optedOut, 'learner-i@example.test')
    const preferences = createLearningEmailPreferences({ query: db.query })
    await preferences.setLearningEmails(optedOut, false)
    for (const learner of [wants, optedOut, unverified]) await enrollments.enrollFreeCourse(learner, course.courseId)

    const sendEmail = vi.fn().mockResolvedValue({ messageId: 'message-1' })
    const repository = createLearningEmailRepository({ query: db.query, transaction: db.transaction })
    const worker = createLearningEmailWorker({ repository, resend: { sendEmail }, siteUrl: 'https://seanshore.test' })
    const result = await worker.runSweep(25)
    const again = await worker.runSweep(25)

    expect(result.disabled).toBe(false)
    expect(sendEmail).toHaveBeenCalledTimes(1)
    const sent = sendEmail.mock.calls[0]![0]
    expect(sent).toMatchObject({
      to: 'learner-h@example.test',
      subject: 'You’re enrolled in Fixture SIRE Readiness',
      headers: expect.arrayContaining([{ Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' }]),
    })
    expect(sent.text).toContain(`https://seanshore.test/learn/courses/${course.slug}/learn`)
    expect(again.claimed).toBe(0)
    expect((await emailsFor(optedOut))[0]).toMatchObject({ status: 'skipped' })
    expect((await emailsFor(unverified))[0]).toMatchObject({ status: 'skipped' })
    // Opting out never hides the in-app notification.
    expect(await notificationsFor(optedOut)).toHaveLength(1)

    // The link in the email turns learning emails off for that person only.
    const emailId = (await emailsFor(wants))[0]!.id as string
    expect(sent.headers).toContainEqual({ Name: 'List-Unsubscribe', Value: `<https://seanshore.test/api/email/learning/unsubscribe?token=${emailId}>` })
    expect(await preferences.unsubscribeWithToken(emailId)).toBe(true)
    expect(await preferences.learningEmailsEnabled(wants)).toBe(false)
    expect(await preferences.learningEmailsEnabled(unverified)).toBe(true)
    expect(await preferences.unsubscribeWithToken('11111111-1111-4111-8111-111111111111')).toBe(false)
    expect(await preferences.unsubscribeWithToken('not-a-token')).toBe(false)
  }, 120_000)
})
