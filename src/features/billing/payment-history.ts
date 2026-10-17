import type { QueryResultRow } from 'pg'
import { query as databaseQuery } from '@/lib/db/client'
import { formatMoney } from '@/features/payments/currency'
import { displayName } from '@/features/profiles/display-name'
import { INTERVAL_LABELS, PLAN_LABELS, type BillingInterval, type PaidPlanCode } from './plans'

/**
 * Round H (H7): Payment history on Settings › Membership & billing and on an organization's Plan & billing, with a
 * PDF for each payment. READ ONLY: it reads subscription_payments, course_payment_orders, event_payment_orders and
 * tax_invoices / tax_credit_notes, and never writes.
 *
 * - Course purchases and seat packs link to their GST tax invoice (and credit note after a refund), issued at purchase
 *   (/api/learn/invoices, /api/learn/credit-notes).
 * - Subscription payments and event tickets carry no invoice number or GST breakdown, so they get a "Payment receipt"
 *   PDF (/api/billing/receipts/…), clearly not a tax invoice. Issuing GST invoices for them needs a sequential
 *   invoice-number series, which is a schema and payment-flow change.
 */

type Query = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>

export type PaymentKind = 'subscription' | 'course' | 'seat_pack' | 'event'
export type PaymentStatusTone = 'success' | 'pending' | 'failed' | 'neutral'

export type PaymentHistoryEntry = {
  id: string
  kind: PaymentKind
  /** ISO timestamp the list is ordered by (paid, scheduled or created). */
  at: string
  item: string
  amountMinor: number
  currency: string
  status: 'paid' | 'refunded' | 'failed' | 'scheduled' | 'cancelled'
  invoiceId: string | null
  invoiceNumber: string | null
  creditNoteId: string | null
  creditNoteNumber: string | null
}

export type PaymentDocumentLink = { href: string; label: string }

export type PaymentHistoryRow = {
  id: string
  date: string
  item: string
  amount: string
  status: string
  tone: PaymentStatusTone
  documents: PaymentDocumentLink[]
}

const STATUS: Record<PaymentHistoryEntry['status'], { label: string; tone: PaymentStatusTone }> = {
  paid: { label: 'Paid', tone: 'success' },
  refunded: { label: 'Refunded', tone: 'neutral' },
  failed: { label: 'Failed — not charged', tone: 'failed' },
  scheduled: { label: 'Scheduled', tone: 'pending' },
  cancelled: { label: 'Cancelled — not charged', tone: 'neutral' },
}

export function paymentDate(value: string | null | undefined, timeZone = 'Asia/Kolkata') {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone }).format(date)
}

/** The PDFs for one payment: the tax invoice (and credit note) when issued, otherwise a payment receipt once paid. */
export function paymentDocuments(entry: PaymentHistoryEntry): PaymentDocumentLink[] {
  if (entry.kind === 'course' || entry.kind === 'seat_pack') {
    const links: PaymentDocumentLink[] = []
    if (entry.invoiceId) links.push({ href: `/api/learn/invoices/${entry.invoiceId}`, label: entry.invoiceNumber ? `Tax invoice ${entry.invoiceNumber}` : 'Tax invoice' })
    if (entry.creditNoteId) links.push({ href: `/api/learn/credit-notes/${entry.creditNoteId}`, label: entry.creditNoteNumber ? `Credit note ${entry.creditNoteNumber}` : 'Credit note' })
    return links
  }
  if (entry.status !== 'paid' && entry.status !== 'refunded') return []
  return [{ href: `/api/billing/receipts/${entry.kind}/${entry.id}`, label: 'Payment receipt' }]
}

export function paymentHistoryRows(entries: readonly PaymentHistoryEntry[]): PaymentHistoryRow[] {
  return [...entries]
    .sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id))
    .map((entry) => ({
      id: `${entry.kind}-${entry.id}`,
      date: paymentDate(entry.at),
      item: entry.item,
      amount: formatMoney(entry.amountMinor, entry.currency),
      status: STATUS[entry.status].label,
      tone: STATUS[entry.status].tone,
      documents: paymentDocuments(entry),
    }))
}

function iso(value: unknown) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(String(value))
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function planItem(planCode: unknown, interval: unknown, periodStart: unknown, periodEnd: unknown) {
  const plan = PLAN_LABELS[planCode as PaidPlanCode] ?? 'Plan'
  const cadence = INTERVAL_LABELS[interval as BillingInterval]?.adjective.toLowerCase()
  const start = iso(periodStart)
  const end = iso(periodEnd)
  const period = start && end ? ` · ${paymentDate(start)} – ${paymentDate(end)}` : ''
  return `${plan}${cadence ? ` · ${cadence}` : ''}${period}`
}

function subscriptionStatus(value: unknown): PaymentHistoryEntry['status'] {
  if (value === 'success') return 'paid'
  if (value === 'failed') return 'failed'
  if (value === 'cancelled') return 'cancelled'
  return 'scheduled'
}

