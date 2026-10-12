import { cookies } from 'next/headers'
import { RETURN_PATH_COOKIE, safeReturnPath } from '@/lib/auth/return-path'

/**
 * Round F: the page a member signed in or signed up for (`?next=`, kept by the proxy), checked again,
 * or Home. Onboarding sends new members there when they finish.
 */
export async function homeOrReturnPath(): Promise<string> {
  try {
    return safeReturnPath((await cookies()).get(RETURN_PATH_COOKIE)?.value) ?? '/home'
  } catch {
    return '/home'
  }
}
