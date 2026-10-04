/**
 * Mobile sign-ins are separate Cognito users whose email is a made-up address
 * (phone-<hash>@auth.seaandshore.in). They exist only to sign in with that number.
 *
 * Kept free of imports with side effects: the outbox worker uses it, and its task has no web
 * environment (importing @/lib/env there throws at load and crash-loops the worker).
 */
export function isPhoneLoginEmail(email: string | null | undefined) {
  return typeof email === 'string' && /^phone-[0-9a-f]{32}@auth\.seaandshore\.in$/i.test(email.trim())
}
