import type { QueryResultRow } from 'pg'
import { query as databaseQuery, withTransaction as databaseTransaction, type DatabaseQueryClient } from '@/lib/db/client'
import { createResendEmailClient, loadResendApiKey, ResendApiError, type ResendEmailClient } from '@/lib/email/resend'
import { withEmailSuppression } from '@/lib/email/suppression'
import { ORGANIZATION_REVIEW_EMAIL_FROM, organizationReviewSiteUrl, renderOrganizationReviewEmail } from './organization-review-email'
import { isOrganizationReviewNoticeDecision, type OrganizationReviewNoticeDetails } from './organization-review-notice'

/**
 * Round GP (Global Partners), Part C: sends the queued organization review emails
 * (public.organization_review_emails) from the outbox worker, through the Resend client with suppression, like every
 * other queued email. One email per queue row, at most once: the Resend idempotency key is the row id and a sent row
 * is never claimed again. The address is the applicant's verified sign-in email; without one the row is skipped. Rows
 * older than seven days are skipped rather than sent late. Logs carry counts only.
 */
type Query = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>
type Transaction = <T>(work: (query: Query) => Promise<T>) => Promise<T>
type Sender = Pick<ResendEmailClient, 'sendEmail'>

const MAX_ATTEMPTS = 5
const STALE_AFTER_HOURS = 7 * 24

export type OrganizationReviewEmailDelivery = {
  id: string
  details: OrganizationReviewNoticeDetails
  email: string | null
  stale: boolean
}

function runtimeTransaction<T>(work: (query: Query) => Promise<T>) {
  return databaseTransaction((client: DatabaseQueryClient) => work(async (text, values) => (await client.query(text, values ? [...values] : undefined)).rows))
}

