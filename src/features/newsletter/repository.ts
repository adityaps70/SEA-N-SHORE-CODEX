import type { QueryResultRow } from 'pg'
import {
  query as databaseQuery,
  withTransaction as databaseWithTransaction,
  type DatabaseQueryClient,
} from '@/lib/db/client'
import { isNewsletterTopic, type NewsletterSource, type NewsletterStatus, type NewsletterTopic } from './topics'

export type NewsletterSyncStatus = 'not_required' | 'pending' | 'synced' | 'failed'

export type NewsletterSubscriber = {
  id: string
  email: string
  profileId: string | null
  status: NewsletterStatus
  topics: NewsletterTopic[]
  source: string
  consentTextVersion: string | null
  consentedAt: string | null
  confirmedAt: string | null
  confirmationSentAt: string | null
  unsubscribedAt: string | null
  sesSyncStatus: NewsletterSyncStatus
  sesSyncAttempts: number
  sesSyncError: string | null
  sesSyncedAt: string | null
  createdAt: string
  updatedAt: string
}

export type NewsletterConsentEventType =
  | 'subscribe_requested'
  | 'subscribe_confirmed'
  | 'topics_changed'
  | 'unsubscribed'
  | 'duplicate_signup'

export type NewsletterConsentEvent = {
  id: string
  eventType: NewsletterConsentEventType
  topics: NewsletterTopic[]
  consentTextVersion: string | null
  source: string
  actorProfileId: string | null
  ipHash: string | null
  userAgentSummary: string | null
  createdAt: string
}

export type ConsentContext = {
  source: NewsletterSource
  ipHash?: string | null
  userAgentSummary?: string | null
  actorProfileId?: string | null
  consentTextVersion?: string | null
}

export type SignupOutcome =
  | 'subscribed'
  | 'confirmation_required'
  | 'already_subscribed'
  | 'already_pending'
  | 'topics_updated'

type SubscriberRow = QueryResultRow & {
  id: string
  email: string
  profile_id: string | null
  status: NewsletterStatus
  topics: string[] | null
  source: string
  consent_text_version: string | null
  consented_at: Date | string | null
  confirmed_at: Date | string | null
  confirmation_sent_at: Date | string | null
  unsubscribed_at: Date | string | null
  ses_sync_status: NewsletterSyncStatus
  ses_sync_attempts: number | string
  ses_sync_error: string | null
  ses_synced_at: Date | string | null
  created_at: Date | string
  updated_at: Date | string
}

type EventRow = QueryResultRow & {
  id: string | number
  event_type: NewsletterConsentEventType
  topics: string[] | null
  consent_text_version: string | null
  source: string
  actor_profile_id: string | null
  ip_hash: string | null
  user_agent_summary: string | null
  created_at: Date | string
}

type Query = <T extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]) => Promise<T[]>
type Transaction = <T>(fn: (client: DatabaseQueryClient) => Promise<T>) => Promise<T>

const SUBSCRIBER_COLUMNS = `id, email, profile_id, status, topics, source, consent_text_version, consented_at,
  confirmed_at, confirmation_sent_at, unsubscribed_at, ses_sync_status, ses_sync_attempts, ses_sync_error,
  ses_synced_at, created_at, updated_at`

