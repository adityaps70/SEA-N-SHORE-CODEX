import { NextRequest, NextResponse } from 'next/server'
import {
  COGNITO_COOKIE_NAMES,
  createCognitoCookieManager,
} from '@/lib/auth/cognito-cookies'
import { createCognitoOAuth, verifyOAuthState } from '@/lib/auth/cognito-oauth'
import { getCognitoEnvironment, publicEnvironment } from '@/lib/env'
import { siteUrlFor } from '@/lib/site-url'
import { googleCallbackFailure, logGoogleCallbackFailure } from '@/lib/auth/google-callback-failure'
import { APP_HANDOFF_CONFIRM_COOKIE, APP_HANDOFF_TTL_SECONDS } from '@/features/auth/app-handoff'
import { appHandoffService } from '@/features/auth/app-handoff-runtime'
import { cognitoCookieOptions } from '@/lib/auth/cognito-cookies'

/**
 * Round I (I3): a Google sign-in started in the iPhone Home Screen app comes back here in a Safari window, without
 * the app's state and verifier cookies. When the state belongs to a live app handoff, the code is kept for the app
 * and this window asks for the code the app shows (/auth/app-handoff). Null when it is not a handoff.
 */
async function continueAppHandoff(state: string | null, code: string | null, allowInsecureHttp: boolean) {
  if (!state || !code) return null
  let handoff: { id: string; confirmSecret: string } | null = null
  try {
    handoff = await appHandoffService().recordCallback({ state, authorizationCode: code })
  } catch {
    handoff = null
  }
  if (!handoff) return null
  const response = NextResponse.redirect(siteUrlFor('/auth/app-handoff'))
  response.cookies.set(APP_HANDOFF_CONFIRM_COOKIE, `${handoff.id}.${handoff.confirmSecret}`, {
    ...cognitoCookieOptions(publicEnvironment.NEXT_PUBLIC_SITE_URL, { allowInsecureHttp }),
    maxAge: APP_HANDOFF_TTL_SECONDS,
  })
  response.headers.set('Cache-Control', 'private, no-store')
  return response
}

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
  if (failure === 'missing_verifier' || failure === 'state_mismatch') {
    const handoff = await continueAppHandoff(actualState, code, environment.AWS_COGNITO_ALLOW_INSECURE_HTTP_COOKIES)
    if (handoff) return handoff
  }
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
