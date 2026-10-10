import type { QueryResultRow } from 'pg'
import { query as databaseQuery, withTransaction as databaseTransaction, type DatabaseQueryClient } from '@/lib/db/client'
import { learnerCourseAccessSql } from './course-publication'
import { courseManagerAccessSql, enrollmentAccessOpenSql } from './course-access'
import {
  ASSIGNMENT_DEFAULTS,
  assignmentSubmissionPrefix,
  isAssignmentAttachmentPath,
  type AssignmentAttachmentRules,
} from './assignment-policy'

export type AssignmentQuery = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>
type AssignmentTransaction = <T>(work: (query: AssignmentQuery) => Promise<T>) => Promise<T>

type AssignmentAccessRow = QueryResultRow & {
  assignment_id: string
  enrollment_id: string
  lesson_id: string
  max_attempts: string | number | null
  attempts_used: string | number
  pending_attempt_id?: string | null
  completed?: boolean | null
}

type AttemptRow = QueryResultRow & {
  id: string
  attempt_number: string | number
  status: string
  submitted_at: string | Date
  response_text?: string | null
  score_points?: string | number | null
  percentage?: string | number | null
  passed?: boolean | null
  feedback?: string | null
  graded_at?: string | Date | null
}

type AssignmentStateAccessRow = QueryResultRow & {
  assignment_id: string
  enrollment_id: string
  max_points: string | number
  passing_percentage: string | number
  max_attempts: string | number | null
  completed: boolean | null
  accepted_extensions?: string[] | null
  max_upload_bytes?: string | number | null
  max_files?: string | number | null
}

type AttachmentRow = QueryResultRow & {
  id: string
  attempt_id: string
  file_name: string
  content_type: string
  size_bytes: string | number
}

type ViewerAttachmentRow = QueryResultRow & {
  storage_path: string
  file_name: string
  content_type: string
}

/** A file a learner attached to a submission. */
export type LearnerAssignmentAttachment = {
  id: string
  fileName: string
  contentType: string
  sizeBytes: number
}

/** An uploaded file the server has checked (owner prefix, stored type and size, file signature). */
export type VerifiedAssignmentAttachment = {
  storagePath: string
  fileName: string
  contentType: string
  sizeBytes: number
}

/** What a learner may upload to an assignment they can submit to now. */
export type AssignmentSubmissionTarget = {
  enrollmentId: string
  lessonId: string
  rules: AssignmentAttachmentRules
}

export type LearnerAssignmentAttempt = {
  id: string
  attemptNumber: number
  status: 'submitted' | 'graded'
  submittedAt: string
  responseText: string | null
  scorePoints: number | null
  percentage: number | null
  passed: boolean | null
  feedback: string | null
  gradedAt: string | null
  attachments: LearnerAssignmentAttachment[]
}

export type LearnerAssignmentState = {
  completed: boolean
  maxPoints: number
  passingPercentage: number
  maxAttempts: number | null
  attemptsUsed: number
  attemptsRemaining: number | null
  reviewPending: boolean
  latestAttempt: LearnerAssignmentAttempt | null
  attempts: LearnerAssignmentAttempt[]
  /** File rules for submissions (empty extensions = any supported type). */
  attachmentRules: AssignmentAttachmentRules
}

function runtimeTransaction<T>(work: (query: AssignmentQuery) => Promise<T>) {
  return databaseTransaction(async (client: DatabaseQueryClient) => work(async (text, values) => {
    const result = await client.query(text, values)
    return result.rows
  }))
}

function iso(value: string | Date | null | undefined) {
  if (!value) return null
  return value instanceof Date ? value.toISOString() : value
}

function asStatus(value: string): 'submitted' | 'graded' {
  if (value === 'submitted' || value === 'graded') return value
  throw new Error('assignment_attempt_status_invalid')
}

function asSubmittedStatus(value: string): 'submitted' {
  if (value === 'submitted') return value
  throw new Error('assignment_attempt_status_invalid')
}

function mapAttempt(row: AttemptRow): LearnerAssignmentAttempt {
  return {
    id: row.id,
    attemptNumber: Number(row.attempt_number),
    status: asStatus(row.status),
    submittedAt: iso(row.submitted_at)!,
    responseText: row.response_text ?? null,
    scorePoints: row.score_points === null || row.score_points === undefined ? null : Number(row.score_points),
    percentage: row.percentage === null || row.percentage === undefined ? null : Number(row.percentage),
    passed: row.passed ?? null,
    feedback: row.feedback ?? null,
    gradedAt: iso(row.graded_at),
    attachments: [],
  }
}

