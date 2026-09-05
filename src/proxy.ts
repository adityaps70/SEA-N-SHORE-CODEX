import type { NextRequest } from 'next/server'
import { updateCognitoRouteSession } from '@/lib/auth/cognito-proxy'

export async function proxy(request: NextRequest) {
  return updateCognitoRouteSession(request)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
