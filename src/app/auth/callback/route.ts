import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { publicEnvironment } from '@/lib/env'
import type { Database } from '@/lib/supabase/database.types'

const allowedNextPaths = new Set(['/home', '/onboarding', '/auth/update-password'])

export function safeAuthNextPath(value: string | null) {
  return value && allowedNextPaths.has(value) ? value : '/home'
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code')
  const next = safeAuthNextPath(request.nextUrl.searchParams.get('next'))
  const response = NextResponse.redirect(new URL(next, request.url))

  if (code) {
    const supabase = createServerClient<Database>(
      publicEnvironment.NEXT_PUBLIC_SUPABASE_URL,
      publicEnvironment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      {
        cookies: {
          getAll: () => request.cookies.getAll(),
          setAll(cookiesToSet, responseHeaders) {
            cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
            Object.entries(responseHeaders).forEach(([name, value]) => response.headers.set(name, value))
          },
        },
      },
    )
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) return response
  }

  const failure = NextResponse.redirect(new URL('/auth/sign-in?error=callback', request.url))
  failure.headers.set('Cache-Control', 'private, no-store')
  return failure
}
