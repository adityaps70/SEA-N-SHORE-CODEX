import type { QueryResultRow } from 'pg'
import type { DatabaseQueryClient } from '@/lib/db/client'
import { recordPaymentAudit, type PaymentAuditActorType } from '@/features/payments/audit'
import { adjustSaleEarningPart } from '@/features/payments/earnings'
import type { PaymentCurrency } from '@/features/payments/types'
import { issueCreditNoteForOrder, withTaxSavepoint } from '@/features/tax/tax-document-repository'
import { loadTrainingCompany } from './company-access'
import { SEAT_REFUND_DAYS, SeatError } from './seat-rules'

/**
 * D3: refunds of a seat pack's unassigned seats (public.company_training_seat_refunds). Within 30 days of the purchase
 * a company can refund some or all of the seats nobody has been given. A pack is refunded once, because its invoice
 * takes one credit note. The chosen seats are held ("refund_pending") while the gateway is asked, then become
 * "refunded" with the credit note and the seller's earning adjusted in one transaction; a refused refund gives them back.
 *
 * Refunding every seat of a pack goes through the ordinary full order refund instead (course-payment-service.ts).
 */

export type SeatRefundStatus = 'requested' | 'pending' | 'processed' | 'failed'

export type SeatRefund = {
  id: string
  orderId: string
  companyId: string
  seatCount: number
  amountMinor: number
  currency: PaymentCurrency
  status: SeatRefundStatus
  attempts: number
  providerRefundId: string | null
  requestedAt: string
  creditNoteId: string | null
}

export type SeatRefundActor = { type: PaymentAuditActorType; profileId?: string | null }

type LockedPack = {
  id: string
  companyId: string
  status: string
  paidAt: Date
  amountMinor: number
  currency: PaymentCurrency
  provider: string
  providerOrderId: string | null
  providerPaymentId: string | null
  quantity: number
  unitMinor: number
  refundStatus: string | null
}

const REFUND_COLUMNS = `refund.id, refund.order_id, refund.company_id, refund.seat_count, refund.amount_minor, refund.currency,
  refund.status, refund.attempts, refund.provider_refund_id, refund.requested_at, refund.credit_note_id`

function mapRefund(row: QueryResultRow): SeatRefund {
  return {
    id: String(row.id),
    orderId: String(row.order_id),
    companyId: String(row.company_id),
    seatCount: Number(row.seat_count),
    amountMinor: Number(row.amount_minor),
    currency: row.currency === 'USD' ? 'USD' : 'INR',
    status: row.status as SeatRefundStatus,
    attempts: Number(row.attempts),
    providerRefundId: row.provider_refund_id ? String(row.provider_refund_id) : null,
    requestedAt: new Date(row.requested_at instanceof Date ? row.requested_at.getTime() : String(row.requested_at)).toISOString(),
    creditNoteId: row.credit_note_id ? String(row.credit_note_id) : null,
  }
}

function rowsOf(client: DatabaseQueryClient) {
  return async (text: string, values?: readonly unknown[]) => (await client.query(text, values ? [...values] : undefined)).rows
}

async function audit(client: DatabaseQueryClient, refund: SeatRefund, action: string, actor: SeatRefundActor, details: Record<string, unknown> = {}) {
  await recordPaymentAudit(client, {
    actorType: actor.type,
    actorProfileId: actor.profileId ?? null,
    subjectType: 'course_payment_order',
    subjectId: refund.orderId,
    action,
    amountMinor: refund.amountMinor,
    currency: refund.currency,
    details: { companyId: refund.companyId, seatRefundId: refund.id, seatCount: refund.seatCount, ...details },
  })
}

async function lockPack(client: DatabaseQueryClient, orderId: string, companyId: string): Promise<LockedPack> {
  const rows = await client.query<QueryResultRow>(
    `select o.id, o.seat_company_id, o.status, o.paid_at, o.amount_minor, o.currency, o.provider, o.provider_order_id,
            o.provider_payment_id, o.seat_quantity, o.seat_unit_price_minor, o.refund_status
     from public.course_payment_orders o
     where o.id = $1::uuid and o.seat_company_id = $2::uuid
     for update`,
    [orderId, companyId],
  )
  const row = rows.rows[0]
  if (!row || !row.paid_at) throw new SeatError('seat_pack_not_found')
  return {
    id: String(row.id),
    companyId: String(row.seat_company_id),
    status: String(row.status),
    paidAt: new Date(row.paid_at instanceof Date ? row.paid_at.getTime() : String(row.paid_at)),
    amountMinor: Number(row.amount_minor),
    currency: row.currency === 'USD' ? 'USD' : 'INR',
    provider: String(row.provider),
    providerOrderId: row.provider_order_id ? String(row.provider_order_id) : null,
    providerPaymentId: row.provider_payment_id ? String(row.provider_payment_id) : null,
    quantity: Number(row.seat_quantity),
    unitMinor: Number(row.seat_unit_price_minor),
    refundStatus: row.refund_status ? String(row.refund_status) : null,
  }
}

