import { NextRequest, NextResponse } from 'next/server'
import {
  COGNITO_COOKIE_NAMES,
  createCognitoCookieManager,
} from '@/lib/auth/cognito-cookies'
import { createCognitoOAuth, verifyOAuthState } from '@/lib/auth/cognito-oauth'
import { getCognitoEnvironment, publicEnvironment } from '@/lib/env'
import { siteUrlFor } from '@/lib/site-url'
import { googleCallbackFailure, logGoogleCallbackFailure } from '@/lib/auth/google-callback-failure'

function redirectWithError(code: string, intent: 'sign-in' | 'sign-up' = 'sign-in') {
  const authPath = intent === 'sign-up' ? '/auth/sign-up' : '/auth/sign-in'
  const response = NextResponse.redirect(siteUrlFor(`${authPath}?oauthError=${encodeURIComponent(code)}`))
  const environment = getCognitoEnvironment()
  const cookies = createCognitoCookieManager(
    response.cookies,
    publicEnvironment.NEXT_PUBLIC_SITE_URL,
    { allowInsecureHttp: environment.AWS_COGNITO_ALLOW_INSECURE_HTTP_COOKIES },
  )
  cookies.clearOAuthChallenge()
  response.headers.set('Cache-Control', 'private, no-store')
  return response
}

export async function GET(request: NextRequest) {
  const environment = getCognitoEnvironment()
  const intent = request.cookies.get(COGNITO_COOKIE_NAMES.oauthIntent)?.value === 'sign-up'
    ? 'sign-up'
    : 'sign-in'
  if (!environment.AWS_COGNITO_GOOGLE_ENABLED || !environment.AWS_COGNITO_DOMAIN) {
    logGoogleCallbackFailure('unavailable')
    return redirectWithError('unavailable', intent)
  }

  const actualState = request.nextUrl.searchParams.get('state')
  const expectedState = request.cookies.get(COGNITO_COOKIE_NAMES.oauthState)?.value
  const verifier = request.cookies.get(COGNITO_COOKIE_NAMES.oauthVerifier)?.value
  const code = request.nextUrl.searchParams.get('code')
  const providerError = request.nextUrl.searchParams.get('error')

  const failure = googleCallbackFailure({
    providerError,
    code,
    verifier,
    stateMatches: verifyOAuthState(expectedState, actualState),
  })
  if (failure || !code || !verifier) {
    logGoogleCallbackFailure(failure ?? 'missing_code')
    return redirectWithError('verification', intent)
  }

  try {
    const oauth = createCognitoOAuth({
      domain: environment.AWS_COGNITO_DOMAIN,
      clientId: environment.AWS_COGNITO_CLIENT_ID,
      siteUrl: publicEnvironment.NEXT_PUBLIC_SITE_URL,
    })
    const authentication = await oauth.exchangeCode({ code, verifier })
    const response = NextResponse.redirect(siteUrlFor('/auth/post-sign-in'))
    const cookies = createCognitoCookieManager(
      response.cookies,
      publicEnvironment.NEXT_PUBLIC_SITE_URL,
      { allowInsecureHttp: environment.AWS_COGNITO_ALLOW_INSECURE_HTTP_COOKIES },
    )
    cookies.clearOAuthChallenge()
    cookies.setAuthentication(authentication)
    response.headers.set('Cache-Control', 'private, no-store')
    return response
  } catch {
    logGoogleCallbackFailure('exchange_failed')
    return redirectWithError('exchange', intent)
  }
}
