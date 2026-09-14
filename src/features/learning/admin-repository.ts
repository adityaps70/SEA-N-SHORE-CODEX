import type { QueryResultRow } from 'pg'
import { query as databaseQuery, withTransaction as databaseTransaction, type DatabaseQueryClient } from '@/lib/db/client'
import { canTransitionCourseStatus, type CourseStatus } from './course-workflow'
import {
  canTransitionMentorApplicationStatus,
  type MentorApplicationStatus,
} from './mentor-application'

type LearningAdminQuery = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>
type LearningAdminTransaction = <T>(work: (query: LearningAdminQuery) => Promise<T>) => Promise<T>
export type MentorReviewDecision = 'approved' | 'changes_requested' | 'rejected'
export type CourseAdminDecision = 'changes_requested' | 'approved' | 'published' | 'archived'

export type MentorApplicationReviewItem = {
  applicationId: string
  userId: string
  name: string
  currentLastRank: string
  yearsExperience: number
  vesselTypes: string[]
  specialization: string
  certifications: string[]
  linkedInUrl: string | null
  shortBio: string
  profilePhotoPath: string | null
  proposedCourseTopics: string[]
  status: MentorApplicationStatus
  submittedAt: string
  updatedAt: string
  adminReviewNote: string | null
}

export type CourseReviewItem = {
  courseId: string
  mentorId: string
  mentorUserId: string
  mentorName: string
  slug: string
  title: string
  subtitle: string | null
  description: string
  category: string
  level: 'beginner' | 'intermediate' | 'advanced' | 'all_levels'
  language: string
  learningOutcomes: string[]
  requirements: string[]
  targetAudience: string[]
  priceMinor: number
  discountPriceMinor: number | null
  currency: string
  accessType: 'free' | 'paid'
  certificateEnabled: boolean
  courseFormat: 'recorded' | 'live_cohort' | 'hybrid'
  status: CourseStatus
  adminReviewNote: string | null
  updatedAt: string
}

type AdminAuthorizationRow = QueryResultRow & { allowed?: boolean }
type LockedMentorApplicationRow = QueryResultRow & {
  id: string
  user_id: string
  status: string
}
type LockedCourseReviewRow = QueryResultRow & {
  id: string
  mentor_id: string
  status: string
}
type ReturningIdRow = QueryResultRow & { id: string }
type MentorApplicationReviewRow = QueryResultRow & {
  application_id: string
  user_id: string
  applicant_name: string
  current_last_rank: string
  years_experience: string | number
  vessel_types: string[] | null
  specialization: string
  certifications: string[] | null
  linkedin_url: string | null
  short_bio: string
  profile_photo_path: string | null
  proposed_course_topics: string[] | null
  status: string
  submitted_at: string | Date
  updated_at: string | Date
  admin_review_note: string | null
}
type CourseReviewRow = QueryResultRow & {
  course_id: string
  mentor_id: string
  mentor_user_id: string
  mentor_name: string
  slug: string
  title: string
  subtitle: string | null
  description: string
  category: string
  level: CourseReviewItem['level']
  language: string
  learning_outcomes: string[] | null
  requirements: string[] | null
  target_audience: string[] | null
  price_minor: string | number
  discount_price_minor: string | number | null
  currency: string
  access_type: CourseReviewItem['accessType']
  certificate_enabled: boolean
  course_format: CourseReviewItem['courseFormat']
  status: string
  admin_review_note: string | null
  updated_at: string | Date
}

function runtimeTransaction<T>(work: (query: LearningAdminQuery) => Promise<T>) {
  return databaseTransaction(async (client: DatabaseQueryClient) => work(async (text, values) => {
    const result = await client.query(text, values)
    return result.rows
  }))
}

function mentorApplicationStatus(value: string): MentorApplicationStatus {
  if (value === 'pending' || value === 'changes_requested' || value === 'approved' || value === 'rejected') return value
  throw new Error('mentor_application_status_invalid')
}

function courseStatus(value: string): CourseStatus {
  if (
    value === 'draft'
    || value === 'submitted'
    || value === 'changes_requested'
    || value === 'approved'
    || value === 'published'
    || value === 'archived'
  ) return value
  throw new Error('course_status_invalid')
}

function isoDateTime(value: string | Date) {
  return value instanceof Date ? value.toISOString() : value
}

