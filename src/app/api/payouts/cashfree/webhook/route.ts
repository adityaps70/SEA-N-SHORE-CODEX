import { revalidatePath } from 'next/cache'
import { handlePayoutWebhook } from '@/features/payouts/payout-runtime'
import { PaymentVerificationError } from '@/features/payments/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Payouts webhook bodies are small JSON documents; refuse anything unreasonable. */
const MAX_BODY_BYTES = 128 * 1024
const NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store' }

function json(payload: Record<string, unknown>, status: number) {
  return Response.json(payload, { status, headers: NO_STORE_HEADERS })
}

/**
 * Cashfree Payouts webhook (v2): transfer status changes for seller payouts. The raw
 * body is verified with the Payouts client secret before it is parsed, each delivery
 * is processed once, and only transfers whose id we issued (snspo_…) are applied.
 *   200 handled / ignored / duplicate · 400 bad signature · 503 not set up · 500 retry
 */
export async function POST(request: Request) {
  const declaredLength = Number(request.headers.get('content-length') ?? 0)
  if (declaredLength > MAX_BODY_BYTES) return json({ ok: false, error: 'payload_too_large' }, 413)

  const rawBody = await request.text()
  if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) return json({ ok: false, error: 'payload_too_large' }, 413)

  try {
    const result = await handlePayoutWebhook({ rawBody, headers: request.headers })
    if (!result) return json({ ok: false, error: 'payouts_not_configured' }, 503)
    if (result.status === 'handled' && result.changed) {
      for (const path of ['/admin/payments', '/admin/payments/payouts', '/settings/earnings']) {
        try {
          revalidatePath(path)
        } catch {
          // Cache refresh is best effort; the payout itself is already recorded.
        }
      }
    }
    return json({ ok: true, status: result.status }, 200)
  } catch (error) {
    if (error instanceof PaymentVerificationError) return json({ ok: false, error: 'invalid_signature' }, 400)
    console.error('cashfree_payouts_webhook_failed', { message: error instanceof Error ? error.message : null })
    return json({ ok: false, error: 'processing_failed' }, 500)
  }
}
