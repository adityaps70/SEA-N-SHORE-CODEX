import type { QueryResultRow } from 'pg'
import { query as databaseQuery, withTransaction as databaseTransaction, type DatabaseQueryClient } from '@/lib/db/client'
import {
  canTransitionMentorApplicationStatus,
  type MentorApplicationStatus,
} from './mentor-application'

type LearningAdminQuery = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>
type LearningAdminTransaction = <T>(work: (query: LearningAdminQuery) => Promise<T>) => Promise<T>
export type MentorReviewDecision = 'approved' | 'changes_requested' | 'rejected'

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

type AdminAuthorizationRow = QueryResultRow & { allowed?: boolean }
type LockedMentorApplicationRow = QueryResultRow & {
  id: string
  user_id: string
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

  return {
    isPlatformAdministrator,
    listMentorApplications,
    reviewMentorApplication,
  }
}

export const learningAdminRepository = createLearningAdminRepository()
