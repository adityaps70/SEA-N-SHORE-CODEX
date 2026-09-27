import type { QueryResultRow } from 'pg'
import { query, type DatabaseQueryClient } from '@/lib/db/client'
import { recordPaymentAudit, type PaymentAuditActorType } from './audit'
import type { PaymentCurrency } from './types'

/**
 * Seller earnings ledger (migration 0046). Sea N Shore collects every payment and
 * later pays sellers (organizations or member profiles) their share:
 *
 *   platform fee = gross × fee percent, rounded half-up to the paisa/cent
 *   net          = gross − platform fee
 *
 * The fee percent is the seller's override if one exists, else the platform default
 * (platform_fee_settings). It is copied onto each earning, so later changes never
 * rewrite past sales. An earning is 'pending' until available_at (the sale is final
 * plus hold_days), then 'available' for a payout, then 'in_payout' / 'paid' (set by
 * the payouts module). A refund reverses a pending/available earning, or, if the
 * money was already paid out, adds a negative 'adjustment' that is deducted from the
 * seller's next payout.
 *
 * All writes take the caller's transaction client, so the ledger always changes in
 * the same transaction as the payment that caused it.
 */

export type Seller = { profileId: string; companyId?: undefined } | { companyId: string; profileId?: undefined }
export type EarningSourceType = 'event_ticket' | 'course_purchase'
export type EarningStatus = 'pending' | 'available' | 'in_payout' | 'paid' | 'reversed'

export type SellerEarning = {
  id: string
  seller: Seller
  sourceType: EarningSourceType | 'adjustment'
  sourceId: string
  adjustsEarningId: string | null
  currency: PaymentCurrency
  grossMinor: number
  platformFeePercent: string
  platformFeeMinor: number
  netMinor: number
  status: EarningStatus
  availableAt: string
  payoutId: string | null
  reversedReason: string | null
  createdAt: string
}

export type SellerBalance = {
  currency: PaymentCurrency
  /** Still inside the hold period. */
  pendingMinor: number
  /** Ready for a payout (includes negative adjustments; can be ≤ 0 — never pay out ≤ 0). */
  availableMinor: number
  inPayoutMinor: number
  paidMinor: number
  /** When the next pending earning becomes available, if any. */
  nextAvailableAt: string | null
}

export type PlatformFeeSettings = { defaultPercent: string; holdDays: number }

export type LedgerActor = { type: PaymentAuditActorType; profileId?: string | null }

const SYSTEM: LedgerActor = { type: 'system' }
const DAY_MS = 86_400_000

type EarningRow = QueryResultRow & {
  id: string
  seller_profile_id: string | null
  seller_company_id: string | null
  source_type: SellerEarning['sourceType']
  source_id: string
  adjusts_earning_id: string | null
  currency: PaymentCurrency
  gross_minor: string | number
  platform_fee_percent: string | number
  platform_fee_minor: string | number
  net_minor: string | number
  status: EarningStatus
  available_at: string | Date
  payout_id: string | null
  reversed_reason: string | null
  created_at: string | Date
}

const EARNING_COLUMNS = `
  id, seller_profile_id, seller_company_id, source_type, source_id, adjusts_earning_id, currency,
  gross_minor, platform_fee_percent, platform_fee_minor, net_minor, status, available_at, payout_id,
  reversed_reason, created_at
`

function iso(value: string | Date) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function mapEarning(row: EarningRow): SellerEarning {
  return {
    id: row.id,
    seller: row.seller_company_id ? { companyId: row.seller_company_id } : { profileId: row.seller_profile_id! },
    sourceType: row.source_type,
    sourceId: row.source_id,
    adjustsEarningId: row.adjusts_earning_id,
    currency: row.currency,
    grossMinor: Number(row.gross_minor),
    platformFeePercent: formatPercent(row.platform_fee_percent),
    platformFeeMinor: Number(row.platform_fee_minor),
    netMinor: Number(row.net_minor),
    status: row.status,
    availableAt: iso(row.available_at),
    payoutId: row.payout_id,
    reversedReason: row.reversed_reason,
    createdAt: iso(row.created_at),
  }
}

