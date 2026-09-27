import { MAX_WEBHOOK_BODY_BYTES, respondToSubscriptionWebhook } from '@/features/billing/webhook-http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Cashfree subscription webhook (Creator Pro / Organization Pro auto-renew):
 * SUBSCRIPTION_STATUS_CHANGED, SUBSCRIPTION_AUTH_STATUS, SUBSCRIPTION_PAYMENT_*.
 * The raw body text is verified (x-webhook-signature = Base64 HMAC-SHA256 of
 * x-webhook-timestamp + body, keyed with the PG client secret) before it is parsed;
 * each delivery is processed once.
 */
export async function POST(request: Request) {
  const declaredLength = Number(request.headers.get('content-length') ?? 0)
  if (declaredLength > MAX_WEBHOOK_BODY_BYTES) {
    return Response.json({ ok: false, error: 'payload_too_large' }, { status: 413, headers: { 'Cache-Control': 'private, no-store' } })
  }
  const rawBody = await request.text()
  return respondToSubscriptionWebhook(rawBody, request.headers)
}
