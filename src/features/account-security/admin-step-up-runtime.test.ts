import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  holdsAdminRole: vi.fn<(userId: string) => Promise<boolean>>(async () => true),
  createAdminStepUp: vi.fn((deps: unknown) => deps),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/features/admin/admin-roles', () => ({ holdsAdminRole: mocks.holdsAdminRole }))
vi.mock('@/features/auth/mfa-status', () => ({ currentAccessToken: vi.fn(), productionCognitoApi: () => ({}) }))
vi.mock('./admin-step-up', () => ({ createAdminStepUp: mocks.createAdminStepUp, sessionHasAdminStepUp: vi.fn() }))
vi.mock('./audit', () => ({ recordAccountSecurityAudit: vi.fn() }))
vi.mock('./backup-codes', () => ({ createBackupCodeRepository: vi.fn() }))
vi.mock('./keys', () => ({ accountSecurityKey: vi.fn() }))
vi.mock('./runtime', () => ({ accountQuery: vi.fn(), accountTransaction: vi.fn() }))
vi.mock('./session-runtime', () => ({ currentSessionId: vi.fn() }))

const { productionAdminStepUp } = await import('./admin-step-up-runtime')

/**
 * Round GP (Part C follow-up): a country admin on a Google sign-in confirms with password and authenticator code like
 * an administrator. The production step-up asks "holds an admin role" (platform or country), not "platform only".
 */
describe('the production admin step-up', () => {
  it('lets anyone with an admin role step up, and refuses everyone else', async () => {
    const deps = productionAdminStepUp({ id: 'partner-1' }) as unknown as { isPlatformAdministrator: () => Promise<boolean> }
    await expect(deps.isPlatformAdministrator()).resolves.toBe(true)
    expect(mocks.holdsAdminRole).toHaveBeenCalledWith('partner-1')
    mocks.holdsAdminRole.mockResolvedValueOnce(false)
    await expect(deps.isPlatformAdministrator()).resolves.toBe(false)
  })
})
