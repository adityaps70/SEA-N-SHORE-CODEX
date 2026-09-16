import type { QueryResultRow } from 'pg'
import { query as databaseQuery, withTransaction as databaseTransaction, type DatabaseQueryClient } from '@/lib/db/client'
import { finalizeEnrollmentIfComplete } from './learner-progress-repository'

export type AssignmentGradingQuery = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>
type AssignmentGradingTransaction = <T>(work: (query: AssignmentGradingQuery) => Promise<T>) => Promise<T>

type GradeAccessRow = QueryResultRow & {
  attempt_id: string
  status: string
  enrollment_id: string
  lesson_id: string
  learner_id: string
  course_id: string
  course_slug: string
  max_points: string | number
  passing_percentage: string | number
}

type GradedRow = QueryResultRow & { graded_at: string | Date }

type MentorAttemptRow = QueryResultRow & {
  attempt_id: string
  attempt_number: string | number
  status: string
  submitted_at: string | Date
  response_text: string | null
  attachment_path: string | null
  score_points: string | number | null
  percentage: string | number | null
  passed: boolean | null
  feedback: string | null
  graded_at: string | Date | null
  max_points: string | number
  passing_percentage: string | number
  course_title: string
  course_slug: string
  lesson_title: string
  learner_name: string
}

type MentorReviewRow = MentorAttemptRow & {
  assignment_instructions: string
  enrollment_id: string
  lesson_id: string
  learner_id: string
}

type MentorAttemptHistoryRow = QueryResultRow & {
  attempt_id: string
  attempt_number: string | number
  status: string
  submitted_at: string | Date
  response_text: string | null
  attachment_path: string | null
  score_points: string | number | null
  percentage: string | number | null
  passed: boolean | null
  feedback: string | null
  graded_at: string | Date | null
}

export type MentorAssignmentAttempt = {
  id: string
  attemptNumber: number
  status: 'submitted' | 'graded'
  submittedAt: string
  responseText: string | null
  attachmentPath: string | null
  scorePoints: number | null
  percentage: number | null
  passed: boolean | null
  feedback: string | null
  gradedAt: string | null
  maxPoints: number
  passingPercentage: number
  courseTitle: string
  courseSlug: string
  lessonTitle: string
  learnerName: string
}

export type MentorAssignmentAttemptHistory = {
  id: string
  attemptNumber: number
  status: 'submitted' | 'graded'
  submittedAt: string
  responseText: string | null
  attachmentPath: string | null
  scorePoints: number | null
  percentage: number | null
  passed: boolean | null
  feedback: string | null
  gradedAt: string | null
}

export type MentorAssignmentReview = MentorAssignmentAttempt & {
  assignmentInstructions: string
  previousAttempts: MentorAssignmentAttemptHistory[]
}

function runtimeTransaction<T>(work: (query: AssignmentGradingQuery) => Promise<T>) {
  return databaseTransaction(async (client: DatabaseQueryClient) => work(async (text, values) => {
    const result = await client.query(text, values)
    return result.rows
  }))
}

function iso(value: string | Date | null) {
  if (value === null) return null
  return value instanceof Date ? value.toISOString() : value
}

function status(value: string): 'submitted' | 'graded' {
  if (value === 'submitted' || value === 'graded') return value
  throw new Error('assignment_attempt_status_invalid')
}

function mapMentorAttempt(row: MentorAttemptRow): MentorAssignmentAttempt {
  return {
    id: row.attempt_id,
    attemptNumber: Number(row.attempt_number),
    status: status(row.status),
    submittedAt: iso(row.submitted_at)!,
    responseText: row.response_text,
    attachmentPath: row.attachment_path,
    scorePoints: row.score_points === null ? null : Number(row.score_points),
    percentage: row.percentage === null ? null : Number(row.percentage),
    passed: row.passed,
    feedback: row.feedback,
    gradedAt: iso(row.graded_at),
    maxPoints: Number(row.max_points),
    passingPercentage: Number(row.passing_percentage),
    courseTitle: row.course_title,
    courseSlug: row.course_slug,
    lessonTitle: row.lesson_title,
    learnerName: row.learner_name,
  }
}

