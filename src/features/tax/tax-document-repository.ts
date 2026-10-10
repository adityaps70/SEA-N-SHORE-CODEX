import type { QueryResultRow } from 'pg'
import type { DatabaseQueryClient } from '@/lib/db/client'
import { recordPaymentAudit } from '@/features/payments/audit'
import {
  COURSE_SAC,
  creditNoteNumber,
  EXPORT_PLACE_OF_SUPPLY,
  financialYearOf,
  GST_SUPPLIER,
  gstBreakup,
  gstStateName,
  indiaDate,
  invoiceNumber,
  supplyTypeFor,
  type GstSupplier,
  type SupplyType,
} from './gst'
import { lutForDate } from './tax-settings'

/**
 * GST tax invoices and credit notes for course sales (C4): public.tax_invoices and public.tax_credit_notes.
 *
 * An invoice is issued in the same transaction that confirms a paid course order (the learner got access); a credit
 * note in the same transaction that first marks that order refunded. Numbers come from a counter row per series and
 * financial year, locked by the issuing transaction, so a rolled-back purchase never leaves a gap and two purchases at
 * the same moment never share a number. Issued documents can't be changed or deleted (database triggers).
 */

type Client = Pick<DatabaseQueryClient, 'query'>

export type TaxInvoice = {
  id: string
  invoiceNumber: string
  financialYear: string
  orderId: string
  buyerProfileId: string | null
  invoiceDate: string
  issuedAt: string
  supplier: GstSupplier
  buyerName: string
  buyerCompany: string | null
  buyerGstin: string | null
  placeOfSupplyCode: string
  placeOfSupplyName: string
  supplyType: SupplyType
  lutArn: string | null
  sac: string
  description: string
  currency: 'INR' | 'USD'
  gstRateBasisPoints: number
  taxableMinor: number
  cgstMinor: number
  sgstMinor: number
  igstMinor: number
  totalMinor: number
  /** The order reference shown to the buyer (the gateway order id when there is one). */
  orderReference: string
}

export type TaxCreditNote = {
  id: string
  creditNoteNumber: string
  financialYear: string
  invoiceId: string
  noteDate: string
  issuedAt: string
  reason: string
  taxableMinor: number
  cgstMinor: number
  sgstMinor: number
  igstMinor: number
  totalMinor: number
}

function iso(value: unknown) {
  return new Date(value instanceof Date ? value.getTime() : String(value)).toISOString()
}

function dateOnly(value: unknown) {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).slice(0, 10)
}

function money(value: unknown) {
  return Number(value ?? 0)
}

function parseSupplier(value: unknown): GstSupplier {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value
  return (parsed && typeof parsed === 'object' ? parsed : GST_SUPPLIER) as GstSupplier
}

export const INVOICE_COLUMNS = `
  invoice.id, invoice.invoice_number, invoice.financial_year, invoice.order_id, invoice.buyer_profile_id, invoice.invoice_date,
  invoice.issued_at, invoice.supplier, invoice.buyer_name, invoice.buyer_company, invoice.buyer_gstin,
  invoice.place_of_supply_code, invoice.place_of_supply_name, invoice.supply_type, invoice.lut_arn, invoice.sac,
  invoice.description, invoice.currency, invoice.gst_rate_basis_points, invoice.taxable_minor, invoice.cgst_minor,
  invoice.sgst_minor, invoice.igst_minor, invoice.total_minor,
  coalesce((select o.provider_order_id from public.course_payment_orders o where o.id = invoice.order_id), invoice.order_id::text) as order_reference`

