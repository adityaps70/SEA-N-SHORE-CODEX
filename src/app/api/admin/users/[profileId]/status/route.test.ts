import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requirePlatformAdministratorUser: vi.fn(),
  suspendAccount: vi.fn(),
  restoreAccount: vi.fn(),
}))

vi.mock('@/features/admin/access', () => ({
  requirePlatformAdministratorUser: mocks.requirePlatformAdministratorUser,
}))
vi.mock('@/features/admin/runtime-user-control-service', () => ({
  runtimeAdminUserControlService: {
    suspendAccount: mocks.suspendAccount,
    restoreAccount: mocks.restoreAccount,
  },
}))

import { POST } from './route'
import { AdminSignInControlError } from '@/features/admin/sign-in-control-error'

const adminId = '11111111-1111-4111-8111-111111111111'
const profileId = '55555555-5555-4555-8555-555555555555'

function request(body: unknown) {
  return new Request(`https://seaandshore.example/api/admin/users/${profileId}/status`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST admin user status', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requirePlatformAdministratorUser.mockResolvedValue({
      id: adminId,
      cognitoSub: 'admin-sub',
      email: 'admin@example.com',
    })
    mocks.suspendAccount.mockResolvedValue({ ok: true })
    mocks.restoreAccount.mockResolvedValue({ ok: true })
  })

  it('requires admin authorization before suspending an account', async () => {
    const response = await POST(request({
      action: 'suspend',
      reason: 'Repeated unsafe recruitment messages.',
    }), { params: Promise.resolve({ profileId }) })

    expect(response.status).toBe(200)
    expect(mocks.suspendAccount).toHaveBeenCalledWith(
      adminId,
      profileId,
      'Repeated unsafe recruitment messages.',
    )
  })

  it('restores a suspended account with a recorded reason', async () => {
    const response = await POST(request({
      action: 'restore',
      reason: 'Appeal reviewed and access restored.',
    }), { params: Promise.resolve({ profileId }) })

    expect(response.status).toBe(200)
    expect(mocks.restoreAccount).toHaveBeenCalledWith(
      adminId,
      profileId,
      'Appeal reviewed and access restored.',
    )
  })

  it('says clearly when a suspension could not reach every sign-in method', async () => {
    mocks.suspendAccount.mockRejectedValueOnce(new AdminSignInControlError('admin_user_cognito_suspend_incomplete', 1, 3))

    const response = await POST(request({
      action: 'suspend',
      reason: 'Repeated unsafe recruitment messages.',
    }), { params: Promise.resolve({ profileId }) })

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'The account is suspended, but 1 of 3 sign-in methods couldn’t be signed out. Suspend again to retry.',
    })
  })

  it('rejects non-admin access before touching account controls', async () => {
    mocks.requirePlatformAdministratorUser.mockRejectedValueOnce(new Error('admin_forbidden'))

    const response = await POST(request({
      action: 'suspend',
      reason: 'Repeated unsafe recruitment messages.',
    }), { params: Promise.resolve({ profileId }) })

    expect(response.status).toBe(403)
    expect(mocks.suspendAccount).not.toHaveBeenCalled()
  })

  it('requires a meaningful moderation reason', async () => {
    const response = await POST(request({
      action: 'suspend',
      reason: 'bad',
    }), { params: Promise.resolve({ profileId }) })

    expect(response.status).toBe(400)
    expect(mocks.suspendAccount).not.toHaveBeenCalled()
  })
})