function iso(value: Date | string | null): string | null {
  if (value === null || value === undefined) return null
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function topicsFrom(values: string[] | null | undefined): NewsletterTopic[] {
  return (values ?? []).filter(isNewsletterTopic)
}

export function mapSubscriber(row: SubscriberRow): NewsletterSubscriber {
  return {
    id: row.id,
    email: row.email,
    profileId: row.profile_id,
    status: row.status,
    topics: topicsFrom(row.topics),
    source: row.source,
    consentTextVersion: row.consent_text_version,
    consentedAt: iso(row.consented_at),
    confirmedAt: iso(row.confirmed_at),
    confirmationSentAt: iso(row.confirmation_sent_at),
    unsubscribedAt: iso(row.unsubscribed_at),
    sesSyncStatus: row.ses_sync_status,
    sesSyncAttempts: Number(row.ses_sync_attempts ?? 0),
    sesSyncError: row.ses_sync_error,
    sesSyncedAt: iso(row.ses_synced_at),
    createdAt: iso(row.created_at) ?? new Date(0).toISOString(),
    updatedAt: iso(row.updated_at) ?? new Date(0).toISOString(),
  }
}

function mapEvent(row: EventRow): NewsletterConsentEvent {
  return {
    id: String(row.id),
    eventType: row.event_type,
    topics: topicsFrom(row.topics),
    consentTextVersion: row.consent_text_version,
    source: row.source,
    actorProfileId: row.actor_profile_id,
    ipHash: row.ip_hash,
    userAgentSummary: row.user_agent_summary,
    createdAt: iso(row.created_at) ?? new Date(0).toISOString(),
  }
}

function sameTopics(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && [...left].sort().join(',') === [...right].sort().join(',')
}

async function insertEvent(
  client: DatabaseQueryClient,
  subscriberId: string,
  eventType: NewsletterConsentEventType,
  topics: readonly string[],
  context: ConsentContext,
) {
  await client.query(
    `insert into public.newsletter_consent_events (
       subscriber_id, event_type, topics, consent_text_version, source, actor_profile_id, ip_hash, user_agent_summary
     ) values ($1, $2, $3::text[], $4, $5, $6, $7, $8)`,
    [
      subscriberId,
      eventType,
      [...topics],
      context.consentTextVersion ?? null,
      context.source,
      context.actorProfileId ?? null,
      context.ipHash ?? null,
      context.userAgentSummary?.slice(0, 60) ?? null,
    ],
  )
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`)
}

/** Exponential backoff for SES sync retries: 1, 2, 4 … minutes, capped at 6 hours. */
export function nextSyncDelayMinutes(attempts: number) {
  return Math.min(2 ** Math.max(0, attempts - 1), 360)
}

export type SubscriberSearch = {
  q?: string
  status?: NewsletterStatus | null
  topic?: NewsletterTopic | null
  limit?: number
  offset?: number
}

function searchWhere(search: SubscriberSearch) {
  const clauses: string[] = []
  const values: unknown[] = []
  const q = search.q?.trim().toLowerCase()
  if (q) {
    values.push(`%${escapeLike(q)}%`)
    clauses.push(`s.email like $${values.length} escape '\\'`)
  }
  if (search.status) {
    values.push(search.status)
    clauses.push(`s.status = $${values.length}`)
  }
  if (search.topic) {
    values.push(search.topic)
    clauses.push(`$${values.length} = any(s.topics)`)
  }
  return { where: clauses.length ? `where ${clauses.join(' and ')}` : '', values }
}

export type CampaignStatus = 'queued' | 'sending' | 'sent' | 'failed' | 'cancelled'

export type NewsletterCampaign = {
  id: string
  topic: NewsletterTopic
  subject: string
  bodyText: string
  status: CampaignStatus
  recipientCount: number
  sentCount: number
  failedCount: number
  lastError: string | null
  createdAt: string
  completedAt: string | null
}

type CampaignRow = QueryResultRow & {
  id: string
  topic: NewsletterTopic
  subject: string
  body_text: string
  status: CampaignStatus
  recipient_count: number | string
  sent_count: number | string
  failed_count: number | string
  last_error: string | null
  created_at: Date | string
  completed_at: Date | string | null
}

function mapCampaign(row: CampaignRow): NewsletterCampaign {
  return {
    id: row.id,
    topic: row.topic,
    subject: row.subject,
    bodyText: row.body_text,
    status: row.status,
    recipientCount: Number(row.recipient_count ?? 0),
    sentCount: Number(row.sent_count ?? 0),
    failedCount: Number(row.failed_count ?? 0),
    lastError: row.last_error,
    createdAt: iso(row.created_at) ?? new Date(0).toISOString(),
    completedAt: iso(row.completed_at),
  }
}

export type CampaignDelivery = {
  campaignId: string
  subscriberId: string
  email: string
  topic: NewsletterTopic
  subject: string
  bodyText: string
  stillSubscribed: boolean
}

export function createNewsletterRepository(input: { query?: Query; withTransaction?: Transaction } = {}) {
  const query: Query = input.query ?? ((text, values) => databaseQuery(text, values))
  const transaction: Transaction = input.withTransaction ?? databaseWithTransaction

  async function lockSubscriber(client: DatabaseQueryClient, id: string) {
    const result = await client.query<SubscriberRow>(
      `select ${SUBSCRIBER_COLUMNS} from public.newsletter_subscribers where id = $1 for update`,
      [id],
    )
    return result.rows[0] ? mapSubscriber(result.rows[0]) : null
  }

  async function returning(client: DatabaseQueryClient, text: string, values: readonly unknown[]) {
    const result = await client.query<SubscriberRow>(`${text} returning ${SUBSCRIBER_COLUMNS}`, values)
    const row = result.rows[0]
    if (!row) throw new Error('newsletter_subscriber_write_failed')
    return mapSubscriber(row)
  }

  return {
    /**
     * Records consent for an address. `ownershipVerified` is true only when the
     * address is the signed-in member's Cognito-verified email; everyone else
     * must confirm through the emailed link before they are subscribed.
     */
    async recordSignup(signup: {
      email: string
      topics: NewsletterTopic[]
      profileId: string | null
      ownershipVerified: boolean
      context: ConsentContext
    }): Promise<{ outcome: SignupOutcome; subscriber: NewsletterSubscriber }> {
      return transaction(async (client) => {
        const existingResult = await client.query<SubscriberRow>(
          `select ${SUBSCRIBER_COLUMNS} from public.newsletter_subscribers where email = $1 for update`,
          [signup.email],
        )
        const existing = existingResult.rows[0] ? mapSubscriber(existingResult.rows[0]) : null
        const verified = signup.ownershipVerified
        const profileId = verified ? signup.profileId : null

        if (!existing) {
          const inserted = await client.query<SubscriberRow>(
            `insert into public.newsletter_subscribers (
               email, profile_id, status, topics, source, consent_text_version, consented_at, confirmed_at, ses_sync_status
             ) values ($1, $2, $3, $4::text[], $5, $6, now(), case when $3 = 'subscribed' then now() else null end, $7)
             on conflict (email) do nothing
             returning ${SUBSCRIBER_COLUMNS}`,
            [
              signup.email,
              profileId,
              verified ? 'subscribed' : 'pending',
              signup.topics,
              signup.context.source,
              signup.context.consentTextVersion ?? null,
              verified ? 'pending' : 'not_required',
            ],
          )
          const row = inserted.rows[0]
          if (!row) throw new Error('newsletter_signup_conflict')
          const subscriber = mapSubscriber(row)
          await insertEvent(client, subscriber.id, 'subscribe_requested', signup.topics, signup.context)
          if (verified) await insertEvent(client, subscriber.id, 'subscribe_confirmed', signup.topics, signup.context)
          return { outcome: verified ? 'subscribed' : 'confirmation_required', subscriber }
        }

        if (existing.status === 'subscribed') {
          if (verified && !sameTopics(existing.topics, signup.topics)) {
            const subscriber = await returning(
              client,
              `update public.newsletter_subscribers
               set topics = $2::text[], profile_id = coalesce(profile_id, $3), consent_text_version = $4,
                   consented_at = now(), ses_sync_status = 'pending', ses_next_attempt_at = now(), updated_at = now()
               where id = $1`,
              [existing.id, signup.topics, profileId, signup.context.consentTextVersion ?? null],
            )
            await insertEvent(client, existing.id, 'topics_changed', signup.topics, signup.context)
            return { outcome: 'topics_updated', subscriber }
          }
          await insertEvent(client, existing.id, 'duplicate_signup', signup.topics, signup.context)
          return { outcome: 'already_subscribed', subscriber: existing }
        }

        if (verified) {
          // Pending or previously unsubscribed, now confirmed by the verified owner.
          const subscriber = await returning(
            client,
            `update public.newsletter_subscribers
             set status = 'subscribed', topics = $2::text[], profile_id = coalesce(profile_id, $3), source = $4,
                 consent_text_version = $5, consented_at = now(), confirmed_at = now(), unsubscribed_at = null,
                 ses_sync_status = 'pending', ses_sync_attempts = 0, ses_sync_error = null,
                 ses_next_attempt_at = now(), updated_at = now()
             where id = $1`,
            [existing.id, signup.topics, profileId, signup.context.source, signup.context.consentTextVersion ?? null],
          )
          await insertEvent(client, existing.id, 'subscribe_requested', signup.topics, signup.context)
          await insertEvent(client, existing.id, 'subscribe_confirmed', signup.topics, signup.context)
          return { outcome: 'subscribed', subscriber }
        }

        // Unverified request for a pending or unsubscribed address: record the new
        // consent and (re)start confirmation. An unsubscribed address stays
        // unsubscribed in SES until the owner confirms.
        const wasPending = existing.status === 'pending'
        const subscriber = await returning(
          client,
          `update public.newsletter_subscribers
           set status = 'pending', topics = $2::text[], source = $3, consent_text_version = $4, consented_at = now(),
               confirmation_sent_at = case when status = 'pending' then confirmation_sent_at else null end,
               updated_at = now()
           where id = $1`,
          [existing.id, signup.topics, signup.context.source, signup.context.consentTextVersion ?? null],
        )
        await insertEvent(client, existing.id, 'subscribe_requested', signup.topics, signup.context)
        return { outcome: wasPending ? 'already_pending' : 'confirmation_required', subscriber }
      })
    },

    async confirm(id: string, context: ConsentContext) {
      return transaction(async (client) => {
        const existing = await lockSubscriber(client, id)
        if (!existing) return { outcome: 'not_found' as const, subscriber: null }
        if (existing.status === 'subscribed') return { outcome: 'already_subscribed' as const, subscriber: existing }
        if (existing.status === 'unsubscribed') return { outcome: 'unsubscribed' as const, subscriber: existing }
        const subscriber = await returning(
          client,
          `update public.newsletter_subscribers
           set status = 'subscribed', confirmed_at = now(), unsubscribed_at = null, ses_sync_status = 'pending',
               ses_sync_attempts = 0, ses_sync_error = null, ses_next_attempt_at = now(), updated_at = now()
           where id = $1`,
          [id],
        )
        await insertEvent(client, id, 'subscribe_confirmed', subscriber.topics, { ...context, consentTextVersion: subscriber.consentTextVersion })
        return { outcome: 'confirmed' as const, subscriber }
      })
    },

    async unsubscribe(id: string, context: ConsentContext) {
      return transaction(async (client) => {
        const existing = await lockSubscriber(client, id)
        if (!existing) return { outcome: 'not_found' as const, subscriber: null }
        if (existing.status === 'unsubscribed') return { outcome: 'already_unsubscribed' as const, subscriber: existing }
        // Only addresses that were ever confirmed can exist in the SES contact list.
        const needsSync = existing.confirmedAt !== null || existing.sesSyncStatus !== 'not_required'
        const subscriber = await returning(
          client,
          `update public.newsletter_subscribers
           set status = 'unsubscribed', unsubscribed_at = now(),
               ses_sync_status = $2, ses_sync_attempts = 0, ses_sync_error = null, ses_next_attempt_at = now(),
               updated_at = now()
           where id = $1`,
          [id, needsSync ? 'pending' : 'not_required'],
        )
        await insertEvent(client, id, 'unsubscribed', existing.topics, context)
        if (context.source === 'admin' && context.actorProfileId) {
          await client.query(
            `insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
             values ($1, 'newsletter.subscriber_unsubscribed', 'newsletter_subscriber', $2, '{}'::jsonb)`,
            [context.actorProfileId, id],
          )
        }
        return { outcome: 'unsubscribed' as const, subscriber }
      })
    },

    async updateTopics(id: string, topics: NewsletterTopic[], context: ConsentContext) {
      return transaction(async (client) => {
        const existing = await lockSubscriber(client, id)
        if (!existing || existing.status !== 'subscribed') return { outcome: 'not_subscribed' as const, subscriber: existing }
        if (sameTopics(existing.topics, topics)) return { outcome: 'unchanged' as const, subscriber: existing }
        const subscriber = await returning(
          client,
          `update public.newsletter_subscribers
           set topics = $2::text[], ses_sync_status = 'pending', ses_next_attempt_at = now(), updated_at = now()
           where id = $1`,
          [id, topics],
        )
        await insertEvent(client, id, 'topics_changed', topics, context)
        return { outcome: 'updated' as const, subscriber }
      })
    },

    async getById(id: string) {
      const rows = await query<SubscriberRow>(`select ${SUBSCRIBER_COLUMNS} from public.newsletter_subscribers where id = $1`, [id])
      return rows[0] ? mapSubscriber(rows[0]) : null
    },

    async getByEmail(email: string) {
      const rows = await query<SubscriberRow>(`select ${SUBSCRIBER_COLUMNS} from public.newsletter_subscribers where email = $1`, [email])
      return rows[0] ? mapSubscriber(rows[0]) : null
    },

    /** The signed-in member's Cognito-verified email, if any (from identity_accounts). */
    async getVerifiedEmailForProfile(profileId: string) {
      const rows = await query<{ email: string }>(
        `select lower(email) as email
         from public.identity_accounts
         where profile_id = $1 and email_verified = true and email is not null
         order by id
         limit 1`,
        [profileId],
      )
      return rows[0]?.email ?? null
    },

    /** Abuse protection: consent events recorded from one hashed IP in the window. */
    async countRecentEventsForIp(ipHash: string, minutes: number) {
      const rows = await query<{ count: string | number }>(
        `select count(*)::int as count
         from public.newsletter_consent_events
         where ip_hash = $1 and created_at > now() - make_interval(mins => $2::int)`,
        [ipHash, minutes],
      )
      return Number(rows[0]?.count ?? 0)
    },

    async countRecentEventsForEmail(email: string, minutes: number) {
      const rows = await query<{ count: string | number }>(
        `select count(*)::int as count
         from public.newsletter_consent_events e
         join public.newsletter_subscribers s on s.id = e.subscriber_id
         where s.email = $1 and e.created_at > now() - make_interval(mins => $2::int)`,
        [email, minutes],
      )
      return Number(rows[0]?.count ?? 0)
    },

    /** Claims rows due for SES sync so concurrent workers never process the same row. */
    async claimDueForSync(limit: number) {
      const rows = await query<SubscriberRow>(
        `with due as (
           select id from public.newsletter_subscribers
           where ses_sync_status in ('pending', 'failed') and ses_next_attempt_at <= now()
           order by ses_next_attempt_at, id
           limit $1
           for update skip locked
         )
         update public.newsletter_subscribers s
         set ses_next_attempt_at = now() + interval '5 minutes'
         from due
         where s.id = due.id
         returning ${SUBSCRIBER_COLUMNS.split(',').map((column) => `s.${column.trim()}`).join(', ')}`,
        [Math.min(Math.max(Math.trunc(limit), 1), 200)],
      )
      return rows.map(mapSubscriber)
    },

    /**
     * Marks a sync result only if the row has not changed since it was read
     * (updated_at), so a newer opt-out is never overwritten by an older sync.
     */
    async markSynced(id: string, readUpdatedAt: string) {
      const rows = await query<{ id: string }>(
        `update public.newsletter_subscribers
         set ses_sync_status = 'synced', ses_synced_at = now(), ses_sync_error = null, ses_sync_attempts = 0
         where id = $1 and date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $2::timestamptz)
         returning id`,
        [id, readUpdatedAt],
      )
      return rows.length > 0
    },

    async markSyncFailed(id: string, readUpdatedAt: string, error: string) {
      const rows = await query<{ id: string }>(
        `update public.newsletter_subscribers
         set ses_sync_status = 'failed',
             ses_sync_attempts = ses_sync_attempts + 1,
             ses_sync_error = $3,
             ses_next_attempt_at = now() + make_interval(mins => least(power(2, ses_sync_attempts)::int, 360))
         where id = $1 and date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $2::timestamptz)
         returning id`,
        [id, readUpdatedAt, error.slice(0, 500)],
      )
      return rows.length > 0
    },

    /** Subscribed contacts whose SES state has not been checked for a day (for SES-side opt-outs). */
    async claimForReconcile(limit: number) {
      const rows = await query<SubscriberRow>(
        `with due as (
           select id from public.newsletter_subscribers
           where status = 'subscribed' and ses_sync_status = 'synced'
             and (ses_synced_at is null or ses_synced_at < now() - interval '1 day')
           order by ses_synced_at nulls first, id
           limit $1
           for update skip locked
         )
         update public.newsletter_subscribers s
         set ses_synced_at = now()
         from due
         where s.id = due.id
         returning ${SUBSCRIBER_COLUMNS.split(',').map((column) => `s.${column.trim()}`).join(', ')}`,
        [Math.min(Math.max(Math.trunc(limit), 1), 200)],
      )
      return rows.map(mapSubscriber)
    },

    async claimPendingConfirmations(limit: number) {
      const rows = await query<SubscriberRow>(
        `with due as (
           select id from public.newsletter_subscribers
           where status = 'pending' and confirmation_sent_at is null
           order by created_at, id
           limit $1
           for update skip locked
         )
         update public.newsletter_subscribers s
         set confirmation_sent_at = now()
         from due
         where s.id = due.id
         returning ${SUBSCRIBER_COLUMNS.split(',').map((column) => `s.${column.trim()}`).join(', ')}`,
        [Math.min(Math.max(Math.trunc(limit), 1), 200)],
      )
      return rows.map(mapSubscriber)
    },

    /** Claims one confirmation email (not sent yet, or last sent over an hour ago). */
    async claimConfirmation(id: string) {
      const rows = await query<SubscriberRow>(
        `update public.newsletter_subscribers
         set confirmation_sent_at = now()
         where id = $1 and status = 'pending'
           and (confirmation_sent_at is null or confirmation_sent_at < now() - interval '1 hour')
         returning ${SUBSCRIBER_COLUMNS}`,
        [id],
      )
      return rows[0] ? mapSubscriber(rows[0]) : null
    },

    async clearConfirmationSent(id: string) {
      await query(`update public.newsletter_subscribers set confirmation_sent_at = null where id = $1 and status = 'pending'`, [id])
    },

    // ---- Admin -------------------------------------------------------------

    async search(search: SubscriberSearch) {
      const { where, values } = searchWhere(search)
      const limit = Math.min(Math.max(Math.trunc(search.limit ?? 50), 1), 200)
      const offset = Math.max(Math.trunc(search.offset ?? 0), 0)
      const [rows, totals] = await Promise.all([
        query<SubscriberRow>(
          `select ${SUBSCRIBER_COLUMNS.split(',').map((column) => `s.${column.trim()}`).join(', ')}
           from public.newsletter_subscribers s
           ${where}
           order by s.created_at desc, s.id desc
           limit ${limit} offset ${offset}`,
          values,
        ),
        query<{ count: string | number }>(`select count(*)::int as count from public.newsletter_subscribers s ${where}`, values),
      ])
      return { subscribers: rows.map(mapSubscriber), total: Number(totals[0]?.count ?? 0) }
    },

    async statusCounts() {
      const rows = await query<{ status: NewsletterStatus; count: string | number }>(
        `select status, count(*)::int as count from public.newsletter_subscribers group by status`,
      )
      const counts: Record<NewsletterStatus, number> = { pending: 0, subscribed: 0, unsubscribed: 0 }
      for (const row of rows) counts[row.status] = Number(row.count)
      return counts
    },

    async consentHistory(id: string) {
      const rows = await query<EventRow>(
        `select id, event_type, topics, consent_text_version, source, actor_profile_id, ip_hash, user_agent_summary, created_at
         from public.newsletter_consent_events
         where subscriber_id = $1
         order by created_at desc, id desc
         limit 200`,
        [id],
      )
      return rows.map(mapEvent)
    },

    async exportRows(search: Omit<SubscriberSearch, 'limit' | 'offset'>) {
      const { where, values } = searchWhere(search)
      const rows = await query<SubscriberRow>(
        `select ${SUBSCRIBER_COLUMNS.split(',').map((column) => `s.${column.trim()}`).join(', ')}
         from public.newsletter_subscribers s
         ${where}
         order by s.created_at asc, s.id asc
         limit 100000`,
        values,
      )
      return rows.map(mapSubscriber)
    },

    async recordExport(adminId: string, rowCount: number, filters: { status?: string | null; topic?: string | null; q?: boolean }) {
      await query(
        `insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
         values ($1, 'newsletter.subscribers_exported', 'newsletter_subscriber', 'export', $2::jsonb)`,
        [adminId, JSON.stringify({ rows: rowCount, status: filters.status ?? null, topic: filters.topic ?? null, searched: Boolean(filters.q) })],
      )
    },

    // ---- Campaigns -----------------------------------------------------------

    async createCampaign(campaign: { adminId: string; topic: NewsletterTopic; subject: string; bodyText: string }) {
      return transaction(async (client) => {
        const created = await client.query<CampaignRow>(
          `insert into public.newsletter_campaigns (topic, subject, body_text, created_by)
           values ($1, $2, $3, $4)
           returning id, topic, subject, body_text, status, recipient_count, sent_count, failed_count, last_error, created_at, completed_at`,
          [campaign.topic, campaign.subject, campaign.bodyText, campaign.adminId],
        )
        const row = created.rows[0]
        if (!row) throw new Error('newsletter_campaign_create_failed')
        const recipients = await client.query<{ count: string | number }>(
          `with inserted as (
             insert into public.newsletter_campaign_deliveries (campaign_id, subscriber_id)
             select $1, s.id from public.newsletter_subscribers s
             where s.status = 'subscribed' and $2 = any(s.topics)
             on conflict do nothing
             returning 1
           )
           select count(*)::int as count from inserted`,
          [row.id, campaign.topic],
        )
        const count = Number(recipients.rows[0]?.count ?? 0)
        await client.query(`update public.newsletter_campaigns set recipient_count = $2 where id = $1`, [row.id, count])
        await client.query(
          `insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
           values ($1, 'newsletter.campaign_queued', 'newsletter_campaign', $2, jsonb_build_object('topic', $3::text, 'recipients', $4::int))`,
          [campaign.adminId, row.id, campaign.topic, count],
        )
        return { ...mapCampaign(row), recipientCount: count }
      })
    },

    async listCampaigns(limit = 20) {
      const rows = await query<CampaignRow>(
        `select id, topic, subject, body_text, status, recipient_count, sent_count, failed_count, last_error, created_at, completed_at
         from public.newsletter_campaigns
         order by created_at desc
         limit $1`,
        [limit],
      )
      return rows.map(mapCampaign)
    },

    /** Claims queued deliveries and re-checks consent at send time. */
    async claimDeliveries(limit: number): Promise<CampaignDelivery[]> {
      const rows = await query<QueryResultRow & {
        campaign_id: string
        subscriber_id: string
        email: string
        topic: NewsletterTopic
        subject: string
        body_text: string
        still_subscribed: boolean
      }>(
        `with due as (
           select d.campaign_id, d.subscriber_id
           from public.newsletter_campaign_deliveries d
           join public.newsletter_campaigns c on c.id = d.campaign_id
           where d.status = 'queued' and c.status in ('queued', 'sending')
           order by c.created_at, d.subscriber_id
           limit $1
           for update of d skip locked
         ),
         claimed as (
           update public.newsletter_campaign_deliveries d
           set attempts = d.attempts + 1, updated_at = now()
           from due
           where d.campaign_id = due.campaign_id and d.subscriber_id = due.subscriber_id
           returning d.campaign_id, d.subscriber_id
         ),
         started as (
           update public.newsletter_campaigns c
           set status = 'sending', started_at = coalesce(c.started_at, now())
           where c.id in (select campaign_id from claimed) and c.status = 'queued'
           returning c.id
         )
         select claimed.campaign_id, claimed.subscriber_id, s.email, c.topic, c.subject, c.body_text,
                (s.status = 'subscribed' and c.topic = any(s.topics)) as still_subscribed
         from claimed
         join public.newsletter_subscribers s on s.id = claimed.subscriber_id
         join public.newsletter_campaigns c on c.id = claimed.campaign_id`,
        [Math.min(Math.max(Math.trunc(limit), 1), 500)],
      )
      return rows.map((row) => ({
        campaignId: row.campaign_id,
        subscriberId: row.subscriber_id,
        email: row.email,
        topic: row.topic,
        subject: row.subject,
        bodyText: row.body_text,
        stillSubscribed: Boolean(row.still_subscribed),
      }))
    },

    async markDelivery(
      delivery: { campaignId: string; subscriberId: string },
      result: { status: 'sent' | 'failed' | 'skipped' | 'queued'; messageId?: string | null; error?: string | null },
    ) {
      await query(
        `update public.newsletter_campaign_deliveries
         set status = $3, ses_message_id = $4, error = $5, updated_at = now()
         where campaign_id = $1 and subscriber_id = $2`,
        [delivery.campaignId, delivery.subscriberId, result.status, result.messageId ?? null, result.error?.slice(0, 500) ?? null],
      )
    },

    /** Recomputes counts and closes campaigns with nothing left to send. */
    async finalizeCampaigns() {
      await query(
        `update public.newsletter_campaigns c
         set sent_count = totals.sent,
             failed_count = totals.failed,
             status = case when totals.queued = 0 then (case when totals.sent = 0 and totals.failed > 0 then 'failed' else 'sent' end) else c.status end,
             completed_at = case when totals.queued = 0 then coalesce(c.completed_at, now()) else c.completed_at end
         from (
           select campaign_id,
                  count(*) filter (where status = 'sent')::int as sent,
                  count(*) filter (where status = 'failed')::int as failed,
                  count(*) filter (where status = 'queued')::int as queued
           from public.newsletter_campaign_deliveries
           group by campaign_id
         ) totals
         where totals.campaign_id = c.id and c.status in ('queued', 'sending')`,
      )
      // Campaigns with no recipients at all.
      await query(
        `update public.newsletter_campaigns
         set status = 'sent', completed_at = now()
         where status = 'queued' and recipient_count = 0
           and not exists (select 1 from public.newsletter_campaign_deliveries d where d.campaign_id = newsletter_campaigns.id)`,
      )
    },
  }
}

export type NewsletterRepository = ReturnType<typeof createNewsletterRepository>

export const newsletterRepository = createNewsletterRepository()
