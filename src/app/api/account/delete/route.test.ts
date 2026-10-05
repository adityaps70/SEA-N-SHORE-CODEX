import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AccountDeletionError } from '@/features/account-deletion/service'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  deleteAccount: vi.fn(),
  deleteVerifiedAccount: vi.fn(),
  cookieDelete: vi.fn(),
  getDeletionReauth: vi.fn(),
  deleteIdentityByUsername: vi.fn(async () => undefined),
}))

vi.mock('@/features/account-deletion/reauth-runtime', () => ({
  getDeletionReauth: mocks.getDeletionReauth,
  deleteIdentityByUsername: mocks.deleteIdentityByUsername,
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
    deleteVerifiedAccount: mocks.deleteVerifiedAccount,
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
    mocks.deleteVerifiedAccount.mockResolvedValue({ ok: true })
    mocks.getDeletionReauth.mockResolvedValue({ method: 'password' })
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
      cognitoSub: 'sub-1',
    })
    // Every Cognito cookie, including the Round 14 (2.11) authenticator-code challenge pair.
    expect(mocks.cookieDelete).toHaveBeenCalledTimes(11)
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

  it('explains that nothing was deleted when auto-renew could not be turned off', async () => {
    mocks.deleteAccount.mockRejectedValueOnce(new AccountDeletionError('account_deletion_billing_cancel_failed'))
    const response = await POST(request({ confirmation: 'DELETE', password: 'CorrectPassword123' }))
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: expect.stringContaining('nothing was deleted') })
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

  it('asks email members for their password', async () => {
    const response = await POST(request({ confirmation: 'DELETE' }))
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'Enter your password to continue.' })
    expect(mocks.deleteAccount).not.toHaveBeenCalled()
  })

  it('refuses a legacy mobile-only session (no self-service check since SMS codes were retired), even with a code', async () => {
    mocks.getDeletionReauth.mockResolvedValue({ method: 'unavailable' })
    const response = await POST(request({ confirmation: 'DELETE', code: '123456' }))
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: expect.stringContaining('info@beaufortmarine.in') })
    expect(mocks.deleteAccount).not.toHaveBeenCalled()
    expect(mocks.deleteVerifiedAccount).not.toHaveBeenCalled()
    expect(mocks.cookieDelete).not.toHaveBeenCalled()
  })

  it('lets a Google member delete only within 10 minutes of signing in', async () => {
    mocks.getDeletionReauth.mockResolvedValue({ method: 'recent_sign_in', username: 'google_123', fresh: false })
    const stale = await POST(request({ confirmation: 'DELETE' }))
    expect(stale.status).toBe(401)
    await expect(stale.json()).resolves.toMatchObject({ error: expect.stringContaining('sign in with Google again') })
    expect(mocks.deleteVerifiedAccount).not.toHaveBeenCalled()

    mocks.getDeletionReauth.mockResolvedValue({ method: 'recent_sign_in', username: 'google_123', fresh: true })
    const response = await POST(request({ confirmation: 'DELETE' }))
    expect(response.status).toBe(200)
    const call = mocks.deleteVerifiedAccount.mock.calls[0]![0] as { deleteIdentity: () => Promise<void> }
    await call.deleteIdentity()
    expect(mocks.deleteIdentityByUsername).toHaveBeenCalledWith('google_123')
    expect(mocks.cookieDelete).toHaveBeenCalled()
  })

  it('still requires DELETE for passwordless members', async () => {
    mocks.getDeletionReauth.mockResolvedValue({ method: 'recent_sign_in', username: 'google_123', fresh: true })
    const response = await POST(request({ confirmation: 'delete' }))
    expect(response.status).toBe(400)
    expect(mocks.deleteVerifiedAccount).not.toHaveBeenCalled()
  })
})
