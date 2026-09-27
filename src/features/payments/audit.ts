import type { DatabaseQueryClient } from '@/lib/db/client'

/**
 * Append-only trail of money state changes (public.payment_audit_events, migration 0046).
 * Always call it with the same transaction client that makes the change, so the
 * change and its audit row commit or roll back together.
 * Never put secrets, card data or full bank account numbers in `details`.
 */

export type PaymentAuditActorType = 'system' | 'member' | 'organizer' | 'admin' | 'provider'

export type PaymentAuditEntry = {
  actorType: PaymentAuditActorType
  actorProfileId?: string | null
  /** e.g. 'event_payment_order', 'seller_earning', 'platform_fee_settings', 'course_order' */
  subjectType: string
  subjectId: string
  /** e.g. 'checkout_created', 'paid', 'refund_due', 'refund_requested', 'refunded', 'earning_recorded' */
  action: string
  fromStatus?: string | null
  toStatus?: string | null
  amountMinor?: number | null
  currency?: string | null
  provider?: string | null
  providerReference?: string | null
  details?: Record<string, unknown>
}

export async function recordPaymentAudit(client: DatabaseQueryClient, entry: PaymentAuditEntry) {
  await client.query(`
    insert into public.payment_audit_events (
      actor_type, actor_profile_id, subject_type, subject_id, action, from_status, to_status,
      amount_minor, currency, provider, provider_reference, details
    )
    values ($1::text, $2::uuid, $3::text, $4::text, $5::text, $6::text, $7::text, $8::bigint, $9::text, $10::text, $11::text, $12::jsonb)
  `, [
    entry.actorType,
    entry.actorProfileId ?? null,
    entry.subjectType.slice(0, 60),
    entry.subjectId.slice(0, 200),
    entry.action.slice(0, 80),
    entry.fromStatus ?? null,
    entry.toStatus ?? null,
    entry.amountMinor ?? null,
    entry.currency ?? null,
    entry.provider ?? null,
    entry.providerReference?.slice(0, 200) ?? null,
    JSON.stringify(entry.details ?? {}),
  ])
}
