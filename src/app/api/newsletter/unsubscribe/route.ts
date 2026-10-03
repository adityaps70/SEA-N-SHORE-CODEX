import { after } from 'next/server'
import { getNewsletterConfig } from '@/features/newsletter/config'
import { clientIpFromHeaders, hashClientIp, summarizeUserAgent } from '@/features/newsletter/privacy'
import { createNewsletterService } from '@/features/newsletter/service'
import { createNewsletterSesSync } from '@/features/newsletter/ses-sync'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const HEADERS = { 'Cache-Control': 'private, no-store', 'Content-Type': 'text/plain; charset=utf-8' }

/**
 * RFC 8058 one-click unsubscribe. Mail clients POST
 * "List-Unsubscribe=One-Click" to the URL from the List-Unsubscribe header.
 * No login or cookies are needed; the signed token identifies the subscriber.
 */
export async function POST(request: Request) {
  const token = new URL(request.url).searchParams.get('token')
  try {
    const config = getNewsletterConfig()
    const result = await createNewsletterService({ config }).unsubscribeWithToken(token, {
      source: 'one_click',
      ipHash: hashClientIp(clientIpFromHeaders(request.headers), config.tokenSecret),
      userAgentSummary: summarizeUserAgent(request.headers.get('user-agent')),
    })
    if (!result.ok) {
      const status = result.reason === 'expired' ? 410 : result.reason === 'not_found' ? 404 : result.reason === 'unavailable' ? 503 : 400
      return new Response(result.message, { status, headers: HEADERS })
    }
    if (result.outcome === 'unsubscribed') {
      const subscriberId = result.subscriber.id
      after(async () => {
        try {
          await createNewsletterSesSync({ config }).syncById(subscriberId)
        } catch (error) {
          console.error('[newsletter_one_click_sync_failed]', { subscriberId, error: error instanceof Error ? error.name : 'unknown' })
        }
      })
    }
    return new Response('You are unsubscribed from the Sea N Shore newsletter.', { status: 200, headers: HEADERS })
  } catch (error) {
    console.error('[newsletter_one_click_failed]', { error: error instanceof Error ? error.name : 'unknown' })
    return new Response('We could not process this unsubscribe request. Please try again later.', { status: 500, headers: HEADERS })
  }
}

/** Opening the link in a browser shows the confirmation page instead of unsubscribing on GET (link scanners prefetch GETs). */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const target = new URL('/newsletter/unsubscribe', url.origin)
  const token = url.searchParams.get('token')
  if (token) target.searchParams.set('token', token)
  return Response.redirect(target, 303)
}
