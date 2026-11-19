import type { QueryResultRow } from 'pg'

/**
 * Round GP (Global Partners), Part C: when Sea N Shore (a platform administrator or a country admin) approves,
 * rejects or asks for changes to an organization's verification, the member who applied gets an in-app notification
 * and one email (public.organization_review_emails, sent by the outbox worker). A rejection or a request for changes
 * carries the reviewer's reason.
 *
 * Written inside the review's own transaction behind a savepoint: if the notice cannot be written (for example before
 * migrations 0109 / 0110 are applied) it is dropped and logged with its error code only, and the decision still
 * commits. Each decision notifies once: the dedupe key is the application and the moment it was decided.
 */
type Query = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>

export const ORGANIZATION_REVIEW_NOTICE_DECISIONS = ['approved', 'rejected', 'changes_requested'] as const
export type OrganizationReviewNoticeDecision = (typeof ORGANIZATION_REVIEW_NOTICE_DECISIONS)[number]

export type OrganizationReviewNoticeDetails = {
  decision: OrganizationReviewNoticeDecision
  companyName: string
  companySlug: string
  /** The reviewer's reason (rejected / changes requested); null for an approval. */
  reason: string | null
}

export function isOrganizationReviewNoticeDecision(value: unknown): value is OrganizationReviewNoticeDecision {
  return (ORGANIZATION_REVIEW_NOTICE_DECISIONS as readonly unknown[]).includes(value)
}

function errorCode(error: unknown) {
  return error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code) : 'unknown'
}

export async function queueOrganizationReviewNotice(query: Query, input: {
  applicationId: string
  companyId: string
  recipientId: string
  decision: OrganizationReviewNoticeDecision
  reason: string | null
  companyName: string
  companySlug: string
  decidedAt: string | Date
}): Promise<boolean> {
  const decidedAt = input.decidedAt instanceof Date ? input.decidedAt.toISOString() : String(input.decidedAt)
  const dedupeKey = `organization_review:${input.applicationId}:${decidedAt}`
  const details: OrganizationReviewNoticeDetails = {
    decision: input.decision,
    companyName: input.companyName,
    companySlug: input.companySlug,
    reason: input.decision === 'approved' ? null : input.reason?.trim() || null,
  }
  try {
    await query('savepoint organization_review_notice')
  } catch {
    // Not inside a transaction (a test harness): the notice cannot be isolated, so it is not written.
    return false
  }
  try {
    await query(
      `insert into public.notifications (recipient_id, actor_id, notification_type, company_id, details, dedupe_key)
       values ($1, null, 'organization_review_decided'::public.network_notification_type, $2, $3::jsonb, $4)
       on conflict (recipient_id, dedupe_key) where dedupe_key is not null do nothing`,
      [input.recipientId, input.companyId, JSON.stringify(details), dedupeKey],
    )
    await query(
      `insert into public.organization_review_emails (dedupe_key, recipient_id, company_id, decision, payload)
       values ($1, $2, $3, $4, $5::jsonb)
       on conflict (dedupe_key) do nothing`,
      [dedupeKey, input.recipientId, input.companyId, input.decision, JSON.stringify(details)],
    )
    await query('release savepoint organization_review_notice')
    return true
  } catch (error) {
    await query('rollback to savepoint organization_review_notice').catch(() => undefined)
    // The decision is not affected. No names, emails or reasons in the log.
    console.warn('[organization_review_notice_skipped]', { decision: input.decision, code: errorCode(error) })
    return false
  }
}
