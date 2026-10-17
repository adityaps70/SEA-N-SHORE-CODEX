import type { QueryResultRow } from 'pg'
import { query as databaseQuery, withTransaction as databaseTransaction, type DatabaseQueryClient } from '@/lib/db/client'
import { createResendEmailClient, loadResendApiKey, ResendApiError, type ResendEmailClient } from '@/lib/email/resend'
import { withEmailSuppression } from '@/lib/email/suppression'
import { renderSupportEmail, SUPPORT_EMAIL_FROM, SUPPORT_EMAIL_KINDS, supportSiteUrl, type SupportEmailKind } from './support-email'

/**
 * Round H (H7): sends the queued ticket emails (public.support_ticket_emails) from the outbox worker,
 * through the Resend client with suppression, like every other queued email. One email per queue row,
 * at most once: the Resend idempotency key is the row id and a sent row is never claimed again. Rows
 * older than seven days are skipped rather than sent late. Logs carry counts only.
 */
type Query = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>
type Transaction = <T>(work: (query: Query) => Promise<T>) => Promise<T>
type Sender = Pick<ResendEmailClient, 'sendEmail'>

const MAX_ATTEMPTS = 5
const STALE_AFTER_HOURS = 7 * 24

export type SupportEmailDelivery = {
  id: string
  ticketId: string
  kind: SupportEmailKind
  topic: string
  senderName: string
  senderEmail: string
  signedIn: boolean
  body: string | null
  stale: boolean
}

function runtimeTransaction<T>(work: (query: Query) => Promise<T>) {
  return databaseTransaction((client: DatabaseQueryClient) => work(async (text, values) => (await client.query(text, values ? [...values] : undefined)).rows))
}

function isKind(value: unknown): value is SupportEmailKind {
  return (SUPPORT_EMAIL_KINDS as readonly unknown[]).includes(value)
}

export function createSupportEmailRepository(input: { query?: Query; transaction?: Transaction } = {}) {
  const queryRows: Query = input.query ?? ((text, values) => databaseQuery<QueryResultRow>(text, values))
  const transaction = input.transaction ?? runtimeTransaction

  return {
    /** Claims due emails with a 15-minute lease, so a crashed send is retried and never doubled. */
    async claimBatch(limit = 10): Promise<SupportEmailDelivery[]> {
      const bounded = Math.max(1, Math.min(25, Math.floor(limit)))
      return transaction(async (query) => {
        const rows = await query(
          `with picked as (
             select email.id
             from public.support_ticket_emails email
             where email.status = 'pending'
               and email.next_attempt_at <= now()
               and email.attempts < $2
             order by email.next_attempt_at asc, email.id asc
             for update skip locked
             limit $1
           )
           update public.support_ticket_emails email
           set attempts = email.attempts + 1,
               next_attempt_at = now() + interval '15 minutes'
           from picked
           where email.id = picked.id
           returning
             email.id, email.ticket_id, email.kind,
             (select t.topic from public.support_tickets t where t.id = email.ticket_id) as topic,
             (select t.sender_name from public.support_tickets t where t.id = email.ticket_id) as sender_name,
             (select t.sender_email from public.support_tickets t where t.id = email.ticket_id) as sender_email,
             (select t.sender_profile_id is not null from public.support_tickets t where t.id = email.ticket_id) as signed_in,
             (select m.body from public.support_ticket_messages m where m.id = email.message_id) as body,
             email.created_at < now() - make_interval(hours => $3::int) as stale`,
          [bounded, MAX_ATTEMPTS, STALE_AFTER_HOURS],
        )
        return rows.flatMap((row): SupportEmailDelivery[] => (isKind(row.kind)
          ? [{
              id: String(row.id),
              ticketId: String(row.ticket_id),
              kind: row.kind,
              topic: String(row.topic ?? 'other'),
              senderName: String(row.sender_name ?? ''),
              senderEmail: String(row.sender_email ?? ''),
              signedIn: row.signed_in === true,
              body: typeof row.body === 'string' ? row.body : null,
              stale: row.stale === true,
            }]
          : []))
      })
    },

    async markSent(id: string, messageId: string) {
      await queryRows(
        `update public.support_ticket_emails set status = 'sent', sent_at = now(), last_error = left($2, 500) where id = $1`,
        [id, `resend:${messageId}`],
      )
    },

    async markSkipped(id: string, reason: string) {
      await queryRows(`update public.support_ticket_emails set status = 'skipped', last_error = left($2, 500) where id = $1`, [id, reason])
    },

    async markFailed(id: string, error: string, retryable: boolean) {
      await queryRows(
        `update public.support_ticket_emails
         set status = case when $3 and attempts < $4 then 'pending' else 'failed' end,
             last_error = left($2, 500),
             next_attempt_at = case when $3 and attempts < $4 then now() + make_interval(mins => greatest(5, attempts * 10)) else next_attempt_at end
         where id = $1`,
        [id, error, retryable, MAX_ATTEMPTS],
      )
    },

    async tableReady() {
      const rows = await queryRows(`select to_regclass('public.support_ticket_emails') is not null as ready`)
      return rows[0]?.ready === true
    },
  }
}

