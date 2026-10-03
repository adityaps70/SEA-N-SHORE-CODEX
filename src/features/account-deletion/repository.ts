import type { QueryResultRow } from 'pg'
import { query as databaseQuery, withTransaction as databaseTransaction, type DatabaseQueryClient } from '@/lib/db/client'
import { planAccountDeletion, type AccountDeletionPlan, type DeletionFacts } from './plan'

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

/** Only mediaPaths is required, so older callers (admin deletion) and their test doubles keep working. */
export type AccountDeletionResult = {
  mediaPaths: string[]
  /** Paid tickets of events cancelled by the deletion, refunded after the commit. */
  refundOrderIds?: string[]
  /** Attendees of cancelled events, told after the commit. */
  cancelledEventAttendees?: Array<{ profileId: string; eventId: string; eventTitle: string }>
  /** Other Cognito users that signed in to this profile (e.g. mobile sign-in), removed after the commit. */
  otherSignInUsernames?: string[]
  plan?: AccountDeletionPlan
}

/** Events the deletion takes away: personal ones ($1) and those of organizations losing their only manager ($2). */
const AFFECTED_EVENTS_SQL = `((e.company_id is null and e.host_user_id = $1) or e.company_id = any($2::uuid[]))`

type Log = (message: string, details?: Record<string, unknown>) => void
const defaultLog: Log = (message, details) => console.error(message, details ?? {})

const MANAGER_ROLES = ['owner', 'administrator']
const PLAN_LABELS: Record<string, string> = { creator_pro: 'Creator Pro', organization_pro: 'Organization Pro' }

