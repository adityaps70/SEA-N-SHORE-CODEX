import type { CognitoPrincipal } from '@/lib/auth/cognito-api'
import type { DatabaseQueryClient } from '@/lib/db/client'
import { describe, expect, it, vi } from 'vitest'

type IdentityRow = { profile_id: string }

const principal: CognitoPrincipal = {
  sub: 'cognito-sub-1',
  email: 'Member@Example.com',
  emailVerified: true,
  name: 'Member One',
}

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

  it('provisions one incomplete profile and Cognito mapping inside one locked transaction', async () => {
    const profileId = '33333333-3333-4333-8333-333333333333'
    const transactionQuery = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ profile_id: profileId }] })
      .mockResolvedValueOnce({ rows: [] })
    const client = { query: transactionQuery } as unknown as DatabaseQueryClient
    const withTransaction = vi.fn(async <T>(fn: (value: DatabaseQueryClient) => Promise<T>) => fn(client))
    const { createIdentityRepository } = await import('./identity-repository')
    const repository = createIdentityRepository({ withTransaction })

    await expect(repository.provisionProfileForCognitoPrincipal(principal)).resolves.toBe(profileId)

    expect(withTransaction).toHaveBeenCalledTimes(1)
    expect(transactionQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('pg_advisory_xact_lock'),
      ['cognito:cognito-sub-1'],
    )
    expect(transactionQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('identity_accounts'),
      ['cognito', 'cognito-sub-1'],
    )
    expect(transactionQuery).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('insert into public.profiles'),
      ['Member One'],
    )
    expect(transactionQuery).toHaveBeenNthCalledWith(
      4,
      expect.stringContaining('insert into public.identity_accounts'),
      [profileId, 'cognito', 'cognito-sub-1', 'member@example.com'],
    )
  })

  it('returns the mapping found after the transaction lock without inserting a duplicate profile', async () => {
    const profileId = '44444444-4444-4444-8444-444444444444'
    const transactionQuery = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ profile_id: profileId }] })
    const client = { query: transactionQuery } as unknown as DatabaseQueryClient
    const withTransaction = vi.fn(async <T>(fn: (value: DatabaseQueryClient) => Promise<T>) => fn(client))
    const { createIdentityRepository } = await import('./identity-repository')
    const repository = createIdentityRepository({ withTransaction })

    await expect(repository.provisionProfileForCognitoPrincipal(principal)).resolves.toBe(profileId)
    expect(transactionQuery).toHaveBeenCalledTimes(2)
    expect(transactionQuery.mock.calls.some(([sql]) => String(sql).includes('insert into public.profiles'))).toBe(false)
  })
})
