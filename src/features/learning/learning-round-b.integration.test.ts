import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDatabase, type TestDatabase } from '@/lib/db/test-database'
import { createLearnerQuizRepository } from './learner-quiz-repository'
import { createQuestionBankRepository } from './question-bank-repository'
import { createQuizGradingRepository } from './quiz-grading-repository'
import { questionInputSchema, type QuestionInput } from './quiz-question-schema'
import { readQuestionCsv, questionsToCsv } from './quiz-csv'
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
 * Learning round B against the real schema (PGlite): the bank backfill, question types and marks, the
 * server-held timer, random draws, the answer policy, written answers and their grading, and the bank's CSV
 * import. Generic fixture names only.
 */

const ROUND_B_STATEMENTS = readFileSync(join(process.cwd(), 'infra/aws/database/migrations/0073_learning_round_b.sql'), 'utf8')
  .split('-- statement-breakpoint')
  .filter((statement) => statement.split('\n').some((line) => line.trim() && !line.trim().startsWith('--')))

let db: TestDatabase

beforeAll(async () => {
  db = await createTestDatabase()
}, 120_000)

afterAll(async () => {
  await db?.close()
})

/** A seeded random source, so a test can ask for two different draws and get them every run. */
function seeded(seed: number) {
  let state = seed >>> 0
  return (n: number) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state % n
  }
}

function learnerRepository(seed = 1) {
  return createLearnerQuizRepository({ query: db.query, transaction: db.transaction, randomInt: seeded(seed) })
}

type QuizSetup = { course: FixtureCourse; quizId: string; lessonId: string; questions: Array<{ id: string; correct: string; wrong: string }> }

/** Replaces the fixture quiz with `count` single-correct questions and the given settings. */
async function quizWithQuestions(count: number, settings: Record<string, unknown> = {}, maxAttempts: number | null = 3): Promise<QuizSetup> {
  const mentor = await createActiveMentor(db.query)
  const course = await createPublishedCourse(db.query, mentor)
  const quizId = course.quiz!.quizId
  const lessonId = course.lessons.quiz!
  await db.query(`update public.learning_lessons set max_attempts = $2 where id = $1`, [lessonId, maxAttempts])
  // Free navigation: the quiz opens without the earlier materials.
  await db.query(`delete from public.learning_quiz_options where question_id = $1`, [course.quiz!.questionIds[0]])
  await db.query(`delete from public.learning_quiz_questions where quiz_id = $1`, [quizId])
  const questions: QuizSetup['questions'] = []
  for (let index = 0; index < count; index += 1) {
    const question = await db.query(
      `insert into public.learning_quiz_questions (quiz_id, prompt, position, explanation) values ($1, $2, $3, $4) returning id`,
      [quizId, `Fixture question ${index + 1}?`, index, `Fixture explanation ${index + 1}`],
    )
    const id = question[0]!.id as string
    const correct = await db.query(`insert into public.learning_quiz_options (question_id, label, position, is_correct) values ($1, $2, 0, true) returning id`, [id, `Right ${index + 1}`])
    const wrong = await db.query(`insert into public.learning_quiz_options (question_id, label, position, is_correct) values ($1, $2, 1, false) returning id`, [id, `Wrong ${index + 1}`])
    questions.push({ id, correct: correct[0]!.id as string, wrong: wrong[0]!.id as string })
  }
  const columns = Object.keys(settings)
  if (columns.length) {
    await db.query(
      `update public.learning_quizzes set ${columns.map((column, index) => `${column} = $${index + 2}`).join(', ')} where id = $1`,
      [quizId, ...Object.values(settings)],
    )
  }
  return { course, quizId, lessonId, questions }
}

