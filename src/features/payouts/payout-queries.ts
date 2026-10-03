import type { QueryResultRow } from 'pg'
import type { DatabaseQueryClient } from '@/lib/db/client'
import { formatPercent, type EarningStatus, type Seller } from '@/features/payments/earnings'
import {
  ACCOUNT_COLUMNS,
  mapAccount,
  mapPayout,
  PAYOUT_COLUMNS,
  sellerFilter,
  sellerParams,
  type Payout,
  type PayoutAccount,
} from './payout-repository'
import { maskPayoutAccount, type MaskedPayoutAccount, type PayoutMethod, type PayoutStatus } from './payout-rules'

/**
 * Read-only queries behind the seller earnings page and the admin payments console.
 * Course and plan payment tables are built by other modules (migrations 0047/0048);
 * they are discovered at runtime through information_schema so this console keeps
 * working, and says what it cannot read, whatever their exact shape.
 */

const UUID_TEXT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function iso(value: string | Date | null | undefined): string | null {
  if (value === null || value === undefined) return null
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function num(value: string | number | null | undefined) {
  return Number(value ?? 0)
}

export type SellerIdentity = { seller: Seller; name: string; slug: string | null; kind: 'profile' | 'organization' }

type NameRow = { seller_profile_id: string | null; seller_company_id: string | null; profile_name?: string | null; profile_slug?: string | null; company_name?: string | null; company_slug?: string | null }

function identity(row: NameRow): SellerIdentity {
  if (row.seller_company_id) {
    return { seller: { companyId: row.seller_company_id }, name: row.company_name ?? 'Organization', slug: row.company_slug ?? null, kind: 'organization' }
  }
  return { seller: { profileId: row.seller_profile_id! }, name: row.profile_name ?? 'Former member', slug: row.profile_slug ?? null, kind: 'profile' }
}

const NAME_COLUMNS = 'sp.full_name as profile_name, sp.slug as profile_slug, sc.name as company_name, sc.slug as company_slug'
const NAME_JOINS = (alias: string) => `
  left join public.profiles sp on sp.id = ${alias}.seller_profile_id
  left join public.companies sc on sc.id = ${alias}.seller_company_id
`

export async function getSellerIdentity(client: DatabaseQueryClient, seller: Seller): Promise<SellerIdentity | null> {
  const [profileId, companyId] = sellerParams(seller)
  const result = await client.query<QueryResultRow & { name: string | null; slug: string | null }>(
    companyId
      ? 'select name, slug from public.companies where id = $1::uuid'
      : 'select full_name as name, slug from public.profiles where id = $1::uuid',
    [companyId ?? profileId],
  )
  const row = result.rows[0]
  if (!row) return null
  return { seller, name: row.name ?? (companyId ? 'Organization' : 'Member'), slug: row.slug, kind: companyId ? 'organization' : 'profile' }
}

// ---------------------------------------------------------------------------
// Earning lines (sales with their labels)
// ---------------------------------------------------------------------------

export type EarningLine = {
  id: string
  sourceType: 'event_ticket' | 'course_purchase' | 'adjustment'
  /** For an adjustment, the sale it adjusts. */
  baseSourceType: 'event_ticket' | 'course_purchase'
  title: string
  soldAt: string
  currency: string
  grossMinor: number
  feePercent: string
  feeMinor: number
  netMinor: number
  status: EarningStatus
  availableAt: string
  payoutId: string | null
  note: string | null
}

type EarningLineRow = QueryResultRow & {
  id: string
  source_type: EarningLine['sourceType']
  base_source_type: EarningLine['baseSourceType']
  base_source_id: string
  event_title: string | null
  sold_at: string | Date
  currency: string
  gross_minor: string | number
  platform_fee_percent: string | number
  platform_fee_minor: string | number
  net_minor: string | number
  status: EarningStatus
  available_at: string | Date
  payout_id: string | null
  reversed_reason: string | null
}

const EARNING_LINE_SELECT = `
  select e.id, e.source_type, e.currency, e.gross_minor, e.platform_fee_percent, e.platform_fee_minor, e.net_minor,
    e.status, e.available_at, e.payout_id, e.reversed_reason,
    coalesce(orig.source_type, e.source_type) as base_source_type,
    coalesce(orig.source_id, e.source_id) as base_source_id,
    epo.event_title,
    case when e.source_type = 'adjustment' then e.created_at else coalesce(epo.paid_at, e.created_at) end as sold_at
  from public.seller_earnings e
  left join public.seller_earnings orig on e.source_type = 'adjustment' and orig.id = e.adjusts_earning_id
  left join public.event_payment_orders epo
    on coalesce(orig.source_type, e.source_type) = 'event_ticket'
   and epo.id = (case when coalesce(orig.source_id, e.source_id) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                      then coalesce(orig.source_id, e.source_id)::uuid end)
`

async function tableColumns(client: DatabaseQueryClient, table: string) {
  try {
    const result = await client.query<QueryResultRow & { column_name: string }>(`
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = $1::text
    `, [table])
    return new Set(result.rows.map((row) => row.column_name))
  } catch {
    return new Set<string>()
  }
}

function pick(columns: Set<string>, candidates: string[]) {
  return candidates.find((name) => columns.has(name)) ?? null
}

/** Course titles for course purchase earnings, when the course orders table can be read. */
async function courseTitles(client: DatabaseQueryClient, orderIds: string[]) {
  const ids = [...new Set(orderIds.filter((id) => UUID_TEXT.test(id)))]
  const titles = new Map<string, string>()
  if (!ids.length) return titles
  const columns = await tableColumns(client, 'course_payment_orders')
  if (!columns.has('id')) return titles
  const titleSql = columns.has('course_title') ? 'o.course_title' : columns.has('course_id') ? 'c.title' : null
  if (!titleSql) return titles
  try {
    const result = await client.query<QueryResultRow & { id: string; title: string | null }>(`
      select o.id::text as id, ${titleSql}::text as title
      from public.course_payment_orders o
      ${titleSql === 'c.title' ? 'left join public.courses c on c.id = o.course_id' : ''}
      where o.id = any($1::uuid[])
    `, [ids])
    for (const row of result.rows) if (row.title) titles.set(row.id, row.title)
  } catch {
    // Labels are a convenience; the amounts come from the ledger itself.
  }
  return titles
}

async function mapEarningLines(client: DatabaseQueryClient, rows: EarningLineRow[]): Promise<EarningLine[]> {
  const courses = await courseTitles(client, rows.filter((row) => row.base_source_type === 'course_purchase').map((row) => row.base_source_id))
  return rows.map((row) => {
    const baseTitle = row.base_source_type === 'event_ticket'
      ? row.event_title ?? 'Event ticket'
      : courses.get(row.base_source_id) ?? 'Course purchase'
    return {
      id: row.id,
      sourceType: row.source_type,
      baseSourceType: row.base_source_type,
      title: baseTitle,
      soldAt: iso(row.sold_at)!,
      currency: row.currency,
      grossMinor: num(row.gross_minor),
      feePercent: formatPercent(row.platform_fee_percent),
      feeMinor: num(row.platform_fee_minor),
      netMinor: num(row.net_minor),
      status: row.status,
      availableAt: iso(row.available_at)!,
      payoutId: row.payout_id,
      note: row.reversed_reason,
    }
  })
}

export async function listSellerEarnings(client: DatabaseQueryClient, seller: Seller, options: { limit?: number } = {}) {
  const [profileId, companyId] = sellerParams(seller)
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500)
  const result = await client.query<EarningLineRow>(`
    ${EARNING_LINE_SELECT}
    where ${sellerFilter('e', 1, 2)}
    order by e.created_at desc, e.id desc
    limit ${limit + 1}
  `, [profileId, companyId])
  const lines = await mapEarningLines(client, result.rows.slice(0, limit))
  return { lines, hasMore: result.rows.length > limit }
}

