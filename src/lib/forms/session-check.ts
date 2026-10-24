import { authHrefWithReturn } from '@/lib/auth/return-path'

/**
 * Hotfix P2: when a save fails without an answer (the proxy sends a signed-out request to sign-in, which a
 * server action call can't read), ask whether this page still opens signed in: a protected page answers a
 * signed-out request with a redirect to sign-in.
 */
export async function hasSessionEnded(): Promise<boolean> {
  try {
    const response = await fetch(window.location.pathname, { method: 'HEAD', redirect: 'manual', cache: 'no-store', credentials: 'same-origin' })
    return response.type === 'opaqueredirect' || response.status === 401 || (response.status >= 300 && response.status < 400)
  } catch {
    return false
  }
}

/** Sign in again, then come back to this page (and the form's local copy). */
export function signInAgainHref() {
  return authHrefWithReturn('/auth/sign-in', `${window.location.pathname}${window.location.search}`)
}

export const CONNECTION_LOST_MESSAGE = 'We couldn’t reach Sea N Shore. Check your connection and try again. Everything you typed is kept.'

export function goToSignInAgain() {
  window.location.assign(signInAgainHref())
}
