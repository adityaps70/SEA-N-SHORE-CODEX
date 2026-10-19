import { NextRequest, NextResponse } from 'next/server'
import { createCognitoCookieManager } from '@/lib/auth/cognito-cookies'
import { createCognitoOAuth } from '@/lib/auth/cognito-oauth'
import { getCognitoEnvironment, publicEnvironment } from '@/lib/env'
import { siteUrlFor } from '@/lib/site-url'
import { DISPLAY_MODE_COOKIE, isStandaloneCookie } from '@/lib/pwa/display-mode'

function fallbackPath(request: NextRequest) {
  return request.nextUrl.searchParams.get('intent') === 'sign-up'
    ? '/auth/sign-up?oauthError=unavailable'
    : '/auth/sign-in?oauthError=unavailable'
}

export async function GET(request: NextRequest) {
  const environment = getCognitoEnvironment()
  const intent = request.nextUrl.searchParams.get('intent') === 'sign-up' ? 'sign-up' : 'sign-in'
  if (!environment.AWS_COGNITO_GOOGLE_ENABLED || !environment.AWS_COGNITO_DOMAIN) {
    return NextResponse.redirect(siteUrlFor(fallbackPath(request)))
  }

  // Round I (I3): from the iPhone Home Screen app (marker cookie), Google would finish in Safari, not in the app. A
  // sign-in or sign-up started from a plain link (the landing page) goes to the auth page, whose Google button runs
  // the app handoff.
  const requestedIntent = request.nextUrl.searchParams.get('intent')
  const iosAgent = /\b(iPhone|iPad|iPod)\b/.test(request.headers.get('user-agent') ?? '')
  if ((requestedIntent === 'sign-in' || requestedIntent === 'sign-up') && iosAgent
    && isStandaloneCookie(request.cookies.get(DISPLAY_MODE_COOKIE)?.value)) {
    const response = NextResponse.redirect(siteUrlFor(`/auth/${requestedIntent}?oauthError=home-screen-app`))
    response.headers.set('Cache-Control', 'private, no-store')
    return response
  }

  const oauth = createCognitoOAuth({
    domain: environment.AWS_COGNITO_DOMAIN,
    clientId: environment.AWS_COGNITO_CLIENT_ID,
    siteUrl: publicEnvironment.NEXT_PUBLIC_SITE_URL,
  })
  const authorization = oauth.createAuthorizationRequest()
  const response = NextResponse.redirect(authorization.url)
  const cookies = createCognitoCookieManager(
    response.cookies,
    publicEnvironment.NEXT_PUBLIC_SITE_URL,
    { allowInsecureHttp: environment.AWS_COGNITO_ALLOW_INSECURE_HTTP_COOKIES },
  )
  cookies.setOAuthChallenge({
    state: authorization.state,
    verifier: authorization.verifier,
    intent,
  })
  response.headers.set('Cache-Control', 'private, no-store')
  return response
}
