import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  moderateContent: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('./repository', () => ({
  adminRepository: { moderateContent: mocks.moderateContent },
}))

import { moderateContent } from './actions'

const targetId = '22222222-2222-4222-8222-222222222222'

describe('admin moderation actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAwsUser.mockResolvedValue({ id: 'admin-1' })
    mocks.moderateContent.mockResolvedValue(true)
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
