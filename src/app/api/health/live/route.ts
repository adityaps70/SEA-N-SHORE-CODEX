import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * Liveness for the ALB target group and the container health check: the Node server is up and
 * answering. No database, no rendering, so a slow dependency never takes healthy tasks out of
 * service (Round 14, 1.5). Deep checks stay on /api/health/home and /api/health/phase4.
 */
export function GET() {
  const response = NextResponse.json({ status: 'ok' })
  response.headers.set('Cache-Control', 'no-store')
  return response
}
