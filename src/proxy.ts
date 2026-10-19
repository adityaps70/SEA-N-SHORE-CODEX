import { NextRequest } from 'next/server'
import { ADMIN_RETURN_PATH_HEADER, adminReturnPathForRequest } from '@/lib/auth/admin-mfa-paths'
import { afterSignOutRedirect } from '@/lib/auth/after-sign-out'
import { setRefreshTokenLedger, updateCognitoRouteSession } from '@/lib/auth/cognito-proxy'
import { createRefreshTokenLedger } from '@/features/account-security/refresh-token-ledger'
import { query } from '@/lib/db/client'
import { arrivedAtReturnPath, RETURN_PATH_COOKIE } from '@/lib/auth/return-path'
import {
  API_CONTENT_SECURITY_POLICY,
  CONTENT_SECURITY_POLICY_HEADER,
  createCspNonce,
  pageContentSecurityPolicy,
  wantsApiContentSecurityPolicy,
  wantsContentSecurityPolicy,
} from '@/lib/security/content-security-policy'

// Round I (I3): refresh token reuse detection (Node.js runtime, the default for Proxy in Next 16).
setRefreshTokenLedger(createRefreshTokenLedger({ query: (text, values) => query(text, values) }))

export async function proxy(incoming: NextRequest) {
  // Round 14 (2.4): page loads carry a Report-Only CSP with a per-request nonce. Only body-less
  // GET/HEAD document requests are copied with the extra request header.
  let request = incoming
  let policy: string | null = null
  if (wantsContentSecurityPolicy(incoming)) {
    policy = pageContentSecurityPolicy(createCspNonce())
  }
  // Round H (H4): API responses carry a fixed policy too (SCORM package files excepted). Only the
  // response gets it; the request reaches the route unchanged.
  const responsePolicy = policy ?? (wantsApiContentSecurityPolicy(incoming) ? API_CONTENT_SECURITY_POLICY : null)
  // Round 14 (2.11): admin page loads (GET/HEAD only) tell the admin MFA gate which page to return to.
  const adminReturnPath = adminReturnPathForRequest(incoming)
  if (policy || adminReturnPath) {
    const headers = new Headers(incoming.headers)
    if (policy) headers.set(CONTENT_SECURITY_POLICY_HEADER, policy)
    if (adminReturnPath) headers.set(ADMIN_RETURN_PATH_HEADER, adminReturnPath)
    request = new NextRequest(incoming, { headers })
  }
  const response = afterSignOutRedirect(request) ?? await updateCognitoRouteSession(request)
  // Round F: the member is back on the page they signed in for; forget it.
  if (arrivedAtReturnPath(request)) response.cookies.delete(RETURN_PATH_COOKIE)
  if (responsePolicy) response.headers.set(CONTENT_SECURITY_POLICY_HEADER, responsePolicy)
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