function mapSubscription(row: QueryResultRow): PaymentHistoryEntry {
  return {
    id: String(row.id),
    kind: 'subscription',
    at: iso(row.paid_at) ?? iso(row.scheduled_for) ?? iso(row.created_at) ?? new Date(0).toISOString(),
    item: planItem(row.plan_code, row.billing_interval, row.period_start, row.period_end),
    amountMinor: Number(row.amount_minor),
    currency: String(row.currency ?? 'INR'),
    status: subscriptionStatus(row.status),
    invoiceId: null,
    invoiceNumber: null,
    creditNoteId: null,
    creditNoteNumber: null,
  }
}

function mapCourseOrder(row: QueryResultRow): PaymentHistoryEntry {
  const seatPack = Boolean(row.seat_company_id)
  const title = String(row.course_title || 'Course')
  const item = seatPack
    ? `Seat pack · ${Number(row.seat_quantity ?? 0)} ${Number(row.seat_quantity) === 1 ? 'seat' : 'seats'} · ${title}`
    : `Course · ${title}${row.plan_name ? ` (${row.plan_name})` : ''}`
  return {
    id: String(row.id),
    kind: seatPack ? 'seat_pack' : 'course',
    at: iso(row.paid_at) ?? iso(row.created_at) ?? new Date(0).toISOString(),
    item,
    amountMinor: Number(row.amount_minor),
    currency: String(row.currency ?? 'INR'),
    status: row.status === 'refunded' ? 'refunded' : 'paid',
    invoiceId: row.invoice_id ? String(row.invoice_id) : null,
    invoiceNumber: row.invoice_number ? String(row.invoice_number) : null,
    creditNoteId: row.credit_note_id ? String(row.credit_note_id) : null,
    creditNoteNumber: row.credit_note_number ? String(row.credit_note_number) : null,
  }
}

function mapEventOrder(row: QueryResultRow): PaymentHistoryEntry {
  return {
    id: String(row.id),
    kind: 'event',
    at: iso(row.paid_at) ?? iso(row.created_at) ?? new Date(0).toISOString(),
    item: `Event ticket · ${String(row.event_title || 'Event')}`,
    amountMinor: Number(row.amount_minor),
    currency: String(row.currency ?? 'INR'),
    status: row.status === 'refunded' ? 'refunded' : 'paid',
    invoiceId: null,
    invoiceNumber: null,
    creditNoteId: null,
    creditNoteNumber: null,
  }
}

const SUBSCRIPTION_COLUMNS = `payment.id, payment.amount_minor, payment.currency, payment.status, payment.paid_at, payment.scheduled_for,
  payment.created_at, payment.period_start, payment.period_end, checkout.plan_code, checkout.billing_interval`

const COURSE_ORDER_COLUMNS = `o.id, o.course_title, o.plan_name, o.seat_company_id, o.seat_quantity, o.amount_minor, o.currency, o.status,
  o.paid_at, o.created_at, invoice.id as invoice_id, invoice.invoice_number, note.id as credit_note_id, note.credit_note_number`

/** Who may download an organization's receipts: its approved owner or administrators (as for Plan & billing). */
export function organizationBillingAdminSql(companyColumn: string, viewerParam: string) {
  return `exists (
    select 1 from public.company_members billing_admin
    where billing_admin.company_id = ${companyColumn}
      and billing_admin.user_id = ${viewerParam}
      and billing_admin.approved_at is not null
      and billing_admin.role::text in ('owner', 'administrator')
  )`
}

export type SubscriptionReceiptRecord = {
  id: string
  reference: string
  paidAt: string
  amountMinor: number
  currency: string
  item: string
  payerName: string | null
  organizationName: string | null
  refunded: false
}

export type EventReceiptRecord = {
  id: string
  reference: string
  paidAt: string
  amountMinor: number
  currency: string
  item: string
  payerName: string | null
  organizationName: null
  refunded: boolean
}

export type PaymentReceiptRecord = SubscriptionReceiptRecord | EventReceiptRecord

const HISTORY_LIMIT = 100

