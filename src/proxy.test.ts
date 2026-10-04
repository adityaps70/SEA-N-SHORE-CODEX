// @vitest-environment node
import { NextRequest, NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ updateCognitoRouteSession: vi.fn() }))
vi.mock('@/lib/auth/cognito-proxy', () => ({ updateCognitoRouteSession: mocks.updateCognitoRouteSession }))

import { proxy } from './proxy'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.updateCognitoRouteSession.mockImplementation(async (request: NextRequest) => NextResponse.next({ request }))
})

describe('proxy Content Security Policy (Round 14, 2.4)', () => {
  it('sends a Report-Only policy on page loads and hands the same policy to rendering', async () => {
    const response = await proxy(new NextRequest('https://seanshore.in/home', { headers: { 'sec-fetch-dest': 'document', cookie: 'a=b' } }))
    const policy = response.headers.get('content-security-policy-report-only')
    expect(policy).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/]{22}==' 'strict-dynamic'/)
    expect(response.headers.get('content-security-policy')).toBeNull()
    const forwarded = mocks.updateCognitoRouteSession.mock.calls[0]?.[0] as NextRequest
    expect(forwarded.headers.get('content-security-policy-report-only')).toBe(policy)
    expect(forwarded.headers.get('cookie')).toBe('a=b')
    expect(forwarded.nextUrl.pathname).toBe('/home')
  })

  it('leaves POSTs (server actions), API calls and RSC requests untouched', async () => {
    for (const request of [
      new NextRequest('https://seanshore.in/home', { method: 'POST', body: 'x', headers: { 'sec-fetch-dest': 'document' } }),
      new NextRequest('https://seanshore.in/api/health/live', { headers: { 'sec-fetch-dest': 'document' } }),
      new NextRequest('https://seanshore.in/home', { headers: { rsc: '1' } }),
    ]) {
      const response = await proxy(request)
      expect(response.headers.get('content-security-policy-report-only')).toBeNull()
      expect(mocks.updateCognitoRouteSession).toHaveBeenLastCalledWith(request)
    }
  })

  it('still sends the after-sign-out redirect', async () => {
    const response = await proxy(new NextRequest('https://seanshore.in/', { headers: { 'sec-fetch-dest': 'document', cookie: 'sns_after_sign_out=/auth/sign-up' } }))
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('https://seanshore.in/auth/sign-up')
    expect(mocks.updateCognitoRouteSession).not.toHaveBeenCalled()
  })
})
