import { AwsAuthenticationRequiredError, requireAwsUser } from '@/features/auth/aws-queries'
import { searchService } from '@/features/search/search-service'
import { SEARCH_WEIGHTS } from '@/features/search/search-weights'
import { createPublicPageRateLimiter } from '@/lib/http/public-page-rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'private, no-store' }
const JSON_HEADERS = { ...NO_STORE, 'Content-Type': 'application/json; charset=utf-8' }

/** Per member: a 10-per-second burst and 120 a minute. Over either limit is a quiet 429. */
const allowBurst = createPublicPageRateLimiter({ windowMs: 1000, maxPerWindow: SEARCH_WEIGHTS.rateLimit.perSecond, now: () => Date.now() })
const allowMinute = createPublicPageRateLimiter({ windowMs: 60_000, maxPerWindow: SEARCH_WEIGHTS.rateLimit.perMinute, now: () => Date.now() })

/**
 * Round G (G4): the search-as-you-type dropdown. Returns only what the dropdown shows (id, kind,
 * name, one subtitle line, a small signed avatar) for up to 3 people, 2 organizations, 2
 * communities, 2 jobs and 1 course or event. One query per keystroke; a statement timeout returns
 * what is ready (partial: true), never a 500.
 */
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get('q') ?? ''
  if (q.length > SEARCH_WEIGHTS.maxQueryLength) return Response.json({ error: 'too_long' }, { status: 400, headers: NO_STORE })
  try {
    const user = await requireAwsUser()
    const burst = allowBurst(user.id)
    if (!burst || !allowMinute(user.id)) return Response.json({ error: 'slow_down' }, { status: 429, headers: { ...NO_STORE, 'Retry-After': '2' } })
    const result = await searchService.suggest(user.id, q)
    return new Response(JSON.stringify(result), { status: 200, headers: JSON_HEADERS })
  } catch (error) {
    if (error instanceof AwsAuthenticationRequiredError) return Response.json({ error: 'sign_in' }, { status: 401, headers: NO_STORE })
    console.error('[search_suggest_failed]', { code: (error as { code?: string })?.code ?? null })
    return new Response(JSON.stringify({ query: q, items: [], partial: true }), { status: 200, headers: JSON_HEADERS })
  }
}
