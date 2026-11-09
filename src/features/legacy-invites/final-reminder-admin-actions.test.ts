import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(async () => ({ id: 'admin-1', cognitoSub: 'sub-1', email: 'admin@example.test' })),
  hasStepUp: vi.fn(async () => true),
  resume: vi.fn(async () => true),
  prepare: vi.fn(async () => ({ status: 'prepared', prepared: 10, requested: 10, limitedByFirstBatch: false })),
  send: vi.fn(async () => ({ status: 'sent' as const, to: 'admin@example.test' })),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/features/admin/access', () => ({ requirePlatformAdministratorUser: mocks.requireAdmin }))
vi.mock('@/features/account-security/admin-step-up-runtime', () => ({ hasAdminStepUp: mocks.hasStepUp }))
vi.mock('./final-reminder-repository', () => ({ legacyFinalReminderRepository: { resume: mocks.resume, prepareEligible: mocks.prepare } }))
vi.mock('./final-reminder-test', () => ({ legacyFinalReminderTestSender: { send: mocks.send } }))

const actions = await import('./final-reminder-admin-actions')

beforeEach(() => vi.clearAllMocks())

describe('Resume final reminders', () => {
  it('needs the admin step-up: without it nothing changes', async () => {
    mocks.hasStepUp.mockResolvedValueOnce(false)
    await expect(actions.resumeLegacyFinalReminders()).resolves.toEqual({ status: 'step_up_required' })
    expect(mocks.hasStepUp).toHaveBeenCalledWith('admin-1')
    expect(mocks.resume).not.toHaveBeenCalled()
  })

  it('a platform administrator with the step-up resumes, recorded as that administrator', async () => {
    await expect(actions.resumeLegacyFinalReminders()).resolves.toEqual({ status: 'resumed' })
    expect(mocks.resume).toHaveBeenCalledWith('admin-1')
    mocks.resume.mockResolvedValueOnce(false)
    await expect(actions.resumeLegacyFinalReminders()).resolves.toEqual({ status: 'not_paused' })
  })

  it('refuses anyone who is not a platform administrator before checking anything else', async () => {
    mocks.requireAdmin.mockRejectedValueOnce(new Error('admin_forbidden'))
    await expect(actions.resumeLegacyFinalReminders()).rejects.toThrow('admin_forbidden')
    expect(mocks.hasStepUp).not.toHaveBeenCalled()
    expect(mocks.resume).not.toHaveBeenCalled()
  })
})

describe('final reminder admin actions', () => {
  it('prepares only 10, 50 or 100', async () => {
    await expect(actions.prepareLegacyFinalReminderBatch(10)).resolves.toMatchObject({ status: 'prepared' })
    expect(mocks.prepare).toHaveBeenCalledWith(10, 'admin-1')
    await expect(actions.prepareLegacyFinalReminderBatch(500)).rejects.toThrow('legacy_final_reminder_batch_invalid')
    expect(mocks.prepare).toHaveBeenCalledTimes(1)
  })

  it('sends a test only to the signed-in admin', async () => {
    const sendWithInput = actions.sendLegacyFinalReminderTest as unknown as (input: unknown) => Promise<unknown>
    await expect(sendWithInput({ to: 'someone@example.test' })).resolves.toEqual({ status: 'sent', to: 'admin@example.test' })
    expect(mocks.send).toHaveBeenCalledWith({ id: 'admin-1', email: 'admin@example.test' })
  })
})