function rulesFrom(row: {
  accepted_extensions?: string[] | null
  max_upload_bytes?: string | number | null
  max_files?: string | number | null
}): AssignmentAttachmentRules {
  return {
    acceptedExtensions: row.accepted_extensions ?? [],
    maxUploadBytes: Number(row.max_upload_bytes ?? ASSIGNMENT_DEFAULTS.maxUploadBytes),
    maxFiles: Number(row.max_files ?? ASSIGNMENT_DEFAULTS.maxFiles),
  }
}

async function loadAttachments(query: AssignmentQuery, attemptIds: string[]) {
  const byAttempt = new Map<string, LearnerAssignmentAttachment[]>()
  if (attemptIds.length === 0) return byAttempt
  const rows = await query(
    `select id, attempt_id, file_name, content_type, size_bytes
     from public.learning_assignment_attachments
     where attempt_id = any($1::uuid[])
     order by attempt_id, position asc`,
    [attemptIds],
  ) as AttachmentRow[]
  for (const row of rows) {
    const list = byAttempt.get(row.attempt_id) ?? []
    list.push({ id: row.id, fileName: row.file_name, contentType: row.content_type, sizeBytes: Number(row.size_bytes) })
    byAttempt.set(row.attempt_id, list)
  }
  return byAttempt
}

/** Files attached to the given attempts, for the trainer's grading view. */
export async function loadAssignmentAttachmentsWithQuery(query: AssignmentQuery, attemptIds: string[]) {
  return loadAttachments(query, attemptIds)
}

