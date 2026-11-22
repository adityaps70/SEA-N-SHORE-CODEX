import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  holdsAdminRole: vi.fn<(userId: string) => Promise<boolean>>(async () => false),
  setSoftwareTokenMfaPreference: vi.fn(async () => undefined),
}))

vi.mock('server-only', () => ({}))
vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn() } }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/features/admin/admin-roles', () => ({ holdsAdminRole: mocks.holdsAdminRole }))
vi.mock('./aws-queries', () => ({ requireAwsUser: async () => ({ id: 'partner-1' }) }))
vi.mock('./mfa-status', () => ({
  currentAccessToken: async () => 'placeholder-access-token',
  productionCognitoApi: () => ({ setSoftwareTokenMfaPreference: mocks.setSoftwareTokenMfaPreference }),
}))

const { disableAuthenticator } = await import('./mfa-actions')
const { MFA_MESSAGES } = await import('./mfa')

/** Round GP (Part C follow-up): country admins, like administrators, cannot turn their authenticator app off. */
describe('turning the authenticator app off', () => {
  beforeEach(() => vi.clearAllMocks())

  it('is refused for anyone with an admin role, a country admin included', async () => {
    mocks.holdsAdminRole.mockResolvedValueOnce(true)
    await expect(disableAuthenticator()).resolves.toEqual({ status: 'error', error: MFA_MESSAGES.adminCannotDisable })
    expect(mocks.holdsAdminRole).toHaveBeenCalledWith('partner-1')
    expect(mocks.setSoftwareTokenMfaPreference).not.toHaveBeenCalled()
  })

  it('is refused when the role cannot be read (fail closed), and allowed for other members', async () => {
    mocks.holdsAdminRole.mockRejectedValueOnce(new Error('database unavailable'))
    await expect(disableAuthenticator()).resolves.toMatchObject({ status: 'error' })
    expect(mocks.setSoftwareTokenMfaPreference).not.toHaveBeenCalled()
    await expect(disableAuthenticator()).resolves.toMatchObject({ status: 'disabled' })
    expect(mocks.setSoftwareTokenMfaPreference).toHaveBeenCalledWith({ accessToken: 'placeholder-access-token', enabled: false })
  })
})