function sellerColumns(seller: Seller): [string | null, string | null] {
  if (seller.companyId) return [null, seller.companyId]
  if (seller.profileId) return [seller.profileId, null]
  throw new RangeError('seller_required')
}

/** "10", "10.5", 10.25 -> basis points (1000, 1050, 1025). Throws outside 0..100 or beyond 2 decimals. */
export function percentToBasisPoints(percent: string | number): number {
  const textValue = typeof percent === 'number' ? String(percent) : percent.trim()
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(textValue)
  if (!match) throw new RangeError('fee_percent_invalid')
  const points = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'))
  if (points > 10_000) throw new RangeError('fee_percent_invalid')
  return points
}

export function formatPercent(percent: string | number) {
  const points = percentToBasisPoints(typeof percent === 'number' ? percent : String(Number(percent)))
  return `${Math.floor(points / 100)}.${String(points % 100).padStart(2, '0')}`
}

/**
 * Platform fee for one sale. Rounding: half-up to the smallest unit (paisa/cent),
 * computed with integers: fee = floor((gross × basisPoints + 5000) / 10000).
 * Example: ₹499.00 at 10% -> fee ₹49.90, net ₹449.10; ₹0.05 at 10% -> fee ₹0.01 (0.5 paise rounds up).
 */
export function computePlatformFee(grossMinor: number, percent: string | number) {
  if (!Number.isSafeInteger(grossMinor) || grossMinor <= 0) throw new RangeError('gross_minor_invalid')
  const points = BigInt(percentToBasisPoints(percent))
  const feeMinor = Number((BigInt(grossMinor) * points + BigInt(5_000)) / BigInt(10_000))
  return { feeMinor, netMinor: grossMinor - feeMinor, percent: formatPercent(percent) }
}

/** When a sale becomes available for payout: availableAfter + holdDays. */
export function earningAvailableAt(availableAfter: Date, holdDays: number) {
  return new Date(availableAfter.getTime() + holdDays * DAY_MS)
}

export async function getPlatformFeeSettings(client?: DatabaseQueryClient): Promise<PlatformFeeSettings> {
  const sql = 'select default_percent, hold_days from public.platform_fee_settings where id = true'
  type Row = QueryResultRow & { default_percent: string | number; hold_days: number }
  const rows = client ? (await client.query<Row>(sql)).rows : await query<Row>(sql)
  const row = rows[0]
  // The migration inserts the row; these defaults only apply if someone deleted it.
  return row ? { defaultPercent: formatPercent(row.default_percent), holdDays: Number(row.hold_days) } : { defaultPercent: '10.00', holdDays: 7 }
}

/** The fee percent that applies to this seller now: their override, else the default. */
export async function resolveFeePercent(client: DatabaseQueryClient, seller: Seller) {
  const [profileId, companyId] = sellerColumns(seller)
  const override = await client.query<QueryResultRow & { percent: string | number }>(`
    select percent from public.seller_fee_overrides
    where ($1::uuid is not null and seller_profile_id = $1::uuid)
       or ($2::uuid is not null and seller_company_id = $2::uuid)
    limit 1
  `, [profileId, companyId])
  if (override.rows[0]) return formatPercent(override.rows[0].percent)
  return (await getPlatformFeeSettings(client)).defaultPercent
}

/**
 * Records a seller's share of one paid sale. Idempotent: a second call for the same
 * (sourceType, sourceId) returns the existing earning unchanged (created = false).
 *
 * availableAfter = the moment the sale is final (event end or payment time, whichever
 * is later; for a course, the purchase time). hold_days is added to it here.
 */
