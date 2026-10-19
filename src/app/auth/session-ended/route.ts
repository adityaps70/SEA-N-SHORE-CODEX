import { NextResponse, type NextRequest } from 'next/server'
import { createCognitoApi } from '@/lib/auth/cognito-api'
import { COGNITO_COOKIE_NAMES, createCognitoCookieManager } from '@/lib/auth/cognito-cookies'
import { getCognitoEnvironment, publicEnvironment } from '@/lib/env'
import { siteUrlFor } from '@/lib/site-url'
import { getAwsVerification } from '@/features/auth/aws-queries'

export const dynamic = 'force-dynamic'

/**
 * Round H (H3): where requireUser sends a device that was signed out from Settings › Account on another device.
 * It revokes this device's Cognito refresh token (the device has it, so every token from that sign-in stops
 * working at Cognito too), clears the auth cookies and shows sign-in with a short notice. A device whose session is
 * still active is only sent home, so a link to this page cannot sign anybody out.
 */
export async function GET(request: NextRequest) {
  let revoked = false
  let signedIn = false
  let notice = 'session-ended'
  try {
    const verification = await getAwsVerification()
    revoked = verification.sessionRevoked
    signedIn = verification.user !== null
    // Round I (I3): say why. Not opened for 30 days, or an old sign-in token was used again (possibly a copy).
    if (verification.sessionEndReason === 'idle') notice = 'session-expired'
    if (verification.sessionEndReason === 'refresh_reuse') notice = 'session-security'
  } catch {
    revoked = false
  }

  if (!revoked) {
    const response = NextResponse.redirect(siteUrlFor(signedIn ? '/home' : '/auth/sign-in'))
    response.headers.set('Cache-Control', 'private, no-store')
    return response
  }

  const environment = getCognitoEnvironment()
  const refreshToken = request.cookies.get(COGNITO_COOKIE_NAMES.refresh)?.value
  if (refreshToken) {
    try {
      await createCognitoApi({ region: environment.AWS_COGNITO_REGION, clientId: environment.AWS_COGNITO_CLIENT_ID }).revokeToken(refreshToken)
    } catch {
      // The cookies are cleared below either way; the session row already refuses this sign-in.
    }
  }

  const response = NextResponse.redirect(siteUrlFor(`/auth/sign-in?notice=${notice}`))
  createCognitoCookieManager(response.cookies, publicEnvironment.NEXT_PUBLIC_SITE_URL, {
    allowInsecureHttp: environment.AWS_COGNITO_ALLOW_INSECURE_HTTP_COOKIES,
  }).clearCognitoCookies()
  response.headers.set('Cache-Control', 'private, no-store')
  return response
}
