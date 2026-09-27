import type { QueryResultRow } from 'pg'
import type { DatabaseQueryClient } from '@/lib/db/client'
import { recordPaymentAudit, type PaymentAuditActorType } from '@/features/payments/audit'
import { releaseAvailableEarnings, type Seller } from '@/features/payments/earnings'
import {
  DEFAULT_MIN_PAYOUT_MINOR,
  DISPATCH_RETRY_AFTER_MS,
  nextPayoutStatus,
  transferIdForPayout,
  transferOutcome,
  type PayoutAccountStatus,
  type PayoutMethod,
  type PayoutStatus,
} from './payout-rules'

/**
 * Payout accounts and the payout state machine (migration 0049). Every money state
 * change runs inside the caller's transaction and writes payment_audit_events rows in
 * that same transaction.
 *
 *   draft ──(Cashfree accepted)──> processing ──> success ──> reversed
 *     │                               │
 *     ├──(Cashfree definitely refused)┴──> failed      (earnings back to 'available')
 *     └──(Cashfree has no record, admin cancels)──> cancelled (earnings back to 'available')
 *
 * Earnings: available -> in_payout (payout created) -> paid (success);
 * in_payout / paid -> available again on failed / reversed / cancelled.
 */

export class PayoutError extends Error {
  constructor(readonly code:
    | 'forbidden'
    | 'no_payout_account'
    | 'payout_in_progress'
    | 'nothing_to_pay'
    | 'below_minimum'
    | 'balance_changed'
    | 'payout_not_found'
    | 'payout_not_cancellable'
    | 'account_not_found') {
    super(code)
    this.name = 'PayoutError'
  }
}

export type PayoutActor = { type: PaymentAuditActorType; profileId?: string | null }

export type PayoutAccount = {
  id: string
  seller: Seller
  method: PayoutMethod
  holderName: string
  ifsc: string | null
  last4: string | null
  vpa: string | null
  providerBeneficiaryId: string
  providerStatus: string | null
  providerVerified: boolean
  status: PayoutAccountStatus
  createdAt: string
}

export type Payout = {
  id: string
  seller: Seller
  payoutAccountId: string
  amountMinor: number
  currency: 'INR'
  status: PayoutStatus
  transferId: string
  transferMode: string | null
  cfTransferId: string | null
  providerStatus: string | null
  providerStatusCode: string | null
  utr: string | null
  failureReason: string | null
  dispatchAttempts: number
  lastDispatchAt: string | null
  approvedBy: string | null
  approvedAt: string | null
  sentAt: string | null
  completedAt: string | null
  lastCheckedAt: string | null
  createdAt: string
  updatedAt: string
}

/** What Cashfree told us about a transfer (from a create/get call or a verified webhook). */
export type TransferReport = {
  status: string
  statusCode?: string | null
  statusDescription?: string | null
  cfTransferId?: string | null
  utr?: string | null
  amountMinor?: number | null
}

type AccountRow = QueryResultRow & {
  id: string
  seller_profile_id: string | null
  seller_company_id: string | null
  method: PayoutMethod
  account_holder_name: string
  bank_ifsc: string | null
  bank_account_last4: string | null
  upi_vpa: string | null
  provider_beneficiary_id: string
  provider_status: string | null
  provider_verified: boolean
  status: PayoutAccountStatus
  created_at: string | Date
}

type PayoutRow = QueryResultRow & {
  id: string
  seller_profile_id: string | null
  seller_company_id: string | null
  payout_account_id: string
  amount_minor: string | number
  currency: 'INR'
  status: PayoutStatus
  transfer_id: string
  transfer_mode: string | null
  cf_transfer_id: string | null
  provider_status: string | null
  provider_status_code: string | null
  utr: string | null
  failure_reason: string | null
  dispatch_attempts: number
  last_dispatch_at: string | Date | null
  approved_by: string | null
  approved_at: string | Date | null
  sent_at: string | Date | null
  completed_at: string | Date | null
  last_checked_at: string | Date | null
  created_at: string | Date
  updated_at: string | Date
}

export const ACCOUNT_COLUMNS = `
  id, seller_profile_id, seller_company_id, method, account_holder_name, bank_ifsc, bank_account_last4,
  upi_vpa, provider_beneficiary_id, provider_status, provider_verified, status, created_at
`

