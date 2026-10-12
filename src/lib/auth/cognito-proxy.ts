import { NextResponse, type NextRequest } from 'next/server'
import { CognitoApiError, createCognitoApi } from './cognito-api'
import { createCognitoSessionManager } from './cognito-session'
import { createCognitoPrincipalResolver } from './cognito-principal-cache'
import { getCognitoEnvironment } from '@/lib/env'
import { trustedClientIp } from '@/lib/http/client-ip'
import { createPublicPageRateLimiter } from '@/lib/http/public-page-rate-limit'
import { RETURN_PATH_COOKIE, returnPathCookieOptions, returnPathForRequest, safeReturnPath } from './return-path'

// About, Help, Accessibility, Privacy, Terms and Copyright are public so signed-out visitors (and
// newsletter consent links) can read them. Contact, Pricing, Refunds and Shipping must stay public
// too: the payment gateway (Cashfree) verifies them without signing in. Never add them here.
const PROTECTED_PREFIXES = [
  '/activities',
  '/admin',
  '/community',
  '/events',
  '/hashtags',
  '/hiring',
  '/home',
  '/jobs',
  '/learn',
  '/messages',
  '/network',
  '/notifications',
  '/onboarding',
  '/profile',
  '/saved',
  '/search',
] as const

/**
 * Learning pages anyone can read (learning round A): the course catalogue, each course's page and
 * its free-preview materials. Everything else under /learn (the course player, My Learning,
 * Learning Studio, trainer onboarding) stays signed-in only, and so does any /learn page added later.
 */
const PUBLIC_LEARN_PATHS = [
  /^\/learn$/,
  /^\/learn\/courses\/[a-z0-9]+(?:-[a-z0-9]+)*$/,
  /^\/learn\/courses\/[a-z0-9]+(?:-[a-z0-9]+)*\/preview\/[0-9a-f-]{36}$/,
]

export function isPublicLearnRoute(pathname: string) {
  return PUBLIC_LEARN_PATHS.some((pattern) => pattern.test(pathname))
}

/**
 * Round F: a post page opens for anyone. Signed-in members still get their session refreshed here, so
 * an expired access token never makes them look signed out; signed-out visitors are never redirected.
 */
const SOFT_AUTH_PATHS = [/^\/posts\/[^/]+$/]

export function isSoftAuthRoute(pathname: string) {
  return SOFT_AUTH_PATHS.some((pattern) => pattern.test(pathname))
}

/** Sign-in and sign-up remember a safe `?next=` so the member lands back where the wall stopped them. */
const AUTH_ENTRY_PATHS = new Set(['/auth/sign-in', '/auth/sign-up'])

export function rememberReturnPath(request: NextRequest) {
  const response = NextResponse.next({ request })
  if (!AUTH_ENTRY_PATHS.has(request.nextUrl.pathname)) return response
  const next = safeReturnPath(request.nextUrl.searchParams.get('next'))
  if (next) response.cookies.set(RETURN_PATH_COOKIE, next, returnPathCookieOptions())
  return response
}

/** The sign-in page for a protected request, carrying the page to come back to. */
export function signInRedirectUrl(request: NextRequest) {
  const url = new URL('/auth/sign-in', request.url)
  const next = returnPathForRequest(request)
  if (next) url.searchParams.set('next', next)
  return url
}

const allowPublicPostView = createPublicPageRateLimiter()

export function isCognitoProtectedRoute(pathname: string) {
  if (isPublicLearnRoute(pathname)) return false
  return PROTECTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

type RouteSession = {
  getVerifiedPrincipal(): Promise<{ sub: string } | null>
  refreshSession(): Promise<boolean>
}

export function createCognitoProxyHandler(session: RouteSession, options: { allowSignedOutView?: (key: string) => boolean } = {}) {
  const allowSignedOutView = options.allowSignedOutView ?? allowPublicPostView
  return async function handle(request: NextRequest) {
    const soft = isSoftAuthRoute(request.nextUrl.pathname)
    if (!soft && !isCognitoProtectedRoute(request.nextUrl.pathname)) {
      return NextResponse.next({ request })
    }

    const principal = await session.getVerifiedPrincipal()
    if (principal?.sub) return NextResponse.next({ request })

    if (await session.refreshSession()) {
      return NextResponse.next({ request })
    }

    if (soft) {
      // Signed out: the page renders read-only, at most 60 views a minute per visitor address.
      const key = trustedClientIp(request.headers) ?? 'unknown'
      if (!allowSignedOutView(key)) {
        return new NextResponse('Too many requests. Please wait a minute and try again.', {
          status: 429,
          headers: { 'Retry-After': '60', 'Content-Type': 'text/plain; charset=utf-8' },
        })
      }
      return NextResponse.next({ request })
    }

    return NextResponse.redirect(signInRedirectUrl(request))
  }
}

const resolveRouteCognitoPrincipal = createCognitoPrincipalResolver({
  getUser: async (accessToken) => {
    const environment = getCognitoEnvironment()
    const api = createCognitoApi({
      region: environment.AWS_COGNITO_REGION,
      clientId: environment.AWS_COGNITO_CLIENT_ID,
    })
    return api.getUser(accessToken)
  },
})

type CookieMutation =
  | { kind: 'set'; name: string; value: string; options?: Record<string, unknown> }
  | { kind: 'delete'; name: string }

export async function updateCognitoRouteSession(request: NextRequest) {
  if (AUTH_ENTRY_PATHS.has(request.nextUrl.pathname)) return rememberReturnPath(request)
  if (!isCognitoProtectedRoute(request.nextUrl.pathname) && !isSoftAuthRoute(request.nextUrl.pathname)) {
    return NextResponse.next({ request })
  }

  const mutations: CookieMutation[] = []
  const cookieStore = {
    get(name: string) {
      return request.cookies.get(name)
    },
    set(name: string, value: string, options?: Record<string, unknown>) {
      request.cookies.set(name, value)
      mutations.push({ kind: 'set' as const, name, value, options })
    },
    delete(name: string) {
      request.cookies.delete(name)
      mutations.push({ kind: 'delete' as const, name })
    },
  }

  const environment = getCognitoEnvironment()
  const api = createCognitoApi({
    region: environment.AWS_COGNITO_REGION,
    clientId: environment.AWS_COGNITO_CLIENT_ID,
  })
  const session = createCognitoSessionManager({
    cookieStore,
    api: {
      getUser: async (accessToken) => {
        const principal = await resolveRouteCognitoPrincipal(accessToken)
        if (!principal) throw new CognitoApiError('NotAuthorizedException')
        return principal
      },
      refresh: api.refresh,
    },
    siteUrl: request.nextUrl.origin,
  })

  const response = await createCognitoProxyHandler(session)(request)
  for (const mutation of mutations) {
    if (mutation.kind === 'delete') {
      response.cookies.delete(mutation.name)
    } else {
      response.cookies.set(mutation.name, mutation.value, mutation.options)
    }
  }
  response.headers.set('Cache-Control', 'private, no-store')
  return response
}
