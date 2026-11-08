import type { QueryResultRow } from 'pg'
import { query as databaseQuery } from '@/lib/db/client'
import { ResendApiError } from './resend'

/**
 * The do-not-email list (public.email_suppressions). An address lands here after a hard bounce, a complaint, a
 * "suppressed" event or Resend's own suppression list, or when the person unsubscribes from the legacy reminder.
 * Every Resend and SES sender is wrapped with `withEmailSuppression`, so nothing more is emailed to it. Sign-up and
 * password-reset codes (Cognito's sender Lambda) are not wrapped: the person asked for them, and refusing them would
 * lock the person out of their own account.
 */

export type SuppressionReason = 'hard_bounce' | 'complaint' | 'provider_suppressed' | 'unsubscribed'
export type SuppressionSource = 'resend_webhook' | 'resend_backfill' | 'resend_suppression_list' | 'legacy_reminder_unsubscribe'

type Query = <T extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]) => Promise<T[]>

export function normalizeEmail(value: unknown) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return email.length >= 3 && email.length <= 320 && email.includes('@') ? email : null
}

export function createEmailSuppressions(input: { query?: Query } = {}) {
  const queryRows: Query = input.query ?? ((text, values) => databaseQuery(text, values))

  return {
    async isSuppressed(email: string) {
      const normalized = normalizeEmail(email)
      if (!normalized) return false
      const rows = await queryRows(`select 1 as found from public.email_suppressions where email = $1`, [normalized])
      return rows.length > 0
    },

    /** Adds the address once; the first reason is kept. True when it was newly added. */
    async add(entry: { email: string; reason: SuppressionReason; source: SuppressionSource; resendEmailId?: string | null }) {
      const email = normalizeEmail(entry.email)
      if (!email) return false
      const rows = await queryRows(
        `insert into public.email_suppressions (email, reason, source, resend_email_id)
         values ($1, $2, $3, $4)
         on conflict (email) do nothing
         returning email`,
        [email, entry.reason, entry.source, entry.resendEmailId?.slice(0, 100) || null],
      )
      return rows.length > 0
    },
  }
}

export const emailSuppressions = createEmailSuppressions()

/** The error a wrapped sender throws for a do-not-email address. Not retryable, so queues mark the row failed. */
export function recipientSuppressedError() {
  return new ResendApiError('recipient_do_not_email', 422, 'The recipient is on the do-not-email list')
}

// RFC 2606 / 6761 reserved names can never receive mail, and sending there only bounces and hurts the sender's
// reputation. The load-test accounts (Round ARCH) and the staging E2E users use them; Cognito's sender Lambda has the
// same rule (infra/aws/app/lambda/cognito-resend-email-sender.mjs).
const RESERVED_DOMAINS = ['example.com', 'example.net', 'example.org']
const RESERVED_TLDS = new Set(['test', 'example', 'invalid', 'localhost'])

/** True for an address on a reserved domain (example.com, *.invalid, ...), which can never receive mail. */
export function isReservedRecipient(email: string) {
  const domain = (normalizeEmail(email) ?? '').split('@').pop() ?? ''
  if (!domain) return false
  if (RESERVED_TLDS.has(domain.split('.').at(-1) ?? '')) return true
  return RESERVED_DOMAINS.some((reserved) => domain === reserved || domain.endsWith(`.${reserved}`))
}

type SendsTo = { sendEmail(input: { to: string }): Promise<unknown> }

/**
 * Wraps a Resend sender so a do-not-email recipient, or a reserved address that can never receive mail, is refused
 * before anything reaches Resend.
 */
export function withEmailSuppression<C extends SendsTo>(client: C, isSuppressed: (email: string) => Promise<boolean> = (email) => emailSuppressions.isSuppressed(email)): C {
  return {
    ...client,
    async sendEmail(input: { to: string }) {
      if (isReservedRecipient(input.to) || await isSuppressed(input.to)) throw recipientSuppressedError()
      return client.sendEmail(input)
    },
  } as C
}