describe('bank backfill (0073)', () => {
  it('copies every live quiz question into its trainer’s bank once, links it, and changes no quiz, attempt or answer', async () => {
    const mentor = await createActiveMentor(db.query)
    const course = await createPublishedCourse(db.query, mentor)
    const learner = await enrollLearner(db.query, course.courseId, 'Fixture Learner A')
    const [questionId] = course.quiz!.questionIds
    const [right, wrong] = course.quiz!.optionIds[0]!
    // A quiz and an attempt as they were stored before round B (the backfill already ran at migration time).
    await db.query(`update public.learning_quiz_questions set source_question_id = null where id = $1`, [questionId])
    await db.query(`delete from public.learning_question_banks where mentor_id = $1`, [mentor.mentorId])
    const attemptId = await recordQuizAttempt(db.query, {
      quizId: course.quiz!.quizId,
      enrollmentId: learner.enrollmentId,
      learnerId: learner.learnerId,
      answers: [{ questionId: questionId!, optionId: wrong!, correctOptionId: right! }],
    })
    const before = {
      quiz: await db.query(`select prompt, position, question_type, marks from public.learning_quiz_questions where id = $1`, [questionId]),
      options: await db.query(`select id, label, position, is_correct from public.learning_quiz_options where question_id = $1 order by position`, [questionId]),
      attempt: await db.query(`select score, total_questions, percentage, passed, status from public.learning_quiz_attempts where id = $1`, [attemptId]),
      answers: await db.query(`select selected_option_id, correct_option_id, is_correct, grading_status from public.learning_quiz_attempt_answers where attempt_id = $1`, [attemptId]),
    }

    for (const statement of ROUND_B_STATEMENTS) await db.query(statement)
    for (const statement of ROUND_B_STATEMENTS) await db.query(statement)

    const bank = await db.query(`select id from public.learning_question_banks where mentor_id = $1`, [mentor.mentorId])
    expect(bank).toHaveLength(1)
    const copies = await db.query(
      `select id, prompt, question_type, imported_from_question_id, quiz_id from public.learning_quiz_questions where bank_id = $1`,
      [bank[0]!.id],
    )
    expect(copies).toEqual([expect.objectContaining({ prompt: 'Which document comes first?', question_type: 'single_choice', imported_from_question_id: questionId, quiz_id: null })])
    const copyOptions = await db.query(`select label, position, is_correct from public.learning_quiz_options where question_id = $1 order by position`, [copies[0]!.id])
    expect(copyOptions).toEqual(before.options.map(({ label, position, is_correct }) => ({ label, position, is_correct })))
    const linked = await db.query(`select source_question_id from public.learning_quiz_questions where id = $1`, [questionId])
    expect(linked[0]!.source_question_id).toBe(copies[0]!.id)

    expect(await db.query(`select prompt, position, question_type, marks from public.learning_quiz_questions where id = $1`, [questionId])).toEqual(before.quiz)
    expect(await db.query(`select id, label, position, is_correct from public.learning_quiz_options where question_id = $1 order by position`, [questionId])).toEqual(before.options)
    expect(await db.query(`select score, total_questions, percentage, passed, status from public.learning_quiz_attempts where id = $1`, [attemptId])).toEqual(before.attempt)
    expect(await db.query(`select selected_option_id, correct_option_id, is_correct, grading_status from public.learning_quiz_attempt_answers where attempt_id = $1`, [attemptId])).toEqual(before.answers)
    expect(before.attempt[0]!.status).toBe('completed')
    expect(before.answers[0]!.grading_status).toBe('auto')
  }, 120_000)

  it('keeps one correct option for single-answer types and allows several for multiple-correct questions', async () => {
    const { questions } = await quizWithQuestions(1)
    const questionId = questions[0]!.id
    await expect(db.query(`update public.learning_quiz_options set is_correct = true where question_id = $1`, [questionId])).rejects.toThrow(/only one correct option/)
    await db.query(`update public.learning_quiz_questions set question_type = 'multiple_choice' where id = $1`, [questionId])
    await db.query(`update public.learning_quiz_options set is_correct = true where question_id = $1`, [questionId])
    expect(await db.query(`select count(*)::int as count from public.learning_quiz_options where question_id = $1 and is_correct`, [questionId])).toEqual([{ count: 2 }])
    await expect(db.query(`update public.learning_quiz_questions set question_type = 'single_choice' where id = $1`, [questionId])).rejects.toThrow(/only one correct option/)
  }, 120_000)
})

