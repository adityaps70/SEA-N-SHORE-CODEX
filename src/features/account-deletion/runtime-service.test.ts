import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createCognitoUserAdmin: vi.fn(),
  deleteUser: vi.fn(async (username: string) => { void username }),
}))

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }))
vi.mock('@/lib/db/client', () => ({ query: vi.fn(async () => []) }))
vi.mock('@/lib/env', () => ({
  getCognitoEnvironment: () => ({
    AWS_COGNITO_REGION: 'ap-south-1',
    AWS_COGNITO_CLIENT_ID: 'client',
    AWS_COGNITO_USER_POOL_ID: 'ap-south-1_pool',
  }),
}))
vi.mock('@/features/auth/cognito-user-admin', () => ({ createCognitoUserAdmin: mocks.createCognitoUserAdmin }))
vi.mock('@/features/billing/account-closure', () => ({ stopAutoRenewForClosingAccount: vi.fn() }))
vi.mock('@/features/payments/event-payment-runtime', () => ({ eventPaymentService: { refundOrder: vi.fn() } }))
vi.mock('./repository', () => ({ accountDeletionRepository: {} }))
const clearOrganizationPublicPage = vi.hoisted(() => vi.fn(async () => undefined))
vi.mock('@/features/organizations/public-page-refresh', () => ({ clearOrganizationPublicPage }))

import { runtimeAccountDeletionEffects } from './runtime-service'

describe('runtime account deletion effects', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createCognitoUserAdmin.mockReturnValue({ deleteUser: mocks.deleteUser })
  })

  it('removes a member’s other Cognito sign-ins with the admin AdminDeleteUser helper (no phone auth)', async () => {
    await runtimeAccountDeletionEffects().deleteOtherSignIn!('google_123')
    expect(mocks.createCognitoUserAdmin).toHaveBeenCalledWith({ userPoolId: 'ap-south-1_pool', region: 'ap-south-1' })
    expect(mocks.deleteUser).toHaveBeenCalledWith('google_123')
  })

  it('surfaces a Cognito failure so the deletion service can report it', async () => {
    mocks.deleteUser.mockRejectedValueOnce(new Error('AccessDenied'))
    await expect(runtimeAccountDeletionEffects().deleteOtherSignIn!('uuid-2')).rejects.toThrow('AccessDenied')
  })

  it('clears an unclaimed organization\'s public page at once, without the per-minute wait (Round ARCH, Phase 2)', async () => {
    await runtimeAccountDeletionEffects().clearOrganizationPage!('company-a')
    expect(clearOrganizationPublicPage).toHaveBeenCalledWith({ companyId: 'company-a' }, { immediate: true })
  })
})
