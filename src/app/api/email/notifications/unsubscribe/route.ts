import { NOTIFICATION_EMAIL_COPY } from '@/features/notification-emails/kinds'
import { unsubscribeWithNotificationEmailToken } from '@/features/notification-emails/preferences'
import { siteUrlFor } from '@/lib/site-url'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const HEADERS = { 'Cache-Control': 'private, no-store', 'Content-Type': 'text/plain; charset=utf-8' }

/**
 * RFC 8058 one-click unsubscribe for member activity emails (round H, H3): messages digest, connection requests,
 * comments, mentions. Mail clients POST "List-Unsubscribe=One-Click" here. No sign-in: the signed token names the
 * member and one email type, and only that type is turned off. A forged or altered token changes nothing.
 */
export async function POST(request: Request) {
  const token = new URL(request.url).searchParams.get('token') ?? ''
  try {
    const result = await unsubscribeWithNotificationEmailToken(token)
    if (!result.ok) {
      const status = result.reason === 'expired' ? 410 : result.reason === 'not_found' ? 404 : 400
      return new Response('This unsubscribe link is not valid. Choose your emails in Settings instead.', { status, headers: HEADERS })
    }
    const label = NOTIFICATION_EMAIL_COPY[result.kind].turnOff
    return new Response(`Sea N Shore ${label} are off.`, { status: 200, headers: HEADERS })
  } catch (error) {
    console.error('[notification_email_one_click_unsubscribe_failed]', { error: error instanceof Error ? error.name : 'unknown' })
    return new Response('We could not process this unsubscribe request. Please try again later.', { status: 500, headers: HEADERS })
  }
}

/** Opening the link in a browser shows the confirmation page instead (link scanners prefetch GETs). */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const target = siteUrlFor('/email/notifications/unsubscribe')
  const token = url.searchParams.get('token')
  if (token) target.searchParams.set('token', token)
  return Response.redirect(target, 303)
}
