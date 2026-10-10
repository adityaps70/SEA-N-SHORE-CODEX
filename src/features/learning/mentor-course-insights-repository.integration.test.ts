import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDatabase, type TestDatabase } from '@/lib/db/test-database'
import { createCourseRevisionRepository } from './course-revision-repository'
import { createMentorCourseInsightsRepository, type CourseInsights } from './mentor-course-insights-repository'
import {
  completeLessons,
  createActiveMentor,
  createProfile,
  createPublishedCourse,
  enrollLearner,
  recordQuizAttempt,
  type FixtureCourse,
} from './learning-test-fixtures'

/**
 * C8 Learning Studio course insights against the real schema (PGlite): lesson drop-off, quiz item
 * difficulty (including a written answer) and monthly enrolments / revenue (a refund, two currencies,
 * Asia/Kolkata month edges). Generic fixture names only.
 */

let db: TestDatabase

beforeAll(async () => {
  db = await createTestDatabase()
}, 120_000)

afterAll(async () => {
  await db?.close()
})

/** 15 Oct 2026, 11:30 IST: the window is Nov 2025 .. Oct 2026. */
const NOW = new Date('2026-10-15T06:00:00.000Z')

type Learner = { learnerId: string; enrollmentId: string }

async function setEnrolledAt(enrollmentId: string, at: string) {
  await db.query(`update public.learning_enrollments set enrolled_at = $2::timestamptz where id = $1`, [enrollmentId, at])
}

async function addQuestion(quizId: string, input: { prompt: string; position: number; type?: string; marks?: number; removed?: boolean }) {
  const rows = await db.query(
    `insert into public.learning_quiz_questions (quiz_id, prompt, position, question_type, marks, removed_at)
     values ($1, $2, $3, $4, $5, case when $6::boolean then now() else null end) returning id`,
    [quizId, input.prompt, input.position, input.type ?? 'single_choice', input.marks ?? 1, input.removed ?? false],
  )
  const questionId = rows[0]!.id as string
  if ((input.type ?? 'single_choice') === 'subjective') return { questionId, right: null, wrong: null }
  const right = await db.query(
    `insert into public.learning_quiz_options (question_id, label, position, is_correct) values ($1, 'Right', 0, true) returning id`,
    [questionId],
  )
  const wrong = await db.query(
    `insert into public.learning_quiz_options (question_id, label, position, is_correct) values ($1, 'Wrong', 1, false) returning id`,
    [questionId],
  )
  return { questionId, right: right[0]!.id as string, wrong: wrong[0]!.id as string }
}

/** One attempt: the first question answered by option, plus written answers (graded points or pending). */
async function attempt(
  course: FixtureCourse,
  learner: Learner,
  choice: { questionId: string; optionId: string; correctOptionId: string },
  written: Array<{ questionId: string; points: number | null; maxPoints: number }>,
) {
  const attemptId = await recordQuizAttempt(db.query, {
    quizId: course.quiz!.quizId,
    enrollmentId: learner.enrollmentId,
    learnerId: learner.learnerId,
    answers: [choice],
  })
  for (const answer of written) {
    await db.query(
      `insert into public.learning_quiz_attempt_answers (
         attempt_id, question_id, selected_option_id, correct_option_id, is_correct, text_response,
         points_awarded, max_points, grading_status
       ) values ($1, $2, null, null, $3, 'A fixture written answer.', $4, $5, $6)`,
      [
        attemptId,
        answer.questionId,
        answer.points !== null && answer.points === answer.maxPoints,
        answer.points,
        answer.maxPoints,
        answer.points === null ? 'pending' : 'graded',
      ],
    )
  }
  return attemptId
}

async function sale(
  courseId: string,
  buyerId: string,
  input: {
    amountMinor: number
    currency: 'INR' | 'USD'
    status: 'paid' | 'refunded' | 'failed' | 'created'
    paidAt: string | null
    confirmed?: boolean
    earning?: { sellerProfileId: string; feeMinor: number; status: 'pending' | 'available' | 'paid' | 'reversed' }
  },
) {
  const rows = await db.query(
    `insert into public.course_payment_orders (
       course_id, profile_id, course_title, list_price_minor, amount_minor, currency, provider, status,
       paid_at, enrollment_confirmed_at, refunded_at
     ) values ($1, $2, 'Fixture SIRE Readiness', $3, $3, $4, 'razorpay', $5::text, $6::timestamptz,
       case when $7::boolean then $6::timestamptz else null end,
       case when $5::text = 'refunded' then $6::timestamptz + interval '2 days' else null end)
     returning id`,
    [courseId, buyerId, input.amountMinor, input.currency, input.status, input.paidAt, input.confirmed ?? true],
  )
  const orderId = rows[0]!.id as string
  if (input.earning) {
    await db.query(
      `insert into public.seller_earnings (
         seller_profile_id, source_type, source_id, currency, gross_minor, platform_fee_percent, platform_fee_minor,
         net_minor, status, available_at
       ) values ($1, 'course_purchase', $2, $3, $4::bigint, 10, $5::bigint, $4::bigint - $5::bigint, $6, now())`,
      [input.earning.sellerProfileId, orderId, input.currency, input.amountMinor, input.earning.feeMinor, input.earning.status],
    )
  }
  return orderId
}

