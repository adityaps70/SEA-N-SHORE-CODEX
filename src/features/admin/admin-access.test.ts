import { describe, expect, it, vi } from 'vitest'
import type { CountryAdminPermissions } from '@/features/country-admins/sections'

vi.mock('server-only', () => ({}))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: vi.fn() }))
vi.mock('@/features/country-admins/repository', () => ({ countryAdminRepository: {} }))
vi.mock('./mfa-gate', () => ({ enforcePlatformAdminMfa: vi.fn() }))
vi.mock('./repository', () => ({ adminRepository: {} }))

const { createAdminAccess } = await import('./admin-access')

/**
 * Round GP (Part C, sections in Part E): who may open an admin page. Default deny; both kinds of admin pass the MFA
 * gate; a country admin opens only the sections a platform administrator gave them.
 */
const user = { id: 'user-1' } as never
class Denied extends Error {}

function access(role: { platform?: boolean; countries?: string[] | null; permissions?: CountryAdminPermissions; fail?: boolean }) {
  const enforceMfa = vi.fn(async () => undefined)
  const touchCountryAdmin = vi.fn(async () => undefined)
  const gate = createAdminAccess({
    requireUser: async () => user,
    isPlatformAdministrator: async () => role.platform ?? false,
    countryAdminAccess: async () => {
      if (role.fail) throw new Error('database unavailable')
      return role.countries ? { countries: role.countries, permissions: role.permissions ?? { organizations: 'act' } } : null
    },
    enforceMfa,
    touchCountryAdmin,
    deny: () => { throw new Denied() },
  })
  return { gate, enforceMfa, touchCountryAdmin }
}

describe('requireAdminAccess', () => {
  it('lets a platform administrator into every admin page, after the MFA gate', async () => {
    const { gate, enforceMfa } = access({ platform: true, countries: ['PH'] })
    await expect(gate('platform')).resolves.toEqual({ kind: 'platform', user })
    await expect(gate('console')).resolves.toEqual({ kind: 'platform', user })
    await expect(gate('learning')).resolves.toEqual({ kind: 'platform', user })
    expect(enforceMfa).toHaveBeenCalledWith('user-1')
  })

  it('lets a country admin into the console and their own sections only, after the MFA gate, and records the visit', async () => {
    const permissions: CountryAdminPermissions = { organizations: 'view', members: 'view' }
    const { gate, enforceMfa, touchCountryAdmin } = access({ countries: ['PH'], permissions })
    await expect(gate('console')).resolves.toEqual({ kind: 'country', user, countries: ['PH'], permissions })
    await expect(gate('organizations')).resolves.toMatchObject({ kind: 'country' })
    await expect(gate('members')).resolves.toMatchObject({ kind: 'country' })
    await expect(gate('overview')).rejects.toBeInstanceOf(Denied)
    await expect(gate('learning')).rejects.toBeInstanceOf(Denied)
    await expect(gate('platform')).rejects.toBeInstanceOf(Denied)
    expect(enforceMfa).toHaveBeenCalledWith('user-1')
    expect(touchCountryAdmin).toHaveBeenCalledWith('user-1')
  })

  it('keeps a country admin with no sections out of the console entirely', async () => {
    const { gate, enforceMfa } = access({ countries: ['PH'], permissions: {} })
    await expect(gate('console')).rejects.toBeInstanceOf(Denied)
    await expect(gate('organizations')).rejects.toBeInstanceOf(Denied)
    expect(enforceMfa).not.toHaveBeenCalled()
  })

  it('denies everyone else, and denies when the country admin lookup fails', async () => {
    for (const role of [{}, { countries: [] }, { fail: true }]) {
      const { gate, enforceMfa } = access(role)
      await expect(gate('console')).rejects.toBeInstanceOf(Denied)
      await expect(gate('organizations')).rejects.toBeInstanceOf(Denied)
      await expect(gate('platform')).rejects.toBeInstanceOf(Denied)
      expect(enforceMfa).not.toHaveBeenCalled()
    }
  })

  it('lets a failing MFA gate stop the request', async () => {
    const { gate, enforceMfa } = access({ countries: ['PH'] })
    enforceMfa.mockRejectedValue(new Error('mfa_required'))
    await expect(gate('organizations')).rejects.toThrow('mfa_required')
  })
})
