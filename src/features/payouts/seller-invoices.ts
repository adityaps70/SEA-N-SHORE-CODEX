import type { QueryResultRow } from 'pg'
import type { DatabaseQueryClient } from '@/lib/db/client'
import { recordPaymentAudit } from '@/features/payments/audit'
import type { Seller } from '@/features/payments/earnings'
import { indiaMonth } from '@/features/tax/gst'
import { courseEarningSql, indiaMonthSql } from './course-payable'
import { getPayoutTaxProfile } from './payout-tax'
import {
  invoiceKindFor,
  isClosedPeriod,
  isPeriod,
  type SellerInvoiceContentType,
  type SellerInvoiceKind,
  type SellerInvoiceStatus,
} from './seller-invoice-rules'

/**
 * Seller invoices for course earnings (public.seller_payout_invoices, migration 0076). One submitted-or-approved
 * invoice per seller and month; a rejected one can be replaced; an approved one is final. Every change is audited.
 */

type Client = Pick<DatabaseQueryClient, 'query'>

export type SellerInvoiceErrorCode =
  | 'tax_details_missing'
  | 'period_invalid'
  | 'period_open'
  | 'nothing_to_invoice'
  | 'already_submitted'
  | 'already_approved'
  | 'amount_mismatch'
  | 'amount_changed'
  | 'not_found'
  | 'not_submitted'

export class SellerInvoiceError extends Error {
  constructor(readonly code: SellerInvoiceErrorCode, readonly expectedMinor: number | null = null) {
    super(code)
    this.name = 'SellerInvoiceError'
  }
}

function sellerColumns(seller: Seller): [string | null, string | null] {
  if (seller.companyId) return [null, seller.companyId]
  if (seller.profileId) return [seller.profileId, null]
  throw new RangeError('seller_required')
}

function sellerMatch(alias: string, profileParam = 1, companyParam = 2) {
  return `(($${profileParam}::uuid is not null and ${alias}.seller_profile_id = $${profileParam}::uuid) or ($${companyParam}::uuid is not null and ${alias}.seller_company_id = $${companyParam}::uuid))`
}

function iso(value: string | Date | null | undefined) {
  if (value === null || value === undefined) return null
  return new Date(value).toISOString()
}

export type SellerInvoice = {
  id: string
  seller: Seller
  period: string
  kind: SellerInvoiceKind
  documentNumber: string
  amountMinor: number
  expectedAmountMinor: number
  storagePath: string
  fileName: string
  contentType: SellerInvoiceContentType
  sizeBytes: number
  status: SellerInvoiceStatus
  reviewNote: string | null
  reviewedAt: string | null
  createdAt: string
}

type InvoiceRow = QueryResultRow & {
  id: string
  seller_profile_id: string | null
  seller_company_id: string | null
  period: string
  document_kind: SellerInvoiceKind
  seller_document_number: string
  amount_minor: string | number
  expected_amount_minor: string | number
  storage_path: string
  file_name: string
  content_type: SellerInvoiceContentType
  size_bytes: number | string
  status: SellerInvoiceStatus
  review_note: string | null
  reviewed_at: string | Date | null
  created_at: string | Date
}

const INVOICE_COLUMNS = `
  id, seller_profile_id, seller_company_id, period, document_kind, seller_document_number, amount_minor,
  expected_amount_minor, storage_path, file_name, content_type, size_bytes, status, review_note, reviewed_at, created_at
`

function mapInvoice(row: InvoiceRow): SellerInvoice {
  return {
    id: row.id,
    seller: row.seller_company_id ? { companyId: row.seller_company_id } : { profileId: row.seller_profile_id! },
    period: row.period,
    kind: row.document_kind,
    documentNumber: row.seller_document_number,
    amountMinor: Number(row.amount_minor),
    expectedAmountMinor: Number(row.expected_amount_minor),
    storagePath: row.storage_path,
    fileName: row.file_name,
    contentType: row.content_type,
    sizeBytes: Number(row.size_bytes),
    status: row.status,
    reviewNote: row.review_note,
    reviewedAt: iso(row.reviewed_at),
    createdAt: iso(row.created_at)!,
  }
}

