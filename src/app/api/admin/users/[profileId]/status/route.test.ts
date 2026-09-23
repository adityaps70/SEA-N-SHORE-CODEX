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
