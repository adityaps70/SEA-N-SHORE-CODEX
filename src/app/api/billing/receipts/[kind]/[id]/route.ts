import { getVerifiedUser } from '@/features/auth/queries'
import { paymentHistoryRepository } from '@/features/billing/payment-history'
import { buildPaymentReceiptPdf, paymentReceiptFileName } from '@/features/billing/payment-receipt-pdf'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function textResponse(message: string, status: number) {
  return new Response(message, { status, headers: { 'Cache-Control': 'private, no-store', 'Content-Type': 'text/plain; charset=utf-8' } })
}

/**
 * Round H (H7): the "Payment receipt" PDF (not a tax invoice) for a subscription payment or an event ticket. Only the
 * member who paid, or an owner or administrator of the organization a subscription was for, gets it; anyone else
 * gets 404, the same as a payment that does not exist. Read only.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const user = await getVerifiedUser()
  if (!user) return textResponse('Sign in to download your receipt.', 401)
  const { kind, id } = await params
  if (!UUID.test(id) || (kind !== 'subscription' && kind !== 'event')) return textResponse('Not found', 404)

  try {
    const receipt = kind === 'subscription'
      ? await paymentHistoryRepository.getSubscriptionReceipt(id, user.id)
      : await paymentHistoryRepository.getEventReceipt(id, user.id)
    if (!receipt) return textResponse('Not found', 404)
    const bytes = await buildPaymentReceiptPdf(receipt)
    return new Response(Buffer.from(bytes), {
      status: 200,
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${paymentReceiptFileName(receipt.id)}"`,
      },
    })
  } catch (error) {
    console.error('[payment_receipt_download_failed]', { error: error instanceof Error ? error.name : 'unknown' })
    return textResponse('The receipt could not be created. Please try again.', 500)
  }
}
