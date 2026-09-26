import { revalidatePath } from 'next/cache'
import {
  createEventPaymentService,
  PaymentsNotConfiguredError,
  PaymentVerificationError,
} from '@/features/payments/event-payment-service'
import { getPaymentProvider } from '@/features/payments/provider'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Razorpay webhook bodies are small JSON documents; refuse anything unreasonable. */
const MAX_BODY_BYTES = 256 * 1024
const NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store' }

const service = createEventPaymentService({ getProvider: getPaymentProvider })

function json(payload: Record<string, unknown>, status: number) {
  return Response.json(payload, { status, headers: NO_STORE_HEADERS })
}

/**
 * Razorpay webhook: the source of truth for event payments. It reconciles
 * payments whose browser callback never arrived (closed tab, lost network).
 * The raw body is verified with the webhook secret before anything is parsed,
 * and each delivery id is processed once.
 */
export async function POST(request: Request) {
  const declaredLength = Number(request.headers.get('content-length') ?? 0)
  if (declaredLength > MAX_BODY_BYTES) return json({ ok: false, error: 'payload_too_large' }, 413)

  const rawBody = await request.text()
  if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) return json({ ok: false, error: 'payload_too_large' }, 413)

  try {
    const result = await service.handleWebhook({
      rawBody,
      signature: request.headers.get('x-razorpay-signature'),
      deliveryId: request.headers.get('x-razorpay-event-id'),
    })
    if (result.handled && 'outcome' in result && result.outcome?.order.eventId) {
      const eventId = result.outcome.order.eventId
      try {
        revalidatePath(`/events/${eventId}`)
        revalidatePath(`/events/${eventId}/registrations`)
        revalidatePath('/events/my')
      } catch {
        // Cache refresh is best effort; the payment itself is already recorded.
      }
    }
    return json({ ok: true, handled: result.handled }, 200)
  } catch (error) {
    if (error instanceof PaymentVerificationError) return json({ ok: false, error: 'invalid_signature' }, 400)
    if (error instanceof PaymentsNotConfiguredError) return json({ ok: false, error: 'payments_not_configured' }, 503)
    console.error('razorpay_webhook_failed', { message: error instanceof Error ? error.message : null })
    // A 5xx makes Razorpay retry; the delivery record was rolled back, so the retry is processed afresh.
    return json({ ok: false, error: 'processing_failed' }, 500)
  }
}