describe('timed, shuffled and drawn quizzes', () => {
  it('draws N questions, keeps the draw and option order for the attempt, and draws again for the next attempt', async () => {
    const setup = await quizWithQuestions(20, { draw_count: 10, shuffle_questions: true, shuffle_options: true, time_limit_minutes: 20 })
    const learner = await enrollLearner(db.query, setup.course.courseId, 'Fixture Learner B')

    const before = await learnerRepository(7).getQuizForLearner(learner.learnerId, setup.course.slug, setup.lessonId)
    expect(before).toMatchObject({ usesSessions: true, questionCount: 10, session: null, questions: [] })

    const first = await learnerRepository(7).startQuizAttempt(learner.learnerId, setup.course.slug, setup.lessonId)
    expect(first.questions).toHaveLength(10)
    expect(new Set(first.questions.map((question) => question.id)).size).toBe(10)
    expect(first.deadlineAt).not.toBeNull()
    // Starting again (a reload, another tab) resumes the same attempt: same questions, order and options.
    const resumed = await learnerRepository(99).startQuizAttempt(learner.learnerId, setup.course.slug, setup.lessonId)
    expect(resumed.id).toBe(first.id)
    expect(resumed.questions.map((question) => [question.id, question.options.map((option) => option.id)]))
      .toEqual(first.questions.map((question) => [question.id, question.options.map((option) => option.id)]))
    const page = await learnerRepository(5).getQuizForLearner(learner.learnerId, setup.course.slug, setup.lessonId)
    expect(page?.session?.questions.map((question) => question.id)).toEqual(first.questions.map((question) => question.id))

    const result = await learnerRepository().submitQuizAttempt(learner.learnerId, setup.course.slug, setup.lessonId, [], crypto.randomUUID(), first.id)
    expect(result).toMatchObject({ totalQuestions: 10, score: 0, maxPoints: 10, passed: false })

    const second = await learnerRepository(8).startQuizAttempt(learner.learnerId, setup.course.slug, setup.lessonId)
    expect(second.id).not.toBe(first.id)
    expect(second.questions).toHaveLength(10)
    expect(second.questions.map((question) => question.id)).not.toEqual(first.questions.map((question) => question.id))
    const quiz = await learnerRepository().getQuizForLearner(learner.learnerId, setup.course.slug, setup.lessonId)
    expect(quiz?.attemptsUsed).toBe(1)
    expect(quiz?.maxAttempts).toBe(3)
  }, 120_000)

  it('never sends the answer key, accepted answers or explanations before the attempt is submitted', async () => {
    const setup = await quizWithQuestions(4, { shuffle_options: true })
    await db.query(
      `update public.learning_quiz_questions set question_type = 'fill_blank', accepted_answers = '{secret-accepted-answer}' where id = $1`,
      [setup.questions[3]!.id],
    )
    await db.query(`delete from public.learning_quiz_options where question_id = $1`, [setup.questions[3]!.id])
    const learner = await enrollLearner(db.query, setup.course.courseId, 'Fixture Learner C')
    const session = await learnerRepository().startQuizAttempt(learner.learnerId, setup.course.slug, setup.lessonId)
    const quiz = await learnerRepository().getQuizForLearner(learner.learnerId, setup.course.slug, setup.lessonId)
    for (const payload of [JSON.stringify(session), JSON.stringify(quiz)]) {
      expect(payload).not.toMatch(/isCorrect|is_correct|correctOption|secret-accepted-answer|Fixture explanation|acceptedAnswers/)
    }
  }, 120_000)

  it('enforces the deadline on the server: late saves are refused and late answers are not counted', async () => {
    const setup = await quizWithQuestions(3, { time_limit_minutes: 5, answer_policy: 'never' })
    const learner = await enrollLearner(db.query, setup.course.courseId, 'Fixture Learner D')
    const repository = learnerRepository()
    const session = await repository.startQuizAttempt(learner.learnerId, setup.course.slug, setup.lessonId)
    const [one, two, three] = session.questions.map((question) => setup.questions.find((entry) => entry.id === question.id)!)

    // In time: one correct answer is saved.
    await expect(repository.saveQuizAnswers(learner.learnerId, setup.course.slug, setup.lessonId, session.id, [{ questionId: one!.id, optionId: one!.correct }]))
      .resolves.toMatchObject({ saved: true })

    // The clock runs out (moved on the server, past the grace allowance).
    await db.query(
      `update public.learning_quiz_attempt_sessions set started_at = now() - interval '10 minutes', deadline_at = now() - interval '1 minute' where id = $1`,
      [session.id],
    )

    // A save after the deadline is not stored: the attempt is submitted with what was saved in time.
    const late = await repository.saveQuizAnswers(learner.learnerId, setup.course.slug, setup.lessonId, session.id, [
      { questionId: two!.id, optionId: two!.correct },
      { questionId: three!.id, optionId: three!.correct },
    ])
    expect(late.saved).toBe(false)
    if (late.saved) throw new Error('unreachable')
    expect(late.result).toMatchObject({ score: 1, totalQuestions: 3, autoSubmitted: true, lateAnswersIgnored: true, answers: [] })
    expect(late.result.review).toBeUndefined()

    // Submitting the same session again is refused; nothing more is recorded.
    await expect(repository.submitQuizAttempt(learner.learnerId, setup.course.slug, setup.lessonId, [
      { questionId: two!.id, optionId: two!.correct },
    ], crypto.randomUUID(), session.id)).rejects.toThrow('quiz_session_closed')
    const attempts = await db.query(`select score, auto_submitted from public.learning_quiz_attempts where session_id = $1`, [session.id])
    expect(attempts).toEqual([{ score: 1, auto_submitted: true }])
  }, 120_000)

  it('starts afresh, uncounted, when a reviewed edit deleted a question of the open attempt', async () => {
    const setup = await quizWithQuestions(3, { shuffle_questions: true })
    const learner = await enrollLearner(db.query, setup.course.courseId, 'Fixture Learner K')
    const first = await learnerRepository().startQuizAttempt(learner.learnerId, setup.course.slug, setup.lessonId)
    const removed = first.questions[0]!.id
    await db.query(`delete from public.learning_quiz_options where question_id = $1`, [removed])
    await db.query(`delete from public.learning_quiz_questions where id = $1`, [removed])

    await expect(learnerRepository().submitQuizAttempt(learner.learnerId, setup.course.slug, setup.lessonId, [], crypto.randomUUID(), first.id))
      .rejects.toThrow('quiz_session_stale')
    const quiz = await learnerRepository().getQuizForLearner(learner.learnerId, setup.course.slug, setup.lessonId)
    expect(quiz).toMatchObject({ session: null, attemptsUsed: 0, questionCount: 2 })
    const next = await learnerRepository().startQuizAttempt(learner.learnerId, setup.course.slug, setup.lessonId)
    expect(next.id).not.toBe(first.id)
    expect(next.questions.map((question) => question.id)).not.toContain(removed)
  }, 120_000)

  it('submits an expired attempt for a learner who never came back (hourly sweep)', async () => {
    const setup = await quizWithQuestions(2, { time_limit_minutes: 5 })
    const learner = await enrollLearner(db.query, setup.course.courseId, 'Fixture Learner E')
    const session = await learnerRepository().startQuizAttempt(learner.learnerId, setup.course.slug, setup.lessonId)
    await db.query(
      `update public.learning_quiz_attempt_sessions set started_at = now() - interval '10 minutes', deadline_at = now() - interval '1 minute' where id = $1`,
      [session.id],
    )
    const { finalizeExpiredQuizSessions } = await import('./learner-quiz-repository')
    await finalizeExpiredQuizSessions(db.transaction, { repository: learnerRepository() })
    expect(await db.query(`select closed_at is not null as closed, attempt_id is not null as attempted from public.learning_quiz_attempt_sessions where id = $1`, [session.id]))
      .toEqual([{ closed: true, attempted: true }])
  }, 120_000)
})