/** What a payout for this seller would include right now (call releaseAvailableEarnings first). */
export async function listPayableEarningLines(client: DatabaseQueryClient, seller: Seller) {
  const [profileId, companyId] = sellerParams(seller)
  const result = await client.query<EarningLineRow>(`
    ${EARNING_LINE_SELECT}
    where ${sellerFilter('e', 1, 2)} and e.status = 'available' and e.currency = 'INR' and e.payout_id is null
    order by e.created_at asc, e.id asc
  `, [profileId, companyId])
  return mapEarningLines(client, result.rows)
}

export async function listPayoutEarningLines(client: DatabaseQueryClient, payoutId: string) {
  const result = await client.query<EarningLineRow & { item_active: boolean }>(`
    ${EARNING_LINE_SELECT.replace('from public.seller_earnings e', 'from public.payout_items i join public.seller_earnings e on e.id = i.earning_id')}
    where i.payout_id = $1::uuid
    order by e.created_at asc, e.id asc
  `, [payoutId])
  return mapEarningLines(client, result.rows)
}

// ---------------------------------------------------------------------------
// Payouts
// ---------------------------------------------------------------------------

export type PayoutLine = Payout & { sellerIdentity: SellerIdentity; account: MaskedPayoutAccount | null }

type PayoutLineRow = QueryResultRow & Record<string, unknown>

