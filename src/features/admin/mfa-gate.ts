import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { ADMIN_RETURN_PATH_HEADER, adminMfaSetupHref } from '@/lib/auth/admin-mfa-paths'
import { satisfiesAdminMfa, type CurrentMfaStatus } from '@/features/auth/mfa'
import { getCurrentMfaStatus } from '@/features/auth/mfa-status'

/**
 * Round 14 (2.11): platform administrators need an authenticator app, and a session that answered
 * it at sign-in, before any admin page renders. Runs only after the administrator check, so
 * other members are never sent here.
 */
export function createAdminMfaGate(input: {
  getStatus: () => Promise<CurrentMfaStatus | null>
  getReturnPath: () => Promise<string | null>
  redirect: (href: string) => never
}) {
  return async function enforceAdminMfa(): Promise<void> {
    // A Cognito failure throws here (fail closed); it is not treated as "MFA on".
    const status = await input.getStatus()
    if (satisfiesAdminMfa(status)) return
    input.redirect(adminMfaSetupHref(await input.getReturnPath().catch(() => null)))
  }
}

export const enforcePlatformAdminMfa = createAdminMfaGate({
  getStatus: () => getCurrentMfaStatus(),
  getReturnPath: async () => (await headers()).get(ADMIN_RETURN_PATH_HEADER),
  // Resolved when called, so modules that only import the admin access helpers stay side-effect free.
  redirect: (href) => redirect(href),
})