/** The amount the seller invoices for a month: that month's course earnings (not reversed), in INR. */
export async function getMonthCourseTotal(client: Client, seller: Seller, period: string) {
  if (!isPeriod(period)) throw new SellerInvoiceError('period_invalid')
  const [profileId, companyId] = sellerColumns(seller)
  const result = await client.query<QueryResultRow & { total: string | number }>(`
    select coalesce(sum(e.net_minor), 0) as total from public.seller_earnings e
    where ${sellerMatch('e')} and e.currency = 'INR' and e.status <> 'reversed'
      and ${courseEarningSql('e')} and ${indiaMonthSql('e')} = $3::text
  `, [profileId, companyId, period])
  return Number(result.rows[0]?.total ?? 0)
}

export type SellerInvoiceMonthState = 'not_needed' | 'open' | 'due' | 'submitted' | 'approved' | 'rejected'

export type SellerInvoiceMonth = {
  period: string
  /** The exact amount to invoice. */
  expectedMinor: number
  state: SellerInvoiceMonthState
  /** The current invoice (submitted/approved), else the latest rejected one. */
  invoice: Pick<SellerInvoice, 'id' | 'kind' | 'documentNumber' | 'amountMinor' | 'fileName' | 'status' | 'reviewNote' | 'reviewedAt' | 'createdAt'> | null
}

export function monthState(input: { period: string; expectedMinor: number; invoiceStatus: SellerInvoiceStatus | null; currentMonth: string }): SellerInvoiceMonthState {
  if (input.invoiceStatus === 'approved') return 'approved'
  if (input.invoiceStatus === 'submitted') return 'submitted'
  if (input.expectedMinor <= 0) return 'not_needed'
  if (!isClosedPeriod(input.period, input.currentMonth)) return 'open'
  return input.invoiceStatus === 'rejected' ? 'rejected' : 'due'
}

/** The seller's months with course earnings, newest first (the last 24), with what to invoice and its status. */
export async function listSellerInvoiceMonths(client: Client, seller: Seller, now: Date = new Date()): Promise<SellerInvoiceMonth[]> {
  const [profileId, companyId] = sellerColumns(seller)
  const result = await client.query<QueryResultRow & Record<string, unknown>>(`
    with months as (
      select ${indiaMonthSql('e')} as period, sum(e.net_minor) as expected_minor
      from public.seller_earnings e
      where ${sellerMatch('e')} and e.currency = 'INR' and e.status <> 'reversed' and ${courseEarningSql('e')}
      group by 1
    )
    select m.period, m.expected_minor,
      inv.id as invoice_id, inv.document_kind, inv.seller_document_number, inv.amount_minor, inv.file_name, inv.status,
      inv.review_note, inv.reviewed_at, inv.created_at
    from months m
    left join lateral (
      select i.* from public.seller_payout_invoices i
      where ${sellerMatch('i')} and i.period = m.period
      order by (i.status in ('submitted', 'approved')) desc, i.created_at desc
      limit 1
    ) inv on true
    order by m.period desc
    limit 24
  `, [profileId, companyId])
  const currentMonth = indiaMonth(now)
  return result.rows.map((row) => {
    const expectedMinor = Number(row.expected_minor ?? 0)
    const status = (row.status as SellerInvoiceStatus | null) ?? null
    return {
      period: String(row.period),
      expectedMinor,
      state: monthState({ period: String(row.period), expectedMinor, invoiceStatus: status, currentMonth }),
      invoice: row.invoice_id ? {
        id: String(row.invoice_id),
        kind: row.document_kind as SellerInvoiceKind,
        documentNumber: String(row.seller_document_number),
        amountMinor: Number(row.amount_minor),
        fileName: String(row.file_name),
        status: status!,
        reviewNote: (row.review_note as string | null) ?? null,
        reviewedAt: iso(row.reviewed_at as string | null),
        createdAt: iso(row.created_at as string)!,
      } : null,
    }
  })
}

/**
 * Checks a month can be invoiced now and returns the amount and the document kind. Used before handing out an upload
 * URL (so a wrong amount is refused before the file is sent) and again when the invoice is saved.
 */
