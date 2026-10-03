import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterAll, vi } from 'vitest'

process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000'
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://sea-n-shore-test.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test_key_for_vitest_only'

// At the end of each test file, unmount whatever is still rendered and let React's scheduler
// finish queued work while jsdom's `window` still exists. Without this, work React scheduled
// during the last render (e.g. a next/link effect) can run after the environment is torn down
// and fail the run with "ReferenceError: window is not defined" even though every test passed.
afterAll(async () => {
  // A file may end with fake timers still installed; the wait below needs real ones.
  vi.useRealTimers()
  cleanup()
  await new Promise((resolve) => setTimeout(resolve, 25))
})
