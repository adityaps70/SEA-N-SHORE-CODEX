import { NextResponse, type NextRequest } from 'next/server'
import { CognitoApiError, createCognitoApi } from './cognito-api'
import { COGNITO_COOKIE_NAMES } from './cognito-cookies'
import { createCognitoSessionManager, type RefreshTokenLedger } from './cognito-session'
import { createCognitoPrincipalResolver } from './cognito-principal-cache'
import { getCognitoEnvironment } from '@/lib/env'
import { trustedClientIp } from '@/lib/http/client-ip'
import { createPublicPageRateLimiter } from '@/lib/http/public-page-rate-limit'
import { PUBLIC_ORGANIZATION_PAGE_PATH } from '@/lib/http/public-page-cache'
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
  // Round H (H7): Help › My requests (the member's Contact page tickets). /help itself stays public.
  '/help/requests',
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
const SOFT_AUTH_PATHS = [
  /^\/posts\/[^/]+$/,
  // Round H (H5): the jobs list and each job page (UUID) open the same way, for visitors and search
  // engines. Saved jobs, applications, alerts and any other /jobs page stay signed-in only.
  /^\/jobs$/,
  /^\/jobs\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  // Round ARCH (Phase 2): a claimed organization's main page opens for visitors too (the page itself shows
  // unclaimed, suspended and rejected organizations as not found when signed out). /organizations, the
  // register page and every sub-page (manage, team, training, claim, branding, analytics) stay signed-in only.
  PUBLIC_ORGANIZATION_PAGE_PATH,
]

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

/**
 * Round I (I3): pages that renew a session but never require one. The Home Screen app opens at "/" and members often
 * land on sign-in, so an access token that expired while the app was closed (it lasts 60 minutes) is renewed there
 * from the 30-day refresh cookie, and the member is still signed in. The other auth pages (Google callback, session
 * ended, MFA) handle their own cookies, and health checks never carry a session.
 */
const NO_RENEW_PREFIXES = ['/auth/', '/api/auth/', '/api/health'] as const

export function renewsSessionOnPublicRoute(request: Pick<NextRequest, 'nextUrl' | 'cookies'>) {
  const { pathname } = request.nextUrl
  const blocked = !AUTH_ENTRY_PATHS.has(pathname) && NO_RENEW_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  if (blocked) return false
  return !request.cookies.has(COGNITO_COOKIE_NAMES.access) && request.cookies.has(COGNITO_COOKIE_NAMES.refresh)
}

/**
 * Round ARCH (realtime ticket fix): the realtime ticket route. Phase 5 paused the timed polls while the socket is up,
 * and those polls (through protected pages) used to renew a session whose access token Cognito no longer accepts. So
 * this route renews it itself, once, from the refresh cookie, like a protected page, but never redirects: when the
 * session cannot be renewed the route answers 401 and the client stops asking (src/features/realtime/connection.ts).
 */
export const REALTIME_TICKET_PATH = '/api/realtime/ticket'
export function isRealtimeTicketRoute(pathname: string) {
  return pathname === REALTIME_TICKET_PATH
}

export function isCognitoProtectedRoute(pathname: string) {
  if (isPublicLearnRoute(pathname) || isSoftAuthRoute(pathname)) return false
  return PROTECTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

type RouteSession = {
  getVerifiedPrincipal(): Promise<{ sub: string } | null>
  refreshSession(): Promise<boolean>
}

export function createCognitoProxyHandler(session: RouteSession, options: { allowSignedOutView?: (key: string) => boolean } = {}) {
  const allowSignedOutView = options.allowSignedOutView ?? allowPublicPostView
  return async function handle(request: NextRequest) {
    if (isRealtimeTicketRoute(request.nextUrl.pathname)) {
      const principal = await session.getVerifiedPrincipal().catch(() => null)
      if (!principal?.sub) await session.refreshSession().catch(() => false)
      return NextResponse.next({ request })
    }
    const soft = isSoftAuthRoute(request.nextUrl.pathname)
    if (!soft && !isCognitoProtectedRoute(request.nextUrl.pathname)) {
      // A failed renewal never blocks a public page: it renders signed out, as before.
      if (renewsSessionOnPublicRoute(request)) await session.refreshSession().catch(() => false)
      return AUTH_ENTRY_PATHS.has(request.nextUrl.pathname) ? rememberReturnPath(request) : NextResponse.next({ request })
    }

    const principal = await session.getVerifiedPrincipal()
    if (principal?.sub) return NextResponse.next({ request })

    if (await session.refreshSession()) {
      return NextResponse.next({ request })
    }

    if (soft) {
      // Signed out: the page renders read-only, at most 60 views a minute per visitor address (shared by
      // post and job pages).
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

/** Round I (I3): set once by src/proxy.ts, so this module stays free of database imports (and its tests too). */
let refreshTokenLedger: RefreshTokenLedger | undefined
export function setRefreshTokenLedger(ledger: RefreshTokenLedger) {
  refreshTokenLedger = ledger
}

export async function updateCognitoRouteSession(request: NextRequest) {
  const routed = isCognitoProtectedRoute(request.nextUrl.pathname) || isSoftAuthRoute(request.nextUrl.pathname)
    || isRealtimeTicketRoute(request.nextUrl.pathname)
  if (!routed && !renewsSessionOnPublicRoute(request)) {
    return AUTH_ENTRY_PATHS.has(request.nextUrl.pathname) ? rememberReturnPath(request) : NextResponse.next({ request })
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
    ledger: refreshTokenLedger,
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
