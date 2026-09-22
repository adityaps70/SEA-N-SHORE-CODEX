import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  isPlatformAdministrator: vi.fn(),
}))

vi.mock('@/features/auth/aws-queries', () => ({
  requireAwsUser: mocks.requireAwsUser,
}))

vi.mock('./repository', () => ({
  adminRepository: {
    isPlatformAdministrator: mocks.isPlatformAdministrator,
  },
}))

import {
  canAccessPlatformAdmin,
  requirePlatformAdministratorUser,
} from './access'

describe('platform admin access', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAwsUser.mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      cognitoSub: 'sub-1',
      email: 'member@example.com',
    })
  })

  it('exposes admin chrome only for an administrator role', async () => {
    mocks.isPlatformAdministrator.mockResolvedValueOnce(true)
    await expect(canAccessPlatformAdmin('11111111-1111-4111-8111-111111111111')).resolves.toBe(true)

    mocks.isPlatformAdministrator.mockResolvedValueOnce(false)
    await expect(canAccessPlatformAdmin('11111111-1111-4111-8111-111111111111')).resolves.toBe(false)
  })

  it('fails closed when admin role lookup fails for normal app chrome', async () => {
    mocks.isPlatformAdministrator.mockRejectedValueOnce(new Error('database_unavailable'))
    await expect(canAccessPlatformAdmin('11111111-1111-4111-8111-111111111111')).resolves.toBe(false)
  })

  it('requires both authentication and administrator role for protected admin surfaces', async () => {
    mocks.isPlatformAdministrator.mockResolvedValueOnce(true)
    await expect(requirePlatformAdministratorUser()).resolves.toMatchObject({
      id: '11111111-1111-4111-8111-111111111111',
    })

    mocks.isPlatformAdministrator.mockResolvedValueOnce(false)
    await expect(requirePlatformAdministratorUser()).rejects.toThrow('admin_forbidden')
  })
})
