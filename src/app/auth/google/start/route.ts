import { NextRequest, NextResponse } from 'next/server'
import { createCognitoCookieManager } from '@/lib/auth/cognito-cookies'
import { createCognitoOAuth } from '@/lib/auth/cognito-oauth'
import { getCognitoEnvironment, publicEnvironment } from '@/lib/env'

function fallbackPath(request: NextRequest) {
  return request.nextUrl.searchParams.get('intent') === 'sign-up'
    ? '/auth/sign-up?oauthError=unavailable'
    : '/auth/sign-in?oauthError=unavailable'
}

export async function GET(request: NextRequest) {
  const environment = getCognitoEnvironment()
  if (!environment.AWS_COGNITO_GOOGLE_ENABLED || !environment.AWS_COGNITO_DOMAIN) {
    return NextResponse.redirect(new URL(fallbackPath(request), request.url))
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
  })
  response.headers.set('Cache-Control', 'private, no-store')
  return response
}