function payoutLine(row: PayoutLineRow): PayoutLine {
  const payout = mapPayout(row as Parameters<typeof mapPayout>[0])
  const method = row.account_method as PayoutMethod | null
  return {
    ...payout,
    sellerIdentity: identity(row as unknown as NameRow),
    account: method
      ? maskPayoutAccount({
          method,
          holderName: String(row.account_holder_name ?? ''),
          ifsc: (row.account_ifsc as string | null) ?? null,
          last4: (row.account_last4 as string | null) ?? null,
          vpa: (row.account_vpa as string | null) ?? null,
        })
      : null,
  }
}

const PAYOUT_LINE_SELECT = `
  select ${PAYOUT_COLUMNS.split(',').map((column) => `po.${column.trim()}`).join(', ')},
    ${NAME_COLUMNS},
    pa.method as account_method, pa.account_holder_name, pa.bank_ifsc as account_ifsc,
    pa.bank_account_last4 as account_last4, pa.upi_vpa as account_vpa
  from public.payouts po
  ${NAME_JOINS('po')}
  left join public.payout_accounts pa on pa.id = po.payout_account_id
`

export async function listSellerPayouts(client: DatabaseQueryClient, seller: Seller, limit = 50) {
  const [profileId, companyId] = sellerParams(seller)
  const result = await client.query<PayoutLineRow>(`
    ${PAYOUT_LINE_SELECT}
    where ${sellerFilter('po', 1, 2)} and po.status <> 'cancelled'
    order by po.created_at desc
    limit ${Math.min(Math.max(limit, 1), 200)}
  `, [profileId, companyId])
  return result.rows.map(payoutLine)
}

export async function listPayouts(client: DatabaseQueryClient, options: { statuses: PayoutStatus[]; limit?: number }) {
  const result = await client.query<PayoutLineRow>(`
    ${PAYOUT_LINE_SELECT}
    where po.status = any($1::text[])
    order by po.created_at desc
    limit ${Math.min(Math.max(options.limit ?? 50, 1), 200)}
  `, [options.statuses])
  return result.rows.map(payoutLine)
}

export async function getPayoutLine(client: DatabaseQueryClient, payoutId: string) {
  const result = await client.query<PayoutLineRow>(`${PAYOUT_LINE_SELECT} where po.id = $1::uuid`, [payoutId])
  return result.rows[0] ? payoutLine(result.rows[0]) : null
}

// ---------------------------------------------------------------------------
// Admin: payouts queue
// ---------------------------------------------------------------------------

export type PayoutQueueLine = {
  sellerIdentity: SellerIdentity
  currency: string
  availableMinor: number
  earningCount: number
  account: (PayoutAccount & { masked: MaskedPayoutAccount }) | null
  openPayout: { id: string; status: PayoutStatus } | null
}

