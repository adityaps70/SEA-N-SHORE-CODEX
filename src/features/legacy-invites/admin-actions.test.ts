import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(async () => ({ id: 'admin-1', cognitoSub: 'sub-1', email: 'admin@example.test' })),
  send: vi.fn(async () => ({ status: 'sent' as const, to: 'admin@example.test' })),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/features/admin/access', () => ({ requirePlatformAdministratorUser: mocks.requireAdmin }))
vi.mock('./reminder-test', () => ({ legacyReminderTestSender: { send: mocks.send } }))
vi.mock('./reminder-repository', () => ({ legacyReminderRepository: {} }))
vi.mock('./repository', () => ({ legacyInviteRepository: {} }))

const { sendLegacyReminderTest } = await import('./admin-actions')

beforeEach(() => vi.clearAllMocks())

describe('sendLegacyReminderTest', () => {
  it('sends only to the signed-in admin: the recipient comes from the session, not from the request', async () => {
    const sendWithInput = sendLegacyReminderTest as unknown as (input: unknown) => Promise<unknown>
    await expect(sendWithInput({ to: 'someone@example.test', email: 'someone@example.test' })).resolves.toEqual({ status: 'sent', to: 'admin@example.test' })
    expect(mocks.send).toHaveBeenCalledWith({ id: 'admin-1', email: 'admin@example.test' })
  })

  it('refuses anyone who is not a platform administrator, before anything is sent', async () => {
    mocks.requireAdmin.mockRejectedValueOnce(new Error('admin_forbidden'))
    await expect(sendLegacyReminderTest()).rejects.toThrow('admin_forbidden')
    expect(mocks.send).not.toHaveBeenCalled()
  })
})
