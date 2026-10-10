import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDatabase, type TestDatabase } from '@/lib/db/test-database'
import { createCertificateRepository } from './certificate-repository'
import { createEnrollmentRepository } from './enrollment-repository'
import { createLearnerCourseRepository } from './learner-course-repository'
import { createLearnerHomeRepository } from './learner-home-repository'
import { finalizeEnrollmentIfComplete } from './learner-progress-repository'
import {
  completeLessons,
  createActiveMentor,
  createProfile,
  createPublishedCourse,
  enrollLearner,
  type FixtureCourse,
} from './learning-test-fixtures'
import { curriculumLessons, defaultPlayerLesson } from './next-lesson'

/**
 * Learning round C (C6), against the real schema (PGlite): My Learning's Continue card picks the course the learner
 * was most recently active in and the same next lesson the player opens. Generic fixture names only.
 */

let db: TestDatabase

beforeAll(async () => {
  db = await createTestDatabase()
}, 120_000)

afterAll(async () => {
  await db?.close()
})

function repositories() {
  const learnerCourses = createLearnerCourseRepository({ query: db.query })
  const home = createLearnerHomeRepository({ query: db.query, getLearnerCourse: learnerCourses.getLearnerCourse })
  return { learnerCourses, home }
}

async function enroll(learnerId: string, course: FixtureCourse, options: { daysAgo: number; status?: string; accessExpiresInDays?: number } ) {
  const rows = await db.query(
    `insert into public.learning_enrollments (course_id, learner_id, enrollment_source, status, enrolled_at, completed_at, revoked_at, access_expires_at)
     values ($1, $2, 'free', $3, now() - make_interval(days => $4::int),
       case when $3 = 'completed' then now() end,
       case when $3 = 'revoked' then now() end,
       case when $5::int is null then null else now() + make_interval(days => $5::int) end)
     returning id`,
    [course.courseId, learnerId, options.status ?? 'active', options.daysAgo, options.accessExpiresInDays ?? null],
  )
  return rows[0]!.id as string
}

/** Records lesson progress as last touched `hoursAgo` hours ago. */
async function touch(enrollmentId: string, lessonIds: readonly string[], hoursAgo: number) {
  await completeLessons(db.query, enrollmentId, lessonIds)
  await db.query(
    `update public.learning_progress set updated_at = now() - make_interval(hours => $3::int)
     where enrollment_id = $1 and lesson_id = any($2::uuid[])`,
    [enrollmentId, lessonIds, hoursAgo],
  )
}