/** Sellers with money ready for a payout (call releaseAvailableEarnings first, in the same transaction). */
export async function listPayoutQueue(client: DatabaseQueryClient): Promise<PayoutQueueLine[]> {
  const result = await client.query<QueryResultRow & Record<string, unknown>>(`
    with balances as (
      select seller_profile_id, seller_company_id, currency, sum(net_minor) as available_minor, count(*)::int as earning_count
      from public.seller_earnings
      where status = 'available' and payout_id is null
      group by seller_profile_id, seller_company_id, currency
      having sum(net_minor) <> 0
    )
    select b.seller_profile_id, b.seller_company_id, b.currency, b.available_minor, b.earning_count,
      ${NAME_COLUMNS},
      ${ACCOUNT_COLUMNS.split(',').map((column) => `pa.${column.trim()} as account_${column.trim()}`).join(', ')},
      op.id as open_payout_id, op.status as open_payout_status
    from balances b
    ${NAME_JOINS('b')}
    left join public.payout_accounts pa
      on pa.status = 'active'
     and ((b.seller_profile_id is not null and pa.seller_profile_id = b.seller_profile_id)
       or (b.seller_company_id is not null and pa.seller_company_id = b.seller_company_id))
    left join public.payouts op
      on op.status in ('draft', 'processing')
     and ((b.seller_profile_id is not null and op.seller_profile_id = b.seller_profile_id)
       or (b.seller_company_id is not null and op.seller_company_id = b.seller_company_id))
    order by (b.currency = 'INR') desc, b.available_minor desc
    limit 500
  `)
  return result.rows.map((row) => {
    const accountRow = row.account_id ? Object.fromEntries(
      ACCOUNT_COLUMNS.split(',').map((column) => [column.trim(), row[`account_${column.trim()}`]]),
    ) : null
    const account = accountRow ? mapAccount(accountRow as Parameters<typeof mapAccount>[0]) : null
    return {
      sellerIdentity: identity(row as unknown as NameRow),
      currency: String(row.currency),
      availableMinor: num(row.available_minor as string),
      earningCount: num(row.earning_count as number),
      account: account ? { ...account, masked: maskPayoutAccount(account) } : null,
      openPayout: row.open_payout_id ? { id: String(row.open_payout_id), status: row.open_payout_status as PayoutStatus } : null,
    }
  })
}

// ---------------------------------------------------------------------------
// Admin: recent payments across events, courses and plans (read-only)
// ---------------------------------------------------------------------------

export type PaymentType = 'event' | 'course' | 'plan'
export type NormalizedPaymentStatus = 'paid' | 'refunded' | 'failed' | 'cancelled' | 'pending'
export const PAYMENT_TYPES: PaymentType[] = ['event', 'course', 'plan']
export const PAYMENT_STATUSES: NormalizedPaymentStatus[] = ['paid', 'refunded', 'pending', 'failed', 'cancelled']

export type PaymentLine = {
  type: PaymentType
  id: string
  occurredAt: string
  amountMinor: number
  currency: string
  status: NormalizedPaymentStatus
  provider: string | null
  reference: string | null
  title: string
  payerName: string | null
  payerSlug: string | null
}

function normalizedStatusSql(expression: string) {
  return `(case
    when lower(${expression}::text) in ('paid', 'success', 'succeeded', 'captured', 'completed') then 'paid'
    when lower(${expression}::text) in ('refunded', 'partially_refunded') then 'refunded'
    when lower(${expression}::text) in ('failed', 'declined', 'user_dropped', 'rejected') then 'failed'
    when lower(${expression}::text) in ('cancelled', 'canceled', 'expired', 'void', 'terminated') then 'cancelled'
    else 'pending'
  end)`
}

const EVENT_PAYMENTS_SQL = `
  select 'event'::text as type, o.id::text as id, coalesce(o.paid_at, o.created_at) as occurred_at,
    o.amount_minor::bigint as amount_minor, o.currency::text as currency,
    (case
      when o.status = 'refunded' and o.refund_status = 'failed' then 'paid'
      when o.status = 'created' then 'pending'
      else o.status
    end)::text as status,
    o.provider::text as provider, coalesce(o.provider_payment_id, o.provider_order_id)::text as reference,
    o.event_title::text as title, p.full_name::text as payer_name, p.slug::text as payer_slug
  from public.event_payment_orders o
  left join public.profiles p on p.id = o.profile_id
`

type DynamicSource = { sql: string | null; type: PaymentType }

