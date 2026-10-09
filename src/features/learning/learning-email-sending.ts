import type { QueryResultRow } from 'pg'
import { finalizeExpiredQuizSessions } from './learner-quiz-repository'
import { query as databaseQuery, withTransaction as databaseTransaction, type DatabaseQueryClient } from '@/lib/db/client'
import { createResendEmailClient, loadResendApiKey, ResendApiError, type ResendEmailClient } from '@/lib/email/resend'
import { LEARNING_EMAIL_FROM, learningEmail } from './learning-email'
import { LEARNING_NOTIFICATION_KINDS, sweepReleasedLessons, sweepSubmissionsToGrade, type LearningNotificationDetails, type LearningNotificationKind, sweepExpiringCertificates } from './learning-notifications'

/**
 * Sends the queued learning notification emails (learning round A, A6) from the outbox worker,
 * and runs the hourly digests that fill the queue. One email per queue row, at most once: the
 * Resend idempotency key is the row id, and a sent row is never claimed again. A recipient who
 * turned learning emails off, or has no verified email address, is skipped. News older than three
 * days is skipped rather than sent late.
 */

type Query = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>
type Transaction = <T>(work: (query: Query) => Promise<T>) => Promise<T>
type Sender = Pick<ResendEmailClient, 'sendEmail'>

const MAX_ATTEMPTS = 5
const STALE_AFTER_HOURS = 72
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type LearningEmailDelivery = {
  id: string
  recipientId: string
  kind: LearningNotificationKind
  details: LearningNotificationDetails
  email: string | null
  emailEnabled: boolean
  stale: boolean
}

type ClaimedRow = QueryResultRow & {
  id: string
  recipient_id: string
  kind: string
  payload: { details?: LearningNotificationDetails } | string | null
  email: string | null
  email_enabled: boolean
  stale: boolean
}

function runtimeTransaction<T>(work: (query: Query) => Promise<T>) {
  return databaseTransaction((client: DatabaseQueryClient) => work(async (text, values) => (await client.query(text, values ? [...values] : undefined)).rows))
}

function parsePayload(payload: ClaimedRow['payload']) {
  const value = typeof payload === 'string' ? JSON.parse(payload) as ClaimedRow['payload'] : payload
  return value && typeof value === 'object' ? value.details ?? null : null
}

export function createLearningEmailRepository(input: { query?: Query; transaction?: Transaction } = {}) {
  const queryRows: Query = input.query ?? ((text, values) => databaseQuery<QueryResultRow>(text, values))
  const transaction = input.transaction ?? runtimeTransaction

  return {
    /** Claims due emails with a 15-minute lease, so a crashed send is retried and never doubled. */
    async claimBatch(limit = 10): Promise<LearningEmailDelivery[]> {
      const bounded = Math.max(1, Math.min(25, Math.floor(limit)))
      return transaction(async (query) => {
        const rows = await query(
          `with picked as (
             select email.id
             from public.learning_notification_emails email
             where email.status = 'pending'
               and email.next_attempt_at <= now()
               and email.attempts < $2
             order by email.next_attempt_at asc, email.id asc
             for update skip locked
             limit $1
           )
           update public.learning_notification_emails email
           set attempts = email.attempts + 1,
               next_attempt_at = now() + interval '15 minutes'
           from picked
           where email.id = picked.id
           returning
             email.id, email.recipient_id, email.kind, email.payload,
             (select lower(account.email)
              from public.identity_accounts account
              where account.profile_id = email.recipient_id
                and account.email_verified = true
                and account.email is not null
              order by account.created_at asc, account.id asc
              limit 1) as email,
             coalesce((select preference.email_enabled
                       from public.notification_email_preferences preference
                       where preference.profile_id = email.recipient_id
                         and preference.category = 'learning'), true) as email_enabled,
             email.created_at < now() - make_interval(hours => $3::int) as stale`,
          [bounded, MAX_ATTEMPTS, STALE_AFTER_HOURS],
        ) as ClaimedRow[]
        return rows.flatMap((row): LearningEmailDelivery[] => {
          const details = parsePayload(row.payload)
          if (!(LEARNING_NOTIFICATION_KINDS as readonly string[]).includes(row.kind)) return []
          return [{
            id: row.id,
            recipientId: row.recipient_id,
            kind: row.kind as LearningNotificationKind,
            details: details ?? { courseTitle: '', courseSlug: '' },
            email: row.email,
            emailEnabled: row.email_enabled !== false,
            stale: row.stale === true || !details?.courseTitle,
          }]
        })
      })
    },

    async markSent(id: string, messageId: string) {
      await queryRows(
        `update public.learning_notification_emails
         set status = 'sent', sent_at = now(), last_error = null,
             payload = payload || jsonb_build_object('messageId', $2::text)
         where id = $1`,
        [id, messageId],
      )
    },

    async markSkipped(id: string, reason: string) {
      await queryRows(
        `update public.learning_notification_emails set status = 'skipped', last_error = left($2, 500) where id = $1`,
        [id, reason],
      )
    },

    async markFailed(id: string, error: string, retryable: boolean) {
      await queryRows(
        `update public.learning_notification_emails
         set status = case when $3 and attempts < $4 then 'pending' else 'failed' end,
             last_error = left($2, 500),
             next_attempt_at = case when $3 and attempts < $4 then now() + make_interval(mins => greatest(5, attempts * 10)) else next_attempt_at end
         where id = $1`,
        [id, error, retryable, MAX_ATTEMPTS],
      )
    },
  }
}