export function mapInvoice(row: QueryResultRow): TaxInvoice {
  return {
    id: String(row.id),
    invoiceNumber: String(row.invoice_number),
    financialYear: String(row.financial_year),
    orderId: String(row.order_id),
    buyerProfileId: row.buyer_profile_id ? String(row.buyer_profile_id) : null,
    invoiceDate: dateOnly(row.invoice_date),
    issuedAt: iso(row.issued_at),
    supplier: parseSupplier(row.supplier),
    buyerName: String(row.buyer_name),
    buyerCompany: row.buyer_company ? String(row.buyer_company) : null,
    buyerGstin: row.buyer_gstin ? String(row.buyer_gstin) : null,
    placeOfSupplyCode: String(row.place_of_supply_code),
    placeOfSupplyName: String(row.place_of_supply_name),
    supplyType: row.supply_type as SupplyType,
    lutArn: row.lut_arn ? String(row.lut_arn) : null,
    sac: String(row.sac),
    description: String(row.description),
    currency: row.currency === 'USD' ? 'USD' : 'INR',
    gstRateBasisPoints: Number(row.gst_rate_basis_points),
    taxableMinor: money(row.taxable_minor),
    cgstMinor: money(row.cgst_minor),
    sgstMinor: money(row.sgst_minor),
    igstMinor: money(row.igst_minor),
    totalMinor: money(row.total_minor),
    orderReference: String(row.order_reference ?? row.order_id),
  }
}

export const CREDIT_NOTE_COLUMNS = `
  note.id, note.credit_note_number, note.financial_year, note.invoice_id, note.note_date, note.issued_at, note.reason,
  note.taxable_minor, note.cgst_minor, note.sgst_minor, note.igst_minor, note.total_minor`

export function mapCreditNote(row: QueryResultRow): TaxCreditNote {
  return {
    id: String(row.id),
    creditNoteNumber: String(row.credit_note_number),
    financialYear: String(row.financial_year),
    invoiceId: String(row.invoice_id),
    noteDate: dateOnly(row.note_date),
    issuedAt: iso(row.issued_at),
    reason: String(row.reason),
    taxableMinor: money(row.taxable_minor),
    cgstMinor: money(row.cgst_minor),
    sgstMinor: money(row.sgst_minor),
    igstMinor: money(row.igst_minor),
    totalMinor: money(row.total_minor),
  }
}

/** Takes the next number in a series. Must run inside the issuing transaction: the row lock is held until commit. */
async function nextSequence(client: Client, series: 'invoice' | 'credit_note', financialYear: string) {
  const key = `${series}:${financialYear}`
  await client.query(`insert into public.tax_document_sequences (series) values ($1) on conflict (series) do nothing`, [key])
  const result = await client.query<QueryResultRow>(
    `update public.tax_document_sequences set last_number = last_number + 1, updated_at = now() where series = $1 returning last_number`,
    [key],
  )
  return Number(result.rows[0]!.last_number)
}

type OrderForInvoice = QueryResultRow & {
  id: string
  profile_id: string
  status: string
  amount_minor: string | number
  currency: 'INR' | 'USD'
  course_title: string
  plan_name: string | null
  paid_at: string | Date | null
  enrollment_confirmed_at: string | Date | null
  billing_state_code: string | null
  billing_country: string | null
  billing_company: string | null
  billing_gstin: string | null
  buyer_name: string | null
}

export type InvoiceIssueOutcome =
  | { issued: true; invoice: TaxInvoice; created: boolean }
  | { issued: false; reason: 'order_not_invoiceable' | 'billing_details_missing' | 'lut_missing' }

/**
 * Issues the tax invoice for a paid course order whose learner was enrolled. Idempotent: an order that already has
 * an invoice returns it. Orders started before C4 have no billing state; they get no invoice here (a backfill is a
 * separate, owner-approved step).
 */
