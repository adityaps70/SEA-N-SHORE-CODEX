import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  stepUp: vi.fn(),
  redirect: vi.fn((href: string) => {
    throw Object.assign(new Error('NEXT_REDIRECT'), { href })
  }),
}))

vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('./admin-step-up-runtime', () => ({ productionAdminStepUp: () => mocks.stepUp }))

import { adminStepUpAction } from './admin-step-up-actions'

function form(values: Record<string, string>) {
  const data = new FormData()
  for (const [key, value] of Object.entries(values)) data.set(key, value)
  return data
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAwsUser.mockResolvedValue({ id: 'profile-1' })
})

describe('adminStepUpAction (hotfix P1)', () => {
  it('continues to the admin page asked for, and only to a safe admin path', async () => {
    mocks.stepUp.mockResolvedValue({ status: 'verified' })
    await expect(adminStepUpAction({}, form({ method: 'authenticator', password: 'p', code: '123456', next: '/admin/payments' }))).rejects.toMatchObject({ href: '/admin/payments' })
    expect(mocks.stepUp).toHaveBeenCalledWith({ method: 'authenticator', password: 'p', code: '123456' })
    await expect(adminStepUpAction({}, form({ method: 'backup_code', password: 'p', code: 'ABCDE23456', next: 'https://evil.example/admin' }))).rejects.toMatchObject({ href: '/admin' })
    expect(mocks.stepUp).toHaveBeenLastCalledWith({ method: 'backup_code', password: 'p', code: 'ABCDE23456' })
  })

  it('returns the field error, and logs only the error name when something breaks', async () => {
    mocks.stepUp.mockResolvedValueOnce({ status: 'error', error: 'That code isn’t right.', field: 'code' })
    expect(await adminStepUpAction({}, form({ method: 'authenticator', password: 'p', code: '000000' }))).toEqual({ error: 'That code isn’t right.', field: 'code' })
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.stepUp.mockRejectedValueOnce(new TypeError('fetch failed for secret-password 654321'))
    expect(await adminStepUpAction({}, form({ method: 'authenticator', password: 'secret-password', code: '654321' }))).toMatchObject({ error: expect.stringMatching(/couldn.t confirm it.s you/) })
    expect(error).toHaveBeenCalledWith('admin_step_up_failed', { name: 'TypeError' })
    expect(JSON.stringify(error.mock.calls)).not.toMatch(/secret-password|654321/)
    expect(mocks.redirect).not.toHaveBeenCalled()
  })
})
