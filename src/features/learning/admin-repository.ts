import type { QueryResultRow } from 'pg'
import { query as databaseQuery, withTransaction as databaseTransaction, type DatabaseQueryClient } from '@/lib/db/client'
import {
  canTransitionMentorApplicationStatus,
  type MentorApplicationStatus,
} from './mentor-application'

type LearningAdminQuery = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>
type LearningAdminTransaction = <T>(work: (query: LearningAdminQuery) => Promise<T>) => Promise<T>
export type MentorReviewDecision = 'approved' | 'changes_requested' | 'rejected'

type AdminAuthorizationRow = QueryResultRow & { allowed?: boolean }
type LockedMentorApplicationRow = QueryResultRow & {
  id: string
  user_id: string
  status: string
}
type ReturningIdRow = QueryResultRow & { id: string }

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
    reviewMentorApplication,
  }
}

export const learningAdminRepository = createLearningAdminRepository()
