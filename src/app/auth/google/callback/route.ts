import { NextRequest, NextResponse } from 'next/server'
import {
  COGNITO_COOKIE_NAMES,
  createCognitoCookieManager,
} from '@/lib/auth/cognito-cookies'
import { createCognitoOAuth, verifyOAuthState } from '@/lib/auth/cognito-oauth'
import { getCognitoEnvironment, publicEnvironment } from '@/lib/env'
import { siteUrlFor } from '@/lib/site-url'

function redirectWithError(code: string) {
  const response = NextResponse.redirect(siteUrlFor(`/auth/sign-in?oauthError=${encodeURIComponent(code)}`))
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
  if (!environment.AWS_COGNITO_GOOGLE_ENABLED || !environment.AWS_COGNITO_DOMAIN) {
    return redirectWithError('unavailable')
  }

  const actualState = request.nextUrl.searchParams.get('state')
  const expectedState = request.cookies.get(COGNITO_COOKIE_NAMES.oauthState)?.value
  const verifier = request.cookies.get(COGNITO_COOKIE_NAMES.oauthVerifier)?.value
  const code = request.nextUrl.searchParams.get('code')
  const providerError = request.nextUrl.searchParams.get('error')

  if (
    providerError
    || !code
    || !verifier
    || !verifyOAuthState(expectedState, actualState)
  ) {
    return redirectWithError('verification')
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
    return redirectWithError('exchange')
  }
}
