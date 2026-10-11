import { siteUrlFor } from '@/lib/site-url'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const HEADERS = { 'Cache-Control': 'private, no-store', 'Content-Type': 'text/plain; charset=utf-8' }

/**
 * The List-Unsubscribe target of an admin's test reminder. Mail clients may POST to it (RFC 8058 one-click); it
 * answers 200 and changes nothing, so a test never adds anyone to the do-not-email list.
 */
export async function POST() {
  return new Response('This was a test email. Nothing was changed.', { status: 200, headers: HEADERS })
}

/** Opening it in a browser shows the test-link page. */
export async function GET() {
  return Response.redirect(siteUrlFor('/email/legacy/test-link?link=unsubscribe'), 303)
}