export async function issueInvoiceForOrder(client: Client, orderId: string, input: { actorProfileId?: string | null } = {}): Promise<InvoiceIssueOutcome> {
  const existing = await client.query<QueryResultRow>(
    `select ${INVOICE_COLUMNS} from public.tax_invoices invoice where invoice.order_id = $1::uuid`,
    [orderId],
  )
  if (existing.rows[0]) return { issued: true, invoice: mapInvoice(existing.rows[0]), created: false }

  const orderRows = await client.query<OrderForInvoice>(
    `select o.id, o.profile_id, o.status, o.amount_minor, o.currency, o.course_title, o.plan_name, o.paid_at,
            o.enrollment_confirmed_at, o.billing_state_code, o.billing_country, o.billing_company, o.billing_gstin,
            profile.full_name as buyer_name
     from public.course_payment_orders o
     left join public.profiles profile on profile.id = o.profile_id
     where o.id = $1::uuid`,
    [orderId],
  )
  const order = orderRows.rows[0]
  if (!order || order.status !== 'paid' || !order.enrollment_confirmed_at || !order.paid_at) return { issued: false, reason: 'order_not_invoiceable' }

  const paidAt = new Date(order.paid_at instanceof Date ? order.paid_at.getTime() : String(order.paid_at))
  const supplyType = supplyTypeFor({ currency: order.currency, billingStateCode: order.billing_state_code })
  if (supplyType !== 'export_lut' && !gstStateName(order.billing_state_code)) return { issued: false, reason: 'billing_details_missing' }
  const lutArn = supplyType === 'export_lut' ? await lutForDate(paidAt, client) : null
  if (supplyType === 'export_lut' && !lutArn) return { issued: false, reason: 'lut_missing' }

  const totalMinor = Number(order.amount_minor)
  const breakup = gstBreakup(totalMinor, supplyType)
  const financialYear = financialYearOf(paidAt)
  const sequence = await nextSequence(client, 'invoice', financialYear)
  const number = invoiceNumber(financialYear, sequence)
  const placeOfSupply = supplyType === 'export_lut'
    ? EXPORT_PLACE_OF_SUPPLY
    : { code: order.billing_state_code!, name: gstStateName(order.billing_state_code)! }
  const description = `${order.course_title}${order.plan_name ? ` (${order.plan_name})` : ''}: online course access`.slice(0, 300)

  const inserted = await client.query<QueryResultRow>(
    `insert into public.tax_invoices as invoice (
       invoice_number, financial_year, sequence_number, order_id, buyer_profile_id, invoice_date, supplier, buyer_name,
       buyer_company, buyer_gstin, place_of_supply_code, place_of_supply_name, supply_type, lut_arn, sac, description,
       currency, gst_rate_basis_points, taxable_minor, cgst_minor, sgst_minor, igst_minor, total_minor
     ) values ($1, $2, $3, $4::uuid, $5::uuid, $6::date, $7::jsonb, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
     returning ${INVOICE_COLUMNS}`,
    [
      number, financialYear, sequence, order.id, order.profile_id, indiaDate(paidAt), JSON.stringify(GST_SUPPLIER),
      (order.buyer_name ?? '').trim().slice(0, 180) || 'Sea N Shore learner',
      order.billing_company, order.billing_gstin, placeOfSupply.code, placeOfSupply.name, supplyType, lutArn, COURSE_SAC,
      description, order.currency, breakup.rateBasisPoints, breakup.taxableMinor, breakup.cgstMinor, breakup.sgstMinor,
      breakup.igstMinor, breakup.totalMinor,
    ],
  )
  const invoice = mapInvoice(inserted.rows[0]!)
  await client.query(
    `insert into public.tax_document_emails (document_type, document_id) values ('invoice', $1::uuid) on conflict do nothing`,
    [invoice.id],
  )
  await recordPaymentAudit(client as DatabaseQueryClient, {
    actorType: input.actorProfileId ? 'admin' : 'system',
    actorProfileId: input.actorProfileId ?? null,
    subjectType: 'course_payment_order',
    subjectId: order.id,
    action: 'tax_invoice_issued',
    amountMinor: totalMinor,
    currency: order.currency,
    details: { invoiceNumber: number, supplyType },
  })
  return { issued: true, invoice, created: true }
}

/**
 * Issues the credit note that reverses a refunded order's invoice, in full. Idempotent. An order with no invoice (for
 * example one paid before C4, or refunded before access was given) needs no credit note.
 */
