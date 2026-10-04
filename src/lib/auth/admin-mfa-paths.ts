/**
 * Round 14 (2.11): paths for the platform-admin MFA gate. Kept free of server-only imports so the
 * proxy can use it.
 */

/** Request header the proxy sets on admin page loads so the gate can send the admin back afterwards. */
export const ADMIN_RETURN_PATH_HEADER = 'x-sns-admin-return-path'

/** Settings → Two-step verification, where members set up an authenticator app. */
export const MFA_SETTINGS_PATH = '/settings/security'

/** Only admin console paths are valid return destinations after setup. */
export function safeAdminReturnPath(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const path = value.trim()
  if (path.length > 512) return null
  if (!/^\/admin(?:[/?#]|$)/.test(path)) return null
  if (/[\\\s]/.test(path) || path.includes('//') || /%2f|%5c|%2e/i.test(path)) return null
  // No dot segments: the browser would resolve /admin/../x outside the admin console.
  if (/\/\.{1,2}(?=[/?#]|$)/.test(path)) return null
  return path
}

/** Where the gate sends an administrator who still needs an authenticator app. */
export function adminMfaSetupHref(returnTo: string | null | undefined) {
  const params = new URLSearchParams({ required: 'admin' })
  const next = safeAdminReturnPath(returnTo)
  if (next) params.set('next', next)
  return `${MFA_SETTINGS_PATH}?${params.toString()}`
}

/** The admin page a GET/HEAD request is for (without Next's internal `_rsc` parameter), else null. */
export function adminReturnPathForRequest(request: { method: string; nextUrl: { pathname: string; searchParams: URLSearchParams } }) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null
  const { pathname } = request.nextUrl
  if (pathname !== '/admin' && !pathname.startsWith('/admin/')) return null
  const params = new URLSearchParams(request.nextUrl.searchParams)
  params.delete('_rsc')
  const query = params.toString()
  return safeAdminReturnPath(query ? `${pathname}?${query}` : pathname)
}
