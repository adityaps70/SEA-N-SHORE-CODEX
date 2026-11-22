import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ exchangeCode: vi.fn(), recordCallback: vi.fn(async () => null as { id: string; confirmSecret: string } | null) }))

vi.mock('@/lib/env', () => ({
  getCognitoEnvironment: () => ({
    AWS_COGNITO_GOOGLE_ENABLED: true,
    AWS_COGNITO_DOMAIN: 'auth.example.test',
    AWS_COGNITO_CLIENT_ID: 'client',
    AWS_COGNITO_ALLOW_INSECURE_HTTP_COOKIES: false,
  }),
  publicEnvironment: { NEXT_PUBLIC_SITE_URL: 'https://seanshore.example' },
}))
vi.mock('@/lib/site-url', () => ({
  siteUrlFor: (path: string) => new URL(path, 'https://seanshore.example'),
  siteUrlForRequest: (_headers: unknown, path: string) => new URL(path, 'https://seanshore.example'),
  siteOriginFor: () => 'https://seanshore.example',
}))
vi.mock('@/lib/auth/cognito-oauth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/cognito-oauth')>()),
  createCognitoOAuth: () => ({ exchangeCode: mocks.exchangeCode }),
}))

vi.mock('@/features/auth/app-handoff-runtime', () => ({ appHandoffService: () => ({ recordCallback: mocks.recordCallback }) }))

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

  it('hands a Google sign-in started in the Home Screen app to its code step, without the app cookies (Round I, I3)', async () => {
    mocks.recordCallback.mockResolvedValueOnce({ id: '6f1d2c4e-1111-4222-8333-444455556666', confirmSecret: 'c'.repeat(43) })
    const response = await callback('code=cognito-code&state=app-state')
    expect(mocks.recordCallback).toHaveBeenCalledWith({ state: 'app-state', authorizationCode: 'cognito-code' })
    expect(response.headers.get('location')).toBe('https://seanshore.example/auth/app-handoff')
    const cookie = response.cookies.get('sns_app_handoff_confirm')
    expect(cookie).toMatchObject({ value: `6f1d2c4e-1111-4222-8333-444455556666.${'c'.repeat(43)}`, httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 600 })
    // No session cookies land in Safari.
    expect(response.headers.get('set-cookie')).not.toContain('sns_cognito_access')
  })

  it('keeps the verification error when the state belongs to no app handoff', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const response = await callback('code=cognito-code&state=unknown-state')
    expect(response.headers.get('location')).toBe('https://seanshore.example/auth/sign-in?oauthError=verification')
  })
})
