import { createRankingEmailPreferences } from '@/features/ranking/ranking-email-sending'
import { siteUrlFor } from '@/lib/site-url'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const HEADERS = { 'Cache-Control': 'private, no-store', 'Content-Type': 'text/plain; charset=utf-8' }

/**
 * RFC 8058 one-click unsubscribe for job alert emails and the weekly digest (algorithms round G).
 * Mail clients POST "List-Unsubscribe=One-Click" here. No login is needed: the token is the email's
 * random queue id and only turns that email's topic off for its own recipient.
 */
export async function POST(request: Request) {
  const token = new URL(request.url).searchParams.get('token') ?? ''
  try {
    const topic = await createRankingEmailPreferences().unsubscribeWithToken(token)
    if (!topic) return new Response('This unsubscribe link is not valid.', { status: 404, headers: HEADERS })
    return new Response(topic === 'job_alerts' ? 'Job alert emails from Sea N Shore are off.' : 'The Sea N Shore weekly digest is off.', { status: 200, headers: HEADERS })
  } catch (error) {
    console.error('[ranking_one_click_unsubscribe_failed]', { error: error instanceof Error ? error.name : 'unknown' })
    return new Response('We could not process this unsubscribe request. Please try again later.', { status: 500, headers: HEADERS })
  }
}

/** Opening the link in a browser shows the confirmation page instead (link scanners prefetch GETs). */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const target = siteUrlFor('/email/unsubscribe')
  const token = url.searchParams.get('token')
  if (token) target.searchParams.set('token', token)
  return Response.redirect(target, 303)
}
