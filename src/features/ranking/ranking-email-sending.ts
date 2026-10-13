import type { QueryResultRow } from 'pg'
import { query as databaseQuery, withTransaction as databaseTransaction, type DatabaseQueryClient } from '@/lib/db/client'
import { createResendEmailClient, loadResendApiKey, ResendApiError, type ResendEmailClient } from '@/lib/email/resend'
import { withEmailSuppression } from '@/lib/email/suppression'
import { incrementRankingMetric } from '@/features/signals/repository'
import type { JobAlertEmailPayload } from './job-alerts'
import { RANKING_EMAIL_FROM, RANKING_EMAIL_TOPICS, jobAlertEmail, weeklyDigestEmail, type RankingEmailTopic, type RenderedEmail } from './ranking-email'
import { DIGEST_MIN_ITEMS, digestItemCount, type DigestPayload } from './weekly-digest'

/**
 * Round G: sends the queued job alert (G3) and weekly digest (G6) emails from the outbox worker,
 * through the existing Resend client with suppression (the app's one email path; the SES client is
 * only used by the newsletter sync and the trial reminder). One email per queue row, at most once:
 * the Resend idempotency key is the row id and a sent row is never claimed again. Skipped when the
 * recipient turned the topic off, has no verified email address, or the row is over two days old.
 */
type Query = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>
type Transaction = <T>(work: (query: Query) => Promise<T>) => Promise<T>
type Sender = Pick<ResendEmailClient, 'sendEmail'>
export type RankingEmailRenderer = (input: { emailId: string; recipientId: string; payload: unknown; siteUrl?: string }) => RenderedEmail | null

const MAX_ATTEMPTS = 5
const STALE_AFTER_HOURS = 48
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type RankingEmailDelivery = {
  id: string
  recipientId: string
  topic: RankingEmailTopic
  payload: unknown
  email: string | null
  topicEnabled: boolean
  stale: boolean
}

function runtimeTransaction<T>(work: (query: Query) => Promise<T>) {
  return databaseTransaction((client: DatabaseQueryClient) => work(async (text, values) => (await client.query(text, values ? [...values] : undefined)).rows))
}

function isTopic(value: unknown): value is RankingEmailTopic {
  return (RANKING_EMAIL_TOPICS as readonly unknown[]).includes(value)
}

export function createRankingEmailRepository(input: { query?: Query; transaction?: Transaction } = {}) {
  const queryRows: Query = input.query ?? ((text, values) => databaseQuery<QueryResultRow>(text, values))
  const transaction = input.transaction ?? runtimeTransaction

  return {
    /** Claims due emails with a 15-minute lease, so a crashed send is retried and never doubled. */
    async claimBatch(limit = 10): Promise<RankingEmailDelivery[]> {
      const bounded = Math.max(1, Math.min(25, Math.floor(limit)))
      return transaction(async (query) => {
        const rows = await query(
          `with picked as (
             select email.id
             from public.ranking_emails email
             where email.status = 'pending'
               and email.next_attempt_at <= now()
               and email.attempts < $2
             order by email.next_attempt_at asc, email.id asc
             for update skip locked
             limit $1
           )
           update public.ranking_emails email
           set attempts = email.attempts + 1,
               next_attempt_at = now() + interval '15 minutes'
           from picked
           where email.id = picked.id
           returning
             email.id, email.recipient_id, email.topic, email.payload,
             (select lower(account.email)
              from public.identity_accounts account
              where account.profile_id = email.recipient_id
                and account.email_verified = true
                and account.email is not null
              order by account.created_at asc, account.id asc
              limit 1) as email,
             coalesce((select topic.email_enabled
                       from public.member_email_topics topic
                       where topic.profile_id = email.recipient_id and topic.topic = email.topic), true) as topic_enabled,
             email.created_at < now() - make_interval(hours => $3::int) as stale`,
          [bounded, MAX_ATTEMPTS, STALE_AFTER_HOURS],
        )
        return rows.flatMap((row): RankingEmailDelivery[] => (isTopic(row.topic)
          ? [{
              id: String(row.id),
              recipientId: String(row.recipient_id),
              topic: row.topic,
              payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload,
              email: (row.email as string | null) ?? null,
              topicEnabled: row.topic_enabled !== false,
              stale: row.stale === true,
            }]
          : []))
      })
    },

    async markSent(id: string, messageId: string) {
      await queryRows(
        `update public.ranking_emails
         set status = 'sent', sent_at = now(), last_error = null,
             payload = payload || jsonb_build_object('messageId', $2::text)
         where id = $1`,
        [id, messageId],
      )
    },

    async markSkipped(id: string, reason: string) {
      await queryRows(`update public.ranking_emails set status = 'skipped', last_error = left($2, 500) where id = $1`, [id, reason])
    },

    async markFailed(id: string, error: string, retryable: boolean) {
      await queryRows(
        `update public.ranking_emails
         set status = case when $3 and attempts < $4 then 'pending' else 'failed' end,
             last_error = left($2, 500),
             next_attempt_at = case when $3 and attempts < $4 then now() + make_interval(mins => greatest(5, attempts * 10)) else next_attempt_at end
         where id = $1`,
        [id, error, retryable, MAX_ATTEMPTS],
      )
    },
  }
}

