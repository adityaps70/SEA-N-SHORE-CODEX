import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  canAccessPlatformAdmin: vi.fn(async () => false),
  getCountries: vi.fn(async (): Promise<string[] | null> => null),
  permissions: vi.fn((): Record<string, string> => ({ organizations: 'act' })),
}))

vi.mock('@/features/ranking/switches', () => ({ isRankingEnabled: async () => false }))
vi.mock('@/features/admin/access', () => ({ canAccessPlatformAdmin: mocks.canAccessPlatformAdmin }))
vi.mock('@/features/country-admins/repository', () => ({ countryAdminRepository: { getAccess: async () => { const countries = await mocks.getCountries(); return countries ? { countries, permissions: mocks.permissions() } : null } } }))
vi.mock('./chrome-counts', () => ({
  getChromeCountsForRequest: async () => ({ notificationUnreadCount: 0, messagingUnreadCount: 0, pendingConnectionRequestCount: 0 }),
}))
vi.mock('@/features/profiles/request-cached-reads', () => ({
  getProfilePortfolioForRequest: async () => null,
  listMemberOrganizationsForRequest: async () => [],
}))
vi.mock('@/features/profiles/queries', () => ({ getOwnProfile: async () => null }))

const { appHeaderProps, getAppChromeData, mobileAppHeaderProps } = await import('./app-chrome-data')

/** Round GP (Part C follow-up): who gets an Admin entry in the menu and the drawer. */
const user = { id: 'profile-1', email: 'member@placeholder.example' } as never

describe('the Admin entry in the app chrome', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.canAccessPlatformAdmin.mockResolvedValue(false)
    mocks.getCountries.mockResolvedValue(null)
  })

  it('gives platform administrators the console, without asking for country admin countries', async () => {
    mocks.canAccessPlatformAdmin.mockResolvedValue(true)
    const chrome = await getAppChromeData(user)
    expect(chrome).toMatchObject({ canAccessAdmin: true, adminCountries: null })
    expect(mocks.getCountries).not.toHaveBeenCalled()
  })

  it('gives country admins their countries, for both the header and the phone drawer', async () => {
    mocks.getCountries.mockResolvedValue(['PH'])
    const chrome = await getAppChromeData(user)
    expect(chrome).toMatchObject({ canAccessAdmin: false, adminCountries: ['PH'] })
    expect(appHeaderProps(chrome)).toMatchObject({ canAccessAdmin: false, adminCountries: ['PH'] })
    expect(mobileAppHeaderProps(chrome)).toMatchObject({ canAccessAdmin: false, adminCountries: ['PH'] })
  })

  it('gives other members nothing, and shows nothing when the lookup fails', async () => {
    expect(await getAppChromeData(user)).toMatchObject({ canAccessAdmin: false, adminCountries: null })
    mocks.getCountries.mockRejectedValue(new Error('database unavailable'))
    expect(await getAppChromeData(user)).toMatchObject({ canAccessAdmin: false, adminCountries: null })
  })

  it('gives no entry to a country admin whose sections the console cannot open yet (Round GP Part E)', async () => {
    mocks.getCountries.mockResolvedValue(['PH'])
    mocks.permissions.mockReturnValueOnce({ communities: 'act' })
    expect(await getAppChromeData(user)).toMatchObject({ canAccessAdmin: false, adminCountries: null })
  })
})
