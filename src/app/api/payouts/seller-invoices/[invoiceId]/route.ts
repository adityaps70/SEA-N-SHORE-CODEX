import { canUsePlatformAdminAuthority } from '@/features/admin/mfa-gate'
import { AwsAuthenticationRequiredError, requireAwsUser } from '@/features/auth/aws-queries'
import { canManageSeller } from '@/features/payouts/payout-repository'
import { readClient } from '@/features/payouts/payout-runtime'
import { createSellerInvoiceDownloadUrl } from '@/features/payouts/seller-invoice-files'
import { getSellerInvoice } from '@/features/payouts/seller-invoices'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function notAvailable() {
  return Response.json({ error: 'This file is not available.' }, { status: 404, headers: PRIVATE_HEADERS })
}

/**
 * Downloads a course seller's invoice (C4). Only someone who manages the seller (the member, or an approved owner or
 * administrator of the organization) and platform administrators with admin MFA get a redirect to a five-minute
 * signed URL; everyone else gets 404, so the file's existence is not revealed. Nothing here is cached.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ invoiceId: string }> },
) {
  const { invoiceId } = await context.params
  if (!UUID_PATTERN.test(invoiceId)) return notAvailable()

  let viewerId: string
  try {
    viewerId = (await requireAwsUser()).id
  } catch (error) {
    if (error instanceof AwsAuthenticationRequiredError) {
      return Response.json({ error: 'Please sign in to download this file.' }, { status: 401, headers: PRIVATE_HEADERS })
    }
    throw error
  }

  const invoice = await getSellerInvoice(readClient, invoiceId)
  if (!invoice) return notAvailable()
  const allowed = await canManageSeller(readClient, viewerId, invoice.seller) || await canUsePlatformAdminAuthority(viewerId)
  if (!allowed) return notAvailable()

  const url = await createSellerInvoiceDownloadUrl(invoice)
  return new Response(null, { status: 302, headers: { ...PRIVATE_HEADERS, Location: url } })
}