/** Topic preferences (Settings › Email notifications) and the one-click unsubscribe. */
export function createRankingEmailPreferences(input: { query?: Query } = {}) {
  const queryRows: Query = input.query ?? ((text, values) => databaseQuery<QueryResultRow>(text, values))

  return {
    async topics(profileId: string): Promise<Record<RankingEmailTopic, boolean>> {
      const result: Record<RankingEmailTopic, boolean> = { job_alerts: true, weekly_digest: true }
      const rows = await queryRows(`select topic, email_enabled from public.member_email_topics where profile_id = $1`, [profileId])
      for (const row of rows) if (isTopic(row.topic)) result[row.topic] = row.email_enabled !== false
      return result
    },

    async set(profileId: string, topic: RankingEmailTopic, enabled: boolean) {
      await queryRows(
        `insert into public.member_email_topics (profile_id, topic, email_enabled, updated_at)
         values ($1, $2, $3, now())
         on conflict (profile_id, topic) do update set email_enabled = excluded.email_enabled, updated_at = now()`,
        [profileId, topic, enabled],
      )
    },

    /** Which topic an unsubscribe token (an email's queue id) turns off, or null. Reveals nothing else. */
    async topicForToken(token: string): Promise<RankingEmailTopic | null> {
      if (!UUID.test(token)) return null
      const rows = await queryRows(`select topic from public.ranking_emails where id = $1`, [token])
      return isTopic(rows[0]?.topic) ? rows[0]!.topic as RankingEmailTopic : null
    },

    /** Turns the email's topic off for the person it went to. The topic, or null for an unknown token. */
    async unsubscribeWithToken(token: string): Promise<RankingEmailTopic | null> {
      if (!UUID.test(token)) return null
      const rows = await queryRows(
        `insert into public.member_email_topics (profile_id, topic, email_enabled, updated_at)
         select email.recipient_id, email.topic, false, now()
         from public.ranking_emails email
         where email.id = $1
         on conflict (profile_id, topic) do update set email_enabled = false, updated_at = now()
         returning topic`,
        [token],
      )
      return isTopic(rows[0]?.topic) ? rows[0]!.topic as RankingEmailTopic : null
    },
  }
}

function errorText(error: unknown) {
  if (error instanceof ResendApiError) return `${error.code}: ${error.message}`.slice(0, 500)
  return error instanceof Error ? error.message.slice(0, 500) : 'unknown_error'
}

