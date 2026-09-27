import { createHash, timingSafeEqual } from 'node:crypto'
import { billingJobsSecret } from '@/features/billing/billing-config'
import { subscriptionService } from '@/features/billing/subscription-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store' }

function json(payload: Record<string, unknown>, status: number) {
  return Response.json(payload, { status, headers: NO_STORE_HEADERS })
}

function sameSecret(expected: string, received: string) {
  const a = createHash('sha256').update(expected).digest()
  const b = createHash('sha256').update(received).digest()
  return timingSafeEqual(a, b)
}

/**
 * Billing job entry point for an external scheduler (the outbox worker also runs the
 * same job hourly): expires lapsed plans, reconciles open mandates with Cashfree and, in
 * merchant charge mode, raises due renewal charges. Idempotent.
 *   POST with "Authorization: Bearer <BILLING_JOBS_SECRET>"
 *   503 when BILLING_JOBS_SECRET is not set · 401 wrong secret · 200 summary
 */
export async function POST(request: Request) {
  const secret = billingJobsSecret()
  if (!secret) return json({ ok: false, error: 'jobs_not_configured' }, 503)
  const header = request.headers.get('authorization') ?? ''
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : ''
  if (!token || !sameSecret(secret, token)) return json({ ok: false, error: 'unauthorized' }, 401)
  try {
    const summary = await subscriptionService.runSweep()
    return json({ ok: true, ...summary }, 200)
  } catch (error) {
    console.error('billing_job_failed', { message: error instanceof Error ? error.message : null })
    return json({ ok: false, error: 'job_failed' }, 500)
  }
}
