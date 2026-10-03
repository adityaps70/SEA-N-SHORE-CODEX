import { NextResponse, type NextRequest } from 'next/server'

/**
 * Round 10: "Not you? Use a different email" on onboarding signs the member out and must land on
 * sign-up. Cognito's hosted logout can only return to the site root (the one allowed logout URL),
 * so the sign-out action leaves this short-lived cookie and the proxy forwards "/" to sign-up once.
 */
export const AFTER_SIGN_OUT_COOKIE = 'sns_after_sign_out'

/** Only these destinations are honoured, so the cookie can never become an open redirect. */
export const AFTER_SIGN_OUT_DESTINATIONS = ['/auth/sign-up'] as const
export type AfterSignOutDestination = (typeof AFTER_SIGN_OUT_DESTINATIONS)[number]

export const AFTER_SIGN_OUT_COOKIE_MAX_AGE_SECONDS = 10 * 60

export function isAfterSignOutDestination(value: string | undefined | null): value is AfterSignOutDestination {
  return Boolean(value) && (AFTER_SIGN_OUT_DESTINATIONS as readonly string[]).includes(value as string)
}

/** A redirect for the site root when the sign-out cookie is present; otherwise null. */
export function afterSignOutRedirect(request: NextRequest) {
  if (request.nextUrl.pathname !== '/') return null
  const destination = request.cookies.get(AFTER_SIGN_OUT_COOKIE)?.value
  if (!destination) return null
  const response = isAfterSignOutDestination(destination)
    ? NextResponse.redirect(new URL(destination, request.url))
    : NextResponse.next({ request })
  response.cookies.delete(AFTER_SIGN_OUT_COOKIE)
  return response
}