describe('marks and the answer policy', () => {
  it('marks multiple-correct all or nothing, fill-in-the-blank by accepted answers, takes negative marks, and floors at 0', async () => {
    const setup = await quizWithQuestions(3, { answer_policy: 'after_each_attempt' })
    const [multi, fill, single] = setup.questions
    await db.query(`update public.learning_quiz_questions set question_type = 'multiple_choice', marks = 2 where id = $1`, [multi!.id])
    await db.query(`update public.learning_quiz_options set is_correct = true where question_id = $1`, [multi!.id])
    await db.query(`update public.learning_quiz_questions set question_type = 'fill_blank', accepted_answers = '{Twenty one,21}', marks = 1 where id = $1`, [fill!.id])
    await db.query(`delete from public.learning_quiz_options where question_id = $1`, [fill!.id])
    await db.query(`update public.learning_quiz_questions set negative_marks = 0.5 where id = $1`, [single!.id])
    const learner = await enrollLearner(db.query, setup.course.courseId, 'Fixture Learner F')

    const result = await learnerRepository().submitQuizAttempt(learner.learnerId, setup.course.slug, setup.lessonId, [
      { questionId: multi!.id, optionIds: [multi!.correct, multi!.wrong] },
      { questionId: fill!.id, text: '  twenty   ONE ' },
      { questionId: single!.id, optionId: single!.wrong },
    ])
    // 2 (all both options) + 1 (case-insensitive, spaces ignored) − 0.5 = 2.5 of 4.
    expect(result).toMatchObject({ scorePoints: 2.5, maxPoints: 4, percentage: 63, score: 2 })
    expect(result.review?.find((item) => item.questionId === single!.id)).toMatchObject({ isCorrect: false, pointsAwarded: -0.5, explanation: 'Fixture explanation 3' })

    const allWrong = await learnerRepository().submitQuizAttempt(learner.learnerId, setup.course.slug, setup.lessonId, [
      { questionId: multi!.id, optionIds: [multi!.wrong] },
      { questionId: fill!.id, text: 'nineteen' },
      { questionId: single!.id, optionId: single!.wrong },
    ])
    expect(allWrong).toMatchObject({ scorePoints: 0, percentage: 0 })
  }, 120_000)

  it('shows answers only when the policy allows: never, after passing, after the last attempt', async () => {
    const never = await quizWithQuestions(1, { answer_policy: 'never' })
    const a = await enrollLearner(db.query, never.course.courseId, 'Fixture Learner G')
    const hidden = await learnerRepository().submitQuizAttempt(a.learnerId, never.course.slug, never.lessonId, [{ questionId: never.questions[0]!.id, optionId: never.questions[0]!.correct }])
    expect(hidden).toMatchObject({ passed: true, answers: [] })
    expect(hidden.review).toBeUndefined()

    const afterPass = await quizWithQuestions(1, { answer_policy: 'after_pass' })
    const b = await enrollLearner(db.query, afterPass.course.courseId, 'Fixture Learner H')
    const failed = await learnerRepository().submitQuizAttempt(b.learnerId, afterPass.course.slug, afterPass.lessonId, [{ questionId: afterPass.questions[0]!.id, optionId: afterPass.questions[0]!.wrong }])
    expect(failed.review).toBeUndefined()
    const passed = await learnerRepository().submitQuizAttempt(b.learnerId, afterPass.course.slug, afterPass.lessonId, [{ questionId: afterPass.questions[0]!.id, optionId: afterPass.questions[0]!.correct }])
    expect(passed.review?.[0]).toMatchObject({ correctOptionIds: [afterPass.questions[0]!.correct] })

    const afterLast = await quizWithQuestions(1, { answer_policy: 'after_last_attempt' }, 2)
    const c = await enrollLearner(db.query, afterLast.course.courseId, 'Fixture Learner I')
    const wrong = [{ questionId: afterLast.questions[0]!.id, optionId: afterLast.questions[0]!.wrong }]
    expect((await learnerRepository().submitQuizAttempt(c.learnerId, afterLast.course.slug, afterLast.lessonId, wrong)).review).toBeUndefined()
    expect((await learnerRepository().submitQuizAttempt(c.learnerId, afterLast.course.slug, afterLast.lessonId, wrong)).review?.[0]).toMatchObject({ correctOptionIds: [afterLast.questions[0]!.correct] })
  }, 120_000)
})

