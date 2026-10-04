import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { checkHomeRuntimeHealth } from '@/lib/db/home-health'

export const dynamic = 'force-dynamic'

/**
 * Once HEALTH_CHECK_TOKEN is configured on the web task, only callers that send it in
 * x-health-check-token (the verify workflows) get the deep check; everyone else gets 404.
 */
function authorized(request: Request) {
  const expected = process.env.HEALTH_CHECK_TOKEN?.trim() ?? ''
  if (expected.length < 32) return true
  const given = Buffer.from(request.headers.get('x-health-check-token') ?? '')
  const wanted = Buffer.from(expected)
  return given.length === wanted.length && timingSafeEqual(given, wanted)
}

export async function GET(request: Request) {
  if (!authorized(request)) return new NextResponse(null, { status: 404 })
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
