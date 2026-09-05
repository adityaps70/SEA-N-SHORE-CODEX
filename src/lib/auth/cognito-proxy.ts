import { NextResponse, type NextRequest } from 'next/server'
import { createCognitoApi } from './cognito-api'
import { createCognitoSessionManager } from './cognito-session'
import { getCognitoEnvironment } from '@/lib/env'

const PROTECTED_PREFIXES = [
  '/home',
  '/profile',
  '/network',
  '/notifications',
  '/posts',
  '/onboarding',
  '/jobs',
  '/learn',
  '/events',
  '/community',
] as const

export function isCognitoProtectedRoute(pathname: string) {
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
    api,
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