export async function checkInvoiceableMonth(client: Client, input: { seller: Seller; period: string; amountMinor: number; now: Date; lock?: boolean }) {
  if (!isPeriod(input.period)) throw new SellerInvoiceError('period_invalid')
  const profile = await getPayoutTaxProfile(client, input.seller, { lock: input.lock })
  if (!profile) throw new SellerInvoiceError('tax_details_missing')
  if (!isClosedPeriod(input.period, indiaMonth(input.now))) throw new SellerInvoiceError('period_open')
  const [profileId, companyId] = sellerColumns(input.seller)
  const current = await client.query<QueryResultRow & { status: SellerInvoiceStatus }>(`
    select status from public.seller_payout_invoices i
    where ${sellerMatch('i')} and i.period = $3::text and i.status in ('submitted', 'approved')
    limit 1
  `, [profileId, companyId, input.period])
  if (current.rows[0]?.status === 'approved') throw new SellerInvoiceError('already_approved')
  if (current.rows[0]?.status === 'submitted') throw new SellerInvoiceError('already_submitted')
  const expectedMinor = await getMonthCourseTotal(client, input.seller, input.period)
  if (expectedMinor <= 0) throw new SellerInvoiceError('nothing_to_invoice')
  if (input.amountMinor !== expectedMinor) throw new SellerInvoiceError('amount_mismatch', expectedMinor)
  return { expectedMinor, kind: invoiceKindFor(profile.gstRegistered) }
}

/** Records a checked, uploaded invoice (status submitted). Run in a transaction. */
export async function createSellerInvoice(tx: DatabaseQueryClient, input: {
  seller: Seller
  period: string
  documentNumber: string
  amountMinor: number
  storagePath: string
  fileName: string
  contentType: SellerInvoiceContentType
  sizeBytes: number
  actorProfileId: string
  now: Date
}): Promise<SellerInvoice> {
  const { expectedMinor, kind } = await checkInvoiceableMonth(tx, { ...input, lock: true })
  const [profileId, companyId] = sellerColumns(input.seller)
  let inserted
  try {
    inserted = await tx.query<InvoiceRow>(`
      insert into public.seller_payout_invoices (
        seller_profile_id, seller_company_id, period, document_kind, seller_document_number, amount_minor, expected_amount_minor,
        storage_path, file_name, content_type, size_bytes, status, submitted_by
      )
      values ($1::uuid, $2::uuid, $3::text, $4::text, $5::text, $6::bigint, $7::bigint, $8::text, $9::text, $10::text, $11::integer, 'submitted', $12::uuid)
      returning ${INVOICE_COLUMNS}
    `, [profileId, companyId, input.period, kind, input.documentNumber, input.amountMinor, expectedMinor, input.storagePath, input.fileName, input.contentType, input.sizeBytes, input.actorProfileId])
  } catch (error) {
    if ((error as { code?: string } | null)?.code === '23505') throw new SellerInvoiceError('already_submitted')
    throw error
  }
  const invoice = mapInvoice(inserted.rows[0]!)
  await recordPaymentAudit(tx, {
    actorType: 'member',
    actorProfileId: input.actorProfileId,
    subjectType: 'seller_invoice',
    subjectId: invoice.id,
    action: 'seller_invoice_submitted',
    toStatus: 'submitted',
    amountMinor: invoice.amountMinor,
    currency: 'INR',
    details: { period: invoice.period, kind: invoice.kind, sellerType: companyId ? 'organization' : 'profile', sellerId: companyId ?? profileId },
  })
  return invoice
}

export async function getSellerInvoice(client: Client, invoiceId: string, options: { lock?: boolean } = {}) {
  const result = await client.query<InvoiceRow>(`
    select ${INVOICE_COLUMNS} from public.seller_payout_invoices where id = $1::uuid ${options.lock ? 'for update' : ''}
  `, [invoiceId])
  return result.rows[0] ? mapInvoice(result.rows[0]) : null
}

export type SellerInvoiceReviewLine = SellerInvoice & {
  sellerName: string
  sellerKind: 'profile' | 'organization'
  sellerSlug: string | null
  /** The month's course total now (it can drop if a sale of that month was refunded since). */
  currentExpectedMinor: number
  gstRegistered: boolean | null
}