export function createLearningAdminRepository(input: {
  query?: LearningAdminQuery
  transaction?: LearningAdminTransaction
} = {}) {
  const queryRows: LearningAdminQuery = input.query ?? ((text, values) => databaseQuery<QueryResultRow>(text, values))
  const transaction = input.transaction ?? runtimeTransaction

  async function isPlatformAdministratorWithQuery(query: LearningAdminQuery, userId: string, lock = false) {
    const rows = await query(
      `select true as allowed
       from public.user_roles
       where user_id = $1
         and role::text = 'administrator'
       ${lock ? 'for update' : ''}
       limit 1`,
      [userId],
    ) as AdminAuthorizationRow[]
    const row = rows[0]
    if (!row) return false
    return row.allowed === undefined ? true : Boolean(row.allowed)
  }

  async function requirePlatformAdministrator(query: LearningAdminQuery, userId: string, lock = false) {
    if (!await isPlatformAdministratorWithQuery(query, userId, lock)) throw new Error('admin_forbidden')
  }

  async function isPlatformAdministrator(userId: string) {
    return isPlatformAdministratorWithQuery(queryRows, userId)
  }

  async function listMentorApplications(adminId: string, status: MentorApplicationStatus): Promise<MentorApplicationReviewItem[]> {
    await requirePlatformAdministrator(queryRows, adminId)
    const rows = await queryRows(
      `select
         application.id as application_id,
         application.user_id,
         application.applicant_name,
         application.current_last_rank,
         application.years_experience,
         application.vessel_types,
         application.specialization,
         application.certifications,
         application.linkedin_url,
         application.short_bio,
         application.profile_photo_path,
         application.proposed_course_topics,
         application.status,
         application.submitted_at,
         application.updated_at,
         application.admin_review_note
       from public.learning_mentor_applications application
       where application.status = $1
       order by application.submitted_at asc, application.id asc`,
      [status],
    ) as MentorApplicationReviewRow[]

    return rows.map((row) => ({
      applicationId: row.application_id,
      userId: row.user_id,
      name: row.applicant_name,
      currentLastRank: row.current_last_rank,
      yearsExperience: Number(row.years_experience),
      vesselTypes: row.vessel_types ?? [],
      specialization: row.specialization,
      certifications: row.certifications ?? [],
      linkedInUrl: row.linkedin_url,
      shortBio: row.short_bio,
      profilePhotoPath: row.profile_photo_path,
      proposedCourseTopics: row.proposed_course_topics ?? [],
      status: mentorApplicationStatus(row.status),
      submittedAt: isoDateTime(row.submitted_at),
      updatedAt: isoDateTime(row.updated_at),
      adminReviewNote: row.admin_review_note,
    }))
  }

  async function listCoursesForReview(adminId: string, status: CourseStatus): Promise<CourseReviewItem[]> {
    await requirePlatformAdministrator(queryRows, adminId)
    const rows = await queryRows(
      `select
         course.id as course_id,
         mentor.id as mentor_id,
         mentor.user_id as mentor_user_id,
         application.applicant_name as mentor_name,
         course.slug,
         course.title,
         course.subtitle,
         course.description,
         course.category,
         course.level,
         course.language,
         course.learning_outcomes,
         course.requirements,
         course.target_audience,
         course.price_minor,
         course.discount_price_minor,
         course.currency,
         course.access_type,
         course.certificate_enabled,
         course.course_format,
         course.status,
         course.admin_review_note,
         course.updated_at
       from public.learning_courses course
       inner join public.learning_mentors mentor
         on mentor.id = course.mentor_id
       inner join public.learning_mentor_applications application
         on application.id = mentor.application_id
       where course.status = $1
       order by course.updated_at asc, course.id asc`,
      [status],
    ) as CourseReviewRow[]

    return rows.map((row) => ({
      courseId: row.course_id,
      mentorId: row.mentor_id,
      mentorUserId: row.mentor_user_id,
      mentorName: row.mentor_name,
      slug: row.slug,
      title: row.title,
      subtitle: row.subtitle,
      description: row.description,
      category: row.category,
      level: row.level,
      language: row.language,
      learningOutcomes: row.learning_outcomes ?? [],
      requirements: row.requirements ?? [],
      targetAudience: row.target_audience ?? [],
      priceMinor: Number(row.price_minor),
      discountPriceMinor: row.discount_price_minor === null ? null : Number(row.discount_price_minor),
      currency: row.currency,
      accessType: row.access_type,
      certificateEnabled: row.certificate_enabled,
      courseFormat: row.course_format,
      status: courseStatus(row.status),
      adminReviewNote: row.admin_review_note,
      updatedAt: isoDateTime(row.updated_at),
    }))
  }

  async function reviewMentorApplication(
    adminId: string,
    applicationId: string,
    decision: MentorReviewDecision,
    reviewerNote: string | null,
  ) {
    return transaction(async (txQuery) => {
      await requirePlatformAdministrator(txQuery, adminId, true)

      const lockedRows = await txQuery(
        `select id, user_id, status
         from public.learning_mentor_applications
         where id = $1
         for update`,
        [applicationId],
      ) as LockedMentorApplicationRow[]
      const application = lockedRows[0]
      if (!application) throw new Error('mentor_application_not_found')

      const current = mentorApplicationStatus(application.status)
      if (!canTransitionMentorApplicationStatus({ actor: 'administrator', current, next: decision })) {
        throw new Error('mentor_application_transition_forbidden')
      }

      let mentorId: string | null = null
      if (decision === 'approved') {
        const mentorRows = await txQuery(
          `insert into public.learning_mentors (
             user_id,
             application_id,
             status,
             approved_by,
             approved_at,
             created_at,
             updated_at
           )
           values ($1, $2, 'active', $3, now(), now(), now())
           on conflict (user_id) do update
           set application_id = excluded.application_id,
               status = 'active',
               approved_by = excluded.approved_by,
               approved_at = now(),
               updated_at = now()
           returning id`,
          [application.user_id, applicationId, adminId],
        ) as ReturningIdRow[]
        const mentor = mentorRows[0]
        if (!mentor) throw new Error('mentor_materialization_failed')
        mentorId = mentor.id
      }

      const applicationRows = await txQuery(
        `update public.learning_mentor_applications
         set status = $2,
             reviewed_by = $3,
             reviewed_at = now(),
             admin_review_note = $4,
             updated_at = now()
         where id = $1
         returning id`,
        [applicationId, decision, adminId, reviewerNote],
      ) as ReturningIdRow[]
      if (!applicationRows[0]) throw new Error('mentor_application_not_found')

      await txQuery(
        `insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
         values ($1, $2, $3, $4, $5::jsonb)`,
        [
          adminId,
          `learning.mentor_application.${decision}`,
          'learning_mentor_application',
          applicationId,
          JSON.stringify({
            applicantUserId: application.user_id,
            fromStatus: current,
            toStatus: decision,
            reviewerNote,
            mentorId,
          }),
        ],
      )

      return {
        applicationId,
        status: decision,
        mentorId,
      }
    })
  }

  async function reviewCourse(
    adminId: string,
    courseId: string,
    decision: CourseAdminDecision,
    reviewerNote: string | null,
  ) {
    return transaction(async (txQuery) => {
      await requirePlatformAdministrator(txQuery, adminId, true)

      const lockedRows = await txQuery(
        `select id, mentor_id, status
         from public.learning_courses
         where id = $1
         for update`,
        [courseId],
      ) as LockedCourseReviewRow[]
      const course = lockedRows[0]
      if (!course) throw new Error('course_not_found')

      const current = courseStatus(course.status)
      if (!canTransitionCourseStatus({ actor: 'administrator', current, next: decision })) {
        throw new Error('course_transition_forbidden')
      }
      if (decision === 'changes_requested' && !reviewerNote?.trim()) {
        throw new Error('course_review_note_required')
      }

      let updateSql = `update public.learning_courses
         set status = $2,
             reviewed_by = $3,
             reviewed_at = now(),
             admin_review_note = $4,
             updated_at = now()`

      if (decision === 'changes_requested') {
        updateSql += `,
             approved_at = null,
             published_at = null`
      } else if (decision === 'approved') {
        updateSql += `,
             approved_at = now(),
             published_at = null`
      } else if (decision === 'published') {
        updateSql += `,
             published_at = now()`
      }

      updateSql += `
         where id = $1
         returning id`

      const courseRows = await txQuery(
        updateSql,
        [courseId, decision, adminId, reviewerNote],
      ) as ReturningIdRow[]
      if (!courseRows[0]) throw new Error('course_not_found')

      await txQuery(
        `insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
         values ($1, $2, $3, $4, $5::jsonb)`,
        [
          adminId,
          `learning.course.${decision}`,
          'learning_course',
          courseId,
          JSON.stringify({
            mentorId: course.mentor_id,
            fromStatus: current,
            toStatus: decision,
            reviewerNote,
          }),
        ],
      )

      return { courseId, status: decision }
    })
  }

  return {
    isPlatformAdministrator,
    listMentorApplications,
    listCoursesForReview,
    reviewMentorApplication,
    reviewCourse,
  }
}

export const learningAdminRepository = createLearningAdminRepository()
