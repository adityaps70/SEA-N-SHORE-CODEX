import { wantsContentSecurityPolicy } from '@/lib/security/content-security-policy'

/**
 * Round P3 (B4): signed-out page loads of a few public pages may be cached at CloudFront for a
 * minute, then served stale for up to four more while CloudFront refetches. Browsers always
 * revalidate (max-age=0). Everything else keeps Next's `private, no-store`, and CloudFront's page
 * cache policy only stores what is marked here (its default TTL is 0).
 *
 * Never public: a request carrying any of our cookies (a session, a sign-in challenge, a return
 * path), any method but GET/HEAD, RSC and prefetch requests, and any response that sets a cookie or
 * redirects. CloudFront also keys the page cache on the two session cookies, so a signed-in request
 * can never be answered from the signed-out copy.
 */
export const PUBLIC_PAGE_CACHE_CONTROL = 'public, max-age=0, s-maxage=60, stale-while-revalidate=240'

/** Landing, the jobs list, a job, a course page, privacy and terms. */
const PUBLIC_PAGE_PATHS = [
  /^\/$/,
  /^\/jobs$/,
  /^\/jobs\/[^/]+$/,
  /^\/learn\/courses\/[^/]+$/,
  /^\/privacy$/,
  /^\/terms$/,
]

/** Our own cookies all start with this (sessions, sign-in challenges, return path, display mode). */
const OWN_COOKIE_PREFIX = 'sns_'

type PageRequest = Parameters<typeof wantsContentSecurityPolicy>[0] & {
  cookies: { getAll(): Array<{ name: string }> }
  nextUrl: { pathname: string; searchParams: URLSearchParams }
}

export function isPublicPageCacheable(request: PageRequest, response: { status: number; headers: Headers }): boolean {
  if (!wantsContentSecurityPolicy(request)) return false
  if (request.nextUrl.searchParams.has('_rsc')) return false
  if (!PUBLIC_PAGE_PATHS.some((pattern) => pattern.test(request.nextUrl.pathname))) return false
  if (request.cookies.getAll().some((cookie) => cookie.name.startsWith(OWN_COOKIE_PREFIX))) return false
  if (response.status !== 200 || response.headers.has('location')) return false
  if (response.headers.getSetCookie().length > 0) return false
  return true
}
