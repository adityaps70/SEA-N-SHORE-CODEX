/**
 * Round F: where a member goes after signing in or signing up from an auth wall (for example a shared
 * post link). The path arrives as `?next=` on /auth/sign-in or /auth/sign-up, the proxy keeps it in a
 * short-lived httpOnly cookie, and /auth/post-sign-in or the end of onboarding sends the member there.
 * Kept free of server-only imports so the proxy can use it.
 */

export const RETURN_PATH_COOKIE = 'sns_return_to'
export const RETURN_PATH_COOKIE_MAX_AGE_SECONDS = 30 * 60
const MAX_LENGTH = 512

/**
 * A same-site relative path, or null. Refuses anything a browser could read as another site
 * (`//evil.com`, `/\evil.com`, `https://…`), encoded slashes or dots, dot segments, control characters,
 * and the auth and API paths themselves (no loops, no redirects into endpoints).
 */
export function safeReturnPath(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const path = value.trim()
  if (!path || path.length > MAX_LENGTH) return null
  if (!path.startsWith('/') || path.startsWith('//')) return null
  if (/[\\\s\u0000-\u001f\u007f]/.test(path) || path.includes('//')) return null
  if (/%(?:2f|5c|2e|00)/i.test(path) || path.includes('@')) return null
  if (/\/\.{1,2}(?=[/?#]|$)/.test(path)) return null
  const pathname = path.split(/[?#]/, 1)[0] ?? ''
  if (/^\/(?:auth|api|_next)(?:\/|$)/.test(pathname)) return null
  try {
    // Resolving against a fixed origin must keep that origin and the same path.
    const resolved = new URL(path, 'https://return-path.invalid')
    if (resolved.origin !== 'https://return-path.invalid') return null
  } catch {
    return null
  }
  return path
}

/** `/auth/sign-in?next=<path>` (or sign-up) when the path is safe; the bare page otherwise. */
export function authHrefWithReturn(page: '/auth/sign-in' | '/auth/sign-up', returnPath: string | null | undefined) {
  const next = safeReturnPath(returnPath)
  return next ? `${page}?${new URLSearchParams({ next }).toString()}` : page
}

/** The page a GET page request is for, without Next's internal `_rsc` parameter, if it may be returned to. */
export function returnPathForRequest(request: { method: string; nextUrl: { pathname: string; searchParams: URLSearchParams } }) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null
  const params = new URLSearchParams(request.nextUrl.searchParams)
  params.delete('_rsc')
  const query = params.toString()
  return safeReturnPath(query ? `${request.nextUrl.pathname}?${query}` : request.nextUrl.pathname)
}

/**
 * Secure whenever the public site is https (behind CloudFront and the load balancer the container itself
 * sees http, so the request URL can't tell); the local http dev server needs it off.
 */
export function returnPathCookieOptions(siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? '') {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: siteUrl.startsWith('https:'),
    path: '/',
    maxAge: RETURN_PATH_COOKIE_MAX_AGE_SECONDS,
  }
}

/**
 * The cookie has done its job once the member reaches that page: the proxy deletes it on arrival, so a
 * later sign-in goes to Home as usual.
 */
export function arrivedAtReturnPath(request: { method: string; cookies: { get(name: string): { value: string } | undefined }; nextUrl: { pathname: string; searchParams: URLSearchParams } }) {
  const remembered = request.cookies.get(RETURN_PATH_COOKIE)?.value
  if (!remembered) return false
  return returnPathForRequest(request) === remembered
}
