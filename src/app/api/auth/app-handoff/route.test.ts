// @vitest-environment node
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  googleEnabled: true,
  start: vi.fn(),
  claim: vi.fn(),
  exchangeCode: vi.fn(),
  getVerifiedUser: vi.fn(async () => null as { id: string } | null),
}))

vi.mock('@/lib/env', () => ({
  getCognitoEnvironment: () => ({
    AWS_COGNITO_GOOGLE_ENABLED: mocks.googleEnabled,
    AWS_COGNITO_DOMAIN: 'auth.example.test',
    AWS_COGNITO_CLIENT_ID: 'client',
    AWS_COGNITO_ALLOW_INSECURE_HTTP_COOKIES: false,
  }),
  publicEnvironment: { NEXT_PUBLIC_SITE_URL: 'https://seanshore.example' },
}))
vi.mock('@/features/auth/app-handoff-runtime', () => ({ appHandoffService: () => ({ start: mocks.start, claim: mocks.claim }) }))
vi.mock('@/features/auth/queries', () => ({ getVerifiedUser: mocks.getVerifiedUser }))
vi.mock('@/lib/auth/cognito-oauth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/cognito-oauth')>()),
  createCognitoOAuth: () => ({
    createAuthorizationRequest: () => ({ url: 'https://auth.example.test/oauth2/authorize?state=st', state: 'st', verifier: 'ver' }),
    exchangeCode: mocks.exchangeCode,
  }),
}))

import { GET, POST } from './route'

const HANDOFF = `6f1d2c4e-1111-4222-8333-444455556666.${'s'.repeat(43)}`

function poll(cookies: Record<string, string> = {}) {
  const request = new NextRequest('https://seanshore.example/api/auth/app-handoff')
  for (const [name, value] of Object.entries(cookies)) request.cookies.set(name, value)
  return GET(request)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.googleEnabled = true
  mocks.getVerifiedUser.mockResolvedValue(null)
})

describe('/api/auth/app-handoff (Round I, I3)', () => {
  it('starts a handoff: the app gets the code, the Google link, and its own OAuth and handoff cookies', async () => {
    mocks.start.mockResolvedValue({ id: '6f1d2c4e-1111-4222-8333-444455556666', secret: 's'.repeat(43), pairCode: '482193', expiresInSeconds: 600 })
    const response = await POST(new NextRequest('https://seanshore.example/api/auth/app-handoff', { method: 'POST', body: JSON.stringify({ intent: 'sign-up' }) }))
    await expect(response.json()).resolves.toEqual({ status: 'started', authorizeUrl: 'https://auth.example.test/oauth2/authorize?state=st', pairCode: '482 193', expiresInSeconds: 600 })
    expect(mocks.start).toHaveBeenCalledWith({ state: 'st', intent: 'sign-up' })
    expect(response.cookies.get('sns_cognito_oauth_verifier')).toMatchObject({ value: 'ver', httpOnly: true, secure: true, sameSite: 'lax' })
    expect(response.cookies.get('sns_app_handoff')).toMatchObject({ value: HANDOFF, httpOnly: true, secure: true, sameSite: 'lax', maxAge: 600 })
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })

  it('answers "unavailable" when Google is off or the handoff cannot be stored', async () => {
    mocks.googleEnabled = false
    expect((await POST(new NextRequest('https://seanshore.example/api/auth/app-handoff', { method: 'POST' }))).status).toBe(503)
    mocks.googleEnabled = true
    mocks.start.mockRejectedValue(new Error('app_handoff_unavailable'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const response = await POST(new NextRequest('https://seanshore.example/api/auth/app-handoff', { method: 'POST' }))
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ status: 'unavailable' })
  })

  it('signs the app in with its own verifier once Safari confirmed the code', async () => {
    mocks.claim.mockResolvedValue({ status: 'ready', authorizationCode: 'cognito-code', intent: 'sign-in' })
    mocks.exchangeCode.mockResolvedValue({ accessToken: 'access', refreshToken: 'refresh', expiresIn: 3600 })
    const response = await poll({ sns_app_handoff: HANDOFF, sns_cognito_oauth_verifier: 'ver' })
    await expect(response.json()).resolves.toEqual({ status: 'signed-in', redirectTo: '/auth/post-sign-in' })
    expect(mocks.exchangeCode).toHaveBeenCalledWith({ code: 'cognito-code', verifier: 'ver' })
    expect(response.cookies.get('sns_cognito_refresh')).toMatchObject({ value: 'refresh', httpOnly: true, secure: true, sameSite: 'lax', maxAge: 2_592_000 })
    expect(response.cookies.get('sns_app_handoff')?.value).toBe('')
  })

  it('reports waiting, and treats an app that is already signed in (shared cookies) as done', async () => {
    mocks.claim.mockResolvedValue({ status: 'waiting' })
    await expect((await poll({ sns_app_handoff: HANDOFF })).json()).resolves.toEqual({ status: 'waiting' })
    await expect((await poll()).json()).resolves.toEqual({ status: 'expired' })
    mocks.getVerifiedUser.mockResolvedValue({ id: 'profile-1' })
    await expect((await poll({ sns_app_handoff: HANDOFF })).json()).resolves.toEqual({ status: 'signed-in', redirectTo: '/auth/post-sign-in' })
  })
})
