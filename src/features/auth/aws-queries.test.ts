import type { CognitoPrincipal } from '@/lib/auth/cognito-api'
import { describe, expect, it, vi } from 'vitest'

const principal: CognitoPrincipal = {
  sub: 'cognito-sub-1',
  email: 'member@example.com',
  emailVerified: true,
  name: 'Member One',
}

describe('AWS auth queries', () => {
  it('returns null when no verified Cognito principal exists', async () => {
    const getPrincipal = vi.fn(async () => null)
    const resolveProfileId = vi.fn(async () => '11111111-1111-4111-8111-111111111111')
    const provisionProfileId = vi.fn(async () => '22222222-2222-4222-8222-222222222222')
    const { createAwsAuthQueries } = await import('./aws-queries')
    const queries = createAwsAuthQueries({ getPrincipal, resolveProfileId, provisionProfileId })

    await expect(queries.getAwsVerifiedUser()).resolves.toBeNull()
    expect(resolveProfileId).not.toHaveBeenCalled()
    expect(provisionProfileId).not.toHaveBeenCalled()
  })

  it('provisions one incomplete profile when the verified Cognito subject has no permanent mapping', async () => {
    const getPrincipal = vi.fn(async () => principal)
    const resolveProfileId = vi.fn(async () => null)
    const provisionProfileId = vi.fn(async () => '22222222-2222-4222-8222-222222222222')
    const { createAwsAuthQueries } = await import('./aws-queries')
    const queries = createAwsAuthQueries({ getPrincipal, resolveProfileId, provisionProfileId })

    await expect(queries.getAwsVerifiedUser()).resolves.toEqual({
      id: '22222222-2222-4222-8222-222222222222',
      cognitoSub: 'cognito-sub-1',
      email: 'member@example.com',
    })
    expect(resolveProfileId).toHaveBeenCalledWith('cognito-sub-1')
    expect(provisionProfileId).toHaveBeenCalledWith(principal)
  })

  it('does not provision when the permanent profile mapping already exists', async () => {
    const getPrincipal = vi.fn(async () => principal)
    const resolveProfileId = vi.fn(async () => '11111111-1111-4111-8111-111111111111')
    const provisionProfileId = vi.fn(async () => '22222222-2222-4222-8222-222222222222')
    const { createAwsAuthQueries } = await import('./aws-queries')
    const queries = createAwsAuthQueries({ getPrincipal, resolveProfileId, provisionProfileId })

    await expect(queries.getAwsVerifiedUser()).resolves.toEqual({
      id: '11111111-1111-4111-8111-111111111111',
      cognitoSub: 'cognito-sub-1',
      email: 'member@example.com',
    })
    expect(provisionProfileId).not.toHaveBeenCalled()
  })

  it('reuses one verified-user lookup across repeated authenticated reads in a request', async () => {
    const getPrincipal = vi.fn(async () => principal)
    const resolveProfileId = vi.fn(async () => '11111111-1111-4111-8111-111111111111')
    const provisionProfileId = vi.fn(async () => '22222222-2222-4222-8222-222222222222')
    let cached: Promise<unknown> | null = null
    const cacheVerifiedUser = <T>(loader: () => Promise<T>) => () => {
      cached ??= loader()
      return cached as Promise<T>
    }
    const { createAwsAuthQueries } = await import('./aws-queries')
    const queries = createAwsAuthQueries({ getPrincipal, resolveProfileId, provisionProfileId, cacheVerifiedUser })

    await Promise.all([
      queries.requireAwsUser(),
      queries.requireAwsUser(),
      queries.getAwsVerifiedUser(),
      queries.requireAwsUser(),
    ])

    expect(getPrincipal).toHaveBeenCalledTimes(1)
    expect(resolveProfileId).toHaveBeenCalledTimes(1)
    expect(provisionProfileId).not.toHaveBeenCalled()
  })

  it('fails safely when an authenticated AWS user is required but unavailable', async () => {
    const getPrincipal = vi.fn(async () => null)
    const resolveProfileId = vi.fn(async () => null)
    const provisionProfileId = vi.fn(async () => '22222222-2222-4222-8222-222222222222')
    const { AwsAuthenticationRequiredError, createAwsAuthQueries } = await import('./aws-queries')
    const queries = createAwsAuthQueries({ getPrincipal, resolveProfileId, provisionProfileId })

    await expect(queries.requireAwsUser()).rejects.toBeInstanceOf(AwsAuthenticationRequiredError)
  })
})
