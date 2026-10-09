import type { QueryResultRow } from 'pg'
import { query as databaseQuery, withTransaction as databaseTransaction, type DatabaseQueryClient } from '@/lib/db/client'
import { courseManagerAccessSql } from './course-access'
import { issueCertificateForFinalQuizWithQuery } from './certificate-repository'
import { finalizeEnrollmentIfComplete } from './learner-progress-repository'
import { notifyQuizGraded } from './learning-notifications'
import { attemptTotals, questionTypeOf, roundMarks, type QuestionType } from './quiz-model'

/**
 * Learning round B (B2): written quiz answers wait in the trainer's grading queue. Grading them completes the
 * attempt: its score, pass/fail, the material's completion and (through the enrolment) the certificate follow.
 */

type Query = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>
type Transaction = <T>(work: (query: Query) => Promise<T>) => Promise<T>

export type MentorQuizAttempt = {
  id: string
  attemptNumber: number
  status: 'awaiting_grading' | 'completed'
  submittedAt: string
  gradedAt: string | null
  percentage: number
  passed: boolean
  passPercentage: number
  pendingAnswers: number
  courseTitle: string
  lessonTitle: string
  learnerName: string
}

export type MentorQuizAnswer = {
  id: string
  questionId: string
  prompt: string
  type: QuestionType
  maxPoints: number
  pointsAwarded: number | null
  gradingStatus: 'auto' | 'pending' | 'graded'
  isCorrect: boolean
  textResponse: string | null
  selectedLabels: string[]
  correctLabels: string[]
  acceptedAnswers: string[]
  feedback: string | null
}

export type MentorQuizReview = MentorQuizAttempt & {
  scorePoints: number | null
  maxPoints: number | null
  answers: MentorQuizAnswer[]
}

export type QuizAnswerGrade = { answerId: string; points: number; feedback: string | null }

export class QuizGradingError extends Error {
  constructor(code: 'quiz_attempt_not_found' | 'quiz_attempt_already_graded' | 'quiz_grade_invalid') {
    super(code)
    this.name = 'QuizGradingError'
  }
}

function runtimeTransaction<T>(work: (query: Query) => Promise<T>) {
  return databaseTransaction(async (client: DatabaseQueryClient) => work(async (text, values) => {
    const result = await client.query(text, values)
    return result.rows
  }))
}

function iso(value: unknown) {
  if (value === null || value === undefined) return null
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString()
}

const ATTEMPT_COLUMNS = `attempt.id as attempt_id, attempt.attempt_number, attempt.status, attempt.submitted_at, attempt.graded_at,
       attempt.percentage, attempt.passed, attempt.pass_percentage, attempt.score_points, attempt.max_points,
       course.title as course_title, lesson.title as lesson_title, learner.full_name as learner_name,
       (select count(*)::int from public.learning_quiz_attempt_answers pending
        where pending.attempt_id = attempt.id and pending.grading_status = 'pending') as pending_answers`

const ATTEMPT_JOINS = `from public.learning_quiz_attempts attempt
       inner join public.learning_quizzes quiz on quiz.id = attempt.quiz_id
       inner join public.learning_lessons lesson on lesson.id = quiz.lesson_id
       inner join public.learning_course_sections section on section.id = lesson.section_id
       inner join public.learning_courses course on course.id = section.course_id
       inner join public.profiles learner on learner.id = attempt.learner_id`

function mapAttempt(row: QueryResultRow): MentorQuizAttempt {
  return {
    id: String(row.attempt_id),
    attemptNumber: Number(row.attempt_number),
    status: row.status === 'awaiting_grading' ? 'awaiting_grading' : 'completed',
    submittedAt: iso(row.submitted_at)!,
    gradedAt: iso(row.graded_at),
    percentage: Number(row.percentage),
    passed: Boolean(row.passed),
    passPercentage: Number(row.pass_percentage),
    pendingAnswers: Number(row.pending_answers ?? 0),
    courseTitle: String(row.course_title),
    lessonTitle: String(row.lesson_title),
    learnerName: String(row.learner_name ?? 'Learner'),
  }
}

