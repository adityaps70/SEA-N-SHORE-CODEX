import { createHash, timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { checkHomeRuntimeHealth } from '@/lib/db/home-health'

export const dynamic = 'force-dynamic'

const TOKEN_HEADER = 'x-health-check-token'

/**
 * The deep Home check reads the database, so it is only for callers that send the web task's
 * HEALTH_CHECK_TOKEN in x-health-check-token (the verify workflows). Fails closed: with no token
 * configured nobody is authorized. Constant-time compare; the token is never logged or echoed.
 * Liveness stays public on /api/health/live.
 */
function authorized(request: Request) {
  const expected = process.env.HEALTH_CHECK_TOKEN?.trim() ?? ''
  if (!expected) return false
  const given = createHash('sha256').update(request.headers.get(TOKEN_HEADER) ?? '').digest()
  const wanted = createHash('sha256').update(expected).digest()
  return timingSafeEqual(given, wanted)
}

function unauthorized() {
  return NextResponse.json(
    { status: 'unauthorized' },
    { status: 401, headers: { 'Cache-Control': 'private, no-store' } },
  )
}

export async function GET(request: Request) {
  if (!authorized(request)) return unauthorized()
  try {
    const health = await checkHomeRuntimeHealth()
    const ok = health.profile
      && health.network
      && health.discovery
      && health.feed
      && health.hydration
      && health.media

    const response = NextResponse.json(
      {
        status: ok ? 'ok' : 'degraded',
        profile: health.profile,
        network: health.network,
        discovery: health.discovery,
        feed: health.feed,
        hydration: health.hydration,
        media: health.media,
      },
      { status: ok ? 200 : 503 },
    )
    response.headers.set('Cache-Control', 'private, no-store')
    return response
  } catch {
    const response = NextResponse.json(
      {
        status: 'unavailable',
        profile: false,
        network: false,
        discovery: false,
        feed: false,
        hydration: false,
        media: false,
      },
      { status: 503 },
    )
    response.headers.set('Cache-Control', 'private, no-store')
    return response
  }
}