export const PAYOUT_COLUMNS = `
  id, seller_profile_id, seller_company_id, payout_account_id, amount_minor, currency, status, transfer_id,
  transfer_mode, cf_transfer_id, provider_status, provider_status_code, utr, failure_reason, dispatch_attempts,
  last_dispatch_at, approved_by, approved_at, sent_at, completed_at, last_checked_at, created_at, updated_at
`

function iso(value: string | Date | null): string | null {
  if (value === null || value === undefined) return null
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function sellerOf(row: { seller_profile_id: string | null; seller_company_id: string | null }): Seller {
  return row.seller_company_id ? { companyId: row.seller_company_id } : { profileId: row.seller_profile_id! }
}

export function sellerParams(seller: Seller): [string | null, string | null] {
  if (seller.companyId) return [null, seller.companyId]
  if (seller.profileId) return [seller.profileId, null]
  throw new RangeError('seller_required')
}

/** SQL filter for one seller using two parameters ($a = profile id, $b = company id). */
export function sellerFilter(alias: string, profileParam: number, companyParam: number) {
  const prefix = alias ? `${alias}.` : ''
  return `(($${profileParam}::uuid is not null and ${prefix}seller_profile_id = $${profileParam}::uuid) or ($${companyParam}::uuid is not null and ${prefix}seller_company_id = $${companyParam}::uuid))`
}

export function mapAccount(row: AccountRow): PayoutAccount {
  return {
    id: row.id,
    seller: sellerOf(row),
    method: row.method,
    holderName: row.account_holder_name,
    ifsc: row.bank_ifsc,
    last4: row.bank_account_last4,
    vpa: row.upi_vpa,
    providerBeneficiaryId: row.provider_beneficiary_id,
    providerStatus: row.provider_status,
    providerVerified: Boolean(row.provider_verified),
    status: row.status,
    createdAt: iso(row.created_at)!,
  }
}

export function mapPayout(row: PayoutRow): Payout {
  return {
    id: row.id,
    seller: sellerOf(row),
    payoutAccountId: row.payout_account_id,
    amountMinor: Number(row.amount_minor),
    currency: row.currency,
    status: row.status,
    transferId: row.transfer_id,
    transferMode: row.transfer_mode,
    cfTransferId: row.cf_transfer_id,
    providerStatus: row.provider_status,
    providerStatusCode: row.provider_status_code,
    utr: row.utr,
    failureReason: row.failure_reason,
    dispatchAttempts: Number(row.dispatch_attempts ?? 0),
    lastDispatchAt: iso(row.last_dispatch_at),
    approvedBy: row.approved_by,
    approvedAt: iso(row.approved_at),
    sentAt: iso(row.sent_at),
    completedAt: iso(row.completed_at),
    lastCheckedAt: iso(row.last_checked_at),
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
  }
}

function clip(value: string | null | undefined, max: number) {
  const text = value?.trim()
  return text ? text.slice(0, max) : null
}

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------

/**
 * Who may see a seller's earnings and manage its payout details: the member for their
 * own profile; for an organization, its approved owners and administrators.
 */
export async function canManageSeller(client: DatabaseQueryClient, userId: string, seller: Seller) {
  if (seller.profileId) return seller.profileId === userId
  const result = await client.query<QueryResultRow & { allowed: boolean }>(`
    select true as allowed
    from public.company_members cm
    where cm.company_id = $1::uuid
      and cm.user_id = $2::uuid
      and cm.approved_at is not null
      and cm.role::text in ('owner', 'administrator')
    limit 1
  `, [seller.companyId, userId])
  return Boolean(result.rows[0])
}

export type ManagedOrganization = { id: string; name: string; slug: string | null; role: 'owner' | 'administrator' }

/** Organizations this member can manage payouts for (approved owner / administrator). */
export async function listManagedOrganizations(client: DatabaseQueryClient, userId: string): Promise<ManagedOrganization[]> {
  const result = await client.query<QueryResultRow & { id: string; name: string; slug: string | null; role: string }>(`
    select c.id, c.name, c.slug, cm.role::text as role
    from public.company_members cm
    join public.companies c on c.id = cm.company_id
    where cm.user_id = $1::uuid
      and cm.approved_at is not null
      and cm.role::text in ('owner', 'administrator')
    order by c.name asc, c.id asc
  `, [userId])
  return result.rows.map((row) => ({ id: row.id, name: row.name, slug: row.slug, role: row.role === 'owner' ? 'owner' : 'administrator' }))
}

// ---------------------------------------------------------------------------
// Payout accounts
// ---------------------------------------------------------------------------

export async function getActivePayoutAccount(client: DatabaseQueryClient, seller: Seller, options: { lock?: boolean } = {}) {
  const [profileId, companyId] = sellerParams(seller)
  const result = await client.query<AccountRow>(`
    select ${ACCOUNT_COLUMNS} from public.payout_accounts
    where status = 'active' and ${sellerFilter('', 1, 2)}
    limit 1
    ${options.lock ? 'for update' : ''}
  `, [profileId, companyId])
  return result.rows[0] ? mapAccount(result.rows[0]) : null
}

/** Another active account already registered this UPI ID at Cashfree (e.g. a member and their organization). */
export async function findActiveBeneficiaryForVpa(client: DatabaseQueryClient, vpa: string) {
  const result = await client.query<QueryResultRow & { provider_beneficiary_id: string }>(`
    select provider_beneficiary_id from public.payout_accounts
    where status = 'active' and provider = 'cashfree' and upi_vpa = $1::text
    order by created_at desc
    limit 1
  `, [vpa])
  return result.rows[0]?.provider_beneficiary_id ?? null
}

/** Whether any other active account still pays to this Cashfree beneficiary (so it must not be removed there). */
export async function beneficiaryStillInUse(client: DatabaseQueryClient, beneficiaryId: string, exceptAccountId: string | null) {
  const result = await client.query<QueryResultRow & { count: number | string }>(`
    select count(*)::int as count from public.payout_accounts
    where status = 'active' and provider = 'cashfree' and provider_beneficiary_id = $1::text
      and ($2::uuid is null or id <> $2::uuid)
  `, [beneficiaryId, exceptAccountId])
  return Number(result.rows[0]?.count ?? 0) > 0
}

export async function hasOpenPayout(client: DatabaseQueryClient, seller: Seller) {
  const [profileId, companyId] = sellerParams(seller)
  const result = await client.query<QueryResultRow & { id: string }>(`
    select id from public.payouts
    where status in ('draft', 'processing') and ${sellerFilter('', 1, 2)}
    limit 1
  `, [profileId, companyId])
  return Boolean(result.rows[0])
}

/**
 * Makes these details the seller's one active payout account. The previous active
 * account (if any) is marked removed in the same transaction. Only masked data is stored.
 */
export async function saveActivePayoutAccount(tx: DatabaseQueryClient, input: {
  accountId: string
  seller: Seller
  method: PayoutMethod
  holderName: string
  ifsc: string | null
  last4: string | null
  vpa: string | null
  beneficiaryId: string
  providerStatus: string | null
  providerVerified: boolean
  actorProfileId: string
}): Promise<{ account: PayoutAccount; replaced: PayoutAccount | null }> {
  const [profileId, companyId] = sellerParams(input.seller)
  const previous = await getActivePayoutAccount(tx, input.seller, { lock: true })
  if (await hasOpenPayout(tx, input.seller)) throw new PayoutError('payout_in_progress')
  if (previous) {
    await tx.query(`
      update public.payout_accounts
      set status = 'removed', removed_at = now(), removed_by = $2::uuid, updated_at = now()
      where id = $1::uuid and status = 'active'
    `, [previous.id, input.actorProfileId])
    await recordPaymentAudit(tx, {
      actorType: 'member',
      actorProfileId: input.actorProfileId,
      subjectType: 'payout_account',
      subjectId: previous.id,
      action: 'payout_account_replaced',
      fromStatus: 'active',
      toStatus: 'removed',
      provider: 'cashfree',
      providerReference: previous.providerBeneficiaryId,
      details: { method: previous.method, replacedBy: input.accountId },
    })
  }
  const inserted = await tx.query<AccountRow>(`
    insert into public.payout_accounts (
      id, seller_profile_id, seller_company_id, method, account_holder_name, bank_ifsc, bank_account_last4, upi_vpa,
      provider, provider_beneficiary_id, provider_status, provider_verified, status, created_by
    )
    values ($1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text, $7::text, $8::text, 'cashfree', $9::text, $10::text, $11::boolean, 'active', $12::uuid)
    returning ${ACCOUNT_COLUMNS}
  `, [
    input.accountId, profileId, companyId, input.method, input.holderName, input.ifsc, input.last4, input.vpa,
    input.beneficiaryId, clip(input.providerStatus, 40), input.providerVerified, input.actorProfileId,
  ])
  const account = mapAccount(inserted.rows[0]!)
  await recordPaymentAudit(tx, {
    actorType: 'member',
    actorProfileId: input.actorProfileId,
    subjectType: 'payout_account',
    subjectId: account.id,
    action: 'payout_account_added',
    toStatus: 'active',
    provider: 'cashfree',
    providerReference: account.providerBeneficiaryId,
    // Masked details only: never the full account number.
    details: {
      method: account.method,
      sellerType: companyId ? 'organization' : 'profile',
      sellerId: companyId ?? profileId,
      ifsc: account.ifsc,
      last4: account.last4,
      providerStatus: account.providerStatus,
    },
  })
  return { account, replaced: previous }
}

export async function removeActivePayoutAccount(tx: DatabaseQueryClient, input: { seller: Seller; actorProfileId: string }) {
  const current = await getActivePayoutAccount(tx, input.seller, { lock: true })
  if (!current) return null
  if (await hasOpenPayout(tx, input.seller)) throw new PayoutError('payout_in_progress')
  await tx.query(`
    update public.payout_accounts
    set status = 'removed', removed_at = now(), removed_by = $2::uuid, updated_at = now()
    where id = $1::uuid and status = 'active'
  `, [current.id, input.actorProfileId])
  await recordPaymentAudit(tx, {
    actorType: 'member',
    actorProfileId: input.actorProfileId,
    subjectType: 'payout_account',
    subjectId: current.id,
    action: 'payout_account_removed',
    fromStatus: 'active',
    toStatus: 'removed',
    provider: 'cashfree',
    providerReference: current.providerBeneficiaryId,
    details: { method: current.method },
  })
  return current
}

// ---------------------------------------------------------------------------
// Payout settings
// ---------------------------------------------------------------------------

export async function getPayoutSettings(client: DatabaseQueryClient) {
  const result = await client.query<QueryResultRow & { min_payout_minor: string | number }>(
    'select min_payout_minor from public.payout_settings where id = true',
  )
  const row = result.rows[0]
  return { minPayoutMinor: row ? Number(row.min_payout_minor) : DEFAULT_MIN_PAYOUT_MINOR }
}

export async function updatePayoutSettings(tx: DatabaseQueryClient, input: { minPayoutMinor: number; actorProfileId: string }) {
  if (!Number.isSafeInteger(input.minPayoutMinor) || input.minPayoutMinor < 100 || input.minPayoutMinor > 100_000_000) {
    throw new RangeError('min_payout_invalid')
  }
  const before = await getPayoutSettings(tx)
  await tx.query(`
    insert into public.payout_settings (id, min_payout_minor, updated_by, updated_at)
    values (true, $1::bigint, $2::uuid, now())
    on conflict (id) do update
    set min_payout_minor = excluded.min_payout_minor, updated_by = excluded.updated_by, updated_at = now()
  `, [input.minPayoutMinor, input.actorProfileId])
  if (before.minPayoutMinor !== input.minPayoutMinor) {
    await recordPaymentAudit(tx, {
      actorType: 'admin',
      actorProfileId: input.actorProfileId,
      subjectType: 'payout_settings',
      subjectId: 'default',
      action: 'payout_settings_updated',
      currency: 'INR',
      details: { before, after: { minPayoutMinor: input.minPayoutMinor } },
    })
  }
  return { minPayoutMinor: input.minPayoutMinor }
}

// ---------------------------------------------------------------------------
// Payouts
// ---------------------------------------------------------------------------

type PayableRow = QueryResultRow & { id: string; net_minor: string | number }

/** Earnings that a payout for this seller would include now (INR, available, not in a payout). */
export async function lockPayableEarnings(tx: DatabaseQueryClient, seller: Seller) {
  const [profileId, companyId] = sellerParams(seller)
  const result = await tx.query<PayableRow>(`
    select id, net_minor from public.seller_earnings
    where ${sellerFilter('', 1, 2)}
      and status = 'available' and currency = 'INR' and payout_id is null
    order by created_at asc, id asc
    for update
  `, [profileId, companyId])
  return result.rows.map((row) => ({ id: row.id, netMinor: Number(row.net_minor) }))
}

export async function lockOpenPayout(tx: DatabaseQueryClient, seller: Seller) {
  const [profileId, companyId] = sellerParams(seller)
  const result = await tx.query<PayoutRow>(`
    select ${PAYOUT_COLUMNS} from public.payouts
    where status in ('draft', 'processing') and ${sellerFilter('', 1, 2)}
    order by created_at desc
    limit 1
    for update
  `, [profileId, companyId])
  return result.rows[0] ? mapPayout(result.rows[0]) : null
}

export async function findOpenPayout(client: DatabaseQueryClient, seller: Seller) {
  const [profileId, companyId] = sellerParams(seller)
  const result = await client.query<PayoutRow>(`
    select ${PAYOUT_COLUMNS} from public.payouts
    where status in ('draft', 'processing') and ${sellerFilter('', 1, 2)}
    order by created_at desc
    limit 1
  `, [profileId, companyId])
  return result.rows[0] ? mapPayout(result.rows[0]) : null
}

export async function lockPayout(tx: DatabaseQueryClient, payoutId: string) {
  const result = await tx.query<PayoutRow>(`select ${PAYOUT_COLUMNS} from public.payouts where id = $1::uuid for update`, [payoutId])
  return result.rows[0] ? mapPayout(result.rows[0]) : null
}

export async function getPayout(client: DatabaseQueryClient, payoutId: string) {
  const result = await client.query<PayoutRow>(`select ${PAYOUT_COLUMNS} from public.payouts where id = $1::uuid`, [payoutId])
  return result.rows[0] ? mapPayout(result.rows[0]) : null
}

export async function getPayoutAccountById(client: DatabaseQueryClient, accountId: string) {
  const result = await client.query<AccountRow>(`select ${ACCOUNT_COLUMNS} from public.payout_accounts where id = $1::uuid`, [accountId])
  return result.rows[0] ? mapAccount(result.rows[0]) : null
}

export type CreatePayoutResult =
  | { kind: 'created'; payout: Payout; account: PayoutAccount }
  | { kind: 'existing'; payout: Payout }

/**
 * Admin approved "Send ₹X": creates the payout (status draft, claimed for sending),
 * its items, and moves the included earnings to in_payout — all in one transaction.
 *
 * Double-click / retry safe: if the seller already has an open payout, that payout is
 * returned instead (the unique "one open payout per seller" index backs this up).
 * The admin reviewed a specific list of earnings; if the payable set or total changed
 * since then, nothing is created (balance_changed).
 */
export async function createPayout(tx: DatabaseQueryClient, input: {
  payoutId: string
  seller: Seller
  earningIds: string[]
  expectedTotalMinor: number
  minPayoutMinor: number
  actorProfileId: string
  now?: Date
}): Promise<CreatePayoutResult> {
  await releaseAvailableEarnings(tx, input.now ?? new Date())
  // Lock the seller's account row first: concurrent sends for one seller queue up here.
  const account = await getActivePayoutAccount(tx, input.seller, { lock: true })
  const open = await lockOpenPayout(tx, input.seller)
  if (open) return { kind: 'existing', payout: open }
  if (!account) throw new PayoutError('no_payout_account')

  const payable = await lockPayableEarnings(tx, input.seller)
  const total = payable.reduce((sum, earning) => sum + earning.netMinor, 0)
  const expected = new Set(input.earningIds)
  const sameSet = expected.size === payable.length && payable.every((earning) => expected.has(earning.id))
  if (!sameSet || total !== input.expectedTotalMinor) throw new PayoutError('balance_changed')
  if (total <= 0) throw new PayoutError('nothing_to_pay')
  if (total < input.minPayoutMinor) throw new PayoutError('below_minimum')

  const [profileId, companyId] = sellerParams(input.seller)
  const transferId = transferIdForPayout(input.payoutId)
  const inserted = await tx.query<PayoutRow>(`
    insert into public.payouts (
      id, seller_profile_id, seller_company_id, payout_account_id, amount_minor, currency, status, provider,
      transfer_id, transfer_mode, dispatch_attempts, last_dispatch_at, approved_by, approved_at
    )
    values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::bigint, 'INR', 'draft', 'cashfree', $6::text, $7::text, 1, now(), $8::uuid, now())
    returning ${PAYOUT_COLUMNS}
  `, [input.payoutId, profileId, companyId, account.id, total, transferId, account.method === 'upi' ? 'upi' : 'banktransfer', input.actorProfileId])
  const payout = mapPayout(inserted.rows[0]!)

  const ids = payable.map((earning) => earning.id)
  const moved = await tx.query<QueryResultRow & { items: number | string; changed: number | string }>(`
    with items as (
      insert into public.payout_items (payout_id, earning_id, amount_minor)
      select $1::uuid, e.id, e.net_minor from public.seller_earnings e where e.id = any($2::uuid[])
      returning earning_id
    ),
    changed as (
      update public.seller_earnings e
      set status = 'in_payout', payout_id = $1::uuid, updated_at = now()
      where e.id = any($2::uuid[]) and e.status = 'available' and e.payout_id is null
      returning e.id, e.net_minor, e.currency
    ),
    audited as (
      insert into public.payment_audit_events (actor_type, actor_profile_id, subject_type, subject_id, action, from_status, to_status, amount_minor, currency, provider, provider_reference, details)
      select 'admin', $3::uuid, 'seller_earning', changed.id::text, 'earning_in_payout', 'available', 'in_payout', changed.net_minor, changed.currency, 'cashfree', $4::text, jsonb_build_object('payoutId', $1::text)
      from changed
      returning 1
    )
    select (select count(*) from items)::int as items, (select count(*) from changed)::int as changed
  `, [payout.id, ids, input.actorProfileId, transferId])
  const counts = moved.rows[0]
  if (Number(counts?.items) !== ids.length || Number(counts?.changed) !== ids.length) throw new PayoutError('balance_changed')

  await recordPaymentAudit(tx, {
    actorType: 'admin',
    actorProfileId: input.actorProfileId,
    subjectType: 'payout',
    subjectId: payout.id,
    action: 'payout_approved',
    toStatus: 'draft',
    amountMinor: payout.amountMinor,
    currency: 'INR',
    provider: 'cashfree',
    providerReference: transferId,
    details: { earningCount: ids.length, payoutAccountId: account.id, sellerType: companyId ? 'organization' : 'profile', sellerId: companyId ?? profileId },
  })
  return { kind: 'created', payout, account }
}

/**
 * Claims a draft payout for (re)sending to Cashfree. Returns null if it is not a draft
 * any more or another send started less than DISPATCH_RETRY_AFTER_MS ago (double click).
 */
export async function claimDispatch(tx: DatabaseQueryClient, payoutId: string, now: Date = new Date()) {
  const cutoff = new Date(now.getTime() - DISPATCH_RETRY_AFTER_MS).toISOString()
  const result = await tx.query<PayoutRow>(`
    update public.payouts
    set dispatch_attempts = dispatch_attempts + 1, last_dispatch_at = $2::timestamptz, updated_at = now()
    where id = $1::uuid and status = 'draft'
      and (last_dispatch_at is null or last_dispatch_at <= $3::timestamptz)
      and dispatch_attempts < 100
    returning ${PAYOUT_COLUMNS}
  `, [payoutId, now.toISOString(), cutoff])
  return result.rows[0] ? mapPayout(result.rows[0]) : null
}

const RESTORE_EARNINGS_SQL = `
  with target as (
    select e.id, e.status as from_status
    from public.seller_earnings e
    where e.payout_id = $1::uuid and e.status = any($2::text[])
    for update
  ),
  changed as (
    update public.seller_earnings e
    set status = 'available', payout_id = null, updated_at = now()
    from target
    where e.id = target.id
    returning e.id, e.net_minor, e.currency, target.from_status
  ),
  audited as (
    insert into public.payment_audit_events (actor_type, actor_profile_id, subject_type, subject_id, action, from_status, to_status, amount_minor, currency, provider, provider_reference, details)
    select $3::text, $4::uuid, 'seller_earning', changed.id::text, 'earning_released_from_payout', changed.from_status, 'available', changed.net_minor, changed.currency, 'cashfree', $5::text, jsonb_build_object('payoutId', $1::text, 'payoutStatus', $6::text)
    from changed
    returning 1
  ),
  released as (
    update public.payout_items set active = false, released_at = now()
    where payout_id = $1::uuid and active
    returning 1
  )
  select (select count(*) from changed)::int as count, (select count(*) from released)::int as items
`

const PAY_EARNINGS_SQL = `
  with changed as (
    update public.seller_earnings e
    set status = 'paid', updated_at = now()
    where e.payout_id = $1::uuid and e.status = 'in_payout'
    returning e.id, e.net_minor, e.currency
  ),
  audited as (
    insert into public.payment_audit_events (actor_type, actor_profile_id, subject_type, subject_id, action, from_status, to_status, amount_minor, currency, provider, provider_reference, details)
    select $2::text, $3::uuid, 'seller_earning', changed.id::text, 'earning_paid', 'in_payout', 'paid', changed.net_minor, changed.currency, 'cashfree', $4::text, jsonb_build_object('payoutId', $1::text, 'utr', $5::text)
    from changed
    returning 1
  )
  select count(*)::int as count from changed
`

export type ApplyTransferResult =
  | { changed: true; payout: Payout; from: PayoutStatus }
  | { changed: false; payout: Payout; reason: 'no_change' | 'terminal' | 'amount_mismatch' }

/**
 * Applies what Cashfree reported for this payout's transfer. Idempotent: the same report
 * twice changes nothing the second time; a terminal payout never moves again (except
 * success -> reversed). Amount mismatches are recorded and never applied.
 */
export async function applyTransferReport(tx: DatabaseQueryClient, input: {
  payoutId: string
  report: TransferReport
  actor: PayoutActor
  source: 'send' | 'refresh' | 'webhook' | 'retry'
}): Promise<ApplyTransferResult | null> {
  const current = await lockPayout(tx, input.payoutId)
  if (!current) return null
  const report = input.report
  const providerStatus = clip(report.status?.toUpperCase(), 40)
  const statusCode = clip(report.statusCode, 80)
  const description = clip(report.statusDescription, 500)
  const utr = clip(report.utr, 100)
  const cfTransferId = clip(report.cfTransferId, 100)

  if (typeof report.amountMinor === 'number' && report.amountMinor !== current.amountMinor) {
    await recordPaymentAudit(tx, {
      actorType: input.actor.type,
      actorProfileId: input.actor.profileId ?? null,
      subjectType: 'payout',
      subjectId: current.id,
      action: 'transfer_amount_mismatch',
      fromStatus: current.status,
      amountMinor: report.amountMinor,
      currency: 'INR',
      provider: 'cashfree',
      providerReference: cfTransferId ?? current.transferId,
      details: { expectedMinor: current.amountMinor, providerStatus, source: input.source },
    })
    return { changed: false, payout: current, reason: 'amount_mismatch' }
  }

  const outcome = transferOutcome(providerStatus)
  const target = nextPayoutStatus(current.status, outcome)
  if (!target) {
    // A terminal payout: keep the reference fields if they were missing, nothing else.
    if (current.status === 'success' && utr && !current.utr) {
      const updated = await tx.query<PayoutRow>(`
        update public.payouts set utr = $2::text, last_checked_at = now(), updated_at = now() where id = $1::uuid
        returning ${PAYOUT_COLUMNS}
      `, [current.id, utr])
      return { changed: false, payout: mapPayout(updated.rows[0]!), reason: 'terminal' }
    }
    return { changed: false, payout: current, reason: 'terminal' }
  }

  const failureReason = target === 'failed' || target === 'reversed'
    ? description ?? statusCode ?? providerStatus ?? 'Cashfree did not complete the transfer'
    : null
  const updated = await tx.query<PayoutRow>(`
    update public.payouts
    set status = $2::text,
        provider_status = coalesce($3::text, provider_status),
        provider_status_code = coalesce($4::text, provider_status_code),
        cf_transfer_id = coalesce($5::text, cf_transfer_id),
        utr = coalesce($6::text, utr),
        failure_reason = case when $2::text in ('failed', 'reversed') then $7::text when $2::text = 'success' then null else failure_reason end,
        sent_at = coalesce(sent_at, now()),
        completed_at = case when $2::text in ('success', 'failed', 'reversed') then coalesce(completed_at, now()) else completed_at end,
        last_checked_at = now(),
        updated_at = now()
    where id = $1::uuid
    returning ${PAYOUT_COLUMNS}
  `, [current.id, target, providerStatus, statusCode, cfTransferId, utr, failureReason])
  const payout = mapPayout(updated.rows[0]!)

  if (target === current.status) {
    const fieldsChanged = payout.providerStatus !== current.providerStatus || payout.cfTransferId !== current.cfTransferId || payout.utr !== current.utr
    return fieldsChanged ? { changed: true, payout, from: current.status } : { changed: false, payout, reason: 'no_change' }
  }

  const reference = payout.cfTransferId ?? payout.transferId
  if (target === 'success') {
    await tx.query(PAY_EARNINGS_SQL, [payout.id, input.actor.type, input.actor.profileId ?? null, reference, payout.utr])
  } else if (target === 'failed' || target === 'reversed') {
    await tx.query(RESTORE_EARNINGS_SQL, [payout.id, target === 'reversed' ? ['in_payout', 'paid'] : ['in_payout'], input.actor.type, input.actor.profileId ?? null, reference, target])
  }
  await recordPaymentAudit(tx, {
    actorType: input.actor.type,
    actorProfileId: input.actor.profileId ?? null,
    subjectType: 'payout',
    subjectId: payout.id,
    action: `payout_${target}`,
    fromStatus: current.status,
    toStatus: target,
    amountMinor: payout.amountMinor,
    currency: 'INR',
    provider: 'cashfree',
    providerReference: reference,
    details: { providerStatus, statusCode, utr: payout.utr, source: input.source, reason: failureReason },
  })
  return { changed: true, payout, from: current.status }
}

/** Cashfree's answer to a send was unclear (timeout, 5xx). The payout stays a draft; the note tells the admin to check. */
export async function noteDispatchProblem(tx: DatabaseQueryClient, input: { payoutId: string; note: string; actor: PayoutActor }) {
  const current = await lockPayout(tx, input.payoutId)
  if (!current || current.status !== 'draft') return current
  const updated = await tx.query<PayoutRow>(`
    update public.payouts set failure_reason = $2::text, last_checked_at = now(), updated_at = now()
    where id = $1::uuid and status = 'draft'
    returning ${PAYOUT_COLUMNS}
  `, [current.id, input.note.slice(0, 500)])
  await recordPaymentAudit(tx, {
    actorType: input.actor.type,
    actorProfileId: input.actor.profileId ?? null,
    subjectType: 'payout',
    subjectId: current.id,
    action: 'payout_send_unconfirmed',
    fromStatus: 'draft',
    toStatus: 'draft',
    amountMinor: current.amountMinor,
    currency: 'INR',
    provider: 'cashfree',
    providerReference: current.transferId,
    details: { note: input.note.slice(0, 200) },
  })
  return updated.rows[0] ? mapPayout(updated.rows[0]) : current
}

export async function markPayoutChecked(tx: DatabaseQueryClient, payoutId: string) {
  await tx.query('update public.payouts set last_checked_at = now() where id = $1::uuid', [payoutId])
}

/**
 * Cancels a draft payout that Cashfree has no record of (checked by the caller just
 * before). Earnings go back to available.
 */
export async function cancelDraftPayout(tx: DatabaseQueryClient, input: { payoutId: string; actorProfileId: string; reason: string }) {
  const current = await lockPayout(tx, input.payoutId)
  if (!current) throw new PayoutError('payout_not_found')
  if (current.status === 'cancelled') return current
  if (current.status !== 'draft') throw new PayoutError('payout_not_cancellable')
  const updated = await tx.query<PayoutRow>(`
    update public.payouts
    set status = 'cancelled', failure_reason = $2::text, completed_at = now(), last_checked_at = now(), updated_at = now()
    where id = $1::uuid and status = 'draft'
    returning ${PAYOUT_COLUMNS}
  `, [current.id, input.reason.slice(0, 500)])
  await tx.query(RESTORE_EARNINGS_SQL, [current.id, ['in_payout'], 'admin', input.actorProfileId, current.transferId, 'cancelled'])
  await recordPaymentAudit(tx, {
    actorType: 'admin',
    actorProfileId: input.actorProfileId,
    subjectType: 'payout',
    subjectId: current.id,
    action: 'payout_cancelled',
    fromStatus: 'draft',
    toStatus: 'cancelled',
    amountMinor: current.amountMinor,
    currency: 'INR',
    provider: 'cashfree',
    providerReference: current.transferId,
    details: { reason: input.reason.slice(0, 200) },
  })
  return mapPayout(updated.rows[0]!)
}
