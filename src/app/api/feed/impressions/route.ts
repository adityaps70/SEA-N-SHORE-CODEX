import { z } from 'zod'
import { AwsAuthenticationRequiredError, requireAwsUser } from '@/features/auth/aws-queries'
import { MAX_IMPRESSIONS_PER_REQUEST, signalsRepository } from '@/features/signals/repository'
import { createPublicPageRateLimiter } from '@/lib/http/public-page-rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'private, no-store' }

/** The client batches about every 5 s and flushes on pagehide, so 60 requests a minute is generous. */
const allow = createPublicPageRateLimiter({ windowMs: 60_000, maxPerWindow: 60 })

const bodySchema = z.object({
  postIds: z.array(z.string().uuid()).min(1).max(MAX_IMPRESSIONS_PER_REQUEST),
})

/** Same-site only: a page on another site cannot mark posts as seen for a member. */
function isSameOrigin(request: Request) {
  const origin = request.headers.get('origin')
  if (!origin) return true
  try {
    return new URL(origin).host === new URL(request.url).host
      || new URL(origin).host === request.headers.get('x-forwarded-host')
      || new URL(origin).host === request.headers.get('host')
  } catch {
    return false
  }
}

/**
 * Round G (G0.2): records posts the member saw (≥50% visible for ≥1 s). Sent in batches by the
 * feed and with navigator.sendBeacon on pagehide, so a reload never loses what was just seen.
 * Answers 204 with no body; nothing about the posts is returned.
 */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return new Response(null, { status: 403, headers: NO_STORE })

  let body: unknown = null
  try {
    body = JSON.parse(await request.text())
  } catch {
    return new Response(null, { status: 400, headers: NO_STORE })
  }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return new Response(null, { status: 400, headers: NO_STORE })

  try {
    const user = await requireAwsUser()
    if (!allow(user.id)) return new Response(null, { status: 429, headers: { ...NO_STORE, 'Retry-After': '30' } })
    await signalsRepository.recordImpressions(user.id, parsed.data.postIds)
    return new Response(null, { status: 204, headers: NO_STORE })
  } catch (error) {
    if (error instanceof AwsAuthenticationRequiredError) return new Response(null, { status: 401, headers: NO_STORE })
    // Before migration 0083 there is nowhere to record impressions: accept and drop them.
    if ((error as { code?: string })?.code === '42P01') return new Response(null, { status: 204, headers: NO_STORE })
    throw error
  }
}
