import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AccountDeletionError } from '@/features/account-deletion/service'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  deleteAccount: vi.fn(),
  cookieDelete: vi.fn(),
}))

vi.mock('next/headers', () => ({
  cookies: async () => ({
    delete: mocks.cookieDelete,
  }),
}))

vi.mock('@/features/auth/aws-queries', () => ({
  requireAwsUser: mocks.requireAwsUser,
  AwsAuthenticationRequiredError: class AwsAuthenticationRequiredError extends Error {},
}))

vi.mock('@/features/account-deletion/runtime-service', () => ({
  runtimeAccountDeletionService: {
    deleteAccount: mocks.deleteAccount,
  },
}))

import { POST } from './route'

function request(body: unknown) {
  return new Request('https://seaandshore.example/api/account/delete', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/account/delete', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAwsUser.mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      cognitoSub: 'sub-1',
      email: 'captain@example.com',
    })
    mocks.deleteAccount.mockResolvedValue({ ok: true })
  })

  it('requires an authenticated user, exact confirmation text, and password re-authentication input', async () => {
    const response = await POST(request({
      confirmation: 'DELETE',
      password: 'CorrectPassword123',
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      redirectTo: '/account-deleted',
    })
    expect(mocks.deleteAccount).toHaveBeenCalledWith({
      profileId: '11111111-1111-4111-8111-111111111111',
      email: 'captain@example.com',
      password: 'CorrectPassword123',
    })
    expect(mocks.cookieDelete).toHaveBeenCalledTimes(8)
  })

  it('rejects deletion unless the user types DELETE exactly', async () => {
    const response = await POST(request({
      confirmation: 'delete',
      password: 'CorrectPassword123',
    }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Type DELETE exactly to confirm permanent account deletion.',
    })
    expect(mocks.deleteAccount).not.toHaveBeenCalled()
  })

  it('returns a clear re-authentication error for an incorrect password', async () => {
    mocks.deleteAccount.mockRejectedValueOnce(
      new AccountDeletionError('account_deletion_reauthentication_failed'),
    )

    const response = await POST(request({
      confirmation: 'DELETE',
      password: 'WrongPassword123',
    }))

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Your password could not be verified. Please try again.',
    })
    expect(mocks.cookieDelete).not.toHaveBeenCalled()
  })

  it('does not expose backend deletion errors', async () => {
    mocks.deleteAccount.mockRejectedValueOnce(new Error('private_database_detail'))

    const response = await POST(request({
      confirmation: 'DELETE',
      password: 'CorrectPassword123',
    }))

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'We could not delete your account safely. Nothing else is required from you right now; please try again.',
    })
  })
})