function mapAttemptHistory(row: MentorAttemptHistoryRow): MentorAssignmentAttemptHistory {
  return {
    id: row.attempt_id,
    attemptNumber: Number(row.attempt_number),
    status: status(row.status),
    submittedAt: iso(row.submitted_at)!,
    responseText: row.response_text,
    attachmentPath: row.attachment_path,
    scorePoints: row.score_points === null ? null : Number(row.score_points),
    percentage: row.percentage === null ? null : Number(row.percentage),
    passed: row.passed,
    feedback: row.feedback,
    gradedAt: iso(row.graded_at),
  }
}

export function createAssignmentGradingRepository(input: {
  query?: AssignmentGradingQuery
  transaction?: AssignmentGradingTransaction
} = {}) {
  const queryRows: AssignmentGradingQuery = input.query ?? ((text, values) => databaseQuery<QueryResultRow>(text, values))
  const transaction = input.transaction ?? runtimeTransaction

  async function listForMentor(mentorUserId: string): Promise<MentorAssignmentAttempt[]> {
    const rows = await queryRows(
      `select
         attempt.id as attempt_id,
         attempt.attempt_number,
         attempt.status,
         attempt.submitted_at,
         attempt.response_text,
         attempt.attachment_path,
         attempt.score_points,
         attempt.percentage,
         attempt.passed,
         attempt.feedback,
         attempt.graded_at,
         assignment.max_points,
         assignment.passing_percentage,
         course.title as course_title,
         course.slug as course_slug,
         lesson.title as lesson_title,
         learner.full_name as learner_name
       from public.learning_assignment_attempts attempt
       inner join public.learning_assignments assignment on assignment.id = attempt.assignment_id
       inner join public.learning_lessons lesson on lesson.id = attempt.lesson_id
       inner join public.learning_course_sections section on section.id = lesson.section_id
       inner join public.learning_courses course on course.id = section.course_id
       inner join public.learning_mentors mentor on mentor.id = course.mentor_id
       inner join public.profiles learner on learner.id = attempt.learner_id
       where mentor.user_id = $1
         and mentor.status = 'active'
       order by (attempt.status = 'submitted') desc, attempt.submitted_at asc, attempt.id asc`,
      [mentorUserId],
    ) as MentorAttemptRow[]

    return rows.map(mapMentorAttempt)
  }

  async function getForMentor(mentorUserId: string, attemptId: string): Promise<MentorAssignmentReview | null> {
    const rows = await queryRows(
      `select
         attempt.id as attempt_id,
         attempt.attempt_number,
         attempt.status,
         attempt.submitted_at,
         attempt.response_text,
         attempt.attachment_path,
         attempt.score_points,
         attempt.percentage,
         attempt.passed,
         attempt.feedback,
         attempt.graded_at,
         attempt.enrollment_id,
         attempt.lesson_id,
         attempt.learner_id,
         assignment.instructions as assignment_instructions,
         assignment.max_points,
         assignment.passing_percentage,
         course.title as course_title,
         course.slug as course_slug,
         lesson.title as lesson_title,
         learner.full_name as learner_name
       from public.learning_assignment_attempts attempt
       inner join public.learning_assignments assignment on assignment.id = attempt.assignment_id
       inner join public.learning_lessons lesson on lesson.id = attempt.lesson_id
       inner join public.learning_course_sections section on section.id = lesson.section_id
       inner join public.learning_courses course on course.id = section.course_id
       inner join public.learning_mentors mentor on mentor.id = course.mentor_id
       inner join public.profiles learner on learner.id = attempt.learner_id
       where mentor.user_id = $1
         and mentor.status = 'active'
         and attempt.id = $2
       limit 1`,
      [mentorUserId, attemptId],
    ) as MentorReviewRow[]
    const selected = rows[0]
    if (!selected) return null

    const previousRows = await queryRows(
      `select
         attempt.id as attempt_id,
         attempt.attempt_number,
         attempt.status,
         attempt.submitted_at,
         attempt.response_text,
         attempt.attachment_path,
         attempt.score_points,
         attempt.percentage,
         attempt.passed,
         attempt.feedback,
         attempt.graded_at
       from public.learning_assignment_attempts attempt
       where attempt.enrollment_id = $1
         and attempt.lesson_id = $2
         and attempt.learner_id = $3
         and attempt.attempt_number < $4
       order by attempt.attempt_number desc, attempt.id desc`,
      [selected.enrollment_id, selected.lesson_id, selected.learner_id, Number(selected.attempt_number)],
    ) as MentorAttemptHistoryRow[]

    return {
      ...mapMentorAttempt(selected),
      assignmentInstructions: selected.assignment_instructions,
      previousAttempts: previousRows.map(mapAttemptHistory),
    }
  }

  async function grade(
    mentorUserId: string,
    attemptId: string,
    inputValue: { scorePoints: number; feedback: string | null },
  ) {
    return transaction(async (query) => {
      const accessRows = await query(
        `select
           attempt.id as attempt_id,
           attempt.status,
           attempt.enrollment_id,
           attempt.lesson_id,
           attempt.learner_id,
           course.id as course_id,
           course.slug as course_slug,
           assignment.max_points,
           assignment.passing_percentage
         from public.learning_assignment_attempts attempt
         inner join public.learning_assignments assignment on assignment.id = attempt.assignment_id
         inner join public.learning_lessons lesson on lesson.id = attempt.lesson_id
         inner join public.learning_course_sections section on section.id = lesson.section_id
         inner join public.learning_courses course on course.id = section.course_id
         inner join public.learning_mentors mentor on mentor.id = course.mentor_id
         where mentor.user_id = $1
           and mentor.status = 'active'
           and attempt.id = $2
         for update of attempt`,
        [mentorUserId, attemptId],
      ) as GradeAccessRow[]
      const access = accessRows[0]
      if (!access) throw new Error('assignment_attempt_not_found')
      if (access.status !== 'submitted') throw new Error('assignment_already_graded')

      const maxPoints = Number(access.max_points)
      if (!Number.isInteger(inputValue.scorePoints) || inputValue.scorePoints < 0 || inputValue.scorePoints > maxPoints) {
        throw new Error('assignment_score_invalid')
      }
      const percentage = Math.round((inputValue.scorePoints / maxPoints) * 100)
      const passingPercentage = Number(access.passing_percentage)
      const passed = percentage >= passingPercentage
      const feedback = inputValue.feedback?.trim() || null

      const gradedRows = await query(
        `update public.learning_assignment_attempts
         set status = 'graded',
             score_points = $3,
             percentage = $4,
             passed = $5,
             feedback = $6,
             graded_by = $1,
             graded_at = now()
         where id = $2
           and status = 'submitted'
         returning graded_at`,
        [mentorUserId, attemptId, inputValue.scorePoints, percentage, passed, feedback],
      ) as GradedRow[]
      const graded = gradedRows[0]
      if (!graded) throw new Error('assignment_grade_failed')

      let progressPercent: number | null = null
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
          [access.enrollment_id, access.lesson_id],
        )
        const progress = await finalizeEnrollmentIfComplete(query, access.enrollment_id, access.course_id)
        progressPercent = progress.progressPercent
        enrollmentCompleted = progress.enrollmentCompleted
      }

      return {
        attemptId,
        courseSlug: access.course_slug,
        scorePoints: inputValue.scorePoints,
        maxPoints,
        percentage,
        passingPercentage,
        passed,
        feedback,
        gradedAt: iso(graded.graded_at)!,
        progressPercent,
        enrollmentCompleted,
      }
    })
  }

  return { listForMentor, getForMentor, grade }
}

export const assignmentGradingRepository = createAssignmentGradingRepository()
