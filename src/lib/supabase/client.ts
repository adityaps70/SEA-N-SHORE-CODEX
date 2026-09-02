import { createBrowserClient } from '@supabase/ssr'
import { publicEnvironment } from '@/lib/env'
import type { Database } from './database.types'

export function createBrowserSupabaseClient() {
  return createBrowserClient<Database>(
    publicEnvironment.NEXT_PUBLIC_SUPABASE_URL,
    publicEnvironment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  )
}
