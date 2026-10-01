import type { CognitoPrincipal } from '@/lib/auth/cognito-api'
import type { DatabaseQueryClient } from '@/lib/db/client'
import { describe, expect, it, vi } from 'vitest'

type IdentityRow = {
  profile_id: string
  account_status?: 'active' | 'restricted' | 'suspended' | 'deletion_requested'
  onboarding_completed_at?: string | null
}

const principal: CognitoPrincipal = {
  sub: 'cognito-sub-1',
  username: 'member@example.com',
  email: 'Member@Example.com',
  emailVerified: true,
  phoneNumber: null,
  phoneNumberVerified: false,
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

  it('loads the current profile account status used by the auth gate', async () => {
    const query = vi.fn(async (): Promise<IdentityRow[]> => [{ profile_id: '11111111-1111-4111-8111-111111111111', account_status: 'suspended' }])
    const { createIdentityRepository } = await import('./identity-repository')
    const repository = createIdentityRepository({ query })

    await expect(repository.getProfileAccountStatus('11111111-1111-4111-8111-111111111111')).resolves.toBe('suspended')
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('account_status'),
      ['11111111-1111-4111-8111-111111111111'],
    )
  })

  it('provisions one incomplete profile and Cognito mapping inside one locked transaction', async () => {
    const profileId = '33333333-3333-4333-8333-333333333333'
    const transactionQuery = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ profile_id: profileId }] })
      .mockResolvedValueOnce({ rows: [] })
    const client = { query: transactionQuery } as unknown as DatabaseQueryClient
    let transactionCalls = 0
    const withTransaction = async <T>(fn: (value: DatabaseQueryClient) => Promise<T>): Promise<T> => {
      transactionCalls += 1
      return fn(client)
    }
    const { createIdentityRepository } = await import('./identity-repository')
    const repository = createIdentityRepository({ withTransaction })

    await expect(repository.provisionProfileForCognitoPrincipal(principal)).resolves.toBe(profileId)

    expect(transactionCalls).toBe(1)
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
      expect.stringContaining('pg_advisory_xact_lock'),
      ['verified-login:member@example.com:'],
    )
    expect(transactionQuery).toHaveBeenNthCalledWith(
      4,
      expect.stringContaining('email_verified = true'),
      ['member@example.com'],
    )
    expect(transactionQuery).toHaveBeenNthCalledWith(
      6,
      expect.stringContaining('insert into public.profiles'),
      ['Member One'],
    )
    expect(transactionQuery).toHaveBeenNthCalledWith(
      7,
      expect.stringContaining('insert into public.identity_accounts'),
      [profileId, 'cognito', 'cognito-sub-1', 'member@example.com', 'member@example.com', true, null, false],
    )
  })

  it('links a new Cognito subject to the existing profile when a verified email matches exactly one profile', async () => {
    const profileId = '55555555-5555-4555-8555-555555555555'
    const transactionQuery = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ profile_id: profileId }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
    const client = { query: transactionQuery } as unknown as DatabaseQueryClient
    const withTransaction = async <T>(fn: (value: DatabaseQueryClient) => Promise<T>): Promise<T> => fn(client)
    const { createIdentityRepository } = await import('./identity-repository')
    const repository = createIdentityRepository({ withTransaction })

    await expect(repository.provisionProfileForCognitoPrincipal({
      ...principal,
      sub: 'google-federated-sub',
      username: 'Google_123',
      phoneNumber: null,
      phoneNumberVerified: false,
    })).resolves.toBe(profileId)

    expect(transactionQuery.mock.calls.some(([sql]) => String(sql).includes('insert into public.profiles'))).toBe(false)
    expect(transactionQuery.mock.calls.some(([sql, values]) =>
      String(sql).includes('insert into public.identity_accounts')
      && Array.isArray(values)
      && values[0] === profileId
      && values[2] === 'google-federated-sub')).toBe(true)
  })


  it('reconnects an existing Google duplicate from incomplete onboarding to the completed profile with the same verified email', async () => {
    const duplicateProfileId = '88888888-8888-4888-8888-888888888888'
    const existingProfileId = '99999999-9999-4999-8999-999999999999'
    const transactionQuery = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ profile_id: duplicateProfileId, onboarding_completed_at: null }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ profile_id: existingProfileId }] })
      .mockResolvedValueOnce({ rows: [{ profile_id: existingProfileId, onboarding_completed_at: '2026-09-01T00:00:00.000Z' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
    const client = { query: transactionQuery } as unknown as DatabaseQueryClient
    const withTransaction = async <T>(fn: (value: DatabaseQueryClient) => Promise<T>): Promise<T> => fn(client)
    const { createIdentityRepository } = await import('./identity-repository')
    const repository = createIdentityRepository({ withTransaction })

    await expect(repository.provisionProfileForCognitoPrincipal({
      ...principal,
      sub: 'google-existing-duplicate-sub',
      username: 'Google_456',
      emailVerified: true,
    })).resolves.toBe(existingProfileId)

    expect(transactionQuery.mock.calls.some(([sql, values]) =>
      String(sql).includes('update public.identity_accounts')
      && String(sql).includes('set profile_id')
      && Array.isArray(values)
      && values[1] === 'google-existing-duplicate-sub'
      && values[2] === existingProfileId
      && values[3] === duplicateProfileId)).toBe(true)
    expect(transactionQuery.mock.calls.some(([sql]) => String(sql).includes('insert into public.profiles'))).toBe(false)
  })

  it('claims a restricted imported profile when a verified email matches the legacy claim bridge', async () => {
    const legacyProfileId = '57575757-5757-4575-8575-575757575757'
    const transactionQuery = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ profile_id: legacyProfileId }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
    const client = { query: transactionQuery } as unknown as DatabaseQueryClient
    const withTransaction = async <T>(fn: (value: DatabaseQueryClient) => Promise<T>): Promise<T> => fn(client)
    const { createIdentityRepository } = await import('./identity-repository')
    const repository = createIdentityRepository({ withTransaction })

    await expect(repository.provisionProfileForCognitoPrincipal({
      ...principal,
      sub: 'legacy-claim-sub',
      emailVerified: true,
    })).resolves.toBe(legacyProfileId)

    expect(transactionQuery.mock.calls.some(([sql, values]) =>
      String(sql).includes('legacy_profile_claims')
      && String(sql).includes('claimed_at is null')
      && Array.isArray(values)
      && values[0] === 'member@example.com')).toBe(true)
    expect(transactionQuery.mock.calls.some(([sql, values]) =>
      String(sql).includes('insert into public.identity_accounts')
      && Array.isArray(values)
      && values[0] === legacyProfileId
      && values[2] === 'legacy-claim-sub')).toBe(true)
    expect(transactionQuery.mock.calls.some(([sql, values]) =>
      String(sql).includes('update public.legacy_profile_claims')
      && Array.isArray(values)
      && values[0] === legacyProfileId)).toBe(true)
    expect(transactionQuery.mock.calls.some(([sql, values]) =>
      String(sql).includes("account_status = 'active'")
      && Array.isArray(values)
      && values[0] === legacyProfileId)).toBe(true)
    expect(transactionQuery.mock.calls.some(([sql]) => String(sql).includes('insert into public.profiles'))).toBe(false)
  })

  it('links a verified phone login to the existing profile without creating another profile', async () => {
    const profileId = '56565656-5656-4565-8565-565656565656'
    const transactionQuery = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ profile_id: profileId }] })
      .mockResolvedValueOnce({ rows: [] })
    const client = { query: transactionQuery } as unknown as DatabaseQueryClient
    const withTransaction = async <T>(fn: (value: DatabaseQueryClient) => Promise<T>): Promise<T> => fn(client)
    const { createIdentityRepository } = await import('./identity-repository')
    const repository = createIdentityRepository({ withTransaction })

    await expect(repository.provisionProfileForCognitoPrincipal({
      ...principal,
      sub: 'phone-login-sub',
      username: 'phone-login@auth.seaandshore.in',
      email: null,
      emailVerified: false,
      phoneNumber: '+919876543210',
      phoneNumberVerified: true,
    })).resolves.toBe(profileId)

    expect(transactionQuery.mock.calls.some(([sql]) => String(sql).includes('insert into public.profiles'))).toBe(false)
    expect(transactionQuery.mock.calls.some(([sql, values]) =>
      String(sql).includes('insert into public.identity_accounts')
      && Array.isArray(values)
      && values[0] === profileId
      && values[2] === 'phone-login-sub')).toBe(true)
  })

  it('fails closed instead of merging when verified email and phone point at different profiles', async () => {
    const transactionQuery = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ profile_id: '66666666-6666-4666-8666-666666666666' }] })
      .mockResolvedValueOnce({ rows: [{ profile_id: '77777777-7777-4777-8777-777777777777' }] })
    const client = { query: transactionQuery } as unknown as DatabaseQueryClient
    const withTransaction = async <T>(fn: (value: DatabaseQueryClient) => Promise<T>): Promise<T> => fn(client)
    const { createIdentityRepository, IdentityMappingError } = await import('./identity-repository')
    const repository = createIdentityRepository({ withTransaction })

    await expect(repository.provisionProfileForCognitoPrincipal({
      ...principal,
      phoneNumber: '+919876543210',
      phoneNumberVerified: true,
    })).rejects.toBeInstanceOf(IdentityMappingError)
    expect(transactionQuery.mock.calls.some(([sql]) => String(sql).includes('insert into public.profiles'))).toBe(false)
    expect(transactionQuery.mock.calls.some(([sql]) => String(sql).includes('insert into public.identity_accounts'))).toBe(false)
  })

  it('returns the mapping found after the transaction lock without inserting a duplicate profile', async () => {
    const profileId = '44444444-4444-4444-8444-444444444444'
    const transactionQuery = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ profile_id: profileId, onboarding_completed_at: '2026-09-01T00:00:00.000Z' }] })
      .mockResolvedValueOnce({ rows: [] })
    const client = { query: transactionQuery } as unknown as DatabaseQueryClient
    const withTransaction = async <T>(fn: (value: DatabaseQueryClient) => Promise<T>): Promise<T> => fn(client)
    const { createIdentityRepository } = await import('./identity-repository')
    const repository = createIdentityRepository({ withTransaction })

    await expect(repository.provisionProfileForCognitoPrincipal(principal)).resolves.toBe(profileId)
    expect(transactionQuery).toHaveBeenCalledTimes(3)
    expect(transactionQuery.mock.calls.some(([sql]) => String(sql).includes('insert into public.profiles'))).toBe(false)
  })
})
