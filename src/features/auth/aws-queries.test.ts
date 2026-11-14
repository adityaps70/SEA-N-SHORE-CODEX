import { CognitoApiError, type CognitoPrincipal } from '@/lib/auth/cognito-api'
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
    const getProfileAccountStatus = vi.fn(async () => 'active' as const)
    const { createAwsAuthQueries } = await import('./aws-queries')
    const queries = createAwsAuthQueries({ getPrincipal, resolveProfileId, provisionProfileId, getProfileAccountStatus })

    await expect(queries.getAwsVerifiedUser()).resolves.toBeNull()
    expect(resolveProfileId).not.toHaveBeenCalled()
    expect(provisionProfileId).not.toHaveBeenCalled()
  })

  it('provisions one incomplete profile when the verified Cognito subject has no permanent mapping', async () => {
    const getPrincipal = vi.fn(async () => principal)
    const resolveProfileId = vi.fn(async () => null)
    const provisionProfileId = vi.fn(async () => '22222222-2222-4222-8222-222222222222')
    const getProfileAccountStatus = vi.fn(async () => 'active' as const)
    const { createAwsAuthQueries } = await import('./aws-queries')
    const queries = createAwsAuthQueries({ getPrincipal, resolveProfileId, provisionProfileId, getProfileAccountStatus })

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
    const getProfileAccountStatus = vi.fn(async () => 'active' as const)
    const { createAwsAuthQueries } = await import('./aws-queries')
    const queries = createAwsAuthQueries({ getPrincipal, resolveProfileId, provisionProfileId, getProfileAccountStatus })

    await expect(queries.getAwsVerifiedUser()).resolves.toEqual({
      id: '11111111-1111-4111-8111-111111111111',
      cognitoSub: 'cognito-sub-1',
      email: 'member@example.com',
    })
    expect(provisionProfileId).not.toHaveBeenCalled()
  })

  describe('one-query sign-in check (Round DB)', () => {
    const PROFILE_ID = '11111111-1111-4111-8111-111111111111'

    it('uses the joined lookup and skips the separate mapping and status queries', async () => {
      const resolveProfileWithStatus = vi.fn(async () => ({ profileId: PROFILE_ID, accountStatus: 'active' as const }))
      const resolveProfileId = vi.fn(async () => PROFILE_ID)
      const provisionProfileId = vi.fn(async () => '22222222-2222-4222-8222-222222222222')
      const getProfileAccountStatus = vi.fn(async () => 'active' as const)
      const { createAwsAuthQueries } = await import('./aws-queries')
      const queries = createAwsAuthQueries({
        getPrincipal: vi.fn(async () => principal),
        resolveProfileId,
        provisionProfileId,
        getProfileAccountStatus,
        resolveProfileWithStatus,
      })

      await expect(queries.getAwsVerifiedUser()).resolves.toEqual({
        id: PROFILE_ID,
        cognitoSub: 'cognito-sub-1',
        email: 'member@example.com',
      })
      expect(resolveProfileWithStatus).toHaveBeenCalledWith('cognito-sub-1')
      expect(resolveProfileId).not.toHaveBeenCalled()
      expect(getProfileAccountStatus).not.toHaveBeenCalled()
      expect(provisionProfileId).not.toHaveBeenCalled()
    })

    it('still refuses suspended, deletion-requested and missing-status profiles', async () => {
      const { createAwsAuthQueries } = await import('./aws-queries')
      for (const accountStatus of ['suspended', 'deletion_requested', null] as const) {
        const queries = createAwsAuthQueries({
          getPrincipal: vi.fn(async () => principal),
          resolveProfileId: vi.fn(async () => PROFILE_ID),
          provisionProfileId: vi.fn(async () => PROFILE_ID),
          getProfileAccountStatus: vi.fn(async () => 'active' as const),
          resolveProfileWithStatus: vi.fn(async () => ({ profileId: PROFILE_ID, accountStatus })),
        })
        await expect(queries.getAwsVerifiedUser()).resolves.toBeNull()
      }
    })

    it('provisions and reads the status as before when there is no mapping yet', async () => {
      const resolveProfileId = vi.fn(async () => null)
      const provisionProfileId = vi.fn(async () => '22222222-2222-4222-8222-222222222222')
      const getProfileAccountStatus = vi.fn(async () => 'active' as const)
      const { createAwsAuthQueries } = await import('./aws-queries')
      const queries = createAwsAuthQueries({
        getPrincipal: vi.fn(async () => principal),
        resolveProfileId,
        provisionProfileId,
        getProfileAccountStatus,
        resolveProfileWithStatus: vi.fn(async () => null),
      })

      await expect(queries.getAwsVerifiedUser()).resolves.toEqual({
        id: '22222222-2222-4222-8222-222222222222',
        cognitoSub: 'cognito-sub-1',
        email: 'member@example.com',
      })
      expect(provisionProfileId).toHaveBeenCalledWith(principal)
      expect(getProfileAccountStatus).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222')
      expect(resolveProfileId).not.toHaveBeenCalled()
    })
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
    const getProfileAccountStatus = vi.fn(async () => 'active' as const)
    const { createAwsAuthQueries } = await import('./aws-queries')
    const queries = createAwsAuthQueries({ getPrincipal, resolveProfileId, provisionProfileId, getProfileAccountStatus, cacheVerifiedUser })

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

  it('resolves the member once per Server Action call inside actionScope, and again in the next call (Round CAP)', async () => {
    const getPrincipal = vi.fn(async () => principal)
    const resolveProfileId = vi.fn(async () => '11111111-1111-4111-8111-111111111111')
    const provisionProfileId = vi.fn(async () => '22222222-2222-4222-8222-222222222222')
    const getProfileAccountStatus = vi.fn(async () => 'active' as const)
    const { createAwsAuthQueries, actionAwareVerificationCache } = await import('./aws-queries')
    const { actionScope } = await import('@/lib/server/action-scope')
    const queries = createAwsAuthQueries({ getPrincipal, resolveProfileId, provisionProfileId, getProfileAccountStatus, cacheVerifiedUser: actionAwareVerificationCache })

    // One action whose helpers each ask for the member (as loadFeedPage and addComment did twice, share four times).
    await actionScope(async () => {
      await queries.requireAwsUser()
      await queries.getAwsVerifiedUser()
      await Promise.all([queries.requireAwsUser(), queries.requireAwsUser()])
    })
    expect(getPrincipal).toHaveBeenCalledTimes(1)
    expect(resolveProfileId).toHaveBeenCalledTimes(1)
    // A second action call resolves afresh: nothing is kept between calls.
    await actionScope(async () => { await queries.requireAwsUser() })
    expect(getPrincipal).toHaveBeenCalledTimes(2)
  })

  it('rejects suspended and deleted profiles even when their Cognito access token is still valid', async () => {
    const getPrincipal = vi.fn(async () => principal)
    const resolveProfileId = vi.fn(async () => '11111111-1111-4111-8111-111111111111')
    const provisionProfileId = vi.fn(async () => '22222222-2222-4222-8222-222222222222')
    const { createAwsAuthQueries } = await import('./aws-queries')

    for (const status of ['suspended', 'deletion_requested'] as const) {
      const queries = createAwsAuthQueries({
        getPrincipal,
        resolveProfileId,
        provisionProfileId,
        getProfileAccountStatus: vi.fn(async () => status),
      })

      await expect(queries.getAwsVerifiedUser()).resolves.toBeNull()
      await expect(queries.requireAwsUser()).rejects.toThrow('Authentication required.')
    }
  })

  it('refuses a device whose session was signed out (Round H, H3), and accepts untracked and active sessions', async () => {
    const { createAwsAuthQueries } = await import('./aws-queries')
    const base = {
      getPrincipal: vi.fn(async () => principal),
      resolveProfileId: vi.fn(async () => '11111111-1111-4111-8111-111111111111'),
      provisionProfileId: vi.fn(async () => '22222222-2222-4222-8222-222222222222'),
      getProfileAccountStatus: vi.fn(async () => 'active' as const),
    }

    const revoked = createAwsAuthQueries({ ...base, checkSession: vi.fn(async () => ({ status: 'revoked' as const })) })
    await expect(revoked.getAwsVerifiedUser()).resolves.toBeNull()
    await expect(revoked.getAwsVerification()).resolves.toEqual({ user: null, sessionRevoked: true, sessionEndReason: 'signed_out' })
    await expect(revoked.requireAwsUser()).rejects.toThrow('Authentication required.')

    for (const status of ['active', 'untracked'] as const) {
      const checkSession = vi.fn(async () => ({ status }))
      const queries = createAwsAuthQueries({ ...base, checkSession })
      await expect(queries.getAwsVerifiedUser()).resolves.toMatchObject({ id: '11111111-1111-4111-8111-111111111111' })
      expect(checkSession).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111')
    }

    const signedOut = createAwsAuthQueries({ ...base, getPrincipal: vi.fn(async () => null), checkSession: vi.fn() })
    await expect(signedOut.getAwsVerification()).resolves.toEqual({ user: null, sessionRevoked: false })
  })

  it('treats only a real Cognito authorization failure as an unauthenticated principal', async () => {
    const { resolveCognitoPrincipalFromAccessToken } = await import('./aws-queries')
    const api = {
      getUser: vi.fn(async () => {
        throw new CognitoApiError('NotAuthorizedException')
      }),
    }

    await expect(resolveCognitoPrincipalFromAccessToken(api, 'expired-access-token')).resolves.toBeNull()
  })

  it('does not turn transient Cognito failures into a logout', async () => {
    const { resolveCognitoPrincipalFromAccessToken } = await import('./aws-queries')
    const throttled = new CognitoApiError('TooManyRequestsException')
    const transport = new CognitoApiError('TransportError')

    await expect(resolveCognitoPrincipalFromAccessToken({
      getUser: vi.fn(async () => { throw throttled }),
    }, 'valid-access-token')).rejects.toBe(throttled)

    await expect(resolveCognitoPrincipalFromAccessToken({
      getUser: vi.fn(async () => { throw transport }),
    }, 'valid-access-token')).rejects.toBe(transport)
  })

  it('fails safely when an authenticated AWS user is required but unavailable', async () => {
    const getPrincipal = vi.fn(async () => null)
    const resolveProfileId = vi.fn(async () => null)
    const provisionProfileId = vi.fn(async () => '22222222-2222-4222-8222-222222222222')
    const getProfileAccountStatus = vi.fn(async () => 'active' as const)
    const { AwsAuthenticationRequiredError, createAwsAuthQueries } = await import('./aws-queries')
    const queries = createAwsAuthQueries({ getPrincipal, resolveProfileId, provisionProfileId, getProfileAccountStatus })

    await expect(queries.requireAwsUser()).rejects.toBeInstanceOf(AwsAuthenticationRequiredError)
  })
})