export async function issueCreditNoteForOrder(client: Client, orderId: string, input: { reason: string; at?: Date; actorProfileId?: string | null }) {
  const invoiceRows = await client.query<QueryResultRow>(
    `select ${INVOICE_COLUMNS} from public.tax_invoices invoice where invoice.order_id = $1::uuid`,
    [orderId],
  )
  if (!invoiceRows.rows[0]) return null
  const invoice = mapInvoice(invoiceRows.rows[0])
  const existing = await client.query<QueryResultRow>(`select ${CREDIT_NOTE_COLUMNS} from public.tax_credit_notes note where note.invoice_id = $1::uuid`, [invoice.id])
  if (existing.rows[0]) return mapCreditNote(existing.rows[0])

  const at = input.at ?? new Date()
  const financialYear = financialYearOf(at)
  const sequence = await nextSequence(client, 'credit_note', financialYear)
  const number = creditNoteNumber(financialYear, sequence)
  const inserted = await client.query<QueryResultRow>(
    `insert into public.tax_credit_notes as note (
       credit_note_number, financial_year, sequence_number, invoice_id, note_date, reason, taxable_minor, cgst_minor,
       sgst_minor, igst_minor, total_minor
     ) values ($1, $2, $3, $4::uuid, $5::date, $6, $7, $8, $9, $10, $11)
     returning ${CREDIT_NOTE_COLUMNS}`,
    [number, financialYear, sequence, invoice.id, indiaDate(at), input.reason.slice(0, 200) || 'Refund', invoice.taxableMinor,
      invoice.cgstMinor, invoice.sgstMinor, invoice.igstMinor, invoice.totalMinor],
  )
  const note = mapCreditNote(inserted.rows[0]!)
  await client.query(
    `insert into public.tax_document_emails (document_type, document_id) values ('credit_note', $1::uuid) on conflict do nothing`,
    [note.id],
  )
  await recordPaymentAudit(client as DatabaseQueryClient, {
    actorType: input.actorProfileId ? 'admin' : 'system',
    actorProfileId: input.actorProfileId ?? null,
    subjectType: 'course_payment_order',
    subjectId: orderId,
    action: 'tax_credit_note_issued',
    amountMinor: invoice.totalMinor,
    currency: invoice.currency,
    details: { creditNoteNumber: number, invoiceNumber: invoice.invoiceNumber },
  })
  return note
}

/**
 * Runs tax-document work inside a savepoint of the caller's transaction, so a failure here never undoes the payment
 * or refund it belongs to (and the numbering rolls back with it, leaving no gap). The missing document is issued later
 * by the worker sweep (`issueMissingInvoices`).
 */
export async function withTaxSavepoint<T>(client: Client, label: string, work: () => Promise<T>): Promise<T | null> {
  await client.query('savepoint tax_document')
  try {
    const result = await work()
    await client.query('release savepoint tax_document')
    return result
  } catch (error) {
    await client.query('rollback to savepoint tax_document')
    console.error('[tax_document_failed]', { step: label, error: error instanceof Error ? error.message.slice(0, 200) : 'unknown' })
    return null
  }
}

/** Invoices (and credit notes) that a savepoint had to skip, issued again. Orders from before C4 have no billing state and are left alone. */
export async function issueMissingTaxDocuments(transaction: <T>(work: (client: Client) => Promise<T>) => Promise<T>, limit = 25) {
  const pending = await transaction(async (client) => (await client.query<QueryResultRow>(
    `select o.id, o.status
     from public.course_payment_orders o
     left join public.tax_invoices invoice on invoice.order_id = o.id
     left join public.tax_credit_notes note on note.invoice_id = invoice.id
     where o.enrollment_confirmed_at is not null
       and (o.billing_state_code is not null or o.billing_country is not null)
       and ((o.status = 'paid' and invoice.id is null) or (o.status = 'refunded' and invoice.id is not null and note.id is null))
     order by o.paid_at asc
     limit $1`,
    [limit],
  )).rows)
  let invoices = 0
  let creditNotes = 0
  for (const row of pending) {
    await transaction(async (client) => {
      await client.query(`select 1 from public.course_payment_orders where id = $1::uuid for update`, [row.id])
      if (row.status === 'paid') {
        const outcome = await issueInvoiceForOrder(client, String(row.id))
        if (outcome.issued && outcome.created) invoices += 1
      } else {
        const note = await issueCreditNoteForOrder(client, String(row.id), { reason: 'Course purchase refunded' })
        if (note) creditNotes += 1
      }
    })
  }
  return { checked: pending.length, invoices, creditNotes }
}
