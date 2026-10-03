import { NextResponse } from 'next/server'
import { checkHomeRuntimeHealth } from '@/lib/db/home-health'

export const dynamic = 'force-dynamic'

export async function GET() {
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
