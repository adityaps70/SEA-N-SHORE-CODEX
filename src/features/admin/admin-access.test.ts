import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: vi.fn() }))
vi.mock('@/features/country-admins/repository', () => ({ countryAdminRepository: {} }))
vi.mock('./mfa-gate', () => ({ enforcePlatformAdminMfa: vi.fn() }))
vi.mock('./repository', () => ({ adminRepository: {} }))

const { createAdminAccess } = await import('./admin-access')

/** Round GP (Part C): who may open an admin page. Default deny; both kinds of admin pass the MFA gate. */
const user = { id: 'user-1' } as never
class Denied extends Error {}

function access(role: { platform?: boolean; countries?: string[] | null; countriesFail?: boolean }) {
  const enforceMfa = vi.fn(async () => undefined)
  const touchCountryAdmin = vi.fn(async () => undefined)
  const gate = createAdminAccess({
    requireUser: async () => user,
    isPlatformAdministrator: async () => role.platform ?? false,
    countryAdminCountries: async () => {
      if (role.countriesFail) throw new Error('database unavailable')
      return role.countries ?? null
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
    await expect(gate('country')).resolves.toEqual({ kind: 'platform', user })
    expect(enforceMfa).toHaveBeenCalledWith('user-1')
  })

  it('lets a country admin into country pages only, after the MFA gate, and records the visit', async () => {
    const { gate, enforceMfa, touchCountryAdmin } = access({ countries: ['PH'] })
    await expect(gate('country')).resolves.toEqual({ kind: 'country', user, countries: ['PH'] })
    await expect(gate('platform')).rejects.toBeInstanceOf(Denied)
    expect(enforceMfa).toHaveBeenCalledWith('user-1')
    expect(touchCountryAdmin).toHaveBeenCalledWith('user-1')
  })

  it('denies everyone else, and denies when the country admin lookup fails', async () => {
    for (const role of [{}, { countries: [] }, { countriesFail: true }]) {
      const { gate, enforceMfa } = access(role)
      await expect(gate('country')).rejects.toBeInstanceOf(Denied)
      await expect(gate('platform')).rejects.toBeInstanceOf(Denied)
      expect(enforceMfa).not.toHaveBeenCalled()
    }
  })

  it('lets a failing MFA gate stop the request', async () => {
    const { gate, enforceMfa } = access({ countries: ['PH'] })
    enforceMfa.mockRejectedValue(new Error('mfa_required'))
    await expect(gate('country')).rejects.toThrow('mfa_required')
  })
})
