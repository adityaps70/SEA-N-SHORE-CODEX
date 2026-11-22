import { countryAdminRepository } from '@/features/country-admins/repository'
import { adminRepository } from './repository'

/**
 * Round GP (Part C follow-up): the two admin roles, as the menu and the two-step verification pages need them.
 * A platform administrator has the whole console; a country admin reviews organizations from their countries.
 * Both must keep an authenticator app. This module only reads roles: page access is decided by requireAdminAccess
 * and the repositories, never here.
 */
export type AdminRole = { kind: 'platform' } | { kind: 'country'; countries: string[] } | null

export function createAdminRoles(input: {
  isPlatformAdministrator: (userId: string) => Promise<boolean>
  countryAdminCountries: (userId: string) => Promise<string[] | null>
}) {
  /** The member's admin role, or null. A failed lookup throws: callers decide whether to fail open or closed. */
  async function adminRole(userId: string): Promise<AdminRole> {
    if (await input.isPlatformAdministrator(userId)) return { kind: 'platform' }
    const countries = await input.countryAdminCountries(userId)
    return countries?.length ? { kind: 'country', countries } : null
  }

  /** True for a platform administrator or a country admin. A failed lookup throws. */
  async function holdsAdminRole(userId: string): Promise<boolean> {
    return (await adminRole(userId)) !== null
  }

  return { adminRole, holdsAdminRole }
}

const roles = createAdminRoles({
  isPlatformAdministrator: (userId) => adminRepository.isPlatformAdministrator(userId),
  countryAdminCountries: (userId) => countryAdminRepository.getCountries(userId),
})

export const adminRole = roles.adminRole
export const holdsAdminRole = roles.holdsAdminRole