/** Admin: invoices waiting for review (oldest first), or recently reviewed ones. */
export async function listSellerInvoicesForReview(client: Client, options: { status: 'submitted' | 'reviewed'; limit?: number }): Promise<SellerInvoiceReviewLine[]> {
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 200)
  const result = await client.query<InvoiceRow & Record<string, unknown>>(`
    select ${INVOICE_COLUMNS.split(',').map((column) => `i.${column.trim()}`).join(', ')},
      sp.full_name as profile_name, sp.slug as profile_slug, sc.name as company_name, sc.slug as company_slug,
      tp.gst_registered,
      (select coalesce(sum(e.net_minor), 0) from public.seller_earnings e
        where ((i.seller_profile_id is not null and e.seller_profile_id = i.seller_profile_id) or (i.seller_company_id is not null and e.seller_company_id = i.seller_company_id))
          and e.currency = 'INR' and e.status <> 'reversed' and ${courseEarningSql('e')} and ${indiaMonthSql('e')} = i.period) as current_expected_minor
    from public.seller_payout_invoices i
    left join public.profiles sp on sp.id = i.seller_profile_id
    left join public.companies sc on sc.id = i.seller_company_id
    left join public.payout_tax_profiles tp
      on (i.seller_profile_id is not null and tp.seller_profile_id = i.seller_profile_id)
      or (i.seller_company_id is not null and tp.seller_company_id = i.seller_company_id)
    where ${options.status === 'submitted' ? "i.status = 'submitted'" : "i.status in ('approved', 'rejected')"}
    order by ${options.status === 'submitted' ? 'i.created_at asc' : 'i.reviewed_at desc'}, i.id asc
    limit ${limit}
  `)
  return result.rows.map((row) => ({
    ...mapInvoice(row),
    sellerName: String((row.seller_company_id ? row.company_name : row.profile_name) ?? (row.seller_company_id ? 'Organization' : 'Former member')),
    sellerKind: row.seller_company_id ? 'organization' : 'profile',
    sellerSlug: ((row.seller_company_id ? row.company_slug : row.profile_slug) as string | null) ?? null,
    currentExpectedMinor: Number(row.current_expected_minor ?? 0),
    gstRegistered: row.gst_registered === null || row.gst_registered === undefined ? null : Boolean(row.gst_registered),
  }))
}

/**
 * Admin: approve or reject a submitted invoice. Approving makes the month's course earnings payable; it is refused
 * when the month's total changed since the invoice was submitted (a refund), so the admin rejects it and the seller
 * invoices the new amount. Run in a transaction.
 */
export async function reviewSellerInvoice(tx: DatabaseQueryClient, input: { invoiceId: string; decision: 'approve' | 'reject'; note: string | null; actorProfileId: string }) {
  const invoice = await getSellerInvoice(tx, input.invoiceId, { lock: true })
  if (!invoice) throw new SellerInvoiceError('not_found')
  if (invoice.status !== 'submitted') throw new SellerInvoiceError('not_submitted')
  if (input.decision === 'approve') {
    const current = await getMonthCourseTotal(tx, invoice.seller, invoice.period)
    if (current !== invoice.amountMinor) throw new SellerInvoiceError('amount_changed', current)
  }
  const status: SellerInvoiceStatus = input.decision === 'approve' ? 'approved' : 'rejected'
  const updated = await tx.query<InvoiceRow>(`
    update public.seller_payout_invoices
    set status = $2::text, review_note = $3::text, reviewed_by = $4::uuid, reviewed_at = now(), updated_at = now()
    where id = $1::uuid and status = 'submitted'
    returning ${INVOICE_COLUMNS}
  `, [invoice.id, status, input.note, input.actorProfileId])
  if (!updated.rows[0]) throw new SellerInvoiceError('not_submitted')
  await recordPaymentAudit(tx, {
    actorType: 'admin',
    actorProfileId: input.actorProfileId,
    subjectType: 'seller_invoice',
    subjectId: invoice.id,
    action: input.decision === 'approve' ? 'seller_invoice_approved' : 'seller_invoice_rejected',
    fromStatus: 'submitted',
    toStatus: status,
    amountMinor: invoice.amountMinor,
    currency: 'INR',
    details: { period: invoice.period, kind: invoice.kind, hasNote: Boolean(input.note) },
  })
  return mapInvoice(updated.rows[0])
}
