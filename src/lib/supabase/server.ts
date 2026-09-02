import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { publicEnvironment } from '@/lib/env'
import type { Database } from './database.types'

export async function createServerSupabaseClient() {
  const cookieStore = await cookies()

  return createServerClient<Database>(
    publicEnvironment.NEXT_PUBLIC_SUPABASE_URL,
    publicEnvironment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll(cookiesToSet, responseHeaders) {
          void responseHeaders
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
          } catch {
            // Server Components cannot write cookies; Proxy performs refresh writes.
          }
        },
      },
    },
  )
}
