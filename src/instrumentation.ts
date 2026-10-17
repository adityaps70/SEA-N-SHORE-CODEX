import type { Instrumentation } from 'next'
import { recordServerError } from '@/lib/observability/server-errors'

/**
 * Round H (H1): every server error Next.js captures (route handlers, Server Actions, server
 * rendering) becomes one CloudWatch metric line, counted per area (feed, impressions, messaging,
 * jobs, learning, payment webhooks) and in total. The alarms in web-resilience.tf email operations.
 * Only the route's area is recorded: no message, no member, no query string.
 */
export const onRequestError: Instrumentation.onRequestError = (_error, request) => {
  if (process.env.NEXT_RUNTIME === 'edge') return
  recordServerError(request.path)
}