describe('written answers', () => {
  it('waits for the trainer, then the grade completes the material and issues the certificate', async () => {
    const setup = await quizWithQuestions(2)
    const [single, written] = setup.questions
    await db.query(`update public.learning_quiz_questions set question_type = 'subjective', marks = 4 where id = $1`, [written!.id])
    await db.query(`delete from public.learning_quiz_options where question_id = $1`, [written!.id])
    const learner = await enrollLearner(db.query, setup.course.courseId, 'Fixture Learner J')
    const others = Object.entries(setup.course.lessons).filter(([key]) => key !== 'quiz').map(([, id]) => id)
    await completeLessons(db.query, learner.enrollmentId, others)

    const submitted = await learnerRepository().submitQuizAttempt(learner.learnerId, setup.course.slug, setup.lessonId, [
      { questionId: single!.id, optionId: single!.correct },
      { questionId: written!.id, text: 'A fixture written answer.' },
    ])
    expect(submitted).toMatchObject({ awaitingGrading: true, passed: false })
    expect(await db.query(`select completed from public.learning_progress where enrollment_id = $1 and lesson_id = $2`, [learner.enrollmentId, setup.lessonId])).toEqual([{ completed: false }])
    expect(await db.query(`select 1 from public.learning_certificates where enrollment_id = $1`, [learner.enrollmentId])).toHaveLength(0)
    await expect(learnerRepository().submitQuizAttempt(learner.learnerId, setup.course.slug, setup.lessonId, [
      { questionId: single!.id, optionId: single!.correct },
      { questionId: written!.id, text: 'Another try.' },
    ])).rejects.toThrow('quiz_awaiting_grading')
    const view = await learnerRepository().getQuizForLearner(learner.learnerId, setup.course.slug, setup.lessonId)
    expect(view?.awaitingGrading).toBe(true)
    expect(view?.attemptHistory?.[0]).toMatchObject({ awaitingGrading: true })

    const trainer = await db.query(
      `select mentor.user_id from public.learning_courses course inner join public.learning_mentors mentor on mentor.id = course.mentor_id where course.id = $1`,
      [setup.course.courseId],
    )
    const grading = createQuizGradingRepository({ query: db.query, transaction: db.transaction })
    const queue = await grading.listForMentor(String(trainer[0]!.user_id))
    expect(queue.find((attempt) => attempt.id === submitted.attemptId)).toMatchObject({ status: 'awaiting_grading', pendingAnswers: 1 })
    // Another trainer cannot see or grade it.
    const stranger = await createActiveMentor(db.query)
    expect(await grading.getForMentor(stranger.userId, submitted.attemptId)).toBeNull()

    const review = await grading.getForMentor(String(trainer[0]!.user_id), submitted.attemptId)
    const pendingAnswer = review!.answers.find((answer) => answer.gradingStatus === 'pending')!
    expect(pendingAnswer).toMatchObject({ textResponse: 'A fixture written answer.', maxPoints: 4 })
    await expect(grading.grade(String(trainer[0]!.user_id), submitted.attemptId, [{ answerId: pendingAnswer.id, points: 5, feedback: null }])).rejects.toThrow('quiz_grade_invalid')
    const graded = await grading.grade(String(trainer[0]!.user_id), submitted.attemptId, [{ answerId: pendingAnswer.id, points: 3, feedback: 'Good fixture answer.' }])
    // 1 + 3 of 5 = 80%, above the 70% pass mark.
    expect(graded).toMatchObject({ passed: true, percentage: 80, enrollmentCompleted: true })
    expect(await db.query(`select completed from public.learning_progress where enrollment_id = $1 and lesson_id = $2`, [learner.enrollmentId, setup.lessonId])).toEqual([{ completed: true }])
    expect(await db.query(`select 1 from public.learning_certificates where enrollment_id = $1`, [learner.enrollmentId])).toHaveLength(1)
    expect(await db.query(`select notification_type::text as type from public.notifications where recipient_id = $1 and notification_type::text = 'learning_quiz_graded'`, [learner.learnerId]))
      .toEqual([{ type: 'learning_quiz_graded' }])
    await expect(grading.grade(String(trainer[0]!.user_id), submitted.attemptId, [{ answerId: pendingAnswer.id, points: 3, feedback: null }])).rejects.toThrow('quiz_attempt_already_graded')
  }, 120_000)
})

