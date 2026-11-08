import { AwsAuthenticationRequiredError, requireAwsUser } from '@/features/auth/aws-queries'
import { incrementRankingMetric } from '@/features/signals/repository'
import { createPublicPageRateLimiter } from '@/lib/http/public-page-rate-limit'
import { isSameSiteRequest } from '@/lib/http/same-origin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'private, no-store' }
const VISIT_SOURCES = ['digest', 'job_alert'] as const
const allow = createPublicPageRateLimiter({ windowMs: 60_000, maxPerWindow: 20, now: () => Date.now() })

/**
 * Round G (MEASURE): one visit that arrived from a job alert or the weekly digest (?src=…). Only a
 * daily count per source is kept (ranking_metrics_daily); nothing about the member.
 */
export async function POST(request: Request) {
  if (!isSameSiteRequest(request)) return new Response(null, { status: 403, headers: NO_STORE })
  const source = new URL(request.url).searchParams.get('src') ?? ''
  if (!(VISIT_SOURCES as readonly string[]).includes(source)) return new Response(null, { status: 400, headers: NO_STORE })
  try {
    const user = await requireAwsUser()
    if (!allow(user.id)) return new Response(null, { status: 429, headers: NO_STORE })
    await incrementRankingMetric(`visits.${source}`, 1, user.id)
    return new Response(null, { status: 204, headers: NO_STORE })
  } catch (error) {
    if (error instanceof AwsAuthenticationRequiredError) return new Response(null, { status: 401, headers: NO_STORE })
    return new Response(null, { status: 204, headers: NO_STORE })
  }
}