function parseDetails(decision: unknown, payload: unknown): OrganizationReviewNoticeDetails | null {
  const value = typeof payload === 'string' ? JSON.parse(payload) as unknown : payload
  if (!isOrganizationReviewNoticeDecision(decision) || !value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  return {
    decision,
    companyName: typeof record.companyName === 'string' ? record.companyName : '',
    companySlug: typeof record.companySlug === 'string' ? record.companySlug : '',
    reason: typeof record.reason === 'string' ? record.reason : null,
  }
}

export function createOrganizationReviewEmailRepository(input: { query?: Query; transaction?: Transaction } = {}) {
  const queryRows: Query = input.query ?? ((text, values) => databaseQuery<QueryResultRow>(text, values))
  const transaction = input.transaction ?? runtimeTransaction

  return {
    /** Claims due emails with a 15-minute lease, so a crashed send is retried and never doubled. */
    async claimBatch(limit = 10): Promise<OrganizationReviewEmailDelivery[]> {
      const bounded = Math.max(1, Math.min(25, Math.floor(limit)))
      return transaction(async (query) => {
        const rows = await query(
          `with picked as (
             select email.id
             from public.organization_review_emails email
             where email.status = 'pending'
               and email.next_attempt_at <= now()
               and email.attempts < $2
             order by email.next_attempt_at asc, email.id asc
             for update skip locked
             limit $1
           )
           update public.organization_review_emails email
           set attempts = email.attempts + 1,
               next_attempt_at = now() + interval '15 minutes'
           from picked
           where email.id = picked.id
           returning
             email.id, email.decision, email.payload,
             (select lower(account.email)
              from public.identity_accounts account
              where account.profile_id = email.recipient_id
                and account.email_verified = true
                and account.email is not null
              order by account.created_at asc, account.id asc
              limit 1) as email,
             email.created_at < now() - make_interval(hours => $3::int) as stale`,
          [bounded, MAX_ATTEMPTS, STALE_AFTER_HOURS],
        )
        return rows.flatMap((row): OrganizationReviewEmailDelivery[] => {
          let details: OrganizationReviewNoticeDetails | null = null
          try {
            details = parseDetails(row.decision, row.payload)
          } catch {
            details = null
          }
          if (!details) return []
          return [{ id: String(row.id), details, email: typeof row.email === 'string' ? row.email : null, stale: row.stale === true }]
        })
      })
    },

    async markSent(id: string, messageId: string) {
      await queryRows(
        `update public.organization_review_emails
         set status = 'sent', sent_at = now(), last_error = null,
             payload = payload || jsonb_build_object('messageId', $2::text)
         where id = $1`,
        [id, messageId],
      )
    },

    async markSkipped(id: string, reason: string) {
      await queryRows(`update public.organization_review_emails set status = 'skipped', last_error = left($2, 500) where id = $1`, [id, reason])
    },

    async markFailed(id: string, error: string, retryable: boolean) {
      await queryRows(
        `update public.organization_review_emails
         set status = case when $3 and attempts < $4 then 'pending' else 'failed' end,
             last_error = left($2, 500),
             next_attempt_at = case when $3 and attempts < $4 then now() + make_interval(mins => greatest(5, attempts * 10)) else next_attempt_at end
         where id = $1`,
        [id, error, retryable, MAX_ATTEMPTS],
      )
    },

    async tableReady() {
      const rows = await queryRows(`select to_regclass('public.organization_review_emails') is not null as ready`)
      return rows[0]?.ready === true
    },
  }
}

function errorText(error: unknown) {
  if (error instanceof ResendApiError) return `${error.code}: ${error.message}`.slice(0, 500)
  return error instanceof Error ? error.message.slice(0, 500) : 'unknown_error'
}

export function createOrganizationReviewEmailWorker(input: {
  repository?: ReturnType<typeof createOrganizationReviewEmailRepository>
  resend?: Sender | null
  loadApiKey?: () => Promise<string | null>
  siteUrl?: string | null
} = {}) {
  const repository = input.repository ?? createOrganizationReviewEmailRepository()
  const siteUrl = input.siteUrl === undefined ? organizationReviewSiteUrl() : input.siteUrl
  let client: Sender | null | undefined = input.resend

  async function resolveClient() {
    if (client !== undefined) return client
    const key = await (input.loadApiKey ?? loadResendApiKey)()
    client = key ? withEmailSuppression(createResendEmailClient({ apiKey: key })) : null
    return client
  }

  async function sendOne(delivery: OrganizationReviewEmailDelivery, sender: Sender, site: string) {
    if (delivery.stale) {
      await repository.markSkipped(delivery.id, 'stale')
      return 'skipped' as const
    }
    if (!delivery.email) {
      await repository.markSkipped(delivery.id, 'no_verified_email')
      return 'skipped' as const
    }
    const email = renderOrganizationReviewEmail({ details: delivery.details, siteUrl: site })
    try {
      const result = await sender.sendEmail({
        from: ORGANIZATION_REVIEW_EMAIL_FROM,
        to: delivery.email,
        subject: email.subject,
        text: email.text,
        html: email.html,
        idempotencyKey: `organization-review-email/${delivery.id}`,
        tags: [{ name: 'category', value: `organization_review_${delivery.details.decision}` }],
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
      // No Resend key, or no site address to link to: nothing is claimed, rows wait.
      if (!sender || !siteUrl) return { claimed: 0, sent: 0, failed: 0, skipped: 0, retrying: 0, disabled: true }
      const deliveries = await repository.claimBatch(limit)
      const counts = { sent: 0, failed: 0, skipped: 0, retrying: 0 }
      for (const delivery of deliveries) {
        const result = await sendOne(delivery, sender, siteUrl)
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
 * The outbox worker's sweep: every minute, at most 10 emails a pass. Until migration 0110 is applied the queue table
 * is missing and the sweep waits quietly (checked again every 10 minutes).
 */
export function createOrganizationReviewEmailSweep(input: {
  worker?: ReturnType<typeof createOrganizationReviewEmailWorker>
  repository?: ReturnType<typeof createOrganizationReviewEmailRepository>
  now?: () => number
} = {}) {
  const repository = input.repository ?? createOrganizationReviewEmailRepository()
  const worker = input.worker ?? createOrganizationReviewEmailWorker({ repository })
  const now = input.now ?? Date.now
  let ready = false
  let checkedAt = -Infinity

  return {
    name: 'organization_review_emails',
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
