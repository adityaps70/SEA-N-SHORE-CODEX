import { revalidatePath } from 'next/cache'
import { PaymentVerificationError, type HeaderLookup } from '@/features/payments/types'
import { subscriptionService, type SubscriptionService } from './subscription-service'

const NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store' }
/** Cashfree webhook bodies are small JSON documents; refuse anything unreasonable. */
export const MAX_WEBHOOK_BODY_BYTES = 256 * 1024

function json(payload: Record<string, unknown>, status: number) {
  return Response.json(payload, { status, headers: NO_STORE_HEADERS })
}

/**
 * HTTP answer for a Cashfree subscription webhook (raw body already read as text):
 *   200 handled / ignored / duplicate · 400 bad signature · 503 not set up · 500 retry
 * Used by /api/billing/cashfree/webhook and, for SUBSCRIPTION_* events delivered to the
 * PG endpoint, by /api/payments/cashfree/webhook.
 */
export async function respondToSubscriptionWebhook(
  rawBody: string,
  headers: HeaderLookup,
  service: Pick<SubscriptionService, 'handleWebhook'> = subscriptionService,
) {
  if (Buffer.byteLength(rawBody, 'utf8') > MAX_WEBHOOK_BODY_BYTES) return json({ ok: false, error: 'payload_too_large' }, 413)
  try {
    const result = await service.handleWebhook({ rawBody, headers })
    if (!result) return json({ ok: false, error: 'payments_not_configured' }, 503)
    if (result.status === 'handled') {
      for (const path of result.revalidatePaths) {
        try {
          revalidatePath(path)
        } catch {
          // Cache refresh is best effort; the change itself is committed.
        }
      }
    }
    return json({ ok: true, status: result.status }, 200)
  } catch (error) {
    if (error instanceof PaymentVerificationError) return json({ ok: false, error: 'invalid_signature' }, 400)
    console.error('cashfree_subscription_webhook_failed', { message: error instanceof Error ? error.message : null })
    // 5xx makes Cashfree retry; the delivery record rolled back with the failed transaction.
    return json({ ok: false, error: 'processing_failed' }, 500)
  }
}
