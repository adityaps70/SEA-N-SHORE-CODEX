import { describe, expect, it, vi } from 'vitest'

type IdentityRow = { profile_id: string }

describe('Cognito identity repository', () => {
  it('resolves exactly one Cognito subject to the permanent profile UUID', async () => {
    const query = vi.fn(async () => [{ profile_id: '11111111-1111-4111-8111-111111111111' }])
    const { createIdentityRepository } = await import('./identity-repository')
    const repository = createIdentityRepository({ query })

    await expect(repository.resolveProfileIdForCognitoSub('cognito-sub-1')).resolves.toBe(
      '11111111-1111-4111-8111-111111111111',
    )

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('identity_accounts'),
      ['cognito', 'cognito-sub-1'],
    )
  })

  it('returns null when no Cognito identity mapping exists', async () => {
    const query = vi.fn(async (): Promise<IdentityRow[]> => [])
    const { createIdentityRepository } = await import('./identity-repository')
    const repository = createIdentityRepository({ query })

    await expect(repository.resolveProfileIdForCognitoSub('missing-sub')).resolves.toBeNull()
  })

  it('fails closed when more than one mapping is returned', async () => {
    const query = vi.fn(async () => [
      { profile_id: '11111111-1111-4111-8111-111111111111' },
      { profile_id: '22222222-2222-4222-8222-222222222222' },
    ])
    const { createIdentityRepository, IdentityMappingError } = await import('./identity-repository')
    const repository = createIdentityRepository({ query })

    await expect(repository.resolveProfileIdForCognitoSub('duplicate-sub')).rejects.toBeInstanceOf(
      IdentityMappingError,
    )
  })
})
