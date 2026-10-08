import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ exchangeCode: vi.fn() }))

vi.mock('@/lib/env', () => ({
  getCognitoEnvironment: () => ({
    AWS_COGNITO_GOOGLE_ENABLED: true,
    AWS_COGNITO_DOMAIN: 'auth.example.test',
    AWS_COGNITO_CLIENT_ID: 'client',
    AWS_COGNITO_ALLOW_INSECURE_HTTP_COOKIES: false,
  }),
  publicEnvironment: { NEXT_PUBLIC_SITE_URL: 'https://seanshore.example' },
}))
vi.mock('@/lib/site-url', () => ({ siteUrlFor: (path: string) => new URL(path, 'https://seanshore.example') }))
vi.mock('@/lib/auth/cognito-oauth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/cognito-oauth')>()),
  createCognitoOAuth: () => ({ exchangeCode: mocks.exchangeCode }),
}))

import { GET } from './route'

function callback(query: string, cookies: Record<string, string> = {}) {
  const request = new NextRequest(`https://seanshore.example/auth/google/callback?${query}`)
  for (const [name, value] of Object.entries(cookies)) request.cookies.set(name, value)
  return GET(request)
}

afterEach(() => vi.restoreAllMocks())

describe('Google callback failures', () => {
  it('logs a cancelled Google sign-in with its reason only and keeps the same redirect', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const response = await callback('error=access_denied&state=s')
    expect(response.headers.get('location')).toBe('https://seanshore.example/auth/sign-in?oauthError=verification')
    expect(warn).toHaveBeenCalledWith('[auth_callback_failed]', { provider: 'google', reason: 'provider_access_denied' })
  })

  it('logs a callback that arrives without the PKCE verifier cookie', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await callback('code=abc&state=s')
    expect(warn).toHaveBeenCalledWith('[auth_callback_failed]', { provider: 'google', reason: 'missing_verifier' })
  })

  it('logs a failed code exchange without the code, tokens or any user detail', async () => {
    const { COGNITO_COOKIE_NAMES } = await import('@/lib/auth/cognito-cookies')
    mocks.exchangeCode.mockRejectedValueOnce(new Error('Cognito OAuth exchange failed.'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const response = await callback('code=secret-code&state=s', {
      [COGNITO_COOKIE_NAMES.oauthState]: 's',
      [COGNITO_COOKIE_NAMES.oauthVerifier]: 'v',
    })
    expect(response.headers.get('location')).toBe('https://seanshore.example/auth/sign-in?oauthError=exchange')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith('[auth_callback_failed]', { provider: 'google', reason: 'exchange_failed' })
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret-code')
  })
})
