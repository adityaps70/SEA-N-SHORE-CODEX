import { canUsePlatformAdminAuthority } from '@/features/admin/mfa-gate'
import { getVerifiedUser } from '@/features/auth/queries'
import { buildTaxInvoicePdf, taxDocumentFileName } from '@/features/tax/tax-document-pdf'
import { getInvoiceForViewer, isTaxDocumentId } from '@/features/tax/tax-document-queries'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function textResponse(message: string, status: number) {
  return new Response(message, { status, headers: { 'Cache-Control': 'private, no-store', 'Content-Type': 'text/plain; charset=utf-8' } })
}

/** C4: the GST tax invoice PDF, for its buyer or a platform administrator. Anyone else gets 404. */
export async function GET(_request: Request, { params }: { params: Promise<{ invoiceId: string }> }) {
  const user = await getVerifiedUser()
  if (!user) return textResponse('Sign in to download your invoice.', 401)
  const { invoiceId } = await params
  if (!isTaxDocumentId(invoiceId)) return textResponse('Not found', 404)

  try {
    const invoice = await getInvoiceForViewer(invoiceId, { profileId: user.id, canViewAll: () => canUsePlatformAdminAuthority(user.id) })
    if (!invoice) return textResponse('Not found', 404)
    const bytes = await buildTaxInvoicePdf(invoice)
    return new Response(Buffer.from(bytes), {
      status: 200,
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${taxDocumentFileName(invoice.invoiceNumber)}"`,
      },
    })
  } catch (error) {
    console.error('[tax_invoice_download_failed]', { error: error instanceof Error ? error.name : 'unknown' })
    return textResponse('The invoice could not be created. Please try again.', 500)
  }
}
