'use server'

import { revalidatePath } from 'next/cache'
import { withTransaction } from '@/lib/db/client'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { sellerInvoiceErrorMessage } from './payout-messages'
import { canManageSeller } from './payout-repository'
import { parseSellerKey, parseRupeesToMinor } from './payout-rules'
import { readClient } from './payout-runtime'
import { parseTaxProfileInput, savePayoutTaxProfile, type MaskedPayoutTaxProfile, type TaxProfileFieldErrors } from './payout-tax'
import { createSellerInvoiceUpload, SellerInvoiceFileError, verifySellerInvoiceUpload } from './seller-invoice-files'
import { isDocumentNumber, isPeriod, normaliseDocumentNumber, periodLabel } from './seller-invoice-rules'
import { checkInvoiceableMonth, createSellerInvoice, SellerInvoiceError } from './seller-invoices'

/**
 * Course sellers' tax details and monthly invoices (C4). Only the member themselves, or an approved owner or
 * administrator of the organization, may act for a seller (canManageSeller). The PAN is never logged.
 */

export type SaveTaxDetailsResult =
  | { ok: true; message: string; profile: MaskedPayoutTaxProfile }
  | { ok: false; error: string; fieldErrors?: TaxProfileFieldErrors }

export type StartInvoiceUploadResult =
  | { ok: true; uploadUrl: string; storagePath: string; contentType: string }
  | { ok: false; error: string; field?: 'documentNumber' | 'amount' | 'file' }

export type SubmitInvoiceResult = { ok: true; message: string } | { ok: false; error: string; field?: 'documentNumber' | 'amount' | 'file' }

const FORBIDDEN = 'You can only do this for yourself or for an organization you own or administer.'

function refresh() {
  for (const path of ['/settings/payouts', '/settings/earnings', '/admin/payments/payouts', '/admin/payments/seller-invoices']) revalidatePath(path)
}

function logUnexpected(event: string, error: unknown) {
  if (error instanceof SellerInvoiceError || error instanceof SellerInvoiceFileError) return
  // Only the error name and, for database errors, the SQLSTATE and constraint name: never the PAN, GSTIN,
  // file name or amounts.
  const details = error && typeof error === 'object' ? error as { code?: unknown; constraint?: unknown } : {}
  console.error(event, {
    name: error instanceof Error ? error.name : null,
    code: typeof details.code === 'string' && /^[0-9A-Z]{5}$/.test(details.code) ? details.code : null,
    constraint: typeof details.constraint === 'string' && /^[a-z0-9_]{1,63}$/.test(details.constraint) ? details.constraint : null,
  })
}

async function authorise(sellerKeyValue: unknown) {
  const seller = parseSellerKey(sellerKeyValue)
  if (!seller) return null
  const user = await requireAwsUser()
  if (!await canManageSeller(readClient, user.id, seller)) return { seller, user, allowed: false as const }
  return { seller, user, allowed: true as const }
}

/** Saves the seller's legal name, PAN and GST registration. */
export async function saveTaxDetailsAction(sellerKeyValue: string, details: Record<string, unknown>): Promise<SaveTaxDetailsResult> {
  const parsed = parseTaxProfileInput({
    legalName: details?.legalName,
    pan: details?.pan,
    gstRegistered: details?.gstRegistered,
    gstin: details?.gstin,
  })
  if (!parsed.ok) return { ok: false, error: 'Check the highlighted fields.', fieldErrors: parsed.fieldErrors }
  try {
    const access = await authorise(sellerKeyValue)
    if (!access) return { ok: false, error: 'Choose whose tax details these are, then try again.' }
    if (!access.allowed) return { ok: false, error: FORBIDDEN }
    const profile = await withTransaction((tx) => savePayoutTaxProfile(tx, { ...parsed.input, seller: access.seller, actorProfileId: access.user.id }))
    refresh()
    return {
      ok: true,
      profile,
      message: profile.gstRegistered
        ? `Tax details saved. PAN ${profile.maskedPan}, GST registered: upload a tax invoice for each month of course earnings.`
        : `Tax details saved. PAN ${profile.maskedPan}, not GST registered: upload a bill of supply (no GST) for each month of course earnings.`,
    }
  } catch (error) {
    logUnexpected('payout_tax_profile_save_failed', error)
    return { ok: false, error: "We couldn't save your tax details. Nothing was changed. Please try again." }
  }
}

