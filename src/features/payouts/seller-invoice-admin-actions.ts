'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { withTransaction } from '@/lib/db/client'
import { requirePlatformAdministratorUser } from '@/features/admin/access'
import { adminSellerInvoiceErrorMessage } from './payout-messages'
import { periodLabel } from './seller-invoice-rules'
import { reviewSellerInvoice, SellerInvoiceError } from './seller-invoices'

/** Admin review of course sellers' monthly invoices (C4). Platform administrators with admin MFA only. */

export type SellerInvoiceReviewResult = { ok: true; message: string } | { ok: false; error: string }

const NOT_ADMIN = 'Only Sea N Shore platform administrators can do this.'

class NotAdminError extends Error {}

async function requireAdmin() {
  try {
    return await requirePlatformAdministratorUser()
  } catch (error) {
    if (error instanceof Error && error.message === 'admin_forbidden') throw new NotAdminError()
    throw error
  }
}

function refresh() {
  for (const path of ['/admin/payments/seller-invoices', '/admin/payments/payouts', '/admin/payments/payouts/review', '/settings/earnings']) revalidatePath(path)
}

function logUnexpected(event: string, error: unknown) {
  if (error instanceof NotAdminError || error instanceof SellerInvoiceError) return
  console.error(event, { name: error instanceof Error ? error.name : null })
}

const invoiceId = z.string().uuid()

/** The note the seller sees on a rejected invoice: 5 to 500 characters. */
function checkRejectNote(note: unknown): { ok: true; note: string } | { ok: false; error: string } {
  const text = typeof note === 'string' ? note.trim() : ''
  if (text.length < 5) return { ok: false, error: 'Tell the seller what to fix (at least 5 characters).' }
  if (text.length > 500) return { ok: false, error: 'Keep the note under 500 characters.' }
  return { ok: true, note: text }
}

/** Approves a submitted invoice: the month's course earnings become payable. */
export async function approveSellerInvoiceAction(id: string): Promise<SellerInvoiceReviewResult> {
  const parsed = invoiceId.safeParse(id)
  if (!parsed.success) return { ok: false, error: "We couldn't find this invoice. Refresh the page." }
  try {
    const admin = await requireAdmin()
    const invoice = await withTransaction((tx) => reviewSellerInvoice(tx, { invoiceId: parsed.data, decision: 'approve', note: null, actorProfileId: admin.id }))
    refresh()
    return { ok: true, message: `Approved. The course earnings for ${periodLabel(invoice.period)} can now be paid out.` }
  } catch (error) {
    if (error instanceof NotAdminError) return { ok: false, error: NOT_ADMIN }
    logUnexpected('seller_invoice_approve_failed', error)
    return { ok: false, error: adminSellerInvoiceErrorMessage(error) }
  }
}

/** Rejects a submitted invoice with a note the seller sees; they can then upload a new one. */
export async function rejectSellerInvoiceAction(id: string, note: string): Promise<SellerInvoiceReviewResult> {
  const parsed = invoiceId.safeParse(id)
  if (!parsed.success) return { ok: false, error: "We couldn't find this invoice. Refresh the page." }
  const checkedNote = checkRejectNote(note)
  if (!checkedNote.ok) return { ok: false, error: checkedNote.error }
  try {
    const admin = await requireAdmin()
    const invoice = await withTransaction((tx) => reviewSellerInvoice(tx, { invoiceId: parsed.data, decision: 'reject', note: checkedNote.note, actorProfileId: admin.id }))
    refresh()
    return { ok: true, message: `Rejected. The seller sees your note and can upload a new invoice for ${periodLabel(invoice.period)}.` }
  } catch (error) {
    if (error instanceof NotAdminError) return { ok: false, error: NOT_ADMIN }
    logUnexpected('seller_invoice_reject_failed', error)
    return { ok: false, error: adminSellerInvoiceErrorMessage(error) }
  }
}
