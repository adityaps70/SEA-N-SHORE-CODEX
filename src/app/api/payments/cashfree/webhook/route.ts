import { revalidatePath } from 'next/cache'
import { isSubscriptionWebhookBody } from '@/features/billing/subscription-webhook'
import { respondToSubscriptionWebhook } from '@/features/billing/webhook-http'
import { createCashfreeWebhookHandler } from '@/features/payments/cashfree-webhook'
import { orderHandlerFor } from '@/features/payments/order-handlers'
import { getGatewayByName } from '@/features/payments/provider'
import { PaymentVerificationError } from '@/features/payments/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Cashfree webhook bodies are small JSON documents; refuse anything unreasonable. */
const MAX_BODY_BYTES = 256 * 1024
const NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store' }

const handleCashfreeWebhook = createCashfreeWebhookHandler({
  getGateway: () => getGatewayByName('cashfree'),
  resolveHandler: (providerOrderId) => orderHandlerFor(providerOrderId),
})

function json(payload: Record<string, unknown>, status: number) {
  return Response.json(payload, { status, headers: NO_STORE_HEADERS })
}

/**
 * Cashfree webhook: the source of truth for Cashfree payments and refunds. It
 * reconciles payments whose browser step never finished (closed tab, lost network).
 * The raw body text is verified (x-webhook-signature over x-webhook-timestamp + body)
 * before it is parsed, each delivery is processed once, and orders are routed by
 * their id prefix (evt_ events, crs_ courses).
 *   200 handled / ignored / duplicate · 400 bad signature · 503 not set up · 500 retry
 */
export async function POST(request: Request) {
  const declaredLength = Number(request.headers.get('content-length') ?? 0)
  if (declaredLength > MAX_BODY_BYTES) return json({ ok: false, error: 'payload_too_large' }, 413)

  const rawBody = await request.text()
  if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) return json({ ok: false, error: 'payload_too_large' }, 413)
  // Subscription (plan auto-renew) events delivered to this endpoint belong to billing.
  if (isSubscriptionWebhookBody(rawBody)) return respondToSubscriptionWebhook(rawBody, request.headers)

  try {
    const result = await handleCashfreeWebhook({ rawBody, headers: request.headers })
    if (!result) return json({ ok: false, error: 'payments_not_configured' }, 503)
    if (result.status === 'handled') {
      for (const path of result.revalidatePaths) {
        try {
          revalidatePath(path)
        } catch {
          // Cache refresh is best effort; the payment itself is already recorded.
        }
      }
    }
    return json({ ok: true, status: result.status }, 200)
  } catch (error) {
    if (error instanceof PaymentVerificationError) return json({ ok: false, error: 'invalid_signature' }, 400)
    console.error('cashfree_webhook_failed', { message: error instanceof Error ? error.message : null })
    // A 5xx makes Cashfree retry; the delivery record was rolled back, so the retry is processed afresh.
    return json({ ok: false, error: 'processing_failed' }, 500)
  }
}
