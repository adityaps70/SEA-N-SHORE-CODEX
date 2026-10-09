import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDatabase, type TestDatabase } from '@/lib/db/test-database'
import { candidateCredentialsSql } from '@/features/jobs/candidate-credentials-sql'
import { createCertificateRepository, issueCertificateForCompletedEnrollmentWithQuery } from './certificate-repository'
import { createCertificateSettingsRepository } from './certificate-settings-repository'
import { createLearnerQuizRepository } from './learner-quiz-repository'
import { finalizeEnrollmentIfComplete } from './learner-progress-repository'
import { sweepExpiringCertificates } from './learning-notifications'
import { DEFAULT_CERTIFICATE_SETTINGS } from './certificate-settings'
import { completeLessons, createActiveMentor, createPublishedCourse, enrollLearner } from './learning-test-fixtures'

/**
 * Learning round B (B4, B5) against the real schema (PGlite): certificates copy the course's design, serial prefix
 * and validity; a final quiz can issue them; renewal reminders go out once at 30 and 7 days; members can hide them
 * from their profile and from Jobs matching. Certificates issued before keep their layout and never expire.
 */

let db: TestDatabase

beforeAll(async () => {
  db = await createTestDatabase()
}, 120_000)

afterAll(async () => {
  await db?.close()
})

async function completedLearner(courseId: string, lessons: Record<string, string>, label: string) {
  const learner = await enrollLearner(db.query, courseId, label)
  await completeLessons(db.query, learner.enrollmentId, Object.values(lessons))
  await finalizeEnrollmentIfComplete(db.query, learner.enrollmentId, courseId)
  return learner
}

