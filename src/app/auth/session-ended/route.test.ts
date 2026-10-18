import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ getAwsVerification: vi.fn(), revokeToken: vi.fn() }))

vi.mock('@/lib/env', () => ({
  getCognitoEnvironment: () => ({ AWS_COGNITO_REGION: 'ap-south-1', AWS_COGNITO_CLIENT_ID: 'client', AWS_COGNITO_ALLOW_INSECURE_HTTP_COOKIES: false }),
  publicEnvironment: { NEXT_PUBLIC_SITE_URL: 'https://seanshore.example' },
}))
vi.mock('@/lib/site-url', () => ({ siteUrlFor: (path: string) => new URL(path, 'https://seanshore.example') }))
vi.mock('@/features/auth/aws-queries', () => ({ getAwsVerification: mocks.getAwsVerification }))
vi.mock('@/lib/auth/cognito-api', () => ({ createCognitoApi: () => ({ revokeToken: mocks.revokeToken }) }))

import { GET } from './route'

function request(cookies: Record<string, string> = {}) {
  const value = new NextRequest('https://seanshore.example/auth/session-ended')
  for (const [name, cookie] of Object.entries(cookies)) value.cookies.set(name, cookie)
  return value
}

describe('/auth/session-ended (Round H, H3)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('for a signed-out device: revokes its own refresh token, clears the auth cookies and shows sign-in with a notice', async () => {
    mocks.getAwsVerification.mockResolvedValue({ user: null, sessionRevoked: true })
    mocks.revokeToken.mockResolvedValue(undefined)
    const response = await GET(request({ sns_cognito_access: 'a1', sns_cognito_refresh: 'r1' }))

    expect(response.headers.get('location')).toBe('https://seanshore.example/auth/sign-in?notice=session-ended')
    expect(mocks.revokeToken).toHaveBeenCalledWith('r1')
    const cleared = response.headers.getSetCookie().join('\n')
    expect(cleared).toMatch(/sns_cognito_access=;/)
    expect(cleared).toMatch(/sns_cognito_refresh=;/)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })

  it('cannot be used to sign anybody out: an active session is only sent home', async () => {
    mocks.getAwsVerification.mockResolvedValue({ user: { id: 'profile' }, sessionRevoked: false })
    const response = await GET(request({ sns_cognito_access: 'a1', sns_cognito_refresh: 'r1' }))
    expect(response.headers.get('location')).toBe('https://seanshore.example/home')
    expect(mocks.revokeToken).not.toHaveBeenCalled()
    expect(response.headers.getSetCookie()).toEqual([])
  })

  it('sends a signed-out visitor to sign-in', async () => {
    mocks.getAwsVerification.mockResolvedValue({ user: null, sessionRevoked: false })
    const response = await GET(request())
    expect(response.headers.get('location')).toBe('https://seanshore.example/auth/sign-in')
  })
})