export async function recordSaleEarning(tx: DatabaseQueryClient, input: {
  sourceType: EarningSourceType
  sourceId: string
  seller: Seller
  grossMinor: number
  currency: PaymentCurrency
  availableAfter: Date
  actor?: LedgerActor
}): Promise<{ earning: SellerEarning; created: boolean }> {
  const [profileId, companyId] = sellerColumns(input.seller)
  const settings = await getPlatformFeeSettings(tx)
  const percent = await resolveFeePercent(tx, input.seller)
  const fee = computePlatformFee(input.grossMinor, percent)
  const availableAt = earningAvailableAt(input.availableAfter, settings.holdDays)

  const inserted = await tx.query<EarningRow>(`
    insert into public.seller_earnings (
      seller_profile_id, seller_company_id, source_type, source_id, currency, gross_minor,
      platform_fee_percent, platform_fee_minor, net_minor, status, available_at
    )
    values ($1::uuid, $2::uuid, $3::text, $4::text, $5::text, $6::bigint, $7::numeric, $8::bigint, $9::bigint, 'pending', $10::timestamptz)
    on conflict (source_type, source_id) do nothing
    returning ${EARNING_COLUMNS}
  `, [profileId, companyId, input.sourceType, input.sourceId, input.currency, input.grossMinor, fee.percent, fee.feeMinor, fee.netMinor, availableAt.toISOString()])

  if (inserted.rows[0]) {
    const earning = mapEarning(inserted.rows[0])
    const actor = input.actor ?? SYSTEM
    await recordPaymentAudit(tx, {
      actorType: actor.type,
      actorProfileId: actor.profileId ?? null,
      subjectType: 'seller_earning',
      subjectId: earning.id,
      action: 'earning_recorded',
      toStatus: 'pending',
      amountMinor: earning.netMinor,
      currency: earning.currency,
      details: {
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        grossMinor: earning.grossMinor,
        platformFeePercent: earning.platformFeePercent,
        platformFeeMinor: earning.platformFeeMinor,
        availableAt: earning.availableAt,
      },
    })
    return { earning, created: true }
  }

  const existing = await tx.query<EarningRow>(`
    select ${EARNING_COLUMNS} from public.seller_earnings where source_type = $1::text and source_id = $2::text
  `, [input.sourceType, input.sourceId])
  if (!existing.rows[0]) throw new Error('seller_earning_missing')
  return { earning: mapEarning(existing.rows[0]), created: false }
}

export type ReverseEarningOutcome =
  | { outcome: 'not_found' }
  | { outcome: 'already_reversed'; earning: SellerEarning }
  | { outcome: 'reversed'; earning: SellerEarning }
  | { outcome: 'adjusted'; earning: SellerEarning; adjustment: SellerEarning }

/**
 * Undoes a sale's earning after a refund. Idempotent.
 * - pending / available: the earning becomes 'reversed' (never paid out).
 * - in_payout / paid: the money has gone (or is going) to the seller, so a negative
 *   'adjustment' earning (status available) is added; the next payout deducts it.
 */
