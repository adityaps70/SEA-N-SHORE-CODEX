import { notFound } from 'next/navigation'
import { cache } from 'react'
import { requireAwsUser, type AwsVerifiedUser } from '@/features/auth/aws-queries'
import { countryAdminRepository } from '@/features/country-admins/repository'
import { allows, LIVE_COUNTRY_ADMIN_SECTIONS, type CountryAdminPermissions, type CountryAdminSection } from '@/features/country-admins/sections'
import { enforcePlatformAdminMfa } from './mfa-gate'
import { adminRepository } from './repository'

/**
 * Round GP (Global Partners), Part C (sections in Part E): who may open an admin page. Default deny:
 * - 'platform' pages (every admin page unless it says otherwise): platform administrators only.
 * - a section's pages (e.g. 'organizations', 'members'): platform administrators, and country admins a platform
 *   administrator gave that section to; the page then limits its data to their countries, and shows decisions only
 *   with "act" (access.permissions).
 * - 'console' (the admin layout and the /admin landing page): any country admin with at least one live section.
 * Anyone else, a country admin on a 'platform' page included, gets the same not-found answer the console gives every
 * non-administrator, so no admin page or its contents is revealed. Both kinds of admin must have answered their
 * authenticator app (the round 14 admin MFA gate). The repositories behind each page check the role again in SQL.
 *
 * src/admin-country-access-contract.test.ts requires every admin page to call this and lists the 'country' pages.
 */
export type AdminArea = 'platform' | 'console' | CountryAdminSection

export type AdminAccess =
  | { kind: 'platform'; user: AwsVerifiedUser }
  | { kind: 'country'; user: AwsVerifiedUser; countries: string[]; permissions: CountryAdminPermissions }

type ResolvedAccess = AdminAccess | { kind: 'none'; user: AwsVerifiedUser }

export function createAdminAccess(input: {
  requireUser: () => Promise<AwsVerifiedUser>
  isPlatformAdministrator: (userId: string) => Promise<boolean>
  countryAdminAccess: (userId: string) => Promise<{ countries: string[]; permissions: CountryAdminPermissions } | null>
  enforceMfa: (userId: string) => Promise<void>
  touchCountryAdmin?: (userId: string) => Promise<void>
  deny?: () => never
  memo?: <T>(load: () => Promise<T>) => () => Promise<T>
}) {
  const deny = input.deny ?? (() => notFound())
  const memo = input.memo ?? ((load) => load)

  const resolve = memo(async (): Promise<ResolvedAccess> => {
    const user = await input.requireUser()
    if (await input.isPlatformAdministrator(user.id)) {
      await input.enforceMfa(user.id)
      return { kind: 'platform', user }
    }
    const countryAdmin = await input.countryAdminAccess(user.id).catch(() => null)
    const hasLiveSection = countryAdmin ? LIVE_COUNTRY_ADMIN_SECTIONS.some((section) => allows(countryAdmin.permissions, section)) : false
    if (countryAdmin?.countries.length && hasLiveSection) {
      await input.enforceMfa(user.id)
      await input.touchCountryAdmin?.(user.id).catch(() => undefined)
      return { kind: 'country', user, countries: countryAdmin.countries, permissions: countryAdmin.permissions }
    }
    return { kind: 'none', user }
  })

  return async function requireAdminAccess(area: AdminArea): Promise<AdminAccess> {
    const access = await resolve()
    if (access.kind === 'platform') return access
    if (access.kind === 'country' && (area === 'console' || (area !== 'platform' && allows(access.permissions, area)))) return access
    return deny()
  }
}

/** Once per request: the layout and the page share one role and MFA check. */
const memoForRequest = <T,>(load: () => Promise<T>) => cache(load)

export const requireAdminAccess = createAdminAccess({
  requireUser: requireAwsUser,
  isPlatformAdministrator: (userId) => adminRepository.isPlatformAdministrator(userId),
  countryAdminAccess: (userId) => countryAdminRepository.getAccess(userId),
  enforceMfa: (userId) => enforcePlatformAdminMfa(userId),
  touchCountryAdmin: (userId) => countryAdminRepository.touchActive(userId),
  memo: memoForRequest,
})
