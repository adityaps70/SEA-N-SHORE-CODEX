import { randomUUID } from 'node:crypto'
import type { QueryResultRow } from 'pg'
import { query as databaseQuery, withTransaction, type DatabaseQueryClient } from '@/lib/db/client'
import { createResendEmailClient, loadResendApiKey, ResendApiError, type ResendEmailClient } from '@/lib/email/resend'
import { normalizeEmail, withEmailSuppression } from '@/lib/email/suppression'
import { LEGACY_INVITE_FROM } from './email'
import { legacyReminderTestEmail } from './reminder-email'

type Query = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>
type Transaction = <T>(work: (query: Query) => Promise<T>) => Promise<T>
type Sender = Pick<ResendEmailClient, 'sendEmail'>

/** At most this many test sends per admin per rolling hour, counted from the admin's own audit rows. */
export const LEGACY_REMINDER_TESTS_PER_HOUR = 5
/** Resend tag on test sends. The webhook never puts a recipient of a test on the do-not-email list (TEST_SEND_CATEGORIES). */
export const LEGACY_REMINDER_TEST_CATEGORY = 'legacy_profile_reminder_test'

export const LEGACY_REMINDER_TEST_AUDIT = {
  requested: 'legacy_reminder.test_requested',
  sent: 'legacy_reminder.test_sent',
  failed: 'legacy_reminder.test_failed',
  refused: 'legacy_reminder.test_refused',
} as const

type TestEmail = { subject: string; text: string; html: string; headers: Array<{ Name: string; Value: string }> }

/**
 * Which email a test is of. The default is the second reminder; the final reminder has its own audit actions,
 * Resend tag, hourly count and lock, and builds its email with live counts.
 */
export type LegacyTestVariant = {
  audit: { requested: string; sent: string; failed: string; refused: string }
  category: string
  targetType: string
  keyPrefix: string
  lockPrefix: string
  render: (siteUrl?: string) => TestEmail | Promise<TestEmail>
}

export const LEGACY_REMINDER_TEST_VARIANT: LegacyTestVariant = {
  audit: LEGACY_REMINDER_TEST_AUDIT,
  category: LEGACY_REMINDER_TEST_CATEGORY,
  targetType: 'legacy_reminder_test',
  keyPrefix: 'legacy-profile-reminder-test',
  lockPrefix: 'legacy-reminder-test',
  render: (siteUrl) => legacyReminderTestEmail({ siteUrl }),
}

export type LegacyReminderTestResult =
  | { status: 'sent'; to: string }
  | { status: 'no_verified_email' | 'rate_limited' | 'unavailable' }
  | { status: 'failed'; to: string }

function errorText(error: unknown) {
  if (error instanceof ResendApiError) return `${error.code}: ${error.message}`.slice(0, 500)
  return error instanceof Error ? error.message.slice(0, 500) : 'unknown_error'
}

function clientQuery(client: DatabaseQueryClient): Query {
  return async (text, values) => (await client.query(text, values ? [...values] : undefined)).rows
}

function defaultTransaction(): Transaction {
  return (work) => withTransaction((client) => work(clientQuery(client)))
}

/**
 * "Send test to me" for the second reminder. The only recipient is the signed-in admin's own sign-in email, and only
 * when it is verified; there is no recipient input. The email is the exact reminder with sample details and links
 * that change nothing. It never touches the reminder or invitation tables, so it is not a reminder and does not
 * change anyone's eligibility or the queue. Every request is in the audit log, at most 5 an hour per admin.
 */
export function createLegacyReminderTestSender(input: {
  query?: Query
  transaction?: Transaction
  resend?: Sender | null
  loadApiKey?: () => Promise<string | null>
  siteUrl?: string
  variant?: LegacyTestVariant
} = {}) {
  const variant = input.variant ?? LEGACY_REMINDER_TEST_VARIANT
  const query: Query = input.query ?? ((text, values) => databaseQuery(text, values))
  const transaction = input.transaction ?? defaultTransaction()
  let client: Sender | null | undefined = input.resend

  async function resolveClient() {
    if (client !== undefined) return client
    const key = await (input.loadApiKey ?? loadResendApiKey)()
    client = key ? withEmailSuppression(createResendEmailClient({ apiKey: key })) : null
    return client
  }

  /** The admin's sign-in email, if the admin's own identity has it verified. */
  async function verifiedEmail(adminId: string, signInEmail: string | null) {
    const email = normalizeEmail(signInEmail)
    if (!email) return null
    const rows = await query(
      `select 1 from public.identity_accounts
        where profile_id = $1::uuid and lower(email) = $2 and email_verified = true
        limit 1`,
      [adminId, email],
    )
    return rows.length ? email : null
  }

  async function audit(run: Query, adminId: string, action: string, testId: string, metadata: Record<string, unknown>) {
    await run(
      `insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
       values ($1::uuid, $2, $5, $3, $4::jsonb)`,
      [adminId, action, testId, JSON.stringify(metadata), variant.targetType],
    )
  }

  return {
    async send(admin: { id: string; email: string | null }): Promise<LegacyReminderTestResult> {
      const testId = randomUUID()
      // A refusal is audited too; only requests that went ahead count toward the hourly limit.
      const refuse = async (status: 'no_verified_email' | 'rate_limited' | 'unavailable') => {
        await audit(query, admin.id, variant.audit.refused, testId, { reason: status })
        return { status }
      }
      const to = await verifiedEmail(admin.id, admin.email)
      if (!to) return refuse('no_verified_email')
      const sender = await resolveClient()
      if (!sender) return refuse('unavailable')

      // The lock serialises one admin's requests, so two clicks at once cannot both pass the count.
      const allowed = await transaction(async (run) => {
        await run(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, [`${variant.lockPrefix}:${admin.id}`])
        const rows = await run(
          `select count(*)::int as count from public.audit_events
            where actor_id = $1::uuid and action = $2 and created_at > now() - interval '1 hour'`,
          [admin.id, variant.audit.requested],
        )
        if (Number(rows[0]?.count ?? 0) >= LEGACY_REMINDER_TESTS_PER_HOUR) return false
        await audit(run, admin.id, variant.audit.requested, testId, { to })
        return true
      })
      if (!allowed) return refuse('rate_limited')

      try {
        const email = await variant.render(input.siteUrl)
        const result = await sender.sendEmail({
          from: LEGACY_INVITE_FROM,
          to,
          subject: email.subject,
          text: email.text,
          html: email.html,
          headers: email.headers,
          idempotencyKey: `${variant.keyPrefix}/${testId}`,
          tags: [{ name: 'category', value: variant.category }],
        })
        await audit(query, admin.id, variant.audit.sent, testId, { to, resendEmailId: result.messageId })
        return { status: 'sent', to }
      } catch (error) {
        await audit(query, admin.id, variant.audit.failed, testId, { to, error: errorText(error) })
        return { status: 'failed', to }
      }
    },
  }
}

export const legacyReminderTestSender = createLegacyReminderTestSender()
