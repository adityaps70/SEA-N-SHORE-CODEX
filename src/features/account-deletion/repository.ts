import type { QueryResultRow } from 'pg'
import { withTransaction as databaseTransaction, type DatabaseQueryClient } from '@/lib/db/client'

type Row = QueryResultRow & Record<string, unknown>
type Query = (text: string, values?: readonly unknown[]) => Promise<Row[]>
type Transaction = <T>(work: (query: Query) => Promise<T>) => Promise<T>

type AccountRow = Row & {
  id: string
  account_status: string
}

type MediaRow = Row & {
  storage_path: string | null
}

function runtimeTransaction<T>(work: (query: Query) => Promise<T>) {
  return databaseTransaction(async (client: DatabaseQueryClient) => work(async (text, values) => {
    const result = await client.query<Row>(text, values)
    return result.rows
  }))
}

async function cleanupAccount(query: Query, profileId: string) {
  const locked = await query(
    `select id, account_status::text as account_status
     from public.profiles
     where id = $1
     for update`,
    [profileId],
  ) as AccountRow[]
  if (!locked[0]) throw new Error('account_deletion_profile_not_found')

  const mediaRows = await query(
    `select storage_path
     from (
       select p.avatar_path as storage_path
       from public.profiles p
       where p.id = $1
       union all
       select p.cover_path as storage_path
       from public.profiles p
       where p.id = $1
       union all
       select pm.storage_path
       from public.post_media pm
       join public.posts post on post.id = pm.post_id
       where post.author_id = $1
       union all
       select m.attachment_storage_path
       from public.messages m
       where m.sender_profile_id = $1
       union all
       select a.cv_storage_path
       from public.job_applications a
       where a.applicant_id = $1
       union all
       select e.banner_url
       from public.events e
       where e.host_user_id = $1
       union all
       select application.profile_photo_path
       from public.learning_mentor_applications application
       where application.user_id = $1
       union all
       select attempt.attachment_path
       from public.learning_assignment_attempts attempt
       where attempt.learner_id = $1
     ) media
     where storage_path is not null`,
    [profileId],
  ) as MediaRow[]

  await query(
    `update public.audit_events
     set actor_id = null
     where actor_id = $1`,
    [profileId],
  )
  await query(
    `update public.job_application_events
     set actor_id = null
     where actor_id = $1`,
    [profileId],
  )
  await query(
    `update public.jobs
     set created_by_user_id = null
     where created_by_user_id = $1`,
    [profileId],
  )
  await query(
    `update public.companies
     set verified_by = null
     where verified_by = $1`,
    [profileId],
  )
  await query(
    `update public.company_members
     set verified_by = null
     where verified_by = $1`,
    [profileId],
  )
  await query(
    `update public.job_reports
     set reviewed_by = null
     where reviewed_by = $1`,
    [profileId],
  )
  await query(
    `update public.organization_applications
     set reviewed_by = null
     where reviewed_by = $1`,
    [profileId],
  )
  await query(
    `update public.company_access_requests
     set reviewed_by = null
     where reviewed_by = $1`,
    [profileId],
  )
  await query(
    `update public.learning_mentor_applications
     set reviewed_by = null
     where reviewed_by = $1`,
    [profileId],
  )
  await query(
    `update public.learning_courses
     set reviewed_by = null
     where reviewed_by = $1`,
    [profileId],
  )
  await query(
    `update public.learning_assignment_attempts
     set graded_by = null
     where graded_by = $1`,
    [profileId],
  )
  await query(
    `update public.content_reports
     set reviewed_by = null
     where reviewed_by = $1`,
    [profileId],
  )

  await query(
    `delete from public.post_reactions
     where user_id = $1`,
    [profileId],
  )
  await query(
    `delete from public.comment_reactions
     where user_id = $1`,
    [profileId],
  )
  await query(
    `delete from public.saved_posts
     where user_id = $1`,
    [profileId],
  )
  await query(
    `delete from public.post_poll_votes
     where user_id = $1`,
    [profileId],
  )
  await query(
    `delete from public.content_mentions
     where actor_id = $1 or mentioned_profile_id = $1`,
    [profileId],
  )
  await query(
    `update public.post_comments
     set body = 'Deleted comment',
         deleted_at = coalesce(deleted_at, now()),
         updated_at = now()
     where author_id = $1`,
    [profileId],
  )
  await query(
    `delete from public.posts
     where author_id = $1`,
    [profileId],
  )

  await query(
    `delete from public.notifications
     where recipient_id = $1 or actor_id = $1`,
    [profileId],
  )
  await query(
    `delete from public.follows
     where follower_id = $1 or following_id = $1`,
    [profileId],
  )
  await query(
    `delete from public.connections
     where user_low_id = $1 or user_high_id = $1 or requested_by = $1`,
    [profileId],
  )
  await query(
    `delete from public.user_blocks
     where blocker_id = $1 or blocked_id = $1`,
    [profileId],
  )

  await query(
    `delete from public.message_reactions
     where profile_id = $1`,
    [profileId],
  )
  await query(
    `update public.messages
     set body = '',
         attachment_storage_path = null,
         attachment_name = null,
         attachment_mime_type = null,
         attachment_size = null,
         edited_at = null,
         deleted_at = coalesce(deleted_at, now())
     where sender_profile_id = $1`,
    [profileId],
  )
  await query(
    `update public.conversations conversation
     set last_message_id = (
           select message.id
           from public.messages message
           where message.conversation_id = conversation.id
             and message.deleted_at is null
           order by message.created_at desc, message.id desc
           limit 1
         ),
         last_message_at = (
           select message.created_at
           from public.messages message
           where message.conversation_id = conversation.id
             and message.deleted_at is null
           order by message.created_at desc, message.id desc
           limit 1
         ),
         updated_at = now()
     where conversation.direct_user_low_id = $1
        or conversation.direct_user_high_id = $1`,
    [profileId],
  )

  await query(
    `delete from public.event_attendees
     where user_id = $1`,
    [profileId],
  )
  await query(
    `delete from public.events
     where host_user_id = $1`,
    [profileId],
  )

  await query(
    `delete from public.job_applications
     where applicant_id = $1`,
    [profileId],
  )
  await query(
    `delete from public.job_saves
     where user_id = $1`,
    [profileId],
  )
  await query(
    `delete from public.job_alerts
     where user_id = $1`,
    [profileId],
  )
  await query(
    `delete from public.job_recruiter_notes
     where recruiter_id = $1`,
    [profileId],
  )
  await query(
    `delete from public.job_reports
     where reporter_id = $1`,
    [profileId],
  )
  await query(
    `delete from public.content_reports
     where reporter_id = $1`,
    [profileId],
  )
  await query(
    `delete from public.company_access_requests
     where user_id = $1`,
    [profileId],
  )
  await query(
    `delete from public.organization_applications
     where submitted_by = $1`,
    [profileId],
  )
  await query(
    `delete from public.company_members
     where user_id = $1`,
    [profileId],
  )

  await query(
    `delete from public.learning_certificates
     where learner_id = $1`,
    [profileId],
  )
  await query(
    `delete from public.learning_enrollments
     where learner_id = $1`,
    [profileId],
  )
  await query(
    `update public.learning_mentor_applications
     set applicant_name = 'Deleted member',
         current_last_rank = 'Not retained',
         years_experience = 0,
         vessel_types = array['Not retained']::text[],
         specialization = 'Not retained',
         certifications = array['Not retained']::text[],
         linkedin_url = null,
         short_bio = 'Account deleted; personal mentor application details were removed.',
         profile_photo_path = null,
         proposed_course_topics = array['Not retained']::text[],
         admin_review_note = null,
         updated_at = now()
     where user_id = $1`,
    [profileId],
  )
  await query(
    `update public.learning_mentors
     set status = 'suspended',
         updated_at = now()
     where user_id = $1`,
    [profileId],
  )
  await query(
    `update public.learning_courses
     set status = 'archived',
         is_discoverable = false,
         updated_at = now()
     where mentor_id in (
       select id from public.learning_mentors where user_id = $1
     )
       and status <> 'published'`,
    [profileId],
  )

  await query(
    `delete from public.profile_experiences
     where profile_id = $1`,
    [profileId],
  )
  await query(
    `delete from public.profile_credentials
     where profile_id = $1`,
    [profileId],
  )
  await query(
    `delete from public.profile_visas
     where profile_id = $1`,
    [profileId],
  )
  await query(
    `delete from public.maritime_profiles
     where user_id = $1`,
    [profileId],
  )
  await query(
    `delete from public.profile_skills
     where user_id = $1`,
    [profileId],
  )
  await query(
    `delete from public.user_roles
     where user_id = $1`,
    [profileId],
  )

  await query(
    `delete from public.identity_accounts
     where profile_id = $1`,
    [profileId],
  )
  await query(
    `update public.profiles
     set slug = null,
         profile_type = null,
         identity_root = null,
         primary_identity = null,
         primary_identity_family = null,
         secondary_identities = '{}'::text[],
         full_name = 'Deleted member',
         avatar_path = null,
         cover_path = null,
         location = null,
         headline = null,
         summary = null,
         contact_visibility = 'private',
         account_status = 'deletion_requested',
         onboarding_completed_at = null,
         username_change_count = 0,
         updated_at = now()
     where id = $1`,
    [profileId],
  )

  return {
    mediaPaths: [...new Set(mediaRows.flatMap((row) => (
      typeof row.storage_path === 'string' && row.storage_path.trim()
        ? [row.storage_path.trim()]
        : []
    )))],
  }
}

export function createAccountDeletionRepository(input: {
  transaction?: Transaction
} = {}) {
  const transaction = input.transaction ?? runtimeTransaction

  return {
    async deleteAccountWithIdentity(
      profileId: string,
      deleteIdentity: () => Promise<void>,
    ) {
      return transaction(async (query) => {
        const result = await cleanupAccount(query, profileId)
        await deleteIdentity()
        return result
      })
    },

    async finalizeAccountDeletion(profileId: string) {
      return transaction((query) => cleanupAccount(query, profileId))
    },
  }
}

export const accountDeletionRepository = createAccountDeletionRepository()