export type SeatRefundPlan =
  | { kind: 'whole_pack'; orderId: string }
  | { kind: 'seats'; refund: SeatRefund; providerOrderId: string; providerPaymentId: string }

/**
 * Checks a refund of `seats` unassigned seats and holds them. Refunding every seat of a pack with none assigned is the
 * whole order (returned as 'whole_pack' for the ordinary refund); otherwise the seats are held and the refund row is
 * written (or a refused one is tried again). Runs inside the caller's transaction.
 */
export async function requestSeatRefund(client: DatabaseQueryClient, input: {
  orderId: string
  companyId: string
  seats: number
  actor: SeatRefundActor & { profileId: string }
  platformAdmin?: boolean
  now?: Date
}): Promise<SeatRefundPlan> {
  const now = input.now ?? new Date()
  await loadTrainingCompany(rowsOf(client), { actorId: input.actor.profileId, platformAdmin: input.platformAdmin }, input.companyId, { manage: !input.platformAdmin })
  const pack = await lockPack(client, input.orderId, input.companyId)
  if (pack.status !== 'paid') throw new SeatError(pack.status === 'refunded' ? 'seat_refund_already_used' : 'seat_pack_not_found')
  if (!pack.providerOrderId || !pack.providerPaymentId) throw new SeatError('seat_pack_not_found')
  if (now.getTime() > pack.paidAt.getTime() + SEAT_REFUND_DAYS * 24 * 60 * 60 * 1000) throw new SeatError('seat_refund_window_closed')
  if (pack.refundStatus === 'requested' || pack.refundStatus === 'pending') throw new SeatError('seat_refund_in_progress')
  if (!Number.isInteger(input.seats) || input.seats < 1) throw new SeatError('seat_refund_none_available')

  const existing = await client.query<QueryResultRow>(`select ${REFUND_COLUMNS} from public.company_training_seat_refunds refund where refund.order_id = $1::uuid for update`, [pack.id])
  const previous = existing.rows[0] ? mapRefund(existing.rows[0]) : null
  if (previous && previous.status === 'requested') throw new SeatError('seat_refund_in_progress')
  if (previous && previous.status !== 'failed') throw new SeatError('seat_refund_already_used')
  if (previous && previous.attempts >= 20) throw new SeatError('seat_refund_already_used')

  const counts = await client.query<QueryResultRow>(
    `select count(*) filter (where status = 'available' and valid_until > $2::timestamptz)::int as available,
            count(*) filter (where status in ('assigned', 'refund_pending', 'refunded'))::int as used
     from public.company_training_seats where order_id = $1::uuid`,
    [pack.id, now.toISOString()],
  )
  const available = Number(counts.rows[0]?.available ?? 0)
  const used = Number(counts.rows[0]?.used ?? 0)
  if (available === 0) throw new SeatError('seat_refund_none_available')
  if (input.seats > available) throw new SeatError('seat_refund_too_many')
  if (!previous && used === 0 && input.seats === pack.quantity) return { kind: 'whole_pack', orderId: pack.id }

  const held = await client.query<QueryResultRow>(
    `update public.company_training_seats seat
     set status = 'refund_pending', updated_at = now()
     where seat.id in (
       select id from public.company_training_seats
       where order_id = $1::uuid and status = 'available' and valid_until > $2::timestamptz
       order by created_at asc, id asc
       limit $3
       for update
     )
     returning seat.id`,
    [pack.id, now.toISOString(), input.seats],
  )
  if (held.rows.length !== input.seats) throw new SeatError('seat_refund_too_many')
  const amountMinor = pack.unitMinor * input.seats
  const written = previous
    ? await client.query<QueryResultRow>(
        `update public.company_training_seat_refunds refund
         set seat_count = $2, amount_minor = $3, status = 'requested', attempts = refund.attempts + 1, requested_by = $4::uuid,
             requested_at = now(), last_error = null, updated_at = now()
         where refund.id = $1::uuid
         returning ${REFUND_COLUMNS}`,
        [previous.id, input.seats, amountMinor, input.actor.profileId],
      )
    : await client.query<QueryResultRow>(
        `insert into public.company_training_seat_refunds as refund (order_id, company_id, seat_count, amount_minor, currency, requested_by)
         values ($1::uuid, $2::uuid, $3, $4, $5, $6::uuid)
         returning ${REFUND_COLUMNS}`,
        [pack.id, pack.companyId, input.seats, amountMinor, pack.currency, input.actor.profileId],
      )
  const refund = mapRefund(written.rows[0]!)
  await audit(client, refund, 'seat_refund_requested', input.actor, { attempt: refund.attempts })
  return { kind: 'seats', refund, providerOrderId: pack.providerOrderId, providerPaymentId: pack.providerPaymentId }
}

/**
 * The gateway took the refund (pending or processed). The held seats become refunded, the credit note for their price
 * is issued against the pack's invoice, and that share of the seller's earning is taken back. Idempotent: a later
 * webhook only moves pending to processed.
 */
