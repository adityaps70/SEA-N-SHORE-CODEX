import type { QueryResultRow } from 'pg'
import { query as databaseQuery } from '@/lib/db/client'
import { CREDIT_NOTE_COLUMNS, INVOICE_COLUMNS, mapCreditNote, mapInvoice, type TaxCreditNote, type TaxInvoice } from './tax-document-repository'

/**
 * Reads of issued GST documents for the people allowed to see them (C4): the buyer, or a platform administrator
 * (checked only when the viewer is not the buyer). Anyone else gets null, the same as a document that does not exist.
 */

type Query = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>

export type TaxDocumentViewer = {
  profileId: string
  /** Whether the viewer may read every buyer's documents (a platform administrator with MFA). */
  canViewAll: () => Promise<boolean>
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isTaxDocumentId(value: string) {
  return UUID.test(value)
}

async function allowed(viewer: TaxDocumentViewer, invoice: TaxInvoice) {
  if (invoice.buyerProfileId && invoice.buyerProfileId === viewer.profileId) return true
  return viewer.canViewAll()
}

function runQuery(query?: Query): Query {
  return query ?? ((text, values) => databaseQuery<QueryResultRow>(text, values))
}

export async function getInvoiceForViewer(invoiceId: string, viewer: TaxDocumentViewer, query?: Query): Promise<TaxInvoice | null> {
  if (!isTaxDocumentId(invoiceId)) return null
  const [row] = await runQuery(query)(`select ${INVOICE_COLUMNS} from public.tax_invoices invoice where invoice.id = $1::uuid`, [invoiceId])
  if (!row) return null
  const invoice = mapInvoice(row)
  return (await allowed(viewer, invoice)) ? invoice : null
}

export async function getCreditNoteForViewer(
  creditNoteId: string,
  viewer: TaxDocumentViewer,
  query?: Query,
): Promise<{ note: TaxCreditNote; invoice: TaxInvoice } | null> {
  if (!isTaxDocumentId(creditNoteId)) return null
  const run = runQuery(query)
  const [noteRow] = await run(`select ${CREDIT_NOTE_COLUMNS} from public.tax_credit_notes note where note.id = $1::uuid`, [creditNoteId])
  if (!noteRow) return null
  const note = mapCreditNote(noteRow)
  const [invoiceRow] = await run(`select ${INVOICE_COLUMNS} from public.tax_invoices invoice where invoice.id = $1::uuid`, [note.invoiceId])
  if (!invoiceRow) return null
  const invoice = mapInvoice(invoiceRow)
  return (await allowed(viewer, invoice)) ? { note, invoice } : null
}