describe('question bank', () => {
  function csvRows(count: number) {
    const questions: QuestionInput[] = Array.from({ length: count }, (_, index) => questionInputSchema.parse({
      prompt: `Fixture bank question ${index + 1}?`,
      options: [{ label: 'Yes', isCorrect: index % 2 === 0 }, { label: 'No', isCorrect: index % 2 === 1 }],
      topic: index < 10 ? 'Mooring' : 'Cargo',
      difficulty: 'easy',
    }))
    return questionsToCsv(questions)
  }

  it('imports a valid CSV of 20 questions, and only the bank’s trainer (or an admin) can see them', async () => {
    const owner = await createActiveMentor(db.query)
    const bank = createQuestionBankRepository({ query: db.query, transaction: db.transaction })
    const read = readQuestionCsv(csvRows(20))
    expect(read.ok).toBe(true)
    if (!read.ok) throw new Error('unreachable')
    await bank.importQuestions({ actorId: owner.userId }, read.questions)

    const mine = await bank.getBank({ actorId: owner.userId })
    expect(mine.total).toBe(20)
    expect(mine.topics).toEqual(['Cargo', 'Mooring'])
    expect((await bank.getBank({ actorId: owner.userId }, { topic: 'mooring' })).questions).toHaveLength(10)

    const other = await createActiveMentor(db.query)
    expect((await bank.getBank({ actorId: other.userId })).total).toBe(0)
    await expect(bank.updateQuestion({ actorId: other.userId }, mine.questions[0]!.id, read.questions[0]!)).rejects.toThrow('question_not_found')
    await expect(bank.deleteQuestion({ actorId: other.userId }, mine.questions[0]!.id)).rejects.toThrow('question_not_found')
    const member = await createProfile(db.query, 'Fixture Member')
    await expect(bank.getBank({ actorId: member })).rejects.toThrow('question_bank_forbidden')
    expect((await bank.getBank({ actorId: member, asAdminForMentorId: owner.mentorId })).total).toBe(20)

    // An exported file imports back unchanged.
    const again = readQuestionCsv(questionsToCsv(await bank.listQuestions({ actorId: owner.userId })))
    expect(again.ok && again.questions.map((question) => question.prompt).sort()).toEqual(read.questions.map((question) => question.prompt).sort())
  }, 120_000)

  it('reports every bad row and imports nothing; a row the database refuses rolls the whole file back', async () => {
    const owner = await createActiveMentor(db.query)
    const bank = createQuestionBankRepository({ query: db.query, transaction: db.transaction })
    const lines = csvRows(3).trim().split('\r\n')
    lines.push('multiple,Pick the ballast tanks,Fore peak | Aft peak,5,,,,,,,,,')
    lines.push('fill_blank,The answer is ___,,,,maybe,1,,,,,,')
    const read = readQuestionCsv(lines.join('\r\n'))
    expect(read).toEqual({
      ok: false,
      errors: [
        { row: 5, messages: ['Correct must be option numbers between 1 and 2.'] },
        { row: 6, messages: ['case_sensitive must be yes or no.'] },
      ],
    })

    const valid = readQuestionCsv(csvRows(3))
    if (!valid.ok) throw new Error('unreachable')
    const broken = { ...valid.questions[0]!, topic: 'x'.repeat(81) }
    await expect(bank.importQuestions({ actorId: owner.userId }, [...valid.questions, broken])).rejects.toThrow()
    expect((await bank.getBank({ actorId: owner.userId })).total).toBe(0)
  }, 120_000)
})
