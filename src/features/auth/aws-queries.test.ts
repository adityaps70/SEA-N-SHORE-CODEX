import type { CognitoPrincipal } from '@/lib/auth/cognito-api'
import { describe, expect, it, vi } from 'vitest'

const principal: CognitoPrincipal = {
  sub: 'cognito-sub-1',
  email: 'member@example.com',
  emailVerified: true,
}

describe('AWS auth queries', () => {
  it('returns null when no verified Cognito principal exists', async () => {
    const getPrincipal = vi.fn(async () => null)
    const resolveProfileId = vi.fn(async () => '11111111-1111-4111-8111-111111111111')
    const { createAwsAuthQueries } = await import('./aws-queries')
    const queries = createAwsAuthQueries({ getPrincipal, resolveProfileId })

    await expect(queries.getAwsVerifiedUser()).resolves.toBeNull()
    expect(resolveProfileId).not.toHaveBeenCalled()
  })

  it('returns null when the verified Cognito subject has no permanent profile mapping', async () => {
    const getPrincipal = vi.fn(async () => principal)
    const resolveProfileId = vi.fn(async () => null)
    const { createAwsAuthQueries } = await import('./aws-queries')
    const queries = createAwsAuthQueries({ getPrincipal, resolveProfileId })

    await expect(queries.getAwsVerifiedUser()).resolves.toBeNull()
    expect(resolveProfileId).toHaveBeenCalledWith('cognito-sub-1')
  })

  it('returns the permanent profile UUID with Cognito identity metadata', async () => {
    const getPrincipal = vi.fn(async () => principal)
    const resolveProfileId = vi.fn(async () => '11111111-1111-4111-8111-111111111111')
    const { createAwsAuthQueries } = await import('./aws-queries')
    const queries = createAwsAuthQueries({ getPrincipal, resolveProfileId })

    await expect(queries.getAwsVerifiedUser()).resolves.toEqual({
      id: '11111111-1111-4111-8111-111111111111',
      cognitoSub: 'cognito-sub-1',
      email: 'member@example.com',
    })
  })

  it('fails safely when an authenticated AWS user is required but unavailable', async () => {
    const getPrincipal = vi.fn(async () => null)
    const resolveProfileId = vi.fn(async () => null)
    const { AwsAuthenticationRequiredError, createAwsAuthQueries } = await import('./aws-queries')
    const queries = createAwsAuthQueries({ getPrincipal, resolveProfileId })

    await expect(queries.requireAwsUser()).rejects.toBeInstanceOf(AwsAuthenticationRequiredError)
  })
})
