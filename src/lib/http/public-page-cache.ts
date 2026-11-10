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

/**
 * Round ARCH (Phase 2): a claimed organization's main page changes rarely and every edit clears it from
 * CloudFront (src/lib/edge/cloudfront-invalidation.ts), so it is kept for five minutes and served stale for
 * up to ten more. Sub-pages (manage, team, training, claim, branding, analytics), /organizations itself and
 * /organizations/register are never public.
 */
export const ORGANIZATION_PAGE_CACHE_CONTROL = 'public, max-age=0, s-maxage=300, stale-while-revalidate=600'

/** /organizations/<slug>: one slug segment (lowercase letters, digits, hyphens), never the register page. */
export const PUBLIC_ORGANIZATION_PAGE_PATH = /^\/organizations\/(?!register$)[a-z0-9][a-z0-9-]*$/

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

/** The Cache-Control a signed-out load of a public page gets, or null when the response must stay private. */
export function publicPageCacheControl(request: PageRequest, response: { status: number; headers: Headers }): string | null {
  if (!wantsContentSecurityPolicy(request)) return null
  if (request.nextUrl.searchParams.has('_rsc')) return null
  const pathname = request.nextUrl.pathname
  const value = PUBLIC_PAGE_PATHS.some((pattern) => pattern.test(pathname))
    ? PUBLIC_PAGE_CACHE_CONTROL
    : PUBLIC_ORGANIZATION_PAGE_PATH.test(pathname) ? ORGANIZATION_PAGE_CACHE_CONTROL : null
  if (!value) return null
  if (request.cookies.getAll().some((cookie) => cookie.name.startsWith(OWN_COOKIE_PREFIX))) return null
  if (response.status !== 200 || response.headers.has('location')) return null
  if (response.headers.getSetCookie().length > 0) return null
  return value
}

export function isPublicPageCacheable(request: PageRequest, response: { status: number; headers: Headers }): boolean {
  return publicPageCacheControl(request, response) !== null
}
