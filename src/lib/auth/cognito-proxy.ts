import { NextResponse, type NextRequest } from 'next/server'
import { CognitoApiError, createCognitoApi } from './cognito-api'
import { createCognitoSessionManager } from './cognito-session'
import { createCognitoPrincipalResolver } from './cognito-principal-cache'
import { getCognitoEnvironment } from '@/lib/env'

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
  '/posts',
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

export function isCognitoProtectedRoute(pathname: string) {
  if (isPublicLearnRoute(pathname)) return false
  return PROTECTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

type RouteSession = {
  getVerifiedPrincipal(): Promise<{ sub: string } | null>
  refreshSession(): Promise<boolean>
}

export function createCognitoProxyHandler(session: RouteSession) {
  return async function handle(request: NextRequest) {
    if (!isCognitoProtectedRoute(request.nextUrl.pathname)) {
      return NextResponse.next({ request })
    }

    const principal = await session.getVerifiedPrincipal()
    if (principal?.sub) return NextResponse.next({ request })

    if (await session.refreshSession()) {
      return NextResponse.next({ request })
    }

    return NextResponse.redirect(new URL('/auth/sign-in', request.url))
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
  if (!isCognitoProtectedRoute(request.nextUrl.pathname)) {
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
