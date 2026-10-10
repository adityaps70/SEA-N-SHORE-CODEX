import type { Seller } from '@/features/payments/earnings'

/**
 * Seller invoices for course earnings (C4), the pure rules shared by the server and the upload form.
 *
 * Course sellers supply their service to Sea N Shore. For every calendar month (in India time) with course
 * earnings, the seller invoices Sea N Shore for exactly that month's course earnings (sales less the platform fee,
 * less course refunds made that month). A GST-registered seller uploads a tax invoice; a seller who is not
 * registered uploads a bill of supply (no GST). A month's course earnings are paid only once its invoice is approved.
 */

export const SELLER_INVOICE_MAX_BYTES = 10 * 1024 * 1024
export const SELLER_INVOICE_URL_SECONDS = 300

export const SELLER_INVOICE_TYPES = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
} as const

export type SellerInvoiceContentType = keyof typeof SELLER_INVOICE_TYPES
export type SellerInvoiceKind = 'tax_invoice' | 'bill_of_supply'
export type SellerInvoiceStatus = 'submitted' | 'approved' | 'rejected'

export const SELLER_INVOICE_ACCEPT = Object.keys(SELLER_INVOICE_TYPES).join(',')

export const SELLER_INVOICE_KIND_LABELS: Record<SellerInvoiceKind, string> = {
  tax_invoice: 'Tax invoice',
  bill_of_supply: 'Bill of supply',
}

const PERIOD_PATTERN = /^[0-9]{4}-(0[1-9]|1[0-2])$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DOCUMENT_NUMBER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9/\-_. ]{0,39}$/

export function isPeriod(value: unknown): value is string {
  return typeof value === 'string' && PERIOD_PATTERN.test(value)
}

/** "2026-09" → "September 2026". */
export function periodLabel(period: string) {
  if (!isPeriod(period)) return period
  const [year, month] = period.split('-').map(Number) as [number, number]
  return new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, 1)))
}

/** "September 2026", "August 2026 and September 2026", "July 2026, August 2026 and September 2026". */
export function listPeriods(periods: string[]) {
  const labels = periods.map(periodLabel)
  if (!labels.length) return 'some months'
  if (labels.length === 1) return labels[0]!
  return `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`
}

/** The month before `month` (YYYY-MM). */
export function previousMonth(month: string) {
  if (!isPeriod(month)) throw new RangeError('month_invalid')
  const [year, monthNumber] = month.split('-').map(Number) as [number, number]
  return monthNumber === 1 ? `${year - 1}-12` : `${year}-${String(monthNumber - 1).padStart(2, '0')}`
}

/** A month can be invoiced once it has ended in India: the seller's invoice covers the whole month. */
export function isClosedPeriod(period: string, currentIndiaMonth: string) {
  return isPeriod(period) && period < currentIndiaMonth
}

export function sellerInvoiceFolder(seller: Seller) {
  return seller.companyId ? `company-${seller.companyId}` : `profile-${seller.profileId}`
}

/** seller-invoices/{profile|company}-{id}/{period}/{uuid}.{ext} — a private object, never served directly. */
export function buildSellerInvoicePath(input: { seller: Seller; period: string; fileId: string; contentType: SellerInvoiceContentType }) {
  if (!isPeriod(input.period) || !UUID_PATTERN.test(input.fileId)) throw new RangeError('seller_invoice_path_invalid')
  return `seller-invoices/${sellerInvoiceFolder(input.seller)}/${input.period}/${input.fileId.toLowerCase()}.${SELLER_INVOICE_TYPES[input.contentType]}`
}

/** True only for a path this seller was given for this period and type. */
export function isSellerInvoicePath(path: string, input: { seller: Seller; period: string; contentType: SellerInvoiceContentType }) {
  if (!isPeriod(input.period)) return false
  const prefix = `seller-invoices/${sellerInvoiceFolder(input.seller)}/${input.period}/`
  if (!path.startsWith(prefix)) return false
  const rest = path.slice(prefix.length)
  const [fileId, extension, ...extra] = rest.split('.')
  return !extra.length && Boolean(fileId) && UUID_PATTERN.test(fileId!) && fileId === fileId!.toLowerCase() && extension === SELLER_INVOICE_TYPES[input.contentType]
}

export type SellerInvoiceFileCheck =
  | { ok: true; contentType: SellerInvoiceContentType; name: string }
  | { ok: false; error: string }

export function checkSellerInvoiceFile(input: { name: unknown; mimeType: unknown; size: unknown }): SellerInvoiceFileCheck {
  const name = typeof input.name === 'string' ? input.name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200) : ''
  if (!name) return { ok: false, error: 'Choose the invoice file to upload.' }
  const mimeType = typeof input.mimeType === 'string' ? input.mimeType.toLowerCase() : ''
  if (!(mimeType in SELLER_INVOICE_TYPES)) return { ok: false, error: 'Upload the invoice as a PDF, JPG, PNG or WebP file.' }
  const size = typeof input.size === 'number' ? input.size : Number.NaN
  if (!Number.isSafeInteger(size) || size < 1) return { ok: false, error: 'This file is empty. Choose the invoice file again.' }
  if (size > SELLER_INVOICE_MAX_BYTES) return { ok: false, error: 'The invoice file is larger than 10 MB. Upload a smaller PDF or image.' }
  return { ok: true, contentType: mimeType as SellerInvoiceContentType, name }
}

export function normaliseDocumentNumber(value: unknown) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''
}

export function isDocumentNumber(value: string) {
  return DOCUMENT_NUMBER_PATTERN.test(value)
}

/** The same-origin route that checks the viewer before redirecting to a five-minute signed URL. */
export function sellerInvoiceFileRoute(invoiceId: string) {
  return `/api/payouts/seller-invoices/${encodeURIComponent(invoiceId)}`
}

/** Which document a seller uploads: registered sellers a tax invoice, others a bill of supply. */
export function invoiceKindFor(gstRegistered: boolean): SellerInvoiceKind {
  return gstRegistered ? 'tax_invoice' : 'bill_of_supply'
}
