import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requirePlatformAdministratorUser: vi.fn(),
  permanentlyDeleteAccount: vi.fn(),
}))

vi.mock('@/features/admin/access', () => ({
  requirePlatformAdministratorUser: mocks.requirePlatformAdministratorUser,
}))
vi.mock('@/features/admin/runtime-user-control-service', () => ({
  runtimeAdminUserControlService: {
    permanentlyDeleteAccount: mocks.permanentlyDeleteAccount,
  },
}))

import { POST } from './route'

const adminId = '11111111-1111-4111-8111-111111111111'
const profileId = '55555555-5555-4555-8555-555555555555'

function request(body: unknown) {
  return new Request(`https://seaandshore.example/api/admin/users/${profileId}/delete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST admin permanent user deletion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requirePlatformAdministratorUser.mockResolvedValue({
      id: adminId,
      cognitoSub: 'admin-sub',
      email: 'admin@example.com',
    })
    mocks.permanentlyDeleteAccount.mockResolvedValue({ ok: true })
  })

  it('requires exact DELETE confirmation and a reason', async () => {
    const response = await POST(request({
      confirmation: 'DELETE',
      reason: 'Fraudulent account confirmed after moderation review.',
    }), { params: Promise.resolve({ profileId }) })

    expect(response.status).toBe(200)
    expect(mocks.permanentlyDeleteAccount).toHaveBeenCalledWith(
      adminId,
      profileId,
      'Fraudulent account confirmed after moderation review.',
    )
  })

  it('rejects a weak confirmation without touching the account', async () => {
    const response = await POST(request({
      confirmation: 'delete',
      reason: 'Fraudulent account confirmed after moderation review.',
    }), { params: Promise.resolve({ profileId }) })

    expect(response.status).toBe(400)
    expect(mocks.permanentlyDeleteAccount).not.toHaveBeenCalled()
  })

  it('rejects non-admin callers before permanent deletion', async () => {
    mocks.requirePlatformAdministratorUser.mockRejectedValueOnce(new Error('admin_forbidden'))

    const response = await POST(request({
      confirmation: 'DELETE',
      reason: 'Fraudulent account confirmed after moderation review.',
    }), { params: Promise.resolve({ profileId }) })

    expect(response.status).toBe(403)
    expect(mocks.permanentlyDeleteAccount).not.toHaveBeenCalled()
  })
})
