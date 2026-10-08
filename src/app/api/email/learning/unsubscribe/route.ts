import { createLearningEmailPreferences } from '@/features/learning/learning-email-sending'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const HEADERS = { 'Cache-Control': 'private, no-store', 'Content-Type': 'text/plain; charset=utf-8' }

/**
 * RFC 8058 one-click unsubscribe for learning emails (learning round A, A6). Mail clients POST
 * "List-Unsubscribe=One-Click" to the URL from the List-Unsubscribe header. No login is needed:
 * the token is the email's random queue id and only turns learning emails off for its recipient.
 */
export async function POST(request: Request) {
  const token = new URL(request.url).searchParams.get('token') ?? ''
  try {
    const ok = await createLearningEmailPreferences().unsubscribeWithToken(token)
    if (!ok) return new Response('This unsubscribe link is not valid.', { status: 404, headers: HEADERS })
    return new Response('Learning emails from Sea N Shore are off.', { status: 200, headers: HEADERS })
  } catch (error) {
    console.error('[learning_one_click_unsubscribe_failed]', { error: error instanceof Error ? error.name : 'unknown' })
    return new Response('We could not process this unsubscribe request. Please try again later.', { status: 500, headers: HEADERS })
  }
}

/** Opening the link in a browser shows the confirmation page instead of unsubscribing on GET (link scanners prefetch GETs). */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const target = new URL('/email/learning/unsubscribe', url.origin)
  const token = url.searchParams.get('token')
  if (token) target.searchParams.set('token', token)
  return Response.redirect(target, 303)
}