export async function completeSeatRefund(client: DatabaseQueryClient, input: { refundId: string; providerRefundId: string | null; status: 'pending' | 'processed'; actor?: SeatRefundActor }) {
  const actor = input.actor ?? { type: 'system' }
  const rows = await client.query<QueryResultRow>(`select ${REFUND_COLUMNS} from public.company_training_seat_refunds refund where refund.id = $1::uuid for update`, [input.refundId])
  const current = rows.rows[0] ? mapRefund(rows.rows[0]) : null
  if (!current) return null
  if (current.status === 'processed' || (current.status === 'pending' && input.status === 'pending')) return current
  if (current.status === 'pending' || (current.status === 'failed' && current.creditNoteId)) {
    const moved = await client.query<QueryResultRow>(
      `update public.company_training_seat_refunds refund
       set status = $2, provider_refund_id = coalesce($3, refund.provider_refund_id), updated_at = now()
       where refund.id = $1::uuid returning ${REFUND_COLUMNS}`,
      [current.id, input.status, input.providerRefundId],
    )
    const refund = mapRefund(moved.rows[0]!)
    await audit(client, refund, 'seat_refund_status_changed', actor, { fromStatus: current.status, toStatus: refund.status })
    return refund
  }

  await client.query(
    `update public.company_training_seats seat
     set status = 'refunded', refunded_at = now(), updated_at = now()
     where seat.order_id = $1::uuid and seat.status = 'refund_pending'`,
    [current.orderId],
  )
  const note = await withTaxSavepoint(client, 'credit_note', () => issueCreditNoteForOrder(client, current.orderId, {
    reason: `Refund of ${current.seatCount} unassigned ${current.seatCount === 1 ? 'seat' : 'seats'}`,
    amountMinor: current.amountMinor,
  }))
  const updated = await client.query<QueryResultRow>(
    `update public.company_training_seat_refunds refund
     set status = $2, provider_refund_id = coalesce($3, refund.provider_refund_id), credit_note_id = coalesce($4::uuid, refund.credit_note_id), updated_at = now()
     where refund.id = $1::uuid returning ${REFUND_COLUMNS}`,
    [current.id, input.status, input.providerRefundId, note?.id ?? null],
  )
  const refund = mapRefund(updated.rows[0]!)
  await adjustSaleEarningPart(client, {
    sourceType: 'course_purchase',
    sourceId: current.orderId,
    refundedGrossMinor: current.amountMinor,
    reason: 'company_seats_refunded',
    actor: { type: actor.type, profileId: actor.profileId ?? null },
  })
  await audit(client, refund, 'seat_refund_completed', actor, { refundStatus: refund.status, creditNoteId: refund.creditNoteId })
  return refund
}

/**
 * The gateway refused the refund. Seats that were only held go back to the pack; a refund the gateway had already
 * accepted (credit note issued) keeps its seats refunded and is marked failed so it can be sent again.
 */
export async function failSeatRefund(client: DatabaseQueryClient, input: { refundId: string; reason: string; providerRefundId?: string | null; actor?: SeatRefundActor }) {
  const actor = input.actor ?? { type: 'system' }
  const rows = await client.query<QueryResultRow>(`select ${REFUND_COLUMNS} from public.company_training_seat_refunds refund where refund.id = $1::uuid for update`, [input.refundId])
  const current = rows.rows[0] ? mapRefund(rows.rows[0]) : null
  if (!current || current.status === 'processed') return current
  if (!current.creditNoteId) {
    await client.query(
      `update public.company_training_seats seat
       set status = 'available', updated_at = now()
       where seat.order_id = $1::uuid and seat.status = 'refund_pending'`,
      [current.orderId],
    )
  }
  const updated = await client.query<QueryResultRow>(
    `update public.company_training_seat_refunds refund
     set status = 'failed', last_error = left($2::text, 300), provider_refund_id = coalesce($3, refund.provider_refund_id), updated_at = now()
     where refund.id = $1::uuid returning ${REFUND_COLUMNS}`,
    [current.id, input.reason, input.providerRefundId ?? null],
  )
  const refund = mapRefund(updated.rows[0]!)
  await audit(client, refund, 'seat_refund_failed', actor, { reason: input.reason.slice(0, 120) })
  return refund
}

/** The seat refund a gateway refund event belongs to (Cashfree sends its own refund id). */
export async function findSeatRefundForEvent(client: DatabaseQueryClient, orderId: string, providerRefundId: string | null) {
  const rows = await client.query<QueryResultRow>(
    `select ${REFUND_COLUMNS} from public.company_training_seat_refunds refund
     where refund.order_id = $1::uuid and ($2::text is null or refund.provider_refund_id is null or refund.provider_refund_id = $2::text)
     limit 1`,
    [orderId, providerRefundId],
  )
  return rows.rows[0] ? mapRefund(rows.rows[0]) : null
}
