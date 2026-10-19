import type { QueryResultRow } from 'pg'
import { query as databaseQuery, type DatabaseQueryClient } from '@/lib/db/client'
import type { RecruiterContactReason } from './recruiter-contact'

/** The hiring roles that may manage an organization's jobs (HIRING_ROLES in features/jobs/hiring-repository). */
export const RECRUITER_ROLES = ['owner', 'administrator', 'recruiter'] as const

type Query = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>

export type RecruiterConversationRow = {
  conversation_id: string
  recruiter_profile_id: string
  member_profile_id: string
  reason: RecruiterContactReason
  job_application_id: string | null
  job_id: string | null
  job_title: string | null
}

export type RecruiterApplicationRow = { application_id: string; job_id: string; job_title: string }

/** A personal recruiter verification, or an approved hiring role (owner, administrator, recruiter) in a verified organization. */
const VERIFIED_RECRUITER_SQL = `(
  exists (
    select 1 from public.feature_verifications fv
    where fv.profile_id = $1 and fv.verification_type = 'recruiter' and fv.status = 'approved'
  )
  or exists (
    select 1 from public.company_members cm
    join public.companies c on c.id = cm.company_id
    where cm.user_id = $1 and cm.approved_at is not null and cm.role::text = any($2::text[]) and c.is_verified = true
  )
)`

export function createRecruiterContactRepository(input: { query?: Query } = {}) {
  const query = input.query ?? (databaseQuery as Query)

  return {
    async isVerifiedRecruiter(profileId: string): Promise<boolean> {
      const rows = await query(`select ${VERIFIED_RECRUITER_SQL} as verified`, [profileId, [...RECRUITER_ROLES]])
      return rows[0]?.verified === true
    },

    /**
     * The member's application to a job this recruiter may manage: a personal job they posted while holding a
     * recruiter verification, or a job of a verified organization where they hold an approved hiring role.
     * Withdrawn applications and deleted jobs do not count.
     */
    async findApplicationForRecruiter(recruiterId: string, memberId: string, applicationId: string): Promise<RecruiterApplicationRow | null> {
      const rows = await query(
        `select a.id as application_id, j.id as job_id, j.title as job_title
         from public.job_applications a
         join public.jobs j on j.id = a.job_id
         left join public.company_members cm on cm.company_id = j.company_id and cm.user_id = $1
         left join public.companies c on c.id = j.company_id
         where a.id = $3
           and a.applicant_id = $4
           and a.status::text <> 'withdrawn'
           and j.deleted_at is null
           and (
             (j.company_id is null and j.created_by_user_id = $1 and exists (
               select 1 from public.feature_verifications fv
               where fv.profile_id = $1 and fv.verification_type = 'recruiter' and fv.status = 'approved'
             ))
             or (j.company_id is not null and cm.approved_at is not null and cm.role::text = any($2::text[]) and c.is_verified = true)
           )
         limit 1`,
        [recruiterId, [...RECRUITER_ROLES], applicationId, memberId],
      )
      const row = rows[0] as (QueryResultRow & RecruiterApplicationRow) | undefined
      return row ? { application_id: row.application_id, job_id: row.job_id, job_title: row.job_title } : null
    },

    async isOpenToRecruiters(memberId: string): Promise<boolean> {
      const rows = await query(`select open_to_recruiters from public.member_preferences where profile_id = $1`, [memberId])
      return rows[0]?.open_to_recruiters === true
    },

    /** Serializes one recruiter's new conversations so two at once cannot both pass the daily cap. */
    async lockRecruiter(recruiterId: string): Promise<void> {
      await query(`select pg_advisory_xact_lock(hashtextextended('recruiter_conversation:' || $1::text, 0))`, [recruiterId])
    },

    async countSince(recruiterId: string, since: Date): Promise<number> {
      const rows = await query(
        `select count(*)::int as count from public.recruiter_conversations where recruiter_profile_id = $1 and created_at > $2`,
        [recruiterId, since.toISOString()],
      )
      return Number(rows[0]?.count ?? 0)
    },

    async findByConversation(conversationId: string): Promise<RecruiterConversationRow | null> {
      const rows = await query(
        `select rc.conversation_id, rc.recruiter_profile_id, rc.member_profile_id, rc.reason, rc.job_application_id, rc.job_id,
                j.title as job_title
         from public.recruiter_conversations rc
         left join public.jobs j on j.id = rc.job_id
         where rc.conversation_id = $1`,
        [conversationId],
      )
      return (rows[0] as (QueryResultRow & RecruiterConversationRow) | undefined) ?? null
    },

    async insert(row: {
      conversationId: string
      recruiterId: string
      memberId: string
      reason: RecruiterContactReason
      applicationId: string | null
      jobId: string | null
    }): Promise<void> {
      await query(
        `insert into public.recruiter_conversations (conversation_id, recruiter_profile_id, member_profile_id, reason, job_application_id, job_id)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (conversation_id) do nothing`,
        [row.conversationId, row.recruiterId, row.memberId, row.reason, row.applicationId, row.jobId],
      )
    },
  }
}

export type RecruiterContactRepository = ReturnType<typeof createRecruiterContactRepository>

export function createRecruiterContactRepositoryForClient(client: DatabaseQueryClient): RecruiterContactRepository {
  return createRecruiterContactRepository({ query: async (text, values) => (await client.query(text, values)).rows })
}