describe('certificates (round B)', () => {
  it('keeps certificates issued before round B unchanged: original layout, standard number, no expiry', async () => {
    const mentor = await createActiveMentor(db.query)
    const course = await createPublishedCourse(db.query, mentor)
    const learner = await enrollLearner(db.query, course.courseId, 'Fixture Learner L')
    await completeLessons(db.query, learner.enrollmentId, Object.values(course.lessons))
    await db.query(`update public.learning_enrollments set status = 'completed', completed_at = now() where id = $1`, [learner.enrollmentId])
    // As stored before round B: no template key, serial or expiry.
    await db.query(
      `insert into public.learning_certificates (enrollment_id, course_id, learner_id, learner_name, course_title, mentor_name, completed_at)
       values ($1, $2, $3, 'Fixture Learner L', 'Fixture SIRE Readiness', 'Fixture Trainer', now())`,
      [learner.enrollmentId, course.courseId, learner.learnerId],
    )
    const repository = createCertificateRepository({ query: db.query, transaction: db.transaction })
    const certificate = await repository.ensureCertificateForEnrollment(learner.learnerId, learner.enrollmentId)
    expect(certificate).toMatchObject({ templateKey: null, serialNumber: null, expiresAt: null })
    expect(certificate!.certificateNumber).toMatch(/^SNS-\d{4}-[A-F0-9]{12}$/)
    expect(await repository.getCertificateByVerificationCode(certificate!.verificationCode)).toMatchObject({ expiresAt: null })
  }, 120_000)

  it('copies the design, serial prefix and validity when issued, and later course edits never change it', async () => {
    const mentor = await createActiveMentor(db.query)
    const course = await createPublishedCourse(db.query, mentor)
    await db.query(`update public.learning_courses set status = 'draft' where id = $1`, [course.courseId])
    await createCertificateSettingsRepository({ transaction: db.transaction }).save(mentor.userId, course.courseId, {
      ...DEFAULT_CERTIFICATE_SETTINGS,
      template: 'formal',
      signatoryName: 'Capt. Fixture Signatory',
      signatoryTitle: 'Course director',
      serialPrefix: 'SNS-SIRE-',
      validityMonths: 24,
    })
    await db.query(`update public.learning_courses set status = 'published' where id = $1`, [course.courseId])
    const learner = await completedLearner(course.courseId, course.lessons, 'Fixture Learner M')
    const certificate = await createCertificateRepository({ query: db.query, transaction: db.transaction }).ensureCertificateForEnrollment(learner.learnerId, learner.enrollmentId)

    expect(certificate).toMatchObject({ templateKey: 'formal', signatoryName: 'Capt. Fixture Signatory', signatoryTitle: 'Course director' })
    expect(certificate!.serialNumber).toMatch(new RegExp(`^SNS-SIRE-${new Date().getUTCFullYear()}-[A-F0-9]{8}$`))
    const months = (new Date(certificate!.expiresAt!).getTime() - new Date(certificate!.issuedAt).getTime()) / (30.44 * 24 * 3600 * 1000)
    expect(Math.round(months)).toBe(24)

    await db.query(`update public.learning_courses set certificate_template = 'minimal', certificate_validity_months = null where id = $1`, [course.courseId])
    const again = await issueCertificateForCompletedEnrollmentWithQuery(db.query, learner.enrollmentId)
    expect(again).toMatchObject({ templateKey: 'formal', serialNumber: certificate!.serialNumber, expiresAt: certificate!.expiresAt })
  }, 120_000)

  it('issues on passing the chosen final quiz, before every material is complete', async () => {
    const mentor = await createActiveMentor(db.query)
    const course = await createPublishedCourse(db.query, mentor)
    await db.query(`update public.learning_courses set status = 'draft' where id = $1`, [course.courseId])
    await createCertificateSettingsRepository({ transaction: db.transaction }).save(mentor.userId, course.courseId, {
      ...DEFAULT_CERTIFICATE_SETTINGS,
      issueTrigger: 'final_quiz',
      finalLessonId: course.lessons.quiz!,
    })
    await db.query(`update public.learning_courses set status = 'published' where id = $1`, [course.courseId])
    expect(await db.query(`select lesson.id from public.learning_lessons lesson inner join public.learning_course_sections section on section.id = lesson.section_id where section.course_id = $1 and lesson.certificate_final`, [course.courseId])).toEqual([{ id: course.lessons.quiz }])

    const learner = await enrollLearner(db.query, course.courseId, 'Fixture Learner N')
    const quiz = createLearnerQuizRepository({ query: db.query, transaction: db.transaction })
    const [right, wrong] = course.quiz!.optionIds[0]!
    await quiz.submitQuizAttempt(learner.learnerId, course.slug, course.lessons.quiz!, [{ questionId: course.quiz!.questionIds[0]!, optionId: wrong! }])
    expect(await db.query(`select 1 from public.learning_certificates where enrollment_id = $1`, [learner.enrollmentId])).toHaveLength(0)
    await quiz.submitQuizAttempt(learner.learnerId, course.slug, course.lessons.quiz!, [{ questionId: course.quiz!.questionIds[0]!, optionId: right! }])
    expect(await db.query(`select issued_for from public.learning_certificates where enrollment_id = $1`, [learner.enrollmentId])).toEqual([{ issued_for: 'final_quiz' }])
    expect(await db.query(`select status from public.learning_enrollments where id = $1`, [learner.enrollmentId])).toEqual([{ status: 'active' }])
    // The learner can download it although the course is not finished.
    expect(await createCertificateRepository({ query: db.query, transaction: db.transaction }).ensureCertificateForEnrollment(learner.learnerId, learner.enrollmentId)).not.toBeNull()
  }, 120_000)

  it('sends one renewal reminder 30 days and one 7 days before expiry', async () => {
    const mentor = await createActiveMentor(db.query)
    const course = await createPublishedCourse(db.query, mentor)
    await db.query(`update public.learning_courses set certificate_validity_months = 12 where id = $1`, [course.courseId])
    const learner = await completedLearner(course.courseId, course.lessons, 'Fixture Learner O')
    const certificate = await db.query(`select id, expires_at from public.learning_certificates where enrollment_id = $1`, [learner.enrollmentId])
    const expiresAt = new Date(certificate[0]!.expires_at as string)
    const reminders = async () => db.query(
      `select dedupe_key from public.notifications where recipient_id = $1 and notification_type::text = 'learning_certificate_expiring' order by dedupe_key`,
      [learner.learnerId],
    )

    await sweepExpiringCertificates(db.transaction, { now: new Date(expiresAt.getTime() - 40 * 86_400_000) })
    expect(await reminders()).toHaveLength(0)
    await sweepExpiringCertificates(db.transaction, { now: new Date(expiresAt.getTime() - 29 * 86_400_000) })
    await sweepExpiringCertificates(db.transaction, { now: new Date(expiresAt.getTime() - 20 * 86_400_000) })
    expect((await reminders()).map((row) => row.dedupe_key)).toEqual([`learning_certificate_expiring:${certificate[0]!.id}:30`])
    await sweepExpiringCertificates(db.transaction, { now: new Date(expiresAt.getTime() - 6 * 86_400_000) })
    await sweepExpiringCertificates(db.transaction, { now: new Date(expiresAt.getTime() - 2 * 86_400_000) })
    expect((await reminders()).map((row) => row.dedupe_key)).toEqual([
      `learning_certificate_expiring:${certificate[0]!.id}:30`,
      `learning_certificate_expiring:${certificate[0]!.id}:7`,
    ])
    expect(await db.query(`select kind from public.learning_notification_emails where recipient_id = $1 and kind = 'certificate_expiring'`, [learner.learnerId])).toHaveLength(2)
    await sweepExpiringCertificates(db.transaction, { now: new Date(expiresAt.getTime() + 86_400_000) })
    expect(await reminders()).toHaveLength(2)
  }, 120_000)

  it('shows certificates on the profile and in Jobs matching until the member hides one', async () => {
    const mentor = await createActiveMentor(db.query)
    const course = await createPublishedCourse(db.query, mentor)
    const learner = await completedLearner(course.courseId, course.lessons, 'Fixture Learner P')
    const repository = createCertificateRepository({ query: db.query, transaction: db.transaction })
    const credentials = async () => (await db.query(`select ${candidateCredentialsSql('p')} as credentials from public.profiles p where p.id = $1`, [learner.learnerId]))[0]!.credentials

    const [shown] = await repository.listForProfile(learner.learnerId, { includeHidden: false })
    expect(shown).toMatchObject({ courseTitle: 'Fixture SIRE Readiness', hidden: false, expired: false, expiresAt: null })
    expect(await credentials()).toEqual([{ name: 'Fixture SIRE Readiness', expires_at: null, verified: true }])

    await repository.setHiddenFromProfile(learner.learnerId, shown!.certificateId, true)
    expect(await repository.listForProfile(learner.learnerId, { includeHidden: false })).toEqual([])
    expect(await repository.listForProfile(learner.learnerId, { includeHidden: true })).toEqual([expect.objectContaining({ hidden: true })])
    expect(await credentials()).toEqual([])
    // Nobody else can hide it.
    const other = await enrollLearner(db.query, course.courseId, 'Fixture Learner Q')
    await expect(repository.setHiddenFromProfile(other.learnerId, shown!.certificateId, false)).rejects.toThrow('certificate_not_found')
  }, 120_000)
})
