import { randomUUID } from 'node:crypto'
import {
  createMediaDownloadUrl,
  createMediaUploadUrl,
  deleteMediaObject,
  headMediaObject,
  readMediaObjectPrefix,
} from '@/lib/aws/storage'
import {
  matchesMessageAttachmentSignature,
  MESSAGE_ATTACHMENT_SIGNATURE_BYTES,
  messageAttachmentContentDisposition,
} from '@/features/messaging/media-policy'
import type { Seller } from '@/features/payments/earnings'
import {
  buildSellerInvoicePath,
  checkSellerInvoiceFile,
  isSellerInvoicePath,
  SELLER_INVOICE_URL_SECONDS,
  type SellerInvoiceContentType,
} from './seller-invoice-rules'

/**
 * Seller invoice files in the private media bucket (C4). Uploads go straight to storage through a five-minute
 * presigned PUT under seller-invoices/{profile|company}-{id}/{period}/; before an invoice is recorded the object is
 * checked (path, stored type and size, and its first bytes). Files are only ever read through
 * /api/payouts/seller-invoices/[invoiceId], which hands the seller or an administrator a five-minute signed URL.
 */

/** A refusal with copy the seller can act on. */
export class SellerInvoiceFileError extends Error {
  constructor(readonly sellerMessage: string) {
    super('seller_invoice_file_rejected')
    this.name = 'SellerInvoiceFileError'
  }
}

export async function createSellerInvoiceUpload(input: { seller: Seller; period: string; name: unknown; mimeType: unknown; size: unknown }) {
  const checked = checkSellerInvoiceFile(input)
  if (!checked.ok) throw new SellerInvoiceFileError(checked.error)
  const storagePath = buildSellerInvoicePath({ seller: input.seller, period: input.period, fileId: randomUUID(), contentType: checked.contentType })
  const uploadUrl = await createMediaUploadUrl({ key: storagePath, contentType: checked.contentType }, SELLER_INVOICE_URL_SECONDS)
  return { storagePath, uploadUrl, contentType: checked.contentType, name: checked.name }
}

async function discard(storagePath: string) {
  try {
    await deleteMediaObject(storagePath)
  } catch {
    // Best effort: an unrecorded object is never served.
  }
}

/**
 * Checks an uploaded invoice file before it is recorded: it is under this seller's folder for this month, the
 * stored type and size match what was declared, and its first bytes really are that type. A file that fails is
 * deleted.
 */
export async function verifySellerInvoiceUpload(input: { seller: Seller; period: string; storagePath: unknown; name: unknown; mimeType: unknown; size: unknown }) {
  const checked = checkSellerInvoiceFile(input)
  if (!checked.ok) throw new SellerInvoiceFileError(checked.error)
  const storagePath = typeof input.storagePath === 'string' ? input.storagePath : ''
  const size = input.size as number
  if (!isSellerInvoicePath(storagePath, { seller: input.seller, period: input.period, contentType: checked.contentType })) {
    throw new SellerInvoiceFileError('This file was not uploaded for this invoice. Choose the file and upload it again.')
  }
  let stored: Awaited<ReturnType<typeof headMediaObject>>
  try {
    stored = await headMediaObject(storagePath)
  } catch {
    throw new SellerInvoiceFileError('The invoice file didn’t finish uploading. Choose the file and upload it again.')
  }
  const storedType = stored.contentType?.split(';', 1)[0]?.trim().toLowerCase() ?? null
  if (storedType !== checked.contentType || stored.contentLength !== size) {
    await discard(storagePath)
    throw new SellerInvoiceFileError('The uploaded file doesn’t match the one you chose. Choose the file and upload it again.')
  }
  let prefix: Uint8Array
  try {
    prefix = await readMediaObjectPrefix(storagePath, Math.min(MESSAGE_ATTACHMENT_SIGNATURE_BYTES, size))
  } catch {
    throw new SellerInvoiceFileError('The invoice file couldn’t be checked. Please upload it again.')
  }
  if (!matchesMessageAttachmentSignature(checked.contentType, prefix)) {
    await discard(storagePath)
    throw new SellerInvoiceFileError('This file isn’t really a PDF or image. Upload the original invoice file.')
  }
  return { storagePath, fileName: checked.name, contentType: checked.contentType as SellerInvoiceContentType, sizeBytes: size }
}

/** A five-minute download URL that serves the file as its checked type, as a download. */
export async function createSellerInvoiceDownloadUrl(input: { storagePath: string; fileName: string; contentType: string }) {
  return createMediaDownloadUrl({
    key: input.storagePath,
    contentType: input.contentType,
    contentDisposition: messageAttachmentContentDisposition({ name: input.fileName, disposition: 'attachment' }),
    expiresInSeconds: SELLER_INVOICE_URL_SECONDS,
  })
}
