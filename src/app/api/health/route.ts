export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Round H (H1): the public health check the worker's site probe and the alarm watch. It answers from
 * the web process alone (no database), like /api/health/live, which the load balancer uses.
 */
export function GET() {
  return Response.json({ status: 'ok' }, { headers: { 'Cache-Control': 'no-store' } })
}

export function HEAD() {
  return new Response(null, { status: 200, headers: { 'Cache-Control': 'no-store' } })
}