function errorText(error: unknown) {
  if (error instanceof ResendApiError) return `${error.code}: ${error.message}`.slice(0, 500)
  return error instanceof Error ? error.message.slice(0, 500) : 'unknown_error'
}

export function createSupportEmailWorker(input: {
  repository?: ReturnType<typeof createSupportEmailRepository>
  resend?: Sender | null
  loadApiKey?: () => Promise<string | null>
  siteUrl?: string
} = {}) {
  const repository = input.repository ?? createSupportEmailRepository()
  const siteUrl = supportSiteUrl(input.siteUrl)
  let client: Sender | null | undefined = input.resend

  async function resolveClient() {
    if (client !== undefined) return client
    const key = await (input.loadApiKey ?? loadResendApiKey)()
    client = key ? withEmailSuppression(createResendEmailClient({ apiKey: key })) : null
    return client
  }

  async function sendOne(delivery: SupportEmailDelivery, sender: Sender) {
    if (delivery.stale) {
      await repository.markSkipped(delivery.id, 'stale')
      return 'skipped' as const
    }
    if (!delivery.body) {
      await repository.markSkipped(delivery.id, 'message_missing')
      return 'skipped' as const
    }
    const email = renderSupportEmail({
      kind: delivery.kind,
      ticketId: delivery.ticketId,
      topic: delivery.topic,
      senderName: delivery.senderName,
      senderEmail: delivery.senderEmail,
      signedIn: delivery.signedIn,
      body: delivery.body,
      siteUrl,
    })
    if (!email.to) {
      await repository.markSkipped(delivery.id, 'no_recipient')
      return 'skipped' as const
    }
    try {
      const result = await sender.sendEmail({
        from: SUPPORT_EMAIL_FROM,
        to: email.to,
        subject: email.subject,
        text: email.text,
        html: email.html,
        ...(email.replyTo ? { replyTo: email.replyTo } : {}),
        idempotencyKey: `support-ticket-email/${delivery.id}`,
        tags: [{ name: 'category', value: `support_${delivery.kind}` }],
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
          break
        }
      }
      return { claimed: deliveries.length, ...counts, disabled: false }
    },
  }
}

/**
 * The outbox worker's sweep: every minute, at most 10 emails a pass. Until migration 0089 is applied the
 * queue table is missing and the sweep waits quietly (checked again every 10 minutes).
 */
export function createSupportEmailSweep(input: {
  worker?: ReturnType<typeof createSupportEmailWorker>
  repository?: ReturnType<typeof createSupportEmailRepository>
  now?: () => number
} = {}) {
  const repository = input.repository ?? createSupportEmailRepository()
  const worker = input.worker ?? createSupportEmailWorker({ repository })
  const now = input.now ?? Date.now
  let ready = false
  let checkedAt = -Infinity

  return {
    name: 'support_ticket_emails',
    everyMs: 60_000,
    async run() {
      if (!ready) {
        if (now() - checkedAt < 10 * 60 * 1000) return undefined
        checkedAt = now()
        ready = await repository.tableReady().catch(() => false)
        if (!ready) return undefined
      }
      const result = await worker.runSweep(10)
      return result.claimed ? result : undefined
    },
  }
}
