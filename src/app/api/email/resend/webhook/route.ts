import { handleResendWebhook } from '@/features/email-delivery/webhook'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store' }

/**
 * Resend delivery events (delivered, bounced, complained, delivery_delayed, failed, suppressed), signed by Svix.
 * Each one is written to the email log and to the legacy invitation or reminder it belongs to; hard bounces,
 * complaints and suppressions put the address on the do-not-email list. See features/email-delivery/webhook.ts.
 */
export async function POST(request: Request) {
  const result = await handleResendWebhook(request)
  return Response.json(result.body, { status: result.status, headers: NO_STORE_HEADERS })
}
