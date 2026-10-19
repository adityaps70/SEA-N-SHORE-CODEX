import { NextResponse, type NextRequest } from 'next/server'
import {
  APP_HANDOFF_COOKIE,
  APP_HANDOFF_TTL_SECONDS,
  formatPairCode,
  parseHandoffCookie,
  type AppHandoffIntent,
} from '@/features/auth/app-handoff'
import { appHandoffService } from '@/features/auth/app-handoff-runtime'
import { getVerifiedUser } from '@/features/auth/queries'
import { COGNITO_COOKIE_NAMES, cognitoCookieOptions, createCognitoCookieManager } from '@/lib/auth/cognito-cookies'
import { createCognitoOAuth } from '@/lib/auth/cognito-oauth'
import { getCognitoEnvironment, publicEnvironment } from '@/lib/env'
import { trustedClientIp } from '@/lib/http/client-ip'
import { createPublicPageRateLimiter } from '@/lib/http/public-page-rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Round I (I3): Google sign-in for the iPhone Home Screen app (see features/auth/app-handoff).
 * POST starts a handoff from the app; GET is the app asking whether Google has finished, and signs it in when so.
 */
const allowStart = createPublicPageRateLimiter({ windowMs: 60_000, maxPerWindow: 6 })

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })
}

function oauthClient() {
  const environment = getCognitoEnvironment()
  if (!environment.AWS_COGNITO_GOOGLE_ENABLED || !environment.AWS_COGNITO_DOMAIN) return null
  return {
    environment,
    oauth: createCognitoOAuth({
      domain: environment.AWS_COGNITO_DOMAIN,
      clientId: environment.AWS_COGNITO_CLIENT_ID,
      siteUrl: publicEnvironment.NEXT_PUBLIC_SITE_URL,
    }),
  }
}

export async function POST(request: NextRequest) {
  const client = oauthClient()
  if (!client) return json({ status: 'unavailable' }, 503)
  if (!allowStart(trustedClientIp(request.headers) ?? 'unknown')) return json({ status: 'busy' }, 429)

  const body = await request.json().catch(() => ({})) as { intent?: unknown }
  const intent: AppHandoffIntent = body.intent === 'sign-up' ? 'sign-up' : 'sign-in'
  const authorization = client.oauth.createAuthorizationRequest()

  let handoff: Awaited<ReturnType<ReturnType<typeof appHandoffService>['start']>>
  try {
    handoff = await appHandoffService().start({ state: authorization.state, intent })
  } catch {
    console.warn('[auth_app_handoff_failed]', { stage: 'start' })
    return json({ status: 'unavailable' }, 503)
  }

  const response = json({
    status: 'started',
    authorizeUrl: authorization.url,
    pairCode: formatPairCode(handoff.pairCode),
    expiresInSeconds: handoff.expiresInSeconds,
  })
  const policy = { allowInsecureHttp: client.environment.AWS_COGNITO_ALLOW_INSECURE_HTTP_COOKIES }
  createCognitoCookieManager(response.cookies, publicEnvironment.NEXT_PUBLIC_SITE_URL, policy)
    .setOAuthChallenge({ state: authorization.state, verifier: authorization.verifier, intent })
  response.cookies.set(APP_HANDOFF_COOKIE, `${handoff.id}.${handoff.secret}`, {
    ...cognitoCookieOptions(publicEnvironment.NEXT_PUBLIC_SITE_URL, policy),
    maxAge: APP_HANDOFF_TTL_SECONDS,
  })
  return response
}

export async function GET(request: NextRequest) {
  const client = oauthClient()
  if (!client) return json({ status: 'unavailable' }, 503)
  const handoff = parseHandoffCookie(request.cookies.get(APP_HANDOFF_COOKIE)?.value)
  // If iOS kept the Google window on the app's own cookies, the normal callback has signed the app in already.
  if (await getVerifiedUser().catch(() => null)) {
    const response = json({ status: 'signed-in', redirectTo: '/auth/post-sign-in' })
    if (handoff) response.cookies.delete(APP_HANDOFF_COOKIE)
    return response
  }
  if (!handoff) return json({ status: 'expired' })

  let result: Awaited<ReturnType<ReturnType<typeof appHandoffService>['claim']>>
  try {
    result = await appHandoffService().claim(handoff)
  } catch {
    console.warn('[auth_app_handoff_failed]', { stage: 'claim' })
    return json({ status: 'unavailable' }, 503)
  }
  if (result.status !== 'ready') return json({ status: result.status })

  const verifier = request.cookies.get(COGNITO_COOKIE_NAMES.oauthVerifier)?.value
  const policy = { allowInsecureHttp: client.environment.AWS_COGNITO_ALLOW_INSECURE_HTTP_COOKIES }
  try {
    if (!verifier) throw new Error('missing_verifier')
    const authentication = await client.oauth.exchangeCode({ code: result.authorizationCode, verifier })
    const response = json({ status: 'signed-in', redirectTo: '/auth/post-sign-in' })
    const cookies = createCognitoCookieManager(response.cookies, publicEnvironment.NEXT_PUBLIC_SITE_URL, policy)
    cookies.clearOAuthChallenge()
    cookies.setAuthentication(authentication)
    response.cookies.delete(APP_HANDOFF_COOKIE)
    return response
  } catch {
    console.warn('[auth_app_handoff_failed]', { stage: 'exchange' })
    const response = json({ status: 'failed' })
    response.cookies.delete(APP_HANDOFF_COOKIE)
    return response
  }
}
