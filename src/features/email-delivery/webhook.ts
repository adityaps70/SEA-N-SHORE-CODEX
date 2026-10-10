import { loadResendWebhookSecret, verifyResendWebhook } from '@/lib/email/resend-webhook'
import { parseResendWebhookEvent, type DeliveryEvent } from './events'
import { emailDeliveryRepository } from './repository'

/** Resend event bodies are small JSON documents; refuse anything unreasonable before reading it. */
export const MAX_WEBHOOK_BODY_BYTES = 256 * 1024

export type WebhookResult = { status: number; body: Record<string, unknown> }

/**
 * POST /api/email/resend/webhook. The raw body is verified (Svix signature, 5-minute timestamp window) before it is
 * parsed. 200 recorded / duplicate / ignored · 400 bad signature · 413 too large · 503 not set up yet · 500 retry.
 * A 5xx makes Resend retry; the transaction was rolled back, so the retry is recorded afresh.
 */
export async function handleResendWebhook(request: Request, deps: {
  loadSecret?: () => Promise<string | null>
  record?: (event: DeliveryEvent) => Promise<{ status: 'recorded' | 'duplicate'; suppressed: number }>
  nowSeconds?: () => number
} = {}): Promise<WebhookResult> {
  const declaredLength = Number(request.headers.get('content-length') ?? 0)
  if (declaredLength > MAX_WEBHOOK_BODY_BYTES) return { status: 413, body: { ok: false, error: 'payload_too_large' } }
  const rawBody = await request.text()
  if (Buffer.byteLength(rawBody, 'utf8') > MAX_WEBHOOK_BODY_BYTES) return { status: 413, body: { ok: false, error: 'payload_too_large' } }

  const secret = await (deps.loadSecret ?? loadResendWebhookSecret)()
  if (!secret) return { status: 503, body: { ok: false, error: 'webhook_not_configured' } }

  const id = request.headers.get('svix-id')
  const verification = verifyResendWebhook({
    secret,
    id,
    timestamp: request.headers.get('svix-timestamp'),
    signature: request.headers.get('svix-signature'),
    body: rawBody,
    nowSeconds: deps.nowSeconds?.(),
  })
  if (!verification.ok) return { status: 400, body: { ok: false, error: 'invalid_signature' } }

  const event = parseResendWebhookEvent(rawBody, id!)
  if (!event) return { status: 200, body: { ok: true, status: 'ignored' } }

  try {
    const result = await (deps.record ?? ((value) => emailDeliveryRepository.recordEvent(value)))(event)
    return { status: 200, body: { ok: true, status: result.status } }
  } catch (error) {
    console.error('resend_webhook_record_failed', { type: event.type, message: error instanceof Error ? error.message.slice(0, 200) : null })
    return { status: 500, body: { ok: false, error: 'processing_failed' } }
  }
}
