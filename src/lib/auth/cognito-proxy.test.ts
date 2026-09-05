import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createCognitoProxyHandler } from './cognito-proxy'

function request(path: string) {
  return new NextRequest(`https://staging.seaandshore.in${path}`)
}

describe('Cognito protected route proxy', () => {
  it('leaves public and auth routes reachable without a session', async () => {
    const getVerifiedPrincipal = vi.fn(async () => null)
    const refreshSession = vi.fn(async () => false)
    const handler = createCognitoProxyHandler({ getVerifiedPrincipal, refreshSession })

    const marketing = await handler(request('/'))
    const signIn = await handler(request('/auth/sign-in'))
    const publicProfile = await handler(request('/people/captain-rhea'))

    expect(marketing.status).toBe(200)
    expect(signIn.status).toBe(200)
    expect(publicProfile.status).toBe(200)
    expect(getVerifiedPrincipal).not.toHaveBeenCalled()
    expect(refreshSession).not.toHaveBeenCalled()
  })

  it('allows protected routes with a verified Cognito principal', async () => {
    const getVerifiedPrincipal = vi.fn(async () => ({ sub: 'cognito-sub' }))
    const refreshSession = vi.fn(async () => false)
    const handler = createCognitoProxyHandler({ getVerifiedPrincipal, refreshSession })

    const response = await handler(request('/home'))

    expect(response.status).toBe(200)
    expect(getVerifiedPrincipal).toHaveBeenCalledTimes(1)
    expect(refreshSession).not.toHaveBeenCalled()
  })

  it('refreshes an expired Cognito access session before allowing a protected route', async () => {
    const getVerifiedPrincipal = vi.fn(async () => null)
    const refreshSession = vi.fn(async () => true)
    const handler = createCognitoProxyHandler({ getVerifiedPrincipal, refreshSession })

    const response = await handler(request('/network'))

    expect(response.status).toBe(200)
    expect(refreshSession).toHaveBeenCalledTimes(1)
  })

  it('redirects an unauthenticated protected request to sign in without blocking public auth pages', async () => {
    const handler = createCognitoProxyHandler({
      getVerifiedPrincipal: vi.fn(async () => null),
      refreshSession: vi.fn(async () => false),
    })

    const response = await handler(request('/notifications'))

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('https://staging.seaandshore.in/auth/sign-in')
  })

  it.each(['/home', '/profile', '/network', '/notifications', '/posts/abc', '/onboarding'])('%s is protected', async (path) => {
    const getVerifiedPrincipal = vi.fn(async () => null)
    const handler = createCognitoProxyHandler({
      getVerifiedPrincipal,
      refreshSession: vi.fn(async () => false),
    })

    await handler(request(path))
    expect(getVerifiedPrincipal).toHaveBeenCalledTimes(1)
  })
})
