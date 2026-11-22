import { describe, expect, it, vi } from 'vitest'

vi.mock('@/features/country-admins/repository', () => ({ countryAdminRepository: {} }))
vi.mock('./repository', () => ({ adminRepository: {} }))

const { createAdminRoles } = await import('./admin-roles')

/** Round GP (Part C follow-up): the admin roles the menu and two-step verification pages use. */
function roles(platform: boolean | Error, countries: string[] | null | Error) {
  return createAdminRoles({
    isPlatformAdministrator: async () => {
      if (platform instanceof Error) throw platform
      return platform
    },
    countryAdminCountries: async () => {
      if (countries instanceof Error) throw countries
      return countries
    },
  })
}

describe('admin roles', () => {
  it('names platform administrators first, then country admins, else nobody', async () => {
    expect(await roles(true, ['PH']).adminRole('a')).toEqual({ kind: 'platform' })
    expect(await roles(false, ['PH', 'SG']).adminRole('a')).toEqual({ kind: 'country', countries: ['PH', 'SG'] })
    expect(await roles(false, []).adminRole('a')).toBeNull()
    expect(await roles(false, null).holdsAdminRole('a')).toBe(false)
    expect(await roles(false, ['PH']).holdsAdminRole('a')).toBe(true)
  })

  it('throws when a lookup fails, so each caller chooses to fail open or closed', async () => {
    await expect(roles(new Error('down'), null).holdsAdminRole('a')).rejects.toThrow('down')
    await expect(roles(false, new Error('down')).holdsAdminRole('a')).rejects.toThrow('down')
  })
})
