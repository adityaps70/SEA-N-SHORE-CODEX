import { NextResponse } from 'next/server'
import { checkPhase4DatabaseHealth } from '@/lib/db/health'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const health = await checkPhase4DatabaseHealth()
    const ok = health.database && health.identityMappings
    const response = NextResponse.json(
      { status: ok ? 'ok' : 'degraded', ...health },
      { status: ok ? 200 : 503 },
    )
    response.headers.set('Cache-Control', 'private, no-store')
    return response
  } catch {
    const response = NextResponse.json(
      { status: 'unavailable', database: false, identityMappings: false },
      { status: 503 },
    )
    response.headers.set('Cache-Control', 'private, no-store')
    return response
  }
}