export function createPaymentHistoryRepository(input: { query?: Query } = {}) {
  const queryRows: Query = input.query ?? ((text, values) => databaseQuery<QueryResultRow>(text, values))

  /** A member's own payments: Creator Pro, courses bought for themselves and event tickets. */
  async function listForProfile(profileId: string): Promise<PaymentHistoryEntry[]> {
    const [subscriptions, courses, events] = await Promise.all([
      queryRows(
        `select ${SUBSCRIPTION_COLUMNS}
         from public.subscription_payments payment
         inner join public.subscription_checkouts checkout on checkout.id = payment.checkout_id
         where payment.profile_id = $1 and payment.company_id is null and payment.payment_type = 'CHARGE'
         order by coalesce(payment.paid_at, payment.scheduled_for, payment.created_at) desc
         limit $2`,
        [profileId, HISTORY_LIMIT],
      ),
      queryRows(
        `select ${COURSE_ORDER_COLUMNS}
         from public.course_payment_orders o
         left join public.tax_invoices invoice on invoice.order_id = o.id
         left join public.tax_credit_notes note on note.invoice_id = invoice.id
         where o.profile_id = $1 and o.seat_company_id is null and o.status in ('paid', 'refunded')
         order by coalesce(o.paid_at, o.created_at) desc
         limit $2`,
        [profileId, HISTORY_LIMIT],
      ),
      queryRows(
        `select e.id, e.event_title, e.amount_minor, e.currency, e.status, e.paid_at, e.created_at
         from public.event_payment_orders e
         where e.profile_id = $1 and e.status in ('paid', 'refunded')
         order by coalesce(e.paid_at, e.created_at) desc
         limit $2`,
        [profileId, HISTORY_LIMIT],
      ),
    ])
    return [...subscriptions.map(mapSubscription), ...courses.map(mapCourseOrder), ...events.map(mapEventOrder)]
  }

  /** An organization's payments: Organization Pro and the seat packs bought for it. */
  async function listForCompany(companyId: string): Promise<PaymentHistoryEntry[]> {
    const [subscriptions, seatPacks] = await Promise.all([
      queryRows(
        `select ${SUBSCRIPTION_COLUMNS}
         from public.subscription_payments payment
         inner join public.subscription_checkouts checkout on checkout.id = payment.checkout_id
         where payment.company_id = $1 and payment.payment_type = 'CHARGE'
         order by coalesce(payment.paid_at, payment.scheduled_for, payment.created_at) desc
         limit $2`,
        [companyId, HISTORY_LIMIT],
      ),
      queryRows(
        `select ${COURSE_ORDER_COLUMNS}
         from public.course_payment_orders o
         left join public.tax_invoices invoice on invoice.order_id = o.id
         left join public.tax_credit_notes note on note.invoice_id = invoice.id
         where o.seat_company_id = $1 and o.status in ('paid', 'refunded')
         order by coalesce(o.paid_at, o.created_at) desc
         limit $2`,
        [companyId, HISTORY_LIMIT],
      ),
    ])
    return [...subscriptions.map(mapSubscription), ...seatPacks.map(mapCourseOrder)]
  }

  /**
   * A successful subscription payment, for the member who paid it (personal plan) or an owner or administrator of
   * the organization it was for. Anyone else, and any payment that was not taken, gets null.
   */
  async function getSubscriptionReceipt(paymentId: string, viewerId: string): Promise<SubscriptionReceiptRecord | null> {
    const [row] = await queryRows(
      `select ${SUBSCRIPTION_COLUMNS}, payment.provider_payment_id, payment.cf_payment_id,
              payer.full_name as payer_name, company.name as company_name
       from public.subscription_payments payment
       inner join public.subscription_checkouts checkout on checkout.id = payment.checkout_id
       left join public.profiles payer on payer.id = payment.profile_id
       left join public.companies company on company.id = payment.company_id
       where payment.id = $1::uuid
         and payment.status = 'success'
         and payment.payment_type = 'CHARGE'
         and payment.paid_at is not null
         and (
           (payment.company_id is null and payment.profile_id = $2::uuid)
           or (payment.company_id is not null and ${organizationBillingAdminSql('payment.company_id', '$2::uuid')})
         )
       limit 1`,
      [paymentId, viewerId],
    )
    if (!row) return null
    return {
      id: String(row.id),
      reference: String(row.cf_payment_id ?? row.provider_payment_id ?? row.id),
      paidAt: iso(row.paid_at)!,
      amountMinor: Number(row.amount_minor),
      currency: String(row.currency ?? 'INR'),
      item: planItem(row.plan_code, row.billing_interval, row.period_start, row.period_end),
      payerName: row.payer_name ? displayName(String(row.payer_name)) : null,
      organizationName: row.company_name ? String(row.company_name) : null,
      refunded: false,
    }
  }

  /** A paid (or later refunded) event ticket, for the member who bought it only. */
  async function getEventReceipt(orderId: string, viewerId: string): Promise<EventReceiptRecord | null> {
    const [row] = await queryRows(
      `select e.id, e.event_title, e.amount_minor, e.currency, e.status, e.paid_at, e.provider_payment_id, e.provider_order_id,
              payer.full_name as payer_name
       from public.event_payment_orders e
       left join public.profiles payer on payer.id = e.profile_id
       where e.id = $1::uuid and e.profile_id = $2::uuid and e.status in ('paid', 'refunded') and e.paid_at is not null
       limit 1`,
      [orderId, viewerId],
    )
    if (!row) return null
    return {
      id: String(row.id),
      reference: String(row.provider_payment_id ?? row.provider_order_id ?? row.id),
      paidAt: iso(row.paid_at)!,
      amountMinor: Number(row.amount_minor),
      currency: String(row.currency ?? 'INR'),
      item: `Event ticket · ${String(row.event_title || 'Event')}`,
      payerName: row.payer_name ? displayName(String(row.payer_name)) : null,
      organizationName: null,
      refunded: row.status === 'refunded',
    }
  }

  return { listForProfile, listForCompany, getSubscriptionReceipt, getEventReceipt }
}

export const paymentHistoryRepository = createPaymentHistoryRepository()