function count(value: unknown) {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * Everything the deletion plan needs, read from the member's real data. Inside the
 * deletion transaction `lock` also locks the managed organizations' memberships so two
 * managers deleting at once cannot both leave an organization "managed by the other".
 */
export async function loadDeletionFacts(query: Query, profileId: string, options: { lock?: boolean } = {}): Promise<DeletionFacts> {
  const managed = await query(
    `select cm.company_id, c.name, c.slug, cm.role::text as role
     from public.company_members cm
     join public.companies c on c.id = cm.company_id
     where cm.user_id = $1
       and cm.approved_at is not null
       and cm.role::text = any($2::text[])
     order by c.name asc, c.id asc`,
    [profileId, MANAGER_ROLES],
  )
  const companyIds = managed.map((row) => String(row.company_id))

  if (options.lock && companyIds.length) {
    await query(
      `select cm.company_id
       from public.company_members cm
       where cm.company_id = any($1::uuid[])
       order by cm.company_id, cm.user_id
       for update`,
      [companyIds],
    )
  }

  const [social, personal, organizationRows, earnings, autoRenew] = await Promise.all([
    query(
      `select
         (select count(*) from public.posts where author_id = $1 and company_id is null) as posts,
         (select count(*) from public.post_comments where author_id = $1 and deleted_at is null) as comments,
         (select count(*) from public.post_reactions where user_id = $1)
           + (select count(*) from public.comment_reactions where user_id = $1) as reactions`,
      [profileId],
    ),
    query(
      `select
         (select count(*) from public.jobs
           where company_id is null and created_by_user_id = $1 and deleted_at is null) as jobs,
         (select count(*) from public.events
           where company_id is null and host_user_id = $1 and removed_at is null) as events,
         (select count(*) from public.learning_courses
           where company_id is null and created_by_user_id = $1 and removed_at is null) as courses,
         (select count(*) from public.learning_courses course
           where course.company_id is null and course.created_by_user_id = $1
             and exists (
               select 1 from public.learning_enrollments enrollment
               where enrollment.course_id = course.id and enrollment.status in ('active', 'completed')
             )) as courses_with_learners`,
      [profileId],
    ),
    companyIds.length
      ? query(
        `select
           c.id as company_id,
           (select count(*) from public.company_members other
             join public.profiles other_profile on other_profile.id = other.user_id
             where other.company_id = c.id
               and other.user_id <> $2
               and other.approved_at is not null
               and other.role::text = any($3::text[])
               and other_profile.account_status = 'active') as other_active_managers,
           (select count(*) from public.jobs j where j.company_id = c.id and j.deleted_at is null) as jobs,
           (select count(*) from public.events e where e.company_id = c.id and e.removed_at is null) as events,
           (select count(*) from public.learning_courses course where course.company_id = c.id and course.removed_at is null) as courses
         from public.companies c
         where c.id = any($1::uuid[])`,
        [companyIds, profileId, MANAGER_ROLES],
      )
      : Promise.resolve([] as Row[]),
    query(
      `select currency, sum(net_minor)::bigint as amount_minor
       from public.seller_earnings
       where seller_profile_id = $1
         and status in ('pending', 'available', 'in_payout')
       group by currency
       order by currency`,
      [profileId],
    ),
    query(
      `select checkout.plan_code, c.name as company_name
       from public.subscription_checkouts checkout
       left join public.companies c on c.id = checkout.company_id
       where (checkout.profile_id = $1 or checkout.created_by = $1)
         and checkout.status in ('pending_approval', 'active', 'on_hold', 'paused')
       order by checkout.created_at asc`,
      [profileId],
    ),
  ])

  const byCompany = new Map(organizationRows.map((row) => [String(row.company_id), row]))
  const organizations = managed.map((row) => {
    const facts = byCompany.get(String(row.company_id))
    return {
      companyId: String(row.company_id),
      name: String(row.name ?? 'Organization'),
      slug: typeof row.slug === 'string' ? row.slug : null,
      role: row.role === 'owner' ? 'owner' as const : 'administrator' as const,
      otherActiveManagers: count(facts?.other_active_managers),
      jobs: count(facts?.jobs),
      events: count(facts?.events),
      courses: count(facts?.courses),
    }
  })
  const strippedIds = organizations.filter((organization) => organization.otherActiveManagers === 0).map((organization) => organization.companyId)

  const affected = await query(
    `select
       (select count(*) from public.events e
         where ${AFFECTED_EVENTS_SQL}
           and e.end_at > now() and e.status <> 'cancelled' and e.removed_at is null
           and exists (select 1 from public.event_attendees ea where ea.event_id = e.id)) as upcoming_with_registrations,
       (select count(*) from public.event_payment_orders o
         join public.events e on e.id = o.event_id
         where ${AFFECTED_EVENTS_SQL}
           and e.end_at > now() and e.status <> 'cancelled' and e.removed_at is null
           and o.status = 'paid') as paid_tickets`,
    [profileId, strippedIds],
  )

  return {
    posts: count(social[0]?.posts),
    comments: count(social[0]?.comments),
    reactions: count(social[0]?.reactions),
    personalJobs: count(personal[0]?.jobs),
    personalEvents: count(personal[0]?.events),
    personalCourses: count(personal[0]?.courses),
    personalCoursesWithLearners: count(personal[0]?.courses_with_learners),
    upcomingEventsWithRegistrations: count(affected[0]?.upcoming_with_registrations),
    paidTicketsToRefund: count(affected[0]?.paid_tickets),
    organizations,
    unpaidEarnings: earnings.map((row) => ({ currency: String(row.currency), amountMinor: count(row.amount_minor) })),
    autoRenewPlans: autoRenew.map((row) => ({
      planLabel: PLAN_LABELS[String(row.plan_code)] ?? 'your plan',
      subjectName: typeof row.company_name === 'string' ? row.company_name : null,
    })),
  }
}

/**
 * Removes personal jobs, events and courses, and those of organizations the member is
 * the only manager of. Never deletes an organization row. Events with registrations or
 * payments are cancelled / kept for their ticket holders; courses stay for enrolled
 * learners (removed_at).
 */
async function removeOwnedContent(query: Query, profileId: string, strippedIds: string[], log: Log = defaultLog) {
  const refunds = await query(
    `select o.id
     from public.event_payment_orders o
     join public.events e on e.id = o.event_id
     where ${AFFECTED_EVENTS_SQL}
       and e.end_at > now() and e.status <> 'cancelled' and e.removed_at is null
       and o.status = 'paid'
     order by o.created_at asc`,
    [profileId, strippedIds],
  )
  const attendees = await query(
    `select distinct ea.user_id, e.id as event_id, e.title
     from public.event_attendees ea
     join public.events e on e.id = ea.event_id
     where ${AFFECTED_EVENTS_SQL}
       and e.end_at > now() and e.status <> 'cancelled' and e.removed_at is null
       and ea.user_id <> $1`,
    [profileId, strippedIds],
  )

  // Upcoming events people registered or paid for: cancelled, kept for their ticket holders.
  await query(
    `update public.events e
     set status = 'cancelled', removed_at = now(), updated_at = now()
     where ${AFFECTED_EVENTS_SQL}
       and e.end_at > now() and e.status <> 'cancelled' and e.removed_at is null
       and (
         exists (select 1 from public.event_attendees ea where ea.event_id = e.id)
         or exists (select 1 from public.event_payment_orders o where o.event_id = e.id)
       )`,
    [profileId, strippedIds],
  )
  // Past or already cancelled events with registrations or payments: kept, but unlisted.
  await query(
    `update public.events e
     set removed_at = coalesce(e.removed_at, now()), updated_at = now()
     where ${AFFECTED_EVENTS_SQL}
       and e.removed_at is null
       and (
         exists (select 1 from public.event_attendees ea where ea.event_id = e.id)
         or exists (select 1 from public.event_payment_orders o where o.event_id = e.id)
       )`,
    [profileId, strippedIds],
  )
  // Nobody registered or paid: deleted.
  const deletedEvents = await query(
    `delete from public.events e
     where ${AFFECTED_EVENTS_SQL}
       and not exists (select 1 from public.event_attendees ea where ea.event_id = e.id)
       and not exists (select 1 from public.event_payment_orders o where o.event_id = e.id)
     returning e.banner_url as storage_path`,
    [profileId, strippedIds],
  ) as MediaRow[]

  // Jobs: the existing soft delete, so applicants keep their application history.
  await query(
    `update public.jobs
     set status = 'closed'::public.job_listing_status,
         archived_at = coalesce(archived_at, now()),
         deleted_at = now(),
         deleted_by = $1,
         updated_at = now()
     where deleted_at is null
       and ((company_id is null and created_by_user_id = $1) or company_id = any($2::uuid[]))`,
    [profileId, strippedIds],
  )

  // Courses: off the catalogue and closed to new learners; enrolled learners keep them.
  await query(
    `update public.learning_courses
     set status = 'archived',
         is_discoverable = false,
         removed_at = coalesce(removed_at, now()),
         updated_at = now()
     where (company_id is null and created_by_user_id = $1)
        or company_id = any($2::uuid[])`,
    [profileId, strippedIds],
  )

  if (strippedIds.length) await markOrganizationsUnmanaged(query, strippedIds, log)

  return {
    refundOrderIds: refunds.map((row) => String(row.id)),
    cancelledEventAttendees: attendees.map((row) => ({
      profileId: String(row.user_id),
      eventId: String(row.event_id),
      eventTitle: String(row.title ?? ''),
    })),
    deletedEventMedia: deletedEvents,
  }
}

/**
 * Organizations left without a manager become unclaimed pages (0050: claim_status
 * 'unclaimed'), which someone who runs the organization can claim through the normal
 * verification review. 0050 requires an unclaimed page to be unverified and allows only
 * one unclaimed page per name (companies_unclaimed_name_key on lower(btrim(name))), so:
 * - the page is also marked unverified (claiming re-verifies it);
 * - a page whose name another unclaimed page already has is left as it is and logged;
 * - each page is updated under its own savepoint, so a clash or a missing column can
 *   never fail the account deletion.
 * Guarded: without the claim_status column nothing happens.
 */
async function markOrganizationsUnmanaged(query: Query, companyIds: string[], log: Log) {
  const columns = await query(
    `select 1
     from information_schema.columns
     where table_schema = 'public'
       and table_name = 'companies'
       and column_name = 'claim_status'`,
  )
  if (!columns.length) return

  for (const companyId of companyIds) {
    await query('savepoint account_deletion_claim_status')
    try {
      const updated = await query(
        `update public.companies c
         set claim_status = 'unclaimed',
             is_verified = false,
             updated_at = now()
         where c.id = $1::uuid
           and c.claim_status <> 'unclaimed'
           and not exists (
             select 1 from public.companies other
             where other.id <> c.id
               and other.claim_status = 'unclaimed'
               and lower(btrim(other.name)) = lower(btrim(c.name))
           )
         returning c.id`,
        [companyId],
      )
      await query('release savepoint account_deletion_claim_status')
      if (!updated.length) log('account_deletion_organization_left_claimed', { companyId, reason: 'already_unclaimed_or_name_taken' })
    } catch (error) {
      await query('rollback to savepoint account_deletion_claim_status')
      log('account_deletion_organization_left_claimed', { companyId, reason: error instanceof Error ? error.message.slice(0, 120) : 'error' })
    }
  }
}

function runtimeTransaction<T>(work: (query: Query) => Promise<T>) {
  return databaseTransaction(async (client: DatabaseQueryClient) => work(async (text, values) => {
    const result = await client.query<Row>(text, values)
    return result.rows
  }))
}

async function cleanupAccount(query: Query, profileId: string, currentSub: string | null): Promise<AccountDeletionResult> {
  const locked = await query(
    `select id, account_status::text as account_status
     from public.profiles
     where id = $1
     for update`,
    [profileId],
  ) as AccountRow[]
  if (!locked[0]) throw new Error('account_deletion_profile_not_found')

  // Decide again inside the transaction, from locked data, exactly as the screen showed.
  const plan = planAccountDeletion(await loadDeletionFacts(query, profileId, { lock: true }))
  const signIns = await query(
    `select provider_subject, provider_username
     from public.identity_accounts
     where profile_id = $1 and provider = 'cognito'`,
    [profileId],
  )
  const owned = await removeOwnedContent(query, profileId, plan.strippedCompanyIds)

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
         and post.company_id is null
       union all
       select m.attachment_storage_path
       from public.messages m
       where m.sender_profile_id = $1
       union all
       select a.cv_storage_path
       from public.job_applications a
       where a.applicant_id = $1
       union all
       select d.storage_path
       from public.profile_documents d
       where d.profile_id = $1
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
    `delete from public.post_hides
     where user_id = $1`,
    [profileId],
  )
  // Deleting an account withdraws newsletter consent. The consent history is kept (append-only)
  // and the SES contact is removed by the newsletter worker, which picks up the pending sync.
  await query(
    `insert into public.newsletter_consent_events (subscriber_id, event_type, topics, source)
     select id, 'unsubscribed', topics, 'account_deletion'
     from public.newsletter_subscribers
     where profile_id = $1 and status <> 'unsubscribed'`,
    [profileId],
  )
  await query(
    `update public.newsletter_subscribers
     set status = 'unsubscribed',
         unsubscribed_at = coalesce(unsubscribed_at, now()),
         ses_sync_status = case when confirmed_at is not null or ses_sync_status <> 'not_required' then 'pending' else 'not_required' end,
         ses_sync_attempts = 0,
         ses_sync_error = null,
         ses_next_attempt_at = now(),
         profile_id = null,
         updated_at = now()
     where profile_id = $1`,
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
  // Posts published as an organization belong to its page and stay with it.
  await query(
    `delete from public.posts
     where author_id = $1
       and company_id is null`,
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
    `delete from public.job_applications
     where applicant_id = $1`,
    [profileId],
  )
  await query(
    `delete from public.profile_documents
     where profile_id = $1`,
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
    `delete from public.phone_link_code_requests
     where profile_id = $1`,
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
    mediaPaths: [...new Set([...mediaRows, ...owned.deletedEventMedia].flatMap((row) => (
      typeof row.storage_path === 'string' && row.storage_path.trim()
        ? [row.storage_path.trim()]
        : []
    )))],
    refundOrderIds: owned.refundOrderIds,
    cancelledEventAttendees: owned.cancelledEventAttendees,
    otherSignInUsernames: signIns.flatMap((row) => (
      row.provider_subject !== currentSub && typeof row.provider_username === 'string' && row.provider_username.trim()
        ? [row.provider_username.trim()]
        : []
    )),
    plan,
  }
}

export function createAccountDeletionRepository(input: {
  transaction?: Transaction
  query?: Query
} = {}) {
  const transaction = input.transaction ?? runtimeTransaction

  const read: Query = input.query ?? ((text, values) => databaseQuery<Row>(text, values))

  return {
    /** What deleting this account would do right now, for the delete-account screen. */
    async getDeletionPlan(profileId: string): Promise<AccountDeletionPlan> {
      return planAccountDeletion(await loadDeletionFacts(read, profileId))
    },

    async deleteAccountWithIdentity(
      profileId: string,
      deleteIdentity: () => Promise<void>,
      options: { currentSub?: string | null } = {},
    ) {
      return transaction(async (query) => {
        const result = await cleanupAccount(query, profileId, options.currentSub ?? null)
        await deleteIdentity()
        return result
      })
    },

    async finalizeAccountDeletion(profileId: string, options: { currentSub?: string | null } = {}) {
      return transaction((query) => cleanupAccount(query, profileId, options.currentSub ?? null))
    },
  }
}

export const accountDeletionRepository = createAccountDeletionRepository()