export function createLearnerAssignmentRepository(input: {
  query?: AssignmentQuery
  transaction?: AssignmentTransaction
} = {}) {
  const queryRows: AssignmentQuery = input.query ?? ((text, values) => databaseQuery<QueryResultRow>(text, values))
  const transaction = input.transaction ?? runtimeTransaction

  async function getState(learnerId: string, slug: string, lessonId: string): Promise<LearnerAssignmentState | null> {
    const accessRows = await queryRows(
      `select
         assignment.id as assignment_id,
         enrollment.id as enrollment_id,
         assignment.max_points,
         assignment.passing_percentage,
         assignment.accepted_extensions,
         assignment.max_upload_bytes,
         assignment.max_files,
         lesson.max_attempts,
         coalesce(progress.completed, false) as completed
       from public.learning_enrollments enrollment
       inner join public.learning_courses course
         on course.id = enrollment.course_id
       left join public.learning_mentors mentor
         on mentor.id = course.mentor_id
       left join public.learning_mentor_applications application
         on application.id = mentor.application_id
        and application.user_id = mentor.user_id
       left join public.companies company
         on company.id = course.company_id
       inner join public.learning_course_sections section on section.course_id = course.id
       inner join public.learning_lessons lesson
         on lesson.section_id = section.id
        and lesson.lesson_type = 'assignment'
        and lesson.is_published = true
       inner join public.learning_assignments assignment on assignment.lesson_id = lesson.id
       left join public.learning_progress progress
         on progress.enrollment_id = enrollment.id
        and progress.lesson_id = lesson.id
       where enrollment.learner_id = $1
         and enrollment.status in ('active', 'completed')
         and ${enrollmentAccessOpenSql()}
         and course.slug = $2
         and lesson.id = $3
         and ${learnerCourseAccessSql()}
       limit 1`,
      [learnerId, slug, lessonId],
    ) as AssignmentStateAccessRow[]
    const access = accessRows[0]
    if (!access) return null

    const attemptRows = await queryRows(
      `select id, attempt_number, status, submitted_at, response_text,
              score_points, percentage, passed, feedback, graded_at
       from public.learning_assignment_attempts
       where enrollment_id = $1
         and lesson_id = $2
         and learner_id = $3
       order by attempt_number desc, id desc`,
      [access.enrollment_id, lessonId, learnerId],
    ) as AttemptRow[]
    const attempts = attemptRows.map(mapAttempt)
    const attachments = await loadAttachments(queryRows, attempts.map((attempt) => attempt.id))
    for (const attempt of attempts) attempt.attachments = attachments.get(attempt.id) ?? []
    const maxAttempts = access.max_attempts === null ? null : Number(access.max_attempts)
    const attemptsUsed = attempts.length

    return {
      completed: access.completed ?? false,
      maxPoints: Number(access.max_points),
      passingPercentage: Number(access.passing_percentage),
      maxAttempts,
      attemptsUsed,
      attemptsRemaining: maxAttempts === null ? null : Math.max(0, maxAttempts - attemptsUsed),
      reviewPending: attempts.some((attempt) => attempt.status === 'submitted'),
      latestAttempt: attempts[0] ?? null,
      attempts,
      attachmentRules: rulesFrom(access),
    }
  }

  /**
   * The learner's access to submit right now (enrolled, released, unlocked, not complete, nothing
   * awaiting review, attempts left), with the assignment's file rules. Throws when they can't.
   */
  async function submissionAccess(query: AssignmentQuery, learnerId: string, slug: string, lessonId: string, lock: boolean) {
      const accessRows = await query(
        `select
           assignment.id as assignment_id,
           enrollment.id as enrollment_id,
           lesson.id as lesson_id,
           assignment.accepted_extensions,
           assignment.max_upload_bytes,
           assignment.max_files,
           lesson.max_attempts,
           coalesce(progress.completed, false) as completed,
           (select count(*)::bigint
              from public.learning_assignment_attempts counted
             where counted.enrollment_id = enrollment.id
               and counted.lesson_id = lesson.id) as attempts_used,
           (select pending.id
              from public.learning_assignment_attempts pending
             where pending.enrollment_id = enrollment.id
               and pending.lesson_id = lesson.id
               and pending.status = 'submitted'
             order by pending.attempt_number desc, pending.id desc
             limit 1) as pending_attempt_id
         from public.learning_enrollments enrollment
         inner join public.learning_courses course
           on course.id = enrollment.course_id
         left join public.learning_mentors mentor
           on mentor.id = course.mentor_id
         left join public.learning_mentor_applications application
           on application.id = mentor.application_id
          and application.user_id = mentor.user_id
         left join public.companies company
           on company.id = course.company_id
         inner join public.learning_course_sections section on section.course_id = course.id
         inner join public.learning_lessons lesson
           on lesson.section_id = section.id
          and lesson.lesson_type = 'assignment'
          and lesson.is_published = true
         inner join public.learning_assignments assignment on assignment.lesson_id = lesson.id
         left join public.learning_progress progress
           on progress.enrollment_id = enrollment.id
          and progress.lesson_id = lesson.id
         left join public.learning_progress prerequisite_progress
           on prerequisite_progress.enrollment_id = enrollment.id
          and prerequisite_progress.lesson_id = lesson.prerequisite_lesson_id
         where enrollment.learner_id = $1
           and enrollment.status in ('active', 'completed')
         and ${enrollmentAccessOpenSql()}
           and course.slug = $2
           and lesson.id = $3
           and ${learnerCourseAccessSql()}
           and (
             lesson.release_mode = 'immediate'
             or (lesson.release_mode = 'scheduled' and lesson.release_at <= now())
             or (lesson.release_mode = 'drip' and enrollment.enrolled_at + make_interval(days => lesson.drip_delay_days) <= now())
           )
           and (lesson.prerequisite_lesson_id is null or prerequisite_progress.completed = true)
           and (
             course.navigation_mode = 'free'
             or lesson.prerequisite_lesson_id is not null
             or not exists (
               select 1
               from public.learning_course_sections previous_section
               inner join public.learning_lessons previous_lesson
                 on previous_lesson.section_id = previous_section.id
                and previous_lesson.is_published = true
               left join public.learning_progress previous_progress
                 on previous_progress.enrollment_id = enrollment.id
                and previous_progress.lesson_id = previous_lesson.id
               where previous_section.course_id = course.id
                 and (
                   previous_section.position < section.position
                   or (previous_section.position = section.position and previous_lesson.position < lesson.position)
                 )
                 and coalesce(previous_progress.completed, false) = false
             )
           )
         ${lock ? 'for update of enrollment, lesson' : 'limit 1'}`,
        [learnerId, slug, lessonId],
      ) as Array<AssignmentAccessRow & { accepted_extensions?: string[] | null; max_upload_bytes?: string | number | null; max_files?: string | number | null }>

      const access = accessRows[0]
      if (!access) throw new Error('assignment_not_accessible')
      if (access.completed) throw new Error('assignment_already_completed')
      if (access.pending_attempt_id) throw new Error('assignment_review_pending')
      const attemptsUsed = Number(access.attempts_used ?? 0)
      const maxAttempts = access.max_attempts === null ? null : Number(access.max_attempts)
      if (maxAttempts !== null && attemptsUsed >= maxAttempts) throw new Error('learning_attempt_limit_reached')
      return { access, attemptsUsed, rules: rulesFrom(access) }
  }

  /** Checks the learner may submit now and returns where their files go and the rules they follow. */
  async function getSubmissionTarget(learnerId: string, slug: string, lessonId: string): Promise<AssignmentSubmissionTarget> {
    const { access, rules } = await submissionAccess(queryRows, learnerId, slug, lessonId, false)
    return { enrollmentId: access.enrollment_id, lessonId: access.lesson_id, rules }
  }

  async function submit(
    learnerId: string,
    slug: string,
    lessonId: string,
    submission: {
      responseText: string | null
      /** The id the learner's files were uploaded under; becomes the attempt id. */
      submissionId?: string | null
      attachments: readonly VerifiedAssignmentAttachment[]
    },
  ) {
    if (!submission.responseText?.trim() && submission.attachments.length === 0) {
      throw new Error('assignment_submission_empty')
    }

    return transaction(async (query) => {
      const { access, attemptsUsed, rules } = await submissionAccess(query, learnerId, slug, lessonId, true)
      if (submission.attachments.length > rules.maxFiles) throw new Error('assignment_too_many_files')
      if (submission.attachments.length > 0) {
        if (!submission.submissionId) throw new Error('assignment_attachment_invalid')
        for (const attachment of submission.attachments) {
          const extension = attachment.storagePath.slice(attachment.storagePath.lastIndexOf('.') + 1)
          if (!isAssignmentAttachmentPath({
            enrollmentId: access.enrollment_id,
            lessonId: access.lesson_id,
            submissionId: submission.submissionId,
            extension,
            storagePath: attachment.storagePath,
          })) throw new Error('assignment_attachment_invalid')
        }
      }

      const attemptNumber = attemptsUsed + 1
      const inserted = await query(
        `insert into public.learning_assignment_attempts (
           id, assignment_id, lesson_id, enrollment_id, learner_id, attempt_number,
           response_text, attachment_path, status, submitted_at
         ) values (coalesce($8::uuid, gen_random_uuid()), $1, $2, $3, $4, $5, $6, $7, 'submitted', now())
         returning id, attempt_number, status, submitted_at`,
        [
          access.assignment_id,
          access.lesson_id,
          access.enrollment_id,
          learnerId,
          attemptNumber,
          submission.responseText?.trim() || null,
          // The submission's file prefix: every attached file is stored under it.
          submission.attachments.length > 0
            ? assignmentSubmissionPrefix({ enrollmentId: access.enrollment_id, lessonId: access.lesson_id, submissionId: submission.submissionId! })
            : null,
          submission.submissionId ?? null,
        ],
      ) as AttemptRow[]
      const attempt = inserted[0]
      if (!attempt) throw new Error('assignment_submit_failed')

      for (const [position, attachment] of submission.attachments.entries()) {
        await query(
          `insert into public.learning_assignment_attachments (
             attempt_id, storage_path, file_name, content_type, size_bytes, position
           ) values ($1, $2, $3, $4, $5, $6)`,
          [attempt.id, attachment.storagePath, attachment.fileName, attachment.contentType, attachment.sizeBytes, position],
        )
      }

      await query(
        `insert into public.learning_progress (
           enrollment_id, lesson_id, first_started_at, viewed_at, attempts_used, updated_at
         ) values ($1, $2, now(), now(), $3, now())
         on conflict (enrollment_id, lesson_id) do update
         set first_started_at = coalesce(public.learning_progress.first_started_at, excluded.first_started_at),
             viewed_at = coalesce(public.learning_progress.viewed_at, excluded.viewed_at),
             attempts_used = greatest(public.learning_progress.attempts_used, excluded.attempts_used),
             updated_at = now()`,
        [access.enrollment_id, access.lesson_id, attemptNumber],
      )

      return {
        attemptId: attempt.id,
        attemptNumber: Number(attempt.attempt_number),
        status: asSubmittedStatus(attempt.status),
        submittedAt: iso(attempt.submitted_at)!,
        completed: false as const,
      }
    })
  }

  /**
   * An attached file, if the viewer may download it: the learner who submitted it, a manager of the
   * course (its trainer, or the organization's owners, administrators and LMS managers), or a
   * platform administrator. Anyone else gets null.
   */
  async function getAttachmentForViewer(viewerId: string, attachmentId: string) {
    const rows = await queryRows(
      `select attachment.storage_path, attachment.file_name, attachment.content_type
       from public.learning_assignment_attachments attachment
       inner join public.learning_assignment_attempts attempt on attempt.id = attachment.attempt_id
       inner join public.learning_lessons lesson on lesson.id = attempt.lesson_id
       inner join public.learning_course_sections section on section.id = lesson.section_id
       inner join public.learning_courses course on course.id = section.course_id
       where attachment.id = $1
         and (
           attempt.learner_id = $2
           or ${courseManagerAccessSql('course', '$2')}
           or exists (
             select 1 from public.user_roles role
             where role.user_id = $2 and role.role::text = 'administrator'
           )
         )
       limit 1`,
      [attachmentId, viewerId],
    ) as ViewerAttachmentRow[]
    const row = rows[0]
    return row ? { storagePath: row.storage_path, fileName: row.file_name, contentType: row.content_type } : null
  }

  return { getState, getSubmissionTarget, submit, getAttachmentForViewer }
}

export const learnerAssignmentRepository = createLearnerAssignmentRepository()
