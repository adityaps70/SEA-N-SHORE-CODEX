import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  moderateContent: vi.fn(),
  revalidatePath: vi.fn(),
}))

// Round 15: platform-admin server actions require a session that answered an authenticator app.
const adminMfa = vi.hoisted(() => ({
  isPlatformAdministrator: vi.fn(async (userId: string) => { void userId; return true }),
  getCurrentMfaStatus: vi.fn(async (): Promise<unknown> => ({ kind: 'eligible', enabled: true, email: 'admin@example.com', hostedSession: false })),
}))
vi.mock('@/features/auth/mfa-status', () => ({ getCurrentMfaStatus: adminMfa.getCurrentMfaStatus }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('./repository', () => ({
  adminRepository: { isPlatformAdministrator: adminMfa.isPlatformAdministrator, moderateContent: mocks.moderateContent },
}))

import { moderateContent } from './actions'
import { ADMIN_MFA_REQUIRED_MESSAGE } from './mfa-gate'

const targetId = '22222222-2222-4222-8222-222222222222'

describe('admin moderation actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAwsUser.mockResolvedValue({ id: 'admin-1' })
    mocks.moderateContent.mockResolvedValue(true)
  })

  it('refuses a platform administrator whose session has not answered an authenticator app', async () => {
    adminMfa.getCurrentMfaStatus.mockResolvedValueOnce({ kind: 'eligible', enabled: true, email: 'admin@example.com', hostedSession: true })
    await expect(moderateContent({ targetType: 'post', targetId, action: 'remove', note: 'Spam.' })).resolves.toEqual({ ok: false, error: ADMIN_MFA_REQUIRED_MESSAGE })
    expect(mocks.moderateContent).not.toHaveBeenCalled()
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it('requires a note for destructive moderation actions', async () => {
    await expect(moderateContent({
      targetType: 'post',
      targetId,
      action: 'remove',
      note: ' ',
    })).resolves.toMatchObject({ ok: false })

    expect(mocks.requireAwsUser).not.toHaveBeenCalled()
  })

  it('uses the authenticated administrator and refreshes affected admin/content routes', async () => {
    await expect(moderateContent({
      targetType: 'event',
      targetId,
      action: 'remove',
      note: 'Fraudulent event listing.',
    })).resolves.toEqual({ ok: true })

    expect(mocks.moderateContent).toHaveBeenCalledWith('admin-1', {
      targetType: 'event',
      targetId,
      action: 'remove',
      note: 'Fraudulent event listing.',
    })
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin')
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin/moderation')
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/events')
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/events/${targetId}`)
  })

  it('returns safe copy when authorization fails', async () => {
    mocks.moderateContent.mockRejectedValueOnce(new Error('admin_forbidden'))

    await expect(moderateContent({
      targetType: 'job',
      targetId,
      action: 'dismiss',
      note: 'No violation found.',
    })).resolves.toEqual({
      ok: false,
      error: 'You do not have permission to moderate platform content.',
    })
  })
})