describe('learner home: the Continue card', () => {
  it('picks the most recently active in-progress enrolment, only among the learner’s own, and its exact next lesson', async () => {
    const mentor = await createActiveMentor(db.query)
    const recent = await createPublishedCourse(db.query, mentor)
    const older = await createPublishedCourse(db.query, mentor)
    const completed = await createPublishedCourse(db.query, mentor)
    const revoked = await createPublishedCourse(db.query, mentor)
    const expired = await createPublishedCourse(db.query, mentor)
    const learner = await createProfile(db.query, 'Fixture Learner')
    const otherLearner = await createProfile(db.query, 'Fixture Other Learner')
    const { home, learnerCourses } = repositories()

    const recentEnrollment = await enroll(learner, recent, { daysAgo: 30 })
    const olderEnrollment = await enroll(learner, older, { daysAgo: 1 })
    await touch(recentEnrollment, [recent.lessons.intro!], 1)
    // More recent activity in enrolments that must not be picked: completed, revoked, access ended, someone else's.
    await touch(await enroll(learner, completed, { daysAgo: 5, status: 'completed' }), [completed.lessons.intro!], 0)
    await touch(await enroll(learner, revoked, { daysAgo: 5, status: 'revoked' }), [revoked.lessons.intro!], 0)
    const expiredEnrollment = await enroll(learner, expired, { daysAgo: 400, accessExpiresInDays: -1 })
    await touch(expiredEnrollment, [expired.lessons.intro!], 0)
    await touch(await enroll(otherLearner, older, { daysAgo: 2 }), [older.lessons.intro!], 0)

    // The course list still shows the ended course, with its end date (its card offers a renewal).
    const listed = await createEnrollmentRepository({ query: db.query }).listLearnerEnrollments(learner)
    expect(listed.find((item) => item.enrollmentId === expiredEnrollment)?.accessExpiresAt).toEqual(expect.any(String))
    expect(listed.find((item) => item.enrollmentId === recentEnrollment)?.accessExpiresAt).toBeNull()

    // Latest progress (1 hour ago) beats the other course's later enrolment (1 day ago, no progress).
    expect(await home.findResumeEnrollment(learner)).toMatchObject({ enrollmentId: recentEnrollment, slug: recent.slug })
    const resume = await home.getResumeCourse(learner)
    expect(resume).toMatchObject({
      enrollmentId: recentEnrollment,
      slug: recent.slug,
      title: 'Fixture SIRE Readiness',
      point: { kind: 'next', lesson: { id: recent.lessons.video }, position: 2, total: 6 },
    })

    // Same lesson as the player opens by default.
    const course = await learnerCourses.getLearnerCourse(learner, recent.slug)
    expect(defaultPlayerLesson(curriculumLessons(course!))?.id).toBe(recent.lessons.video)

    // Without newer progress, the enrolment date decides: the course joined 1 day ago now comes first.
    await db.query(`update public.learning_progress set updated_at = now() - interval '3 days' where enrollment_id = $1`, [recentEnrollment])
    expect(await home.getResumeCourse(learner)).toMatchObject({
      enrollmentId: olderEnrollment,
      point: { kind: 'next', lesson: { id: older.lessons.intro }, position: 1, total: 6 },
    })

    // Access that has not ended yet still counts.
    await db.query(`update public.learning_enrollments set access_expires_at = now() + interval '1 day' where id = $1`, [olderEnrollment])
    expect(await home.findResumeEnrollment(learner)).toMatchObject({ enrollmentId: olderEnrollment })
    await db.query(`update public.learning_enrollments set access_expires_at = now() - interval '1 minute' where id = $1`, [olderEnrollment])
    expect(await home.findResumeEnrollment(learner)).toMatchObject({ enrollmentId: recentEnrollment })
  })

  it('respects locks and counts only published lessons for "lesson X of Y"', async () => {
    const mentor = await createActiveMentor(db.query)
    const course = await createPublishedCourse(db.query, mentor)
    const learner = await createProfile(db.query, 'Fixture Learner')
    const enrollmentId = await enroll(learner, course, { daysAgo: 2 })
    await touch(enrollmentId, [course.lessons.intro!], 1)
    // The video opens 30 days after enrolment; the wrap-up is unpublished.
    await db.query(`update public.learning_lessons set release_mode = 'drip', drip_delay_days = 30 where id = $1`, [course.lessons.video])
    await db.query(`update public.learning_lessons set is_published = false where id = $1`, [course.lessons.wrapUp])
    const { home, learnerCourses } = repositories()

    expect(await home.getResumeCourse(learner)).toMatchObject({
      point: { kind: 'next', lesson: { id: course.lessons.quiz }, position: 3, total: 5 },
    })

    // Sequential navigation: the quiz waits for the locked video, so nothing is open until the video's drip date.
    await db.query(`update public.learning_courses set navigation_mode = 'sequential' where id = $1`, [course.courseId])
    const waiting = await home.getResumeCourse(learner)
    expect(waiting?.point.kind).toBe('waiting')
    const enrolled = await db.query(`select enrolled_at from public.learning_enrollments where id = $1`, [enrollmentId])
    const enrolledAt = new Date(enrolled[0]!.enrolled_at as string | Date)
    expect(waiting?.point).toEqual({ kind: 'waiting', opensAt: new Date(enrolledAt.getTime() + 30 * 24 * 60 * 60 * 1000), total: 5 })
    const player = await learnerCourses.getLearnerCourse(learner, course.slug)
    expect(defaultPlayerLesson(curriculumLessons(player!))?.id).toBe(course.lessons.intro)

    // Every published lesson complete (the enrolment is still active): the card offers a review.
    await db.query(`update public.learning_lessons set release_mode = 'immediate', drip_delay_days = null where id = $1`, [course.lessons.video])
    await touch(enrollmentId, [course.lessons.video!, course.lessons.quiz!, course.lessons.checklist!, course.lessons.assignment!], 0)
    expect(await home.getResumeCourse(learner)).toMatchObject({ point: { kind: 'all_done', total: 5 } })
  })

  it('returns nothing for a learner with no in-progress course', async () => {
    const learner = await createProfile(db.query, 'Fixture Learner Without Courses')
    const { home } = repositories()
    expect(await home.findResumeEnrollment(learner)).toBeNull()
    expect(await home.getResumeCourse(learner)).toBeNull()
  })
})

describe('learner home: the Certificates tab', () => {
  it('lists only the learner’s own certificates, hidden ones included, with the enrolment to download from', async () => {
    const mentor = await createActiveMentor(db.query)
    const course = await createPublishedCourse(db.query, mentor)
    const later = await createPublishedCourse(db.query, mentor)
    const learner = await enrollLearner(db.query, course.courseId, 'Fixture Certified Learner')
    const other = await enrollLearner(db.query, course.courseId, 'Fixture Other Certified Learner')
    for (const enrollment of [learner, other]) {
      await completeLessons(db.query, enrollment.enrollmentId, Object.values(course.lessons))
      await finalizeEnrollmentIfComplete(db.query, enrollment.enrollmentId, course.courseId)
    }
    const secondEnrollment = await enroll(learner.learnerId, later, { daysAgo: 1 })
    await completeLessons(db.query, secondEnrollment, Object.values(later.lessons))
    await finalizeEnrollmentIfComplete(db.query, secondEnrollment, later.courseId)
    // The first certificate expired yesterday and is hidden from the profile; the second is newer.
    await db.query(
      `update public.learning_certificates set expires_at = now() - interval '1 day', hidden_from_profile = true, issued_at = now() - interval '2 years'
       where enrollment_id = $1`,
      [learner.enrollmentId],
    )
    const repository = createCertificateRepository({ query: db.query, transaction: db.transaction })

    const certificates = await repository.listForLearner(learner.learnerId)
    expect(certificates).toEqual([
      expect.objectContaining({ enrollmentId: secondEnrollment, courseTitle: 'Fixture SIRE Readiness', expiresAt: null, expired: false }),
      expect.objectContaining({ enrollmentId: learner.enrollmentId, expired: true }),
    ])
    expect(certificates[1]!.verificationCode).toMatch(/^[0-9a-f-]{36}$/)
    expect((await repository.listForLearner(other.learnerId)).map((item) => item.enrollmentId)).toEqual([other.enrollmentId])
  })
})