/** Learning email preference (Settings → Notifications) and the unsubscribe link. */
export function createLearningEmailPreferences(input: { query?: Query } = {}) {
  const queryRows: Query = input.query ?? ((text, values) => databaseQuery<QueryResultRow>(text, values))

  async function set(profileId: string, enabled: boolean) {
    await queryRows(
      `insert into public.notification_email_preferences (profile_id, category, email_enabled, updated_at)
       values ($1, 'learning', $2, now())
       on conflict (profile_id, category) do update set email_enabled = excluded.email_enabled, updated_at = now()`,
      [profileId, enabled],
    )
  }

  return {
    async learningEmailsEnabled(profileId: string) {
      const rows = await queryRows(
        `select email_enabled from public.notification_email_preferences where profile_id = $1 and category = 'learning'`,
        [profileId],
      )
      return rows[0] ? rows[0].email_enabled !== false : true
    },

    setLearningEmails: set,

    /** Whether an unsubscribe token (a learning email's queue id) is real. Reveals nothing else. */
    async isUnsubscribeToken(token: string) {
      if (!UUID.test(token)) return false
      const rows = await queryRows(`select 1 as found from public.learning_notification_emails where id = $1`, [token])
      return rows.length > 0
    },

    /** Turns learning emails off for the person the email went to. True when the token was real. */
    async unsubscribeWithToken(token: string) {
      if (!UUID.test(token)) return false
      const rows = await queryRows(
        `insert into public.notification_email_preferences (profile_id, category, email_enabled, updated_at)
         select email.recipient_id, 'learning', false, now()
         from public.learning_notification_emails email
         where email.id = $1
         on conflict (profile_id, category) do update set email_enabled = false, updated_at = now()
         returning profile_id`,
        [token],
      )
      return rows.length > 0
    },
  }
}

function errorText(error: unknown) {
  if (error instanceof ResendApiError) return `${error.code}: ${error.message}`.slice(0, 500)
  return error instanceof Error ? error.message.slice(0, 500) : 'unknown_error'
}

export function createLearningEmailWorker(input: {
  repository?: ReturnType<typeof createLearningEmailRepository>
  resend?: Sender | null
  loadApiKey?: () => Promise<string | null>
  siteUrl?: string
} = {}) {
  const repository = input.repository ?? createLearningEmailRepository()
  let client: Sender | null | undefined = input.resend

  async function resolveClient() {
    if (client !== undefined) return client
    const key = await (input.loadApiKey ?? loadResendApiKey)()
    client = key ? createResendEmailClient({ apiKey: key }) : null
    return client
  }

  async function sendOne(delivery: LearningEmailDelivery, sender: Sender) {
    if (!delivery.emailEnabled) {
      await repository.markSkipped(delivery.id, 'learning_emails_off')
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
    const email = learningEmail({ emailId: delivery.id, kind: delivery.kind, details: delivery.details, siteUrl: input.siteUrl })
    try {
      const result = await sender.sendEmail({
        from: LEARNING_EMAIL_FROM,
        to: delivery.email,
        subject: email.subject,
        text: email.text,
        html: email.html,
        headers: email.headers,
        idempotencyKey: `learning-notification/${delivery.id}`,
        tags: [{ name: 'category', value: `learning_${delivery.kind}` }],
      })
      await repository.markSent(delivery.id, result.messageId)
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
          // Rate limit or provider trouble: leave the rest of the batch for the next sweep.
          break
        }
      }
      return { claimed: deliveries.length, ...counts, disabled: false }
    },
  }
}

/** The hourly digests: released materials (learners) and submissions to grade (trainers). */
export function createLearningDigestSweep(input: { transaction?: Transaction; now?: () => Date } = {}) {
  const transaction = input.transaction ?? runtimeTransaction
  return {
    async run() {
      const now = input.now?.() ?? new Date()
      const released = await sweepReleasedLessons(transaction, { now })
      const submissions = await sweepSubmissionsToGrade(transaction, { now })
      // Learning round B: timed quiz attempts whose time ran out while the learner was away.
      const quizSessions = await finalizeExpiredQuizSessions(transaction)
      // Learning round B: certificate renewal reminders, 30 and 7 days before expiry.
      const expiring = await sweepExpiringCertificates(transaction, { now })
      return {
        releasedNoticed: released.noticed,
        releasedNotified: released.notified,
        submissions: submissions.submissions,
        trainersNotified: submissions.notified,
        expiredQuizAttempts: quizSessions.finalized,
        certificateReminders: expiring.notified,
      }
    },
  }
}