export async function reverseSaleEarning(tx: DatabaseQueryClient, input: {
  sourceType: EarningSourceType
  sourceId: string
  reason: string
  actor?: LedgerActor
}): Promise<ReverseEarningOutcome> {
  const actor = input.actor ?? SYSTEM
  const reason = input.reason.slice(0, 500)
  const locked = await tx.query<EarningRow>(`
    select ${EARNING_COLUMNS} from public.seller_earnings
    where source_type = $1::text and source_id = $2::text
    for update
  `, [input.sourceType, input.sourceId])
  const current = locked.rows[0] ? mapEarning(locked.rows[0]) : null
  if (!current) return { outcome: 'not_found' }
  if (current.status === 'reversed') return { outcome: 'already_reversed', earning: current }

  if (current.status === 'pending' || current.status === 'available') {
    const updated = await tx.query<EarningRow>(`
      update public.seller_earnings
      set status = 'reversed', reversed_reason = $2::text, reversed_at = now(), updated_at = now()
      where id = $1::uuid
      returning ${EARNING_COLUMNS}
    `, [current.id, reason])
    const earning = mapEarning(updated.rows[0]!)
    await recordPaymentAudit(tx, {
      actorType: actor.type,
      actorProfileId: actor.profileId ?? null,
      subjectType: 'seller_earning',
      subjectId: current.id,
      action: 'earning_reversed',
      fromStatus: current.status,
      toStatus: 'reversed',
      amountMinor: current.netMinor,
      currency: current.currency,
      details: { reason, sourceType: input.sourceType, sourceId: input.sourceId },
    })
    return { outcome: 'reversed', earning }
  }

  const [profileId, companyId] = sellerColumns(current.seller)
  const inserted = await tx.query<EarningRow>(`
    insert into public.seller_earnings (
      seller_profile_id, seller_company_id, source_type, source_id, adjusts_earning_id, currency,
      gross_minor, platform_fee_percent, platform_fee_minor, net_minor, status, available_at, reversed_reason
    )
    values ($1::uuid, $2::uuid, 'adjustment', $3::text, $3::uuid, $4::text, $5::bigint, $6::numeric, $7::bigint, $8::bigint, 'available', now(), $9::text)
    on conflict (source_type, source_id) do nothing
    returning ${EARNING_COLUMNS}
  `, [profileId, companyId, current.id, current.currency, -current.grossMinor, current.platformFeePercent, -current.platformFeeMinor, -current.netMinor, reason])
  if (!inserted.rows[0]) {
    const existing = await tx.query<EarningRow>(`
      select ${EARNING_COLUMNS} from public.seller_earnings where source_type = 'adjustment' and source_id = $1::text
    `, [current.id])
    return { outcome: 'adjusted', earning: current, adjustment: mapEarning(existing.rows[0]!) }
  }
  const adjustment = mapEarning(inserted.rows[0])
  await recordPaymentAudit(tx, {
    actorType: actor.type,
    actorProfileId: actor.profileId ?? null,
    subjectType: 'seller_earning',
    subjectId: adjustment.id,
    action: 'earning_adjustment_created',
    toStatus: 'available',
    amountMinor: adjustment.netMinor,
    currency: adjustment.currency,
    details: { reason, adjustsEarningId: current.id, adjustedStatus: current.status, sourceType: input.sourceType, sourceId: input.sourceId },
  })
  return { outcome: 'adjusted', earning: current, adjustment }
}

/**
 * Job helper: flips every pending earning whose hold has passed to 'available' and
 * writes one audit row each. Safe to run at any time and as often as you like.
 * Balances already treat such rows as available, so this only makes it explicit
 * (run it before building a payout).
 */
export const RELEASE_AVAILABLE_EARNINGS_SQL = `
  with released as (
    update public.seller_earnings
    set status = 'available', updated_at = now()
    where status = 'pending' and available_at <= $1::timestamptz
    returning id, net_minor, currency
  ),
  audited as (
    insert into public.payment_audit_events (actor_type, subject_type, subject_id, action, from_status, to_status, amount_minor, currency)
    select 'system', 'seller_earning', released.id::text, 'earning_available', 'pending', 'available', released.net_minor, released.currency
    from released
    returning 1
  )
  select count(*)::bigint as count from released
`

export async function releaseAvailableEarnings(tx: DatabaseQueryClient, now: Date = new Date()) {
  const result = await tx.query<QueryResultRow & { count: string | number }>(RELEASE_AVAILABLE_EARNINGS_SQL, [now.toISOString()])
  return Number(result.rows[0]?.count ?? 0)
}

/** Balance per currency for one seller. Pending rows past their hold count as available. */
export async function getSellerBalance(seller: Seller, options: { client?: DatabaseQueryClient; now?: Date } = {}): Promise<SellerBalance[]> {
  const [profileId, companyId] = sellerColumns(seller)
  const sql = `
    select currency,
      coalesce(sum(net_minor) filter (where status = 'pending' and available_at > $3::timestamptz), 0) as pending_minor,
      coalesce(sum(net_minor) filter (where status = 'available' or (status = 'pending' and available_at <= $3::timestamptz)), 0) as available_minor,
      coalesce(sum(net_minor) filter (where status = 'in_payout'), 0) as in_payout_minor,
      coalesce(sum(net_minor) filter (where status = 'paid'), 0) as paid_minor,
      min(available_at) filter (where status = 'pending' and available_at > $3::timestamptz) as next_available_at
    from public.seller_earnings
    where ($1::uuid is not null and seller_profile_id = $1::uuid)
       or ($2::uuid is not null and seller_company_id = $2::uuid)
    group by currency
    order by currency
  `
  type Row = QueryResultRow & {
    currency: PaymentCurrency
    pending_minor: string | number
    available_minor: string | number
    in_payout_minor: string | number
    paid_minor: string | number
    next_available_at: string | Date | null
  }
  const values = [profileId, companyId, (options.now ?? new Date()).toISOString()]
  const rows = options.client ? (await options.client.query<Row>(sql, values)).rows : await query<Row>(sql, values)
  return rows.map((row) => ({
    currency: row.currency,
    pendingMinor: Number(row.pending_minor),
    availableMinor: Number(row.available_minor),
    inPayoutMinor: Number(row.in_payout_minor),
    paidMinor: Number(row.paid_minor),
    nextAvailableAt: row.next_available_at ? iso(row.next_available_at) : null,
  }))
}

