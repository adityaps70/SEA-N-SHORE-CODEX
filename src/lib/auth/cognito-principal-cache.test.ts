import { describe, expect, it, vi } from 'vitest'
import { CognitoApiError, type CognitoPrincipal } from './cognito-api'

const principal: CognitoPrincipal = {
  sub: 'cognito-sub-cache',
  email: 'cached@example.com',
  emailVerified: true,
  name: 'Cached Member',
}

function jwtWithExp(expSeconds: number) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({ exp: expSeconds })).toString('base64url')
  return `${header}.${payload}.signature`
}

describe('Cognito verified-principal cache', () => {
  it('reuses a previously Cognito-verified access token during a short authenticated burst', async () => {
    let now = Date.parse('2026-09-21T13:00:00.000Z')
    const getUser = vi.fn(async () => principal)
    const { createCognitoPrincipalResolver } = await import('./cognito-principal-cache')
    const resolve = createCognitoPrincipalResolver({
      getUser,
      now: () => now,
      cacheTtlMs: 5 * 60 * 1000,
    })
    const token = jwtWithExp(Math.floor((now + 60 * 60 * 1000) / 1000))

    await expect(resolve(token)).resolves.toEqual(principal)
    now += 90_000
    await expect(resolve(token)).resolves.toEqual(principal)

    expect(getUser).toHaveBeenCalledTimes(1)
    expect(getUser).toHaveBeenCalledWith(token)
  })

  it('coalesces concurrent verification of the same access token', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const getUser = vi.fn(async () => {
      await gate
      return principal
    })
    const { createCognitoPrincipalResolver } = await import('./cognito-principal-cache')
    const resolve = createCognitoPrincipalResolver({ getUser })
    const token = jwtWithExp(Math.floor(Date.now() / 1000) + 3600)

    const first = resolve(token)
    const second = resolve(token)
    release()

    await expect(Promise.all([first, second])).resolves.toEqual([principal, principal])
    expect(getUser).toHaveBeenCalledTimes(1)
  })

  it('never caches authorization failures or transient Cognito failures as a valid principal', async () => {
    const { createCognitoPrincipalResolver } = await import('./cognito-principal-cache')
    const unauthorized = vi.fn(async () => {
      throw new CognitoApiError('NotAuthorizedException')
    })
    const unauthorizedResolve = createCognitoPrincipalResolver({ getUser: unauthorized })

    await expect(unauthorizedResolve('bad-token')).resolves.toBeNull()
    await expect(unauthorizedResolve('bad-token')).resolves.toBeNull()
    expect(unauthorized).toHaveBeenCalledTimes(2)

    const throttledError = new CognitoApiError('TooManyRequestsException')
    const throttled = vi.fn(async () => {
      throw throttledError
    })
    const throttledResolve = createCognitoPrincipalResolver({ getUser: throttled })

    await expect(throttledResolve('throttled-token')).rejects.toBe(throttledError)
    await expect(throttledResolve('throttled-token')).rejects.toBe(throttledError)
    expect(throttled).toHaveBeenCalledTimes(2)
  })

  it('caps cached verification at the access token expiry', async () => {
    let now = Date.parse('2026-09-21T13:00:00.000Z')
    const getUser = vi.fn(async () => principal)
    const { createCognitoPrincipalResolver } = await import('./cognito-principal-cache')
    const resolve = createCognitoPrincipalResolver({
      getUser,
      now: () => now,
      cacheTtlMs: 5 * 60 * 1000,
    })
    const token = jwtWithExp(Math.floor((now + 70_000) / 1000))

    await resolve(token)
    now += 66_000
    await resolve(token)

    expect(getUser).toHaveBeenCalledTimes(2)
  })
})
