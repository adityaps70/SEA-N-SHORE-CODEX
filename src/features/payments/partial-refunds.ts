import type { QueryResultRow } from 'pg'
import type { DatabaseQueryClient } from '@/lib/db/client'

/**
 * Refunds of part of a payment (made in the Cashfree dashboard, or by Cashfree support). The buyer keeps access and
 * the order stays paid; only that amount is taken back from the seller. Each one is written to the payment audit
 * trail with its amount and Cashfree's refund id, which is how later refunds of the same order know what is left.
 */

export const PARTIAL_REFUND_PROCESSED = 'partial_refund_processed'
export const PARTIAL_REFUND_PENDING = 'partial_refund_pending'

export type PartialRefunds = {
  /** Processed partial refunds so far, counted once per Cashfree refund id. */
  refundedMinor: number
  processedRefundIds: ReadonlySet<string>
  pendingRefundIds: ReadonlySet<string>
}

export async function readPartialRefunds(client: DatabaseQueryClient, subjectType: string, subjectId: string): Promise<PartialRefunds> {
  const result = await client.query<QueryResultRow & { action: string; provider_reference: string | null; amount_minor: string | number | null }>(`
    select audit.action, audit.provider_reference, audit.amount_minor
    from public.payment_audit_events audit
    where audit.subject_type = $1::text and audit.subject_id = $2::text and audit.action in ($3::text, $4::text)
  `, [subjectType, subjectId, PARTIAL_REFUND_PROCESSED, PARTIAL_REFUND_PENDING])
  const processed = new Map<string, number>()
  const pending = new Set<string>()
  for (const row of result.rows) {
    if (!row.provider_reference) continue
    if (row.action === PARTIAL_REFUND_PENDING) pending.add(row.provider_reference)
    else if (!processed.has(row.provider_reference)) processed.set(row.provider_reference, Math.max(0, Number(row.amount_minor ?? 0)))
  }
  let refundedMinor = 0
  for (const amount of processed.values()) refundedMinor += amount
  return { refundedMinor, processedRefundIds: new Set(processed.keys()), pendingRefundIds: pending }
}

/**
 * Whether a refund Cashfree reports is a partial one: less than what is still paid on the order. A refund without an
 * amount, or one for everything that is left, is a full refund (it ends access once processed).
 */
export function isPartialRefund(input: { orderAmountMinor: number; refundedMinor: number; refundAmountMinor: number | null | undefined }) {
  const left = input.orderAmountMinor - input.refundedMinor
  const amount = input.refundAmountMinor
  return typeof amount === 'number' && Number.isFinite(amount) && amount > 0 && amount < left
}