async function coursePaymentsSource(client: DatabaseQueryClient): Promise<DynamicSource> {
  const columns = await tableColumns(client, 'course_payment_orders')
  const amount = pick(columns, ['amount_minor', 'price_minor', 'paid_amount_minor', 'total_minor'])
  const dates = ['paid_at', 'created_at'].filter((name) => columns.has(name))
  if (!columns.has('id') || !amount || !columns.has('status') || !dates.length) return { type: 'course', sql: null }
  const payer = pick(columns, ['profile_id', 'learner_id', 'user_id', 'buyer_id'])
  const references = ['provider_payment_id', 'provider_order_id'].filter((name) => columns.has(name))
  const title = columns.has('course_title') ? 't.course_title::text' : columns.has('course_id') ? 'c.title::text' : "'Course'::text"
  return {
    type: 'course',
    sql: `
      select 'course'::text as type, t.id::text as id, coalesce(${dates.map((name) => `t.${name}`).join(', ')}) as occurred_at,
        t.${amount}::bigint as amount_minor, ${columns.has('currency') ? 't.currency::text' : "'INR'::text"} as currency,
        ${normalizedStatusSql('t.status')}::text as status,
        ${columns.has('provider') ? 't.provider::text' : 'null::text'} as provider,
        ${references.length ? `coalesce(${references.map((name) => `t.${name}::text`).join(', ')})` : 'null::text'} as reference,
        coalesce(${title}, 'Course') as title,
        ${payer ? 'p.full_name::text' : 'null::text'} as payer_name, ${payer ? 'p.slug::text' : 'null::text'} as payer_slug
      from public.course_payment_orders t
      ${payer ? `left join public.profiles p on p.id = t.${payer}` : ''}
      ${title === 'c.title::text' ? 'left join public.courses c on c.id = t.course_id' : ''}
    `,
  }
}

async function planPaymentsSource(client: DatabaseQueryClient): Promise<DynamicSource> {
  const columns = await tableColumns(client, 'subscription_payments')
  const amount = pick(columns, ['amount_minor', 'payment_amount_minor', 'charge_amount_minor'])
  const status = pick(columns, ['status', 'payment_status'])
  const dates = ['paid_at', 'charged_at', 'payment_time', 'created_at'].filter((name) => columns.has(name))
  if (!columns.has('id') || !amount || !status || !dates.length) return { type: 'plan', sql: null }
  const references = ['provider_payment_id', 'cf_payment_id', 'provider_charge_id', 'payment_id'].filter((name) => columns.has(name))
  const payerProfile = pick(columns, ['profile_id', 'user_id'])
  const payerCompany = pick(columns, ['company_id'])
  const plan = pick(columns, ['plan_code', 'plan'])
  return {
    type: 'plan',
    sql: `
      select 'plan'::text as type, t.id::text as id, coalesce(${dates.map((name) => `t.${name}`).join(', ')}) as occurred_at,
        t.${amount}::bigint as amount_minor, ${columns.has('currency') ? 't.currency::text' : "'INR'::text"} as currency,
        ${normalizedStatusSql(`t.${status}`)}::text as status,
        ${columns.has('provider') ? 't.provider::text' : "'cashfree'::text"} as provider,
        ${references.length ? `coalesce(${references.map((name) => `t.${name}::text`).join(', ')})` : 'null::text'} as reference,
        ${plan ? `(case t.${plan}::text when 'creator_pro' then 'Creator Pro' when 'organization_pro' then 'Organization Pro' else coalesce(t.${plan}::text, 'Plan payment') end)` : "'Plan payment'::text"} as title,
        ${payerCompany && payerProfile ? 'coalesce(pc.name, pp.full_name)::text' : payerCompany ? 'pc.name::text' : payerProfile ? 'pp.full_name::text' : 'null::text'} as payer_name,
        ${payerProfile ? 'pp.slug::text' : 'null::text'} as payer_slug
      from public.subscription_payments t
      ${payerProfile ? `left join public.profiles pp on pp.id = t.${payerProfile}` : ''}
      ${payerCompany ? `left join public.companies pc on pc.id = t.${payerCompany}` : ''}
    `,
  }
}

async function paymentSources(client: DatabaseQueryClient) {
  const [course, plan] = await Promise.all([coursePaymentsSource(client), planPaymentsSource(client)])
  const sql = [EVENT_PAYMENTS_SQL, course.sql, plan.sql].filter((part): part is string => Boolean(part))
  const unavailable: PaymentType[] = [course, plan].filter((source) => !source.sql).map((source) => source.type)
  return { unionSql: sql.map((part) => `(${part})`).join(' union all '), unavailable }
}

export async function listRecentPayments(client: DatabaseQueryClient, options: { type: PaymentType | 'all'; status: NormalizedPaymentStatus | 'all'; limit?: number }) {
  const { unionSql, unavailable } = await paymentSources(client)
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500)
  const result = await client.query<QueryResultRow & Record<string, unknown>>(`
    select * from (${unionSql}) payments
    where ($1::text = 'all' or payments.type = $1::text)
      and ($2::text = 'all' or payments.status = $2::text)
    order by payments.occurred_at desc nulls last
    limit ${limit}
  `, [options.type, options.status])
  const lines: PaymentLine[] = result.rows.map((row) => ({
    type: row.type as PaymentType,
    id: String(row.id),
    occurredAt: iso(row.occurred_at as string) ?? new Date(0).toISOString(),
    amountMinor: num(row.amount_minor as string),
    currency: String(row.currency ?? 'INR'),
    status: row.status as NormalizedPaymentStatus,
    provider: (row.provider as string | null) ?? null,
    reference: (row.reference as string | null) ?? null,
    title: String(row.title ?? ''),
    payerName: (row.payer_name as string | null) ?? null,
    payerSlug: (row.payer_slug as string | null) ?? null,
  }))
  return { lines, unavailable }
}