/** Admin: change the platform default fee and hold period. Audited. */
export async function updatePlatformFeeSettings(tx: DatabaseQueryClient, input: { defaultPercent: string | number; holdDays: number; actorProfileId: string }) {
  const percent = formatPercent(input.defaultPercent)
  if (!Number.isInteger(input.holdDays) || input.holdDays < 0 || input.holdDays > 365) throw new RangeError('hold_days_invalid')
  const before = await getPlatformFeeSettings(tx)
  await tx.query(`
    insert into public.platform_fee_settings (id, default_percent, hold_days, updated_by, updated_at)
    values (true, $1::numeric, $2::integer, $3::uuid, now())
    on conflict (id) do update
    set default_percent = excluded.default_percent, hold_days = excluded.hold_days, updated_by = excluded.updated_by, updated_at = now()
  `, [percent, input.holdDays, input.actorProfileId])
  await recordPaymentAudit(tx, {
    actorType: 'admin',
    actorProfileId: input.actorProfileId,
    subjectType: 'platform_fee_settings',
    subjectId: 'default',
    action: 'fee_settings_updated',
    details: { before, after: { defaultPercent: percent, holdDays: input.holdDays } },
  })
  return { defaultPercent: percent, holdDays: input.holdDays }
}

/** Admin: set a seller-specific fee percent (replaces any earlier override). Audited. */
export async function setSellerFeeOverride(tx: DatabaseQueryClient, input: { seller: Seller; percent: string | number; note: string | null; actorProfileId: string }) {
  const [profileId, companyId] = sellerColumns(input.seller)
  const percent = formatPercent(input.percent)
  const note = input.note?.trim().slice(0, 500) || null
  await tx.query(`
    delete from public.seller_fee_overrides
    where ($1::uuid is not null and seller_profile_id = $1::uuid)
       or ($2::uuid is not null and seller_company_id = $2::uuid)
  `, [profileId, companyId])
  await tx.query(`
    insert into public.seller_fee_overrides (seller_profile_id, seller_company_id, percent, note, updated_by)
    values ($1::uuid, $2::uuid, $3::numeric, $4::text, $5::uuid)
  `, [profileId, companyId, percent, note, input.actorProfileId])
  await recordPaymentAudit(tx, {
    actorType: 'admin',
    actorProfileId: input.actorProfileId,
    subjectType: 'seller_fee_override',
    subjectId: companyId ?? profileId!,
    action: 'fee_override_set',
    details: { percent, note, sellerType: companyId ? 'organization' : 'profile' },
  })
  return { percent }
}

/** Admin: remove a seller's override so the platform default applies again. Audited. */
export async function removeSellerFeeOverride(tx: DatabaseQueryClient, input: { seller: Seller; actorProfileId: string }) {
  const [profileId, companyId] = sellerColumns(input.seller)
  const removed = await tx.query<QueryResultRow & { percent: string }>(`
    delete from public.seller_fee_overrides
    where ($1::uuid is not null and seller_profile_id = $1::uuid)
       or ($2::uuid is not null and seller_company_id = $2::uuid)
    returning percent
  `, [profileId, companyId])
  if (removed.rows[0]) {
    await recordPaymentAudit(tx, {
      actorType: 'admin',
      actorProfileId: input.actorProfileId,
      subjectType: 'seller_fee_override',
      subjectId: companyId ?? profileId!,
      action: 'fee_override_removed',
      details: { previousPercent: formatPercent(removed.rows[0].percent) },
    })
  }
  return { removed: Boolean(removed.rows[0]) }
}
