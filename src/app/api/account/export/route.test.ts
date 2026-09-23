import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  class AwsAuthenticationRequiredError extends Error {}

  return {
    requireAwsUser: vi.fn(),
    exportAccountData: vi.fn(),
    AwsAuthenticationRequiredError,
  }
})

vi.mock('@/features/auth/aws-queries', () => ({
  requireAwsUser: mocks.requireAwsUser,
  AwsAuthenticationRequiredError: mocks.AwsAuthenticationRequiredError,
}))

vi.mock('@/features/account-export/repository', () => ({
  accountExportRepository: {
    exportAccountData: mocks.exportAccountData,
  },
}))

import { GET } from './route'

describe('GET /api/account/export', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAwsUser.mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      cognitoSub: 'sub-1',
      email: 'captain@example.com',
    })
    mocks.exportAccountData.mockResolvedValue({
      profile: { full_name: 'Captain Example' },
      posts: [{ id: 'post-1', body: 'Safety first' }],
      connections: [{ id: 'connection-1' }],
    })
  })

  it('returns the authenticated user account export as a downloadable no-store JSON file', async () => {
    const response = await GET()

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(response.headers.get('content-disposition')).toMatch(/attachment; filename="sea-n-shore-data-export-\d{4}-\d{2}-\d{2}\.json"/)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(mocks.exportAccountData).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111')

    const body = await response.json()
    expect(body).toMatchObject({
      schemaVersion: 1,
      account: {
        profileId: '11111111-1111-4111-8111-111111111111',
        email: 'captain@example.com',
      },
      data: {
        profile: { full_name: 'Captain Example' },
        posts: [{ id: 'post-1', body: 'Safety first' }],
        connections: [{ id: 'connection-1' }],
      },
    })
    expect(body.generatedAt).toEqual(expect.any(String))
  })

  it('rejects unauthenticated export requests without exposing account data', async () => {
    mocks.requireAwsUser.mockRejectedValueOnce(new mocks.AwsAuthenticationRequiredError())

    const response = await GET()

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Your session has expired. Sign in again to download your data.',
    })
    expect(mocks.exportAccountData).not.toHaveBeenCalled()
  })

  it('returns a safe error when account data cannot be collected', async () => {
    mocks.exportAccountData.mockRejectedValueOnce(new Error('private_database_detail'))

    const response = await GET()

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'We could not prepare your data export right now. Please try again.',
    })
  })
})
