import { legacyReminderRepository } from '@/features/legacy-invites/reminder-repository'
import { siteUrlFor } from '@/lib/site-url'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const HEADERS = { 'Cache-Control': 'private, no-store', 'Content-Type': 'text/plain; charset=utf-8' }

/**
 * RFC 8058 one-click unsubscribe for the legacy account reminder. Mail clients POST "List-Unsubscribe=One-Click" to
 * the URL from the List-Unsubscribe header. No login is needed: the token is the reminder's own random unsubscribe
 * token and only puts the address that reminder went to on the do-not-email list.
 */
export async function POST(request: Request) {
  const token = new URL(request.url).searchParams.get('token') ?? ''
  try {
    const ok = await legacyReminderRepository.unsubscribeWithToken(token)
    if (!ok) return new Response('This unsubscribe link is not valid.', { status: 404, headers: HEADERS })
    return new Response('You are unsubscribed from Sea N Shore emails.', { status: 200, headers: HEADERS })
  } catch (error) {
    console.error('[legacy_one_click_unsubscribe_failed]', { error: error instanceof Error ? error.name : 'unknown' })
    return new Response('We could not process this unsubscribe request. Please try again later.', { status: 500, headers: HEADERS })
  }
}

/** Opening the link in a browser shows the confirmation page instead of unsubscribing on GET (link scanners prefetch GETs). */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const target = siteUrlFor('/email/legacy/unsubscribe')
  const token = url.searchParams.get('token')
  if (token) target.searchParams.set('token', token)
  return Response.redirect(target, 303)
}