// ---------------------------------------------------------------------------
// Admin: overview totals
// ---------------------------------------------------------------------------

export type CollectedTotal = { type: PaymentType; currency: string; payments: number; collectedMinor: number; refundedMinor: number }
export type LedgerTotal = { currency: string; feesMinor: number; availableMinor: number; pendingMinor: number; inPayoutMinor: number; paidMinor: number }
export type PayoutTotals = { paidOutMinor: number; paidOutCount: number; openCount: number; unconfirmedCount: number; failedCount: number }

export async function getPaymentsOverview(client: DatabaseQueryClient, now: Date = new Date()) {
  const { unionSql, unavailable } = await paymentSources(client)
  const [collected, ledger, payouts] = await Promise.all([
    client.query<QueryResultRow & Record<string, unknown>>(`
      select payments.type, payments.currency,
        count(*) filter (where payments.status in ('paid', 'refunded'))::int as payments,
        coalesce(sum(payments.amount_minor) filter (where payments.status in ('paid', 'refunded')), 0) as collected_minor,
        coalesce(sum(payments.amount_minor) filter (where payments.status = 'refunded'), 0) as refunded_minor
      from (${unionSql}) payments
      group by payments.type, payments.currency
      order by payments.type, payments.currency
    `),
    client.query<QueryResultRow & Record<string, unknown>>(`
      select currency,
        coalesce(sum(platform_fee_minor) filter (where status <> 'reversed'), 0) as fees_minor,
        coalesce(sum(net_minor) filter (where status = 'available' or (status = 'pending' and available_at <= $1::timestamptz)), 0) as available_minor,
        coalesce(sum(net_minor) filter (where status = 'pending' and available_at > $1::timestamptz), 0) as pending_minor,
        coalesce(sum(net_minor) filter (where status = 'in_payout'), 0) as in_payout_minor,
        coalesce(sum(net_minor) filter (where status = 'paid'), 0) as paid_minor
      from public.seller_earnings
      group by currency
      order by currency
    `, [now.toISOString()]),
    client.query<QueryResultRow & Record<string, unknown>>(`
      select
        coalesce(sum(amount_minor) filter (where status = 'success'), 0) as paid_out_minor,
        count(*) filter (where status = 'success')::int as paid_out_count,
        count(*) filter (where status in ('draft', 'processing'))::int as open_count,
        count(*) filter (where status = 'draft')::int as unconfirmed_count,
        count(*) filter (where status in ('failed', 'reversed') and created_at > $1::timestamptz - interval '30 days')::int as failed_count
      from public.payouts
    `, [now.toISOString()]),
  ])
  const payoutRow = payouts.rows[0] ?? {}
  return {
    unavailable,
    collected: collected.rows.map((row): CollectedTotal => ({
      type: row.type as PaymentType,
      currency: String(row.currency),
      payments: num(row.payments as number),
      collectedMinor: num(row.collected_minor as string),
      refundedMinor: num(row.refunded_minor as string),
    })),
    ledger: ledger.rows.map((row): LedgerTotal => ({
      currency: String(row.currency),
      feesMinor: num(row.fees_minor as string),
      availableMinor: num(row.available_minor as string),
      pendingMinor: num(row.pending_minor as string),
      inPayoutMinor: num(row.in_payout_minor as string),
      paidMinor: num(row.paid_minor as string),
    })),
    payouts: {
      paidOutMinor: num(payoutRow.paid_out_minor as string),
      paidOutCount: num(payoutRow.paid_out_count as number),
      openCount: num(payoutRow.open_count as number),
      unconfirmedCount: num(payoutRow.unconfirmed_count as number),
      failedCount: num(payoutRow.failed_count as number),
    } satisfies PayoutTotals,
  }
}