export function createQuizGradingRepository(input: { query?: Query; transaction?: Transaction } = {}) {
  const queryRows: Query = input.query ?? ((text, values) => databaseQuery<QueryResultRow>(text, values))
  const transaction = input.transaction ?? runtimeTransaction

  /** Quiz attempts with written answers in the courses this member manages: waiting first, then recently graded. */
  async function listForMentor(mentorUserId: string): Promise<MentorQuizAttempt[]> {
    const rows = await queryRows(
      `select ${ATTEMPT_COLUMNS}
       ${ATTEMPT_JOINS}
       where ${courseManagerAccessSql('course', '$1')}
         and exists (
           select 1 from public.learning_quiz_attempt_answers answer
           where answer.attempt_id = attempt.id and answer.grading_status in ('pending', 'graded')
         )
       order by (attempt.status = 'awaiting_grading') desc, attempt.submitted_at asc, attempt.id asc
       limit 200`,
      [mentorUserId],
    )
    return rows.map(mapAttempt)
  }

  async function getForMentor(mentorUserId: string, attemptId: string): Promise<MentorQuizReview | null> {
    const rows = await queryRows(
      `select ${ATTEMPT_COLUMNS}
       ${ATTEMPT_JOINS}
       where ${courseManagerAccessSql('course', '$1')}
         and attempt.id = $2
       limit 1`,
      [mentorUserId, attemptId],
    )
    const row = rows[0]
    if (!row) return null
    const answers = await queryRows(
      `select answer.id, answer.question_id, question.prompt, question.question_type, answer.max_points, answer.points_awarded,
              answer.grading_status, answer.is_correct, answer.text_response, answer.feedback, question.accepted_answers,
              coalesce(answer.selected_option_ids, case when answer.selected_option_id is null then '{}'::uuid[] else array[answer.selected_option_id] end) as selected_ids,
              coalesce(answer.correct_option_ids, case when answer.correct_option_id is null then '{}'::uuid[] else array[answer.correct_option_id] end) as correct_ids
       from public.learning_quiz_attempt_answers answer
       inner join public.learning_quiz_questions question on question.id = answer.question_id
       where answer.attempt_id = $1
       order by answer.created_at asc, answer.id asc`,
      [attemptId],
    )
    const optionIds = [...new Set(answers.flatMap((answer) => [...(answer.selected_ids as string[]), ...(answer.correct_ids as string[])]))]
    const labels = optionIds.length
      ? new Map((await queryRows(`select id, label from public.learning_quiz_options where id = any($1::uuid[])`, [optionIds])).map((option) => [String(option.id), String(option.label)]))
      : new Map<string, string>()
    return {
      ...mapAttempt(row),
      scorePoints: row.score_points === null ? null : Number(row.score_points),
      maxPoints: row.max_points === null ? null : Number(row.max_points),
      answers: answers.map((answer) => ({
        id: String(answer.id),
        questionId: String(answer.question_id),
        prompt: String(answer.prompt),
        type: questionTypeOf(answer.question_type),
        maxPoints: answer.max_points === null ? 1 : Number(answer.max_points),
        pointsAwarded: answer.points_awarded === null ? null : Number(answer.points_awarded),
        gradingStatus: answer.grading_status === 'pending' || answer.grading_status === 'graded' ? answer.grading_status : 'auto',
        isCorrect: Boolean(answer.is_correct),
        textResponse: answer.text_response ?? null,
        selectedLabels: (answer.selected_ids as string[]).map((id) => labels.get(id) ?? '').filter(Boolean),
        correctLabels: (answer.correct_ids as string[]).map((id) => labels.get(id) ?? '').filter(Boolean),
        acceptedAnswers: questionTypeOf(answer.question_type) === 'fill_blank' ? (answer.accepted_answers as string[] | null) ?? [] : [],
        feedback: answer.feedback ?? null,
      })),
    }
  }

  /**
   * Grades every waiting written answer of an attempt at once, then completes the attempt: score and pass/fail
   * from all its answers, and on a pass the material's completion (and the certificate, when the course is done).
   */
  async function grade(mentorUserId: string, attemptId: string, grades: readonly QuizAnswerGrade[]) {
    return transaction(async (query) => {
      const locked = await query(
        `select attempt.id, attempt.status, attempt.enrollment_id, attempt.learner_id, attempt.pass_percentage,
                lesson.id as lesson_id, course.id as course_id
         ${ATTEMPT_JOINS}
         where ${courseManagerAccessSql('course', '$1')}
           and attempt.id = $2
         for update of attempt`,
        [mentorUserId, attemptId],
      )
      const attempt = locked[0]
      if (!attempt) throw new QuizGradingError('quiz_attempt_not_found')
      if (attempt.status !== 'awaiting_grading') throw new QuizGradingError('quiz_attempt_already_graded')

      const pending = await query(
        `select id, max_points from public.learning_quiz_attempt_answers where attempt_id = $1 and grading_status = 'pending'`,
        [attemptId],
      )
      const byId = new Map(grades.map((entry) => [entry.answerId, entry]))
      if (pending.length === 0 || byId.size !== grades.length || pending.length !== grades.length) throw new QuizGradingError('quiz_grade_invalid')
      for (const answer of pending) {
        const entry = byId.get(String(answer.id))
        const maxPoints = Number(answer.max_points)
        if (!entry || !Number.isFinite(entry.points) || entry.points < 0 || entry.points > maxPoints || roundMarks(entry.points) !== entry.points) {
          throw new QuizGradingError('quiz_grade_invalid')
        }
        await query(
          `update public.learning_quiz_attempt_answers
           set grading_status = 'graded', points_awarded = $2, is_correct = $3, feedback = $4, graded_by = $5, graded_at = now()
           where id = $1 and grading_status = 'pending'`,
          [answer.id, entry.points, entry.points >= maxPoints, entry.feedback?.trim() || null, mentorUserId],
        )
      }

      const answers = await query(
        `select points_awarded, max_points, is_correct, grading_status from public.learning_quiz_attempt_answers where attempt_id = $1`,
        [attemptId],
      )
      const totals = attemptTotals(answers.map((answer) => ({
        pointsAwarded: answer.points_awarded === null ? null : Number(answer.points_awarded),
        maxPoints: answer.max_points === null ? 1 : Number(answer.max_points),
        isCorrect: Boolean(answer.is_correct),
        gradingStatus: String(answer.grading_status),
      })))
      const passed = totals.percentage >= Number(attempt.pass_percentage)
      await query(
        `update public.learning_quiz_attempts
         set status = 'completed', score = $2, score_points = $3, max_points = $4, percentage = $5, passed = $6, graded_at = now()
         where id = $1 and status = 'awaiting_grading'`,
        [attemptId, totals.correctCount, totals.scorePoints, totals.maxPoints, totals.percentage, passed],
      )

      let enrollmentCompleted = false
      if (passed) {
        await query(
          `insert into public.learning_progress (
             enrollment_id, lesson_id, completed, completed_at, first_started_at, viewed_at, updated_at
           ) values ($1, $2, true, now(), now(), now(), now())
           on conflict (enrollment_id, lesson_id) do update
           set completed = true,
               completed_at = coalesce(public.learning_progress.completed_at, excluded.completed_at),
               first_started_at = coalesce(public.learning_progress.first_started_at, excluded.first_started_at),
               viewed_at = coalesce(public.learning_progress.viewed_at, excluded.viewed_at),
               updated_at = now()`,
          [attempt.enrollment_id, attempt.lesson_id],
        )
        enrollmentCompleted = (await finalizeEnrollmentIfComplete(query, String(attempt.enrollment_id), String(attempt.course_id))).enrollmentCompleted
        await issueCertificateForFinalQuizWithQuery(query, String(attempt.enrollment_id), String(attempt.lesson_id))
      }
      await notifyQuizGraded(query, { attemptId })
      return { attemptId, percentage: totals.percentage, passed, scorePoints: totals.scorePoints, maxPoints: totals.maxPoints, enrollmentCompleted }
    })
  }

  return { listForMentor, getForMentor, grade }
}

export const quizGradingRepository = createQuizGradingRepository()
