import { getServerActionAllowedOrigins } from '@/lib/auth/server-action-origins'

/**
 * Round H (H1): same-site check for small JSON endpoints the app's own pages call (impressions,
 * visit beacons).
 *
 * Behind CloudFront the request's Host is the ALB origin name and X-Forwarded-Host is the
 * distribution's own *.cloudfront.net name (edge.tf), so comparing the browser's Origin with those
 * headers alone rejected every real request from the public site with a 403. The site's
 * public origins come from NEXT_PUBLIC_SITE_URL and SERVER_ACTION_ALLOWED_ORIGINS, the same list
 * Server Actions already trust.
 *
 * - No Origin header (same-origin GET, older browsers, server-to-server): allowed; the endpoints
 *   still require a signed-in member.
 * - Sec-Fetch-Site: same-origin: allowed (the browser itself vouches for it).
 * - Otherwise the Origin host must be one of the site's hosts, or the request's own host.
 */
export function isSameSiteRequest(
  request: Request,
  env: { siteUrl?: string; additionalOrigins?: string } = {
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
    additionalOrigins: process.env.SERVER_ACTION_ALLOWED_ORIGINS,
  },
) {
  const origin = request.headers.get('origin')
  if (!origin) return true
  if (request.headers.get('sec-fetch-site') === 'same-origin') return true

  let originHost: string
  try {
    originHost = new URL(origin).host
  } catch {
    return false
  }
  if (!originHost) return false

  const allowed = new Set(getServerActionAllowedOrigins(env.siteUrl, env.additionalOrigins))
  try {
    allowed.add(new URL(request.url).host)
  } catch {
    // A relative request.url never happens in the route handlers; ignore it.
  }
  const forwardedHost = request.headers.get('x-forwarded-host')
  if (forwardedHost) allowed.add(forwardedHost)
  const host = request.headers.get('host')
  if (host) allowed.add(host)
  return allowed.has(originHost)
}
