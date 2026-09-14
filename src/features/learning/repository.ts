import type { QueryResultRow } from 'pg'
import { query as databaseQuery, withTransaction as databaseTransaction, type DatabaseQueryClient } from '@/lib/db/client'
import { canApplicantEditMentorApplication, type MentorApplicationInput, type MentorApplicationStatus } from './mentor-application'

type LearningQuery = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>
type LearningTransaction = <T>(work: (query: LearningQuery) => Promise<T>) => Promise<T>

type ReturningIdRow = QueryResultRow & { id: string }
type LockedMentorApplicationRow = QueryResultRow & {
  id: string
  user_id: string
  status: string
}
type MentorApplicationDetailRow = QueryResultRow & {
  application_id: string
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
}
type MentorApplicationStateRow = QueryResultRow & {
  application_id: string
  status: string
  submitted_at: string | Date
  updated_at: string | Date
  admin_review_note: string | null
  mentor_id: string | null
  mentor_status: string | null
}

export type MentorApplicationState =
  | { kind: 'none' }
  | {
      kind: 'application'
      applicationId: string
      status: MentorApplicationStatus
      submittedAt: string
      updatedAt: string
      adminReviewNote: string | null
      mentorId: null
      mentorStatus: null
    }
  | {
      kind: 'mentor'
      applicationId: string
      status: 'approved'
      submittedAt: string
      updatedAt: string
      adminReviewNote: string | null
      mentorId: string
      mentorStatus: 'active' | 'suspended'
    }

function runtimeTransaction<T>(work: (query: LearningQuery) => Promise<T>) {
  return databaseTransaction(async (client: DatabaseQueryClient) => work(async (text, values) => {
    const result = await client.query(text, values)
    return result.rows
  }))
}

function mentorApplicationStatus(value: string): MentorApplicationStatus {
  if (value === 'pending' || value === 'changes_requested' || value === 'approved' || value === 'rejected') return value
  throw new Error('mentor_application_status_invalid')
}

function mentorStatus(value: string | null): 'active' | 'suspended' | null {
  if (value === null) return null
  if (value === 'active' || value === 'suspended') return value
  throw new Error('mentor_status_invalid')
}

function isoDateTime(value: string | Date) {
  return value instanceof Date ? value.toISOString() : value
}

export function createLearningRepository(input: {
  query?: LearningQuery
  transaction?: LearningTransaction
} = {}) {
  const queryRows: LearningQuery = input.query ?? ((text, values) => databaseQuery<QueryResultRow>(text, values))
  const transaction = input.transaction ?? runtimeTransaction

  async function submitMentorApplication(actorId: string, application: MentorApplicationInput) {
    const rows = await queryRows(
      `insert into public.learning_mentor_applications (
         user_id,
         applicant_name,
         current_last_rank,
         years_experience,
         vessel_types,
         specialization,
         certifications,
         linkedin_url,
         short_bio,
         profile_photo_path,
         proposed_course_topics,
         status,
         submitted_at,
         updated_at
       )
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now(), now())
       on conflict (user_id) do nothing
       returning id`,
      [
        actorId,
        application.name,
        application.currentLastRank,
        application.yearsExperience,
        application.vesselTypes,
        application.specialization,
        application.certifications,
        application.linkedInUrl,
        application.shortBio,
        application.profilePhotoPath,
        application.proposedCourseTopics,
        'pending',
      ],
    ) as ReturningIdRow[]
    const row = rows[0]
    if (!row) throw new Error('mentor_application_already_exists')
    return { applicationId: row.id }
  }

  async function getMentorApplication(actorId: string, applicationId: string): Promise<MentorApplicationInput | null> {
    const rows = await queryRows(
      `select
         id as application_id,
         applicant_name,
         current_last_rank,
         years_experience,
         vessel_types,
         specialization,
         certifications,
         linkedin_url,
         short_bio,
         profile_photo_path,
         proposed_course_topics
       from public.learning_mentor_applications
       where user_id = $1
         and id = $2
       limit 1`,
      [actorId, applicationId],
    ) as MentorApplicationDetailRow[]
    const row = rows[0]
    if (!row) return null
    return {
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
    }
  }

  async function getMentorApplicationState(actorId: string): Promise<MentorApplicationState> {
    const rows = await queryRows(
      `select
         application.id as application_id,
         application.status,
         application.submitted_at,
         application.updated_at,
         application.admin_review_note,
         mentor.id as mentor_id,
         mentor.status as mentor_status
       from public.learning_mentor_applications application
       left join public.learning_mentors mentor
         on mentor.application_id = application.id
       where application.user_id = $1
       order by application.submitted_at desc, application.id desc
       limit 1`,
      [actorId],
    ) as MentorApplicationStateRow[]
    const row = rows[0]
    if (!row) return { kind: 'none' }

    const status = mentorApplicationStatus(row.status)
    const activeMentorStatus = mentorStatus(row.mentor_status)
    const base = {
      applicationId: row.application_id,
      submittedAt: isoDateTime(row.submitted_at),
      updatedAt: isoDateTime(row.updated_at),
      adminReviewNote: row.admin_review_note,
    }

    if (row.mentor_id && activeMentorStatus) {
      if (status !== 'approved') throw new Error('mentor_application_state_inconsistent')
      return {
        kind: 'mentor',
        ...base,
        status,
        mentorId: row.mentor_id,
        mentorStatus: activeMentorStatus,
      }
    }

    return {
      kind: 'application',
      ...base,
      status,
      mentorId: null,
      mentorStatus: null,
    }
  }

  async function resubmitMentorApplication(actorId: string, applicationId: string, application: MentorApplicationInput) {
    return transaction(async (txQuery) => {
      const lockedRows = await txQuery(
        `select id, user_id, status
         from public.learning_mentor_applications
         where id = $1
           and user_id = $2
         for update`,
        [applicationId, actorId],
      ) as LockedMentorApplicationRow[]
      const current = lockedRows[0]
      if (!current) throw new Error('mentor_application_not_found')

      const status = mentorApplicationStatus(current.status)
      if (!canApplicantEditMentorApplication(status)) throw new Error('mentor_application_resubmit_forbidden')

      const updated = await txQuery(
        `update public.learning_mentor_applications
         set applicant_name = $2,
             current_last_rank = $3,
             years_experience = $4,
             vessel_types = $5,
             specialization = $6,
             certifications = $7,
             linkedin_url = $8,
             short_bio = $9,
             profile_photo_path = $10,
             proposed_course_topics = $11,
             status = 'pending',
             submitted_at = now(),
             updated_at = now(),
             reviewed_by = null,
             reviewed_at = null,
             admin_review_note = null
         where id = $1
           and user_id = $12
         returning id`,
        [
          applicationId,
          application.name,
          application.currentLastRank,
          application.yearsExperience,
          application.vesselTypes,
          application.specialization,
          application.certifications,
          application.linkedInUrl,
          application.shortBio,
          application.profilePhotoPath,
          application.proposedCourseTopics,
          actorId,
        ],
      ) as ReturningIdRow[]
      if (!updated[0]) throw new Error('mentor_application_not_found')
      return true
    })
  }

  return {
    submitMentorApplication,
    getMentorApplication,
    getMentorApplicationState,
    resubmitMentorApplication,
  }
}

export const learningRepository = createLearningRepository()