// ---------------------------------------------------------------------------
// Admin: fee overrides and seller search
// ---------------------------------------------------------------------------

export type FeeOverrideLine = { sellerIdentity: SellerIdentity; percent: string; note: string | null; updatedAt: string; updatedByName: string | null }

export async function listFeeOverrides(client: DatabaseQueryClient): Promise<FeeOverrideLine[]> {
  const result = await client.query<QueryResultRow & Record<string, unknown>>(`
    select o.seller_profile_id, o.seller_company_id, o.percent, o.note, o.updated_at, ${NAME_COLUMNS}, u.full_name as updated_by_name
    from public.seller_fee_overrides o
    ${NAME_JOINS('o')}
    left join public.profiles u on u.id = o.updated_by
    order by o.updated_at desc
    limit 500
  `)
  return result.rows.map((row) => ({
    sellerIdentity: identity(row as unknown as NameRow),
    percent: formatPercent(row.percent as string),
    note: (row.note as string | null) ?? null,
    updatedAt: iso(row.updated_at as string)!,
    updatedByName: (row.updated_by_name as string | null) ?? null,
  }))
}

export type SellerSearchResult = { key: string; kind: 'profile' | 'organization'; id: string; name: string; slug: string | null; detail: string | null }

function likePattern(term: string) {
  return `%${term.replace(/[\\%_]/g, (character) => `\\${character}`)}%`
}

export async function searchSellers(client: DatabaseQueryClient, term: string): Promise<SellerSearchResult[]> {
  const text = term.trim().slice(0, 80)
  if (text.length < 2) return []
  const pattern = likePattern(text)
  const [profiles, companies] = await Promise.all([
    client.query<QueryResultRow & { id: string; name: string | null; slug: string | null; detail: string | null }>(`
      select id, full_name as name, slug, headline as detail
      from public.profiles
      where full_name ilike $1::text or slug ilike $1::text
      order by full_name asc, id asc
      limit 8
    `, [pattern]),
    client.query<QueryResultRow & { id: string; name: string | null; slug: string | null; detail: string | null }>(`
      select id, name, slug, website as detail
      from public.companies
      where name ilike $1::text or slug ilike $1::text
      order by name asc, id asc
      limit 8
    `, [pattern]),
  ])
  return [
    ...companies.rows.map((row) => ({ key: `company:${row.id}`, kind: 'organization' as const, id: row.id, name: row.name ?? 'Organization', slug: row.slug, detail: row.detail })),
    ...profiles.rows.map((row) => ({ key: `profile:${row.id}`, kind: 'profile' as const, id: row.id, name: row.name ?? 'Member', slug: row.slug, detail: row.detail })),
  ]
}

export async function getSellerFeePercent(client: DatabaseQueryClient, seller: Seller) {
  const [profileId, companyId] = sellerParams(seller)
  const result = await client.query<QueryResultRow & { percent: string | number }>(`
    select percent from public.seller_fee_overrides where ${sellerFilter('', 1, 2)} limit 1
  `, [profileId, companyId])
  return result.rows[0] ? formatPercent(result.rows[0].percent) : null
}

export type PayoutAuditLine = { id: string; action: string; fromStatus: string | null; toStatus: string | null; actorType: string; actorName: string | null; createdAt: string; note: string | null }

/** The audit trail of one payout (newest first). */
export async function listPayoutAudit(client: DatabaseQueryClient, payoutId: string): Promise<PayoutAuditLine[]> {
  const result = await client.query<QueryResultRow & Record<string, unknown>>(`
    select a.id::text as id, a.action, a.from_status, a.to_status, a.actor_type, p.full_name as actor_name, a.created_at,
      coalesce(a.details->>'reason', a.details->>'note', a.details->>'statusCode') as note
    from public.payment_audit_events a
    left join public.profiles p on p.id = a.actor_profile_id
    where a.subject_type = 'payout' and a.subject_id = $1::text
    order by a.created_at desc, a.id desc
    limit 100
  `, [payoutId])
  return result.rows.map((row) => ({
    id: String(row.id),
    action: String(row.action),
    fromStatus: (row.from_status as string | null) ?? null,
    toStatus: (row.to_status as string | null) ?? null,
    actorType: String(row.actor_type),
    actorName: (row.actor_name as string | null) ?? null,
    createdAt: iso(row.created_at as string)!,
    note: (row.note as string | null) ?? null,
  }))
}