const DEFAULT_RENDERERS: Partial<Record<RankingEmailTopic, RankingEmailRenderer>> = {
  job_alerts: ({ emailId, payload, siteUrl }) => {
    const value = payload as JobAlertEmailPayload | null
    if (!value || typeof value.alertName !== 'string' || !Array.isArray(value.jobs)) return null
    return jobAlertEmail({ emailId, payload: value, ...(siteUrl ? { siteUrl } : {}) })
  },
  weekly_digest: ({ emailId, payload, siteUrl }) => {
    const value = payload as DigestPayload | null
    if (!value || !Array.isArray(value.posts) || !Array.isArray(value.jobs) || !Array.isArray(value.people) || !Array.isArray(value.events) || !Array.isArray(value.courses)) return null
    // The empty digest is never sent (a test digest is, so the owner can check the layout).
    if (!value.test && digestItemCount(value) < DIGEST_MIN_ITEMS) return null
    return weeklyDigestEmail({ emailId, payload: value, ...(siteUrl ? { siteUrl } : {}) })
  },
}

export function createRankingEmailWorker(input: {
  repository?: ReturnType<typeof createRankingEmailRepository>
  resend?: Sender | null
  loadApiKey?: () => Promise<string | null>
  siteUrl?: string
  renderers?: Partial<Record<RankingEmailTopic, RankingEmailRenderer>>
} = {}) {
  const repository = input.repository ?? createRankingEmailRepository()
  const renderers = { ...DEFAULT_RENDERERS, ...input.renderers }
  let client: Sender | null | undefined = input.resend

  async function resolveClient() {
    if (client !== undefined) return client
    const key = await (input.loadApiKey ?? loadResendApiKey)()
    client = key ? withEmailSuppression(createResendEmailClient({ apiKey: key })) : null
    return client
  }

  async function sendOne(delivery: RankingEmailDelivery, sender: Sender) {
    if (!delivery.topicEnabled) {
      await repository.markSkipped(delivery.id, 'topic_off')
      return 'skipped' as const
    }
    if (!delivery.email) {
      await repository.markSkipped(delivery.id, 'no_verified_email')
      return 'skipped' as const
    }
    if (delivery.stale) {
      await repository.markSkipped(delivery.id, 'stale')
      return 'skipped' as const
    }
    const email = renderers[delivery.topic]?.({ emailId: delivery.id, recipientId: delivery.recipientId, payload: delivery.payload, ...(input.siteUrl ? { siteUrl: input.siteUrl } : {}) })
    if (!email) {
      await repository.markSkipped(delivery.id, 'nothing_to_send')
      return 'skipped' as const
    }
    try {
      const result = await sender.sendEmail({
        from: RANKING_EMAIL_FROM[delivery.topic],
        to: delivery.email,
        subject: email.subject,
        text: email.text,
        html: email.html,
        headers: email.headers,
        idempotencyKey: `ranking-email/${delivery.id}`,
        tags: [{ name: 'category', value: delivery.topic }],
      })
      await repository.markSent(delivery.id, result.messageId)
      void incrementRankingMetric(`email.${delivery.topic}.sent`).catch(() => undefined)
      return 'sent' as const
    } catch (error) {
      const retryable = error instanceof ResendApiError && error.retryable
      await repository.markFailed(delivery.id, errorText(error), retryable)
      return retryable ? 'retry' as const : 'failed' as const
    }
  }

  return {
    async runSweep(limit = 10) {
      const sender = await resolveClient()
      if (!sender) return { claimed: 0, sent: 0, failed: 0, skipped: 0, retrying: 0, disabled: true }
      const deliveries = await repository.claimBatch(limit)
      const counts = { sent: 0, failed: 0, skipped: 0, retrying: 0 }
      for (const delivery of deliveries) {
        const result = await sendOne(delivery, sender)
        if (result === 'sent') counts.sent += 1
        if (result === 'failed') counts.failed += 1
        if (result === 'skipped') counts.skipped += 1
        if (result === 'retry') {
          counts.retrying += 1
          break
        }
      }
      return { claimed: deliveries.length, ...counts, disabled: false }
    },
  }
}

/** The outbox worker's sweep: every minute, at most 10 emails a pass. Quiet when nothing was claimed. */
export function createRankingEmailSweep(worker = createRankingEmailWorker()) {
  return {
    name: 'ranking_emails',
    everyMs: 60_000,
    requiresTable: 'ranking_emails',
    async run() {
      const result = await worker.runSweep(10)
      return result.claimed ? result : undefined
    },
  }
}
