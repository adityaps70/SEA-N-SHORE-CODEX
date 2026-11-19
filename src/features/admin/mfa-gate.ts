import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { ADMIN_RETURN_PATH_HEADER, adminMfaSetupHref } from '@/lib/auth/admin-mfa-paths'
import { canStepUpForAdmin, satisfiesAdminMfa, type CurrentMfaStatus } from '@/features/auth/mfa'
import { hasAdminStepUp } from '@/features/account-security/admin-step-up-runtime'
import { getCurrentMfaStatus } from '@/features/auth/mfa-status'
import { adminRepository } from './repository'
import { countryAdminRepository } from '@/features/country-admins/repository'

/**
 * Round 14 (2.11): platform administrators need an authenticator app, and a session that answered
 * it at sign-in, before any admin page renders. Runs only after the administrator check, so
 * other members are never sent here.
 * Hotfix P1: a Google sign-in on an account with an authenticator app also passes once that sign-in has made the
 * admin step-up (hasStepUp). A failed step-up lookup refuses (fail closed).
 */
export function createAdminMfaGate(input: {
  getStatus: () => Promise<CurrentMfaStatus | null>
  getReturnPath: () => Promise<string | null>
  redirect: (href: string) => never
  hasStepUp?: (userId: string) => Promise<boolean>
}) {
  const hasStepUp = input.hasStepUp ?? (async () => false)
  return async function enforceAdminMfa(userId?: string): Promise<void> {
    // A Cognito failure throws here (fail closed); it is not treated as "MFA on".
    const status = await input.getStatus()
    if (satisfiesAdminMfa(status)) return
    if (userId && canStepUpForAdmin(status) && await hasStepUp(userId).catch(() => false)) return
    input.redirect(adminMfaSetupHref(await input.getReturnPath().catch(() => null)))
  }
}

export const enforcePlatformAdminMfa = createAdminMfaGate({
  getStatus: () => getCurrentMfaStatus(),
  hasStepUp: (userId) => hasAdminStepUp(userId),
  getReturnPath: async () => (await headers()).get(ADMIN_RETURN_PATH_HEADER),
  // Resolved when called, so modules that only import the admin access helpers stay side-effect free.
  redirect: (href) => redirect(href),
})

/** Shown when a platform administrator's session has not answered an authenticator app. */
export const ADMIN_MFA_REQUIRED_MESSAGE = 'Turn on your authenticator app and sign in with it to use Sea N Shore admin tools.'

/**
 * Round 15: the same admin MFA rule for server actions. Admin pages redirect through
 * `enforcePlatformAdminMfa`, but server actions can be called directly, and many check the
 * administrator role only inside their repository. Both checks fail closed: an unreadable role or
 * MFA status refuses rather than allows.
 */
export function createAdminActionMfaChecks(input: {
  isPlatformAdministrator: (userId: string) => Promise<boolean>
  /** Round GP (Part C): a country admin acts with admin authority too, so the same MFA rule applies. */
  isCountryAdministrator?: (userId: string) => Promise<boolean>
  getStatus: () => Promise<CurrentMfaStatus | null>
  hasStepUp?: (userId: string) => Promise<boolean>
}) {
  const hasStepUp = input.hasStepUp ?? (async () => false)
  async function sessionSatisfiesAdminMfa(userId: string) {
    try {
      const status = await input.getStatus()
      if (satisfiesAdminMfa(status)) return true
      return canStepUpForAdmin(status) && await hasStepUp(userId)
    } catch {
      return false
    }
  }

  return {
    /**
     * True when this action must be refused: the actor is a platform administrator (or the role
     * cannot be read) and the session has not answered an authenticator app. Members who are not
     * administrators pass through, so their own authorization (and messages) stay unchanged.
     */
    async adminActionMfaMissing(userId: string): Promise<boolean> {
      let administrator: boolean
      try {
        administrator = await input.isPlatformAdministrator(userId)
          || (input.isCountryAdministrator ? await input.isCountryAdministrator(userId) : false)
      } catch {
        administrator = true
      }
      return administrator && !(await sessionSatisfiesAdminMfa(userId))
    },

    /** Drop-in for `canAccessPlatformAdmin` where it grants authority: an administrator with admin MFA. */
    async canUsePlatformAdminAuthority(userId: string): Promise<boolean> {
      try {
        if (!(await input.isPlatformAdministrator(userId))) return false
      } catch {
        return false
      }
      return sessionSatisfiesAdminMfa(userId)
    },
  }
}

const adminActionMfaChecks = createAdminActionMfaChecks({
  isPlatformAdministrator: (userId) => adminRepository.isPlatformAdministrator(userId),
  isCountryAdministrator: async (userId) => Boolean((await countryAdminRepository.getCountries(userId))?.length),
  getStatus: () => getCurrentMfaStatus(),
  hasStepUp: (userId) => hasAdminStepUp(userId),
})

export const adminActionMfaMissing = adminActionMfaChecks.adminActionMfaMissing
export const canUsePlatformAdminAuthority = adminActionMfaChecks.canUsePlatformAdminAuthority