type InvoiceInput = { period?: unknown; documentNumber?: unknown; amount?: unknown; name?: unknown; mimeType?: unknown; size?: unknown; storagePath?: unknown }

function readInvoiceFields(input: InvoiceInput):
  | { ok: true; period: string; documentNumber: string; amountMinor: number }
  | { ok: false; error: string; field?: 'documentNumber' | 'amount' } {
  if (!isPeriod(input?.period)) return { ok: false, error: 'Choose the month this invoice is for.' }
  const documentNumber = normaliseDocumentNumber(input.documentNumber)
  if (!isDocumentNumber(documentNumber)) {
    return { ok: false, field: 'documentNumber', error: 'Enter your invoice number as it appears on the invoice (up to 40 letters, digits, / - _ or .).' }
  }
  const amountMinor = typeof input.amount === 'string' ? parseRupeesToMinor(input.amount) : null
  if (amountMinor === null || amountMinor <= 0) return { ok: false, field: 'amount', error: 'Enter the invoice total in rupees, for example 4237.50.' }
  return { ok: true, period: input.period, documentNumber, amountMinor }
}

function invoiceFailure(error: unknown): { ok: false; error: string; field?: 'amount' | 'file' } {
  if (error instanceof SellerInvoiceFileError) return { ok: false, error: error.sellerMessage, field: 'file' }
  if (error instanceof SellerInvoiceError) {
    return { ok: false, error: sellerInvoiceErrorMessage(error), ...(error.code === 'amount_mismatch' ? { field: 'amount' as const } : {}) }
  }
  return { ok: false, error: "We couldn't upload this invoice. Nothing was saved. Please try again." }
}

/**
 * Step 1 of an invoice upload: checks the month, the amount and the file, then hands out a five-minute upload URL.
 * A wrong amount is refused here, before the file is sent.
 */
export async function startSellerInvoiceUploadAction(sellerKeyValue: string, input: InvoiceInput): Promise<StartInvoiceUploadResult> {
  const fields = readInvoiceFields(input)
  if (!fields.ok) return fields
  try {
    const access = await authorise(sellerKeyValue)
    if (!access) return { ok: false, error: 'Choose whose invoice this is, then try again.' }
    if (!access.allowed) return { ok: false, error: FORBIDDEN }
    await checkInvoiceableMonth(readClient, { seller: access.seller, period: fields.period, amountMinor: fields.amountMinor, now: new Date() })
    const upload = await createSellerInvoiceUpload({ seller: access.seller, period: fields.period, name: input.name, mimeType: input.mimeType, size: input.size })
    return { ok: true, uploadUrl: upload.uploadUrl, storagePath: upload.storagePath, contentType: upload.contentType }
  } catch (error) {
    logUnexpected('seller_invoice_upload_start_failed', error)
    return invoiceFailure(error)
  }
}

/** Step 2: after the browser uploaded the file, checks it and records the invoice for review. */
export async function submitSellerInvoiceAction(sellerKeyValue: string, input: InvoiceInput): Promise<SubmitInvoiceResult> {
  const fields = readInvoiceFields(input)
  if (!fields.ok) return fields
  try {
    const access = await authorise(sellerKeyValue)
    if (!access) return { ok: false, error: 'Choose whose invoice this is, then try again.' }
    if (!access.allowed) return { ok: false, error: FORBIDDEN }
    const file = await verifySellerInvoiceUpload({ seller: access.seller, period: fields.period, storagePath: input.storagePath, name: input.name, mimeType: input.mimeType, size: input.size })
    await withTransaction((tx) => createSellerInvoice(tx, {
      seller: access.seller,
      period: fields.period,
      documentNumber: fields.documentNumber,
      amountMinor: fields.amountMinor,
      storagePath: file.storagePath,
      fileName: file.fileName,
      contentType: file.contentType,
      sizeBytes: file.sizeBytes,
      actorProfileId: access.user.id,
      now: new Date(),
    }))
    refresh()
    return { ok: true, message: `Invoice for ${periodLabel(fields.period)} sent for review. Your course earnings for that month are paid once it is approved.` }
  } catch (error) {
    logUnexpected('seller_invoice_submit_failed', error)
    return invoiceFailure(error)
  }
}
