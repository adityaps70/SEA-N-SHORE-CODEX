import type { QueryResultRow } from 'pg'
import type { DatabaseQueryClient } from '@/lib/db/client'
import { csvCell } from '@/features/newsletter/csv'

/**
 * The monthly GST document register for the accountant (C4): every tax invoice dated in the month and every credit
 * note dated in the month, one row each, with the amounts exactly as issued. Credit notes are listed with positive
 * amounts and the type "Credit note".
 */

type Client = Pick<DatabaseQueryClient, 'query'>

export type GstExportRow = {
  documentType: 'Invoice' | 'Credit note'
  number: string
  date: string
  againstInvoice: string | null
  buyerName: string
  buyerCompany: string | null
  buyerGstin: string | null
  placeOfSupplyCode: string
  placeOfSupplyName: string
  supplyType: 'B2B' | 'B2C' | 'Export under LUT'
  sac: string
  currency: string
  taxableMinor: number
  cgstMinor: number
  sgstMinor: number
  igstMinor: number
  totalMinor: number
  orderReference: string
}

/** "2026-10" for October 2026; months before 2000 or malformed values are refused. */
export function isExportMonth(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^(2\d{3})-(0[1-9]|1[0-2])$/.test(value)
}

/** Paise as decimal rupees with two decimals, without floating point: 423644 → "4236.44". */
export function decimalAmount(minor: number) {
  const sign = minor < 0 ? '-' : ''
  const absolute = Math.abs(Math.trunc(minor))
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`
}

function supplyTypeLabel(supplyType: string, gstin: unknown): GstExportRow['supplyType'] {
  if (supplyType === 'export_lut') return 'Export under LUT'
  return gstin ? 'B2B' : 'B2C'
}

function dateOnly(value: unknown) {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).slice(0, 10)
}

const ORDER_REFERENCE = `coalesce((select o.provider_order_id from public.course_payment_orders o where o.id = invoice.order_id), invoice.order_id::text)`

export async function listGstDocumentsForMonth(client: Client, month: string): Promise<GstExportRow[]> {
  if (!isExportMonth(month)) throw new Error('gst_export_month_invalid')
  const start = `${month}-01`
  const result = await client.query<QueryResultRow>(
    `select * from (
       select 'Invoice' as document_type, invoice.invoice_number as number, invoice.invoice_date as document_date,
              null::text as against_invoice, invoice.buyer_name, invoice.buyer_company, invoice.buyer_gstin,
              invoice.place_of_supply_code, invoice.place_of_supply_name, invoice.supply_type, invoice.sac, invoice.currency,
              invoice.taxable_minor, invoice.cgst_minor, invoice.sgst_minor, invoice.igst_minor, invoice.total_minor,
              ${ORDER_REFERENCE} as order_reference, 0 as kind_order
       from public.tax_invoices invoice
       where invoice.invoice_date >= $1::date and invoice.invoice_date < ($1::date + interval '1 month')
       union all
       select 'Credit note', note.credit_note_number, note.note_date, invoice.invoice_number, invoice.buyer_name,
              invoice.buyer_company, invoice.buyer_gstin, invoice.place_of_supply_code, invoice.place_of_supply_name,
              invoice.supply_type, invoice.sac, invoice.currency, note.taxable_minor, note.cgst_minor, note.sgst_minor,
              note.igst_minor, note.total_minor, ${ORDER_REFERENCE}, 1
       from public.tax_credit_notes note
       join public.tax_invoices invoice on invoice.id = note.invoice_id
       where note.note_date >= $1::date and note.note_date < ($1::date + interval '1 month')
     ) documents
     order by kind_order asc, number asc`,
    [start],
  )
  return result.rows.map((row) => ({
    documentType: row.document_type === 'Credit note' ? 'Credit note' : 'Invoice',
    number: String(row.number),
    date: dateOnly(row.document_date),
    againstInvoice: row.against_invoice ? String(row.against_invoice) : null,
    buyerName: String(row.buyer_name),
    buyerCompany: row.buyer_company ? String(row.buyer_company) : null,
    buyerGstin: row.buyer_gstin ? String(row.buyer_gstin) : null,
    placeOfSupplyCode: String(row.place_of_supply_code),
    placeOfSupplyName: String(row.place_of_supply_name),
    supplyType: supplyTypeLabel(String(row.supply_type), row.buyer_gstin),
    sac: String(row.sac),
    currency: String(row.currency),
    taxableMinor: Number(row.taxable_minor),
    cgstMinor: Number(row.cgst_minor),
    sgstMinor: Number(row.sgst_minor),
    igstMinor: Number(row.igst_minor),
    totalMinor: Number(row.total_minor),
    orderReference: String(row.order_reference),
  }))
}

const COLUMNS: Array<[string, (row: GstExportRow) => string | null]> = [
  ['Document type', (row) => row.documentType],
  ['Number', (row) => row.number],
  ['Date', (row) => row.date],
  ['Against invoice', (row) => row.againstInvoice],
  ['Buyer name', (row) => row.buyerName],
  ['Buyer company', (row) => row.buyerCompany],
  ['Buyer GSTIN', (row) => row.buyerGstin],
  ['Place of supply code', (row) => row.placeOfSupplyCode],
  ['Place of supply', (row) => row.placeOfSupplyName],
  ['Supply type', (row) => row.supplyType],
  ['SAC', (row) => row.sac],
  ['Currency', (row) => row.currency],
  ['Taxable value', (row) => decimalAmount(row.taxableMinor)],
  ['CGST', (row) => decimalAmount(row.cgstMinor)],
  ['SGST', (row) => decimalAmount(row.sgstMinor)],
  ['IGST', (row) => decimalAmount(row.igstMinor)],
  ['Total', (row) => decimalAmount(row.totalMinor)],
  ['Order ID', (row) => row.orderReference],
]

/** Byte order mark, so spreadsheet apps read the file as UTF-8. */
const BOM = String.fromCharCode(0xfeff)

export function gstDocumentsToCsv(rows: GstExportRow[]) {
  const header = COLUMNS.map(([name]) => csvCell(name)).join(',')
  const lines = rows.map((row) => COLUMNS.map(([, read]) => csvCell(read(row))).join(','))
  return `${BOM}${[header, ...lines].join('\r\n')}\r\n`
}
