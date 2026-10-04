import { NextRequest } from 'next/server'
import { afterSignOutRedirect } from '@/lib/auth/after-sign-out'
import { updateCognitoRouteSession } from '@/lib/auth/cognito-proxy'
import { createCspNonce, reportOnlyContentSecurityPolicy, wantsContentSecurityPolicy } from '@/lib/security/content-security-policy'

export async function proxy(incoming: NextRequest) {
  // Round 14 (2.4): page loads carry a Report-Only CSP with a per-request nonce. Only body-less
  // GET/HEAD document requests are copied with the extra request header.
  let request = incoming
  let policy: string | null = null
  if (wantsContentSecurityPolicy(incoming)) {
    policy = reportOnlyContentSecurityPolicy(createCspNonce())
    const headers = new Headers(incoming.headers)
    headers.set('content-security-policy-report-only', policy)
    request = new NextRequest(incoming, { headers })
  }
  const response = afterSignOutRedirect(request) ?? await updateCognitoRouteSession(request)
  if (policy) response.headers.set('Content-Security-Policy-Report-Only', policy)
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