describe('mentor course insights', () => {
  let trainer: { userId: string; mentorId: string }
  let course: FixtureCourse
  let insights: CourseInsights | null
  let written: { questionId: string }
  let unanswered: { questionId: string }
  let removed: { questionId: string; right: string | null; wrong: string | null }

  beforeAll(async () => {
    trainer = await createActiveMentor(db.query)
    course = await createPublishedCourse(db.query, trainer, { priceMinor: 49900 })
    const [sectionA, sectionB] = course.sectionIds
    // An unpublished material and a removed section's material never show in the funnel.
    await db.query(
      `insert into public.learning_lessons (section_id, position, title, lesson_type, completion_rule, article_body, is_published)
       values ($1, 3, 'Unpublished draft', 'article', 'manual', 'Draft.', false)`,
      [sectionA],
    )
    const removedSection = await db.query(
      `insert into public.learning_course_sections (course_id, title, position, removed_at) values ($1, 'Removed', 2, now()) returning id`,
      [course.courseId],
    )
    await db.query(
      `insert into public.learning_lessons (section_id, position, title, lesson_type, completion_rule, article_body, is_published)
       values ($1, 0, 'In a removed section', 'article', 'manual', 'Gone.', true)`,
      [removedSection[0]!.id],
    )
    void sectionB

    const quizId = course.quiz!.quizId
    written = await addQuestion(quizId, { prompt: 'Describe the vetting sequence.', position: 1, type: 'subjective', marks: 4 })
    unanswered = await addQuestion(quizId, { prompt: 'Which form records the findings?', position: 2 })
    removed = await addQuestion(quizId, { prompt: 'A removed question.', position: 3, removed: true })

    const learner1 = await enrollLearner(db.query, course.courseId, 'Fixture Learner 1')
    const learner2 = await enrollLearner(db.query, course.courseId, 'Fixture Learner 2')
    const learner3 = await enrollLearner(db.query, course.courseId, 'Fixture Learner 3')
    const learner4 = await enrollLearner(db.query, course.courseId, 'Fixture Learner 4')
    const learner5 = await enrollLearner(db.query, course.courseId, 'Fixture Learner 5')
    const revokedLearner = await enrollLearner(db.query, course.courseId, 'Fixture Learner Revoked')

    const { intro, video, quiz } = course.lessons
    await completeLessons(db.query, learner1.enrollmentId, [intro!, video!, quiz!])
    // Opened but not finished: reached, not completed.
    await db.query(
      `insert into public.learning_progress (enrollment_id, lesson_id, completed, viewed_at, first_started_at)
       values ($1, $2, false, now(), now())`,
      [learner2.enrollmentId, intro],
    )
    await completeLessons(db.query, learner4.enrollmentId, [intro!])
    // A revoked learner's progress and answers never count.
    await completeLessons(db.query, revokedLearner.enrollmentId, Object.values(course.lessons))

    const [questionId] = course.quiz!.questionIds
    const [right, wrong] = course.quiz!.optionIds[0]!
    await attempt(course, learner1, { questionId: questionId!, optionId: right!, correctOptionId: right! }, [
      { questionId: written.questionId, points: 3, maxPoints: 4 },
    ])
    await attempt(course, learner2, { questionId: questionId!, optionId: wrong!, correctOptionId: right! }, [
      { questionId: written.questionId, points: null, maxPoints: 4 },
    ])
    const learner4Attempt = await attempt(course, learner4, { questionId: questionId!, optionId: right!, correctOptionId: right! }, [
      { questionId: written.questionId, points: 1, maxPoints: 4 },
    ])
    // An answer to a question removed from the quiz is ignored.
    await db.query(
      `insert into public.learning_quiz_attempt_answers (attempt_id, question_id, selected_option_id, correct_option_id, is_correct)
       values ($1, $2, $3, $4, false)`,
      [learner4Attempt, removed.questionId, removed.wrong, removed.right],
    )
    await attempt(course, revokedLearner, { questionId: questionId!, optionId: wrong!, correctOptionId: right! }, [
      { questionId: written.questionId, points: 0, maxPoints: 4 },
    ])
    await db.query(`update public.learning_enrollments set status = 'revoked' where id = $1`, [revokedLearner.enrollmentId])

    // Enrolments on both sides of Asia/Kolkata month edges.
    await setEnrolledAt(learner1.enrollmentId, '2026-10-01T00:30:00+05:30') // 30 Sep UTC, October in IST
    await setEnrolledAt(learner2.enrollmentId, '2026-09-30T23:30:00+05:30') // September in IST
    await setEnrolledAt(learner3.enrollmentId, '2026-09-10T12:00:00+05:30')
    await setEnrolledAt(revokedLearner.enrollmentId, '2026-09-12T12:00:00+05:30')
    await setEnrolledAt(learner4.enrollmentId, '2025-11-01T00:10:00+05:30') // first window month in IST
    await setEnrolledAt(learner5.enrollmentId, '2025-10-31T23:50:00+05:30') // just before the window

    const seller = trainer.userId
    // INR: one kept sale in October, one refunded sale in September (its earning reversed).
    await sale(course.courseId, learner1.learnerId, {
      amountMinor: 49900, currency: 'INR', status: 'paid', paidAt: '2026-10-02T10:00:00+05:30',
      earning: { sellerProfileId: seller, feeMinor: 4990, status: 'pending' },
    })
    await sale(course.courseId, learner2.learnerId, {
      amountMinor: 49900, currency: 'INR', status: 'refunded', paidAt: '2026-09-15T10:00:00+05:30',
      earning: { sellerProfileId: seller, feeMinor: 4990, status: 'reversed' },
    })
    // USD: one kept sale in September. Never added to rupees.
    await sale(course.courseId, learner3.learnerId, {
      amountMinor: 1500, currency: 'USD', status: 'paid', paidAt: '2026-09-20T10:00:00+05:30',
      earning: { sellerProfileId: seller, feeMinor: 150, status: 'available' },
    })
    // Not counted: paid but the enrolment never confirmed, failed, and paid before the window.
    await sale(course.courseId, learner4.learnerId, { amountMinor: 49900, currency: 'INR', status: 'paid', paidAt: '2026-09-21T10:00:00+05:30', confirmed: false })
    await sale(course.courseId, learner5.learnerId, { amountMinor: 49900, currency: 'INR', status: 'failed', paidAt: null, confirmed: false })
    await sale(course.courseId, learner5.learnerId, {
      amountMinor: 49900, currency: 'INR', status: 'paid', paidAt: '2025-10-31T23:00:00+05:30',
      earning: { sellerProfileId: seller, feeMinor: 4990, status: 'paid' },
    })

    insights = await createMentorCourseInsightsRepository({ query: db.query }).getCourseInsights(trainer.userId, course.courseId, { now: NOW })
  }, 120_000)

  it('counts how many non-revoked learners reached and completed each published material, in curriculum order', () => {
    expect(insights?.course).toEqual({ id: course.courseId, title: 'Fixture SIRE Readiness', slug: course.slug })
    expect(insights!.lessonFunnel.learnerCount).toBe(5)
    expect(insights!.lessonFunnel.lessons.map(({ title, position, reachedCount, reachedPercent, completedCount, completedPercent }) => (
      { title, position, reachedCount, reachedPercent, completedCount, completedPercent }
    ))).toEqual([
      { title: 'Intro', position: 1, reachedCount: 3, reachedPercent: 60, completedCount: 2, completedPercent: 40 },
      { title: 'Walkthrough video', position: 2, reachedCount: 1, reachedPercent: 20, completedCount: 1, completedPercent: 20 },
      { title: 'Knowledge check', position: 3, reachedCount: 1, reachedPercent: 20, completedCount: 1, completedPercent: 20 },
      { title: 'Checklist', position: 4, reachedCount: 0, reachedPercent: 0, completedCount: 0, completedPercent: 0 },
      { title: 'Inspection report', position: 5, reachedCount: 0, reachedPercent: 0, completedCount: 0, completedPercent: 0 },
      { title: 'Wrap-up', position: 6, reachedCount: 0, reachedPercent: 0, completedCount: 0, completedPercent: 0 },
    ])
    expect(insights!.lessonFunnel.lessons[0]).toMatchObject({ sectionTitle: 'Section A', lessonId: course.lessons.intro })
  })

  it('scores each live question over non-revoked answers, written answers by graded marks, pending ones skipped', () => {
    expect(insights!.quizDifficulty).toHaveLength(1)
    const [quiz] = insights!.quizDifficulty
    expect(quiz).toMatchObject({ quizId: course.quiz!.quizId, lessonId: course.lessons.quiz, lessonTitle: 'Knowledge check' })
    expect(quiz!.questions).toEqual([
      {
        questionId: course.quiz!.questionIds[0],
        prompt: 'Which document comes first?',
        questionType: 'single_choice',
        position: 1,
        answerCount: 3,
        pendingCount: 0,
        correctPercent: 67,
        isHardest: false,
      },
      {
        questionId: written.questionId,
        prompt: 'Describe the vetting sequence.',
        questionType: 'subjective',
        position: 2,
        // 3/4 and 1/4 graded; one still pending; the revoked learner's 0/4 is excluded.
        answerCount: 2,
        pendingCount: 1,
        correctPercent: 50,
        isHardest: true,
      },
      {
        questionId: unanswered.questionId,
        prompt: 'Which form records the findings?',
        questionType: 'single_choice',
        position: 3,
        answerCount: 0,
        pendingCount: 0,
        correctPercent: null,
        isHardest: false,
      },
    ])
  })

  it('buckets enrolments and revenue by Asia/Kolkata month for the last 12 months, per currency', () => {
    const { months, revenue } = insights!.monthlyTrend
    expect(months.map((bucket) => bucket.month)).toEqual([
      '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04',
      '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10',
    ])
    expect(months.filter((bucket) => bucket.enrollmentCount > 0)).toEqual([
      { month: '2025-11', enrollmentCount: 1, revokedCount: 0 },
      { month: '2026-09', enrollmentCount: 3, revokedCount: 1 },
      { month: '2026-10', enrollmentCount: 1, revokedCount: 0 },
    ])

    expect(revenue.map((entry) => entry.currency)).toEqual(['INR', 'USD'])
    const [inr, usd] = revenue
    expect(inr!.months).toHaveLength(12)
    expect(inr!.months.find((bucket) => bucket.month === '2026-10')).toEqual({
      month: '2026-10', orderCount: 1, refundedOrderCount: 0, grossMinor: 49900, refundedMinor: 0, platformFeeMinor: 4990, trainerNetMinor: 44910,
    })
    expect(inr!.months.find((bucket) => bucket.month === '2026-09')).toEqual({
      month: '2026-09', orderCount: 1, refundedOrderCount: 1, grossMinor: 49900, refundedMinor: 49900, platformFeeMinor: 0, trainerNetMinor: 0,
    })
    expect(inr!.totals).toEqual({ orderCount: 2, refundedOrderCount: 1, grossMinor: 99800, refundedMinor: 49900, platformFeeMinor: 4990, trainerNetMinor: 44910 })
    expect(usd!.totals).toEqual({ orderCount: 1, refundedOrderCount: 0, grossMinor: 1500, refundedMinor: 0, platformFeeMinor: 150, trainerNetMinor: 1350 })
    expect(usd!.months.find((bucket) => bucket.month === '2026-09')?.grossMinor).toBe(1500)
  })

  it('never exposes learner identity', () => {
    const text = JSON.stringify(insights)
    expect(text).not.toContain('Fixture Learner')
    expect(text).not.toMatch(/learnerId|learner_id|email/i)
  })

  it('returns nothing to a non-manager, another trainer, or for a draft revision or a malformed id', async () => {
    const repository = createMentorCourseInsightsRepository({ query: db.query })
    const otherTrainer = await createActiveMentor(db.query)
    const member = await createProfile(db.query, 'Fixture Member')
    expect(await repository.getCourseInsights(otherTrainer.userId, course.courseId, { now: NOW })).toBeNull()
    expect(await repository.getCourseInsights(member, course.courseId, { now: NOW })).toBeNull()
    expect(await repository.getCourseInsights(trainer.userId, 'not-a-course-id', { now: NOW })).toBeNull()

    // The other trainer's own course is theirs alone, and comes back empty rather than borrowing data.
    const otherCourse = await createPublishedCourse(db.query, otherTrainer)
    expect(await repository.getCourseInsights(trainer.userId, otherCourse.courseId, { now: NOW })).toBeNull()
    const empty = await repository.getCourseInsights(otherTrainer.userId, otherCourse.courseId, { now: NOW })
    expect(empty?.lessonFunnel.learnerCount).toBe(0)
    expect(empty?.lessonFunnel.lessons).toHaveLength(6)
    expect(empty?.lessonFunnel.lessons.every((lesson) => lesson.reachedCount === 0 && lesson.reachedPercent === 0)).toBe(true)
    expect(empty?.quizDifficulty[0]?.questions).toEqual([expect.objectContaining({ answerCount: 0, correctPercent: null })])
    expect(empty?.monthlyTrend.months.every((bucket) => bucket.enrollmentCount === 0)).toBe(true)
    expect(empty?.monthlyTrend.revenue).toEqual([])

    // Analytics are for the live course only: the draft revision row is not a separate course here.
    const revisions = createCourseRevisionRepository({ transaction: db.transaction })
    const started = await revisions.startRevision(trainer.userId, course.courseId)
    expect(await repository.getCourseInsights(trainer.userId, started.revisionCourseId, { now: NOW })).toBeNull()
    const live = await repository.getCourseInsights(trainer.userId, course.courseId, { now: NOW })
    expect(live?.lessonFunnel.learnerCount).toBe(5)
  }, 120_000)
})
