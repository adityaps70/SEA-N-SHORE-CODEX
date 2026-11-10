// @vitest-environment node
import { NextRequest, NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ updateCognitoRouteSession: vi.fn(), setRefreshTokenLedger: vi.fn() }))
vi.mock('@/lib/auth/cognito-proxy', () => ({
  updateCognitoRouteSession: mocks.updateCognitoRouteSession,
  setRefreshTokenLedger: mocks.setRefreshTokenLedger,
}))
vi.mock('@/lib/db/client', () => ({ query: vi.fn(async () => ({ rows: [] })) }))

import { ORGANIZATION_PAGE_CACHE_CONTROL, PUBLIC_PAGE_CACHE_CONTROL } from '@/lib/http/public-page-cache'
import { proxy } from './proxy'

const document = { 'sec-fetch-dest': 'document', accept: 'text/html' }

function page(path: string, headers: Record<string, string> = {}, init: { method?: string } = {}) {
  return new NextRequest(`https://seanshore.in${path}`, { headers: { ...document, ...headers }, ...init })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.updateCognitoRouteSession.mockImplementation(async (request: NextRequest) => NextResponse.next({ request }))
})

describe('CloudFront page cache: only signed-out public pages are ever marked cacheable (Round P3, B4)', () => {
  it.each(['/', '/jobs', '/jobs/3f1c2b9e-1111-4222-8333-444455556666', '/learn/courses/sire-2-inspections', '/privacy', '/terms'])(
    'marks a signed-out load of %s public for a minute, with stale-while-revalidate',
    async (path) => {
      const response = await proxy(page(path))
      expect(response.headers.get('cache-control')).toBe(PUBLIC_PAGE_CACHE_CONTROL)
      expect(PUBLIC_PAGE_CACHE_CONTROL).toBe('public, max-age=0, s-maxage=60, stale-while-revalidate=240')
    },
  )

  it.each([
    ['a session cookie', { cookie: 'sns_cognito_access=token' }],
    ['only a refresh cookie', { cookie: 'sns_cognito_refresh=token' }],
    ['a sign-in challenge', { cookie: 'sns_cognito_mfa_challenge=x' }],
    ['a remembered return path', { cookie: 'sns_return_to=%2Fjobs' }],
  ])('never marks a request with %s public', async (_case, headers) => {
    for (const path of ['/', '/jobs', '/privacy']) {
      const response = await proxy(page(path, headers))
      expect(response.headers.get('cache-control')).toBeNull()
    }
  })

  it('never marks signed-in or personal pages public, even signed out', async () => {
    for (const path of ['/home', '/messages', '/profile', '/settings', '/notifications', '/jobs/abc/apply', '/learn/my-learning', '/people/member-a', '/posts/abc', '/auth/sign-in']) {
      const response = await proxy(page(path))
      expect(response.headers.get('cache-control')).toBeNull()
    }
  })

  it('never marks RSC, prefetch, POST or API requests public', async () => {
    for (const request of [
      new NextRequest('https://seanshore.in/jobs', { headers: { rsc: '1' } }),
      new NextRequest('https://seanshore.in/jobs?_rsc=abc12', { headers: document }),
      new NextRequest('https://seanshore.in/jobs', { headers: { 'next-router-prefetch': '1', accept: 'text/html' } }),
      new NextRequest('https://seanshore.in/jobs', { method: 'POST', body: 'x', headers: document }),
      new NextRequest('https://seanshore.in/api/public/jobs', { headers: document }),
    ]) {
      const response = await proxy(request)
      expect(response.headers.get('cache-control')).not.toBe(PUBLIC_PAGE_CACHE_CONTROL)
    }
  })

  it('never marks a response that sets a cookie or redirects public', async () => {
    mocks.updateCognitoRouteSession.mockImplementationOnce(async (request: NextRequest) => {
      const response = NextResponse.next({ request })
      response.cookies.set('sns_cognito_access', 'refreshed')
      return response
    })
    expect((await proxy(page('/jobs'))).headers.get('cache-control')).toBeNull()

    mocks.updateCognitoRouteSession.mockImplementationOnce(async () => NextResponse.redirect('https://seanshore.in/auth/sign-in'))
    expect((await proxy(page('/jobs'))).headers.get('cache-control')).toBeNull()
  })
})

describe('CloudFront page cache: public organization pages (Round ARCH, Phase 2)', () => {
  it.each(['/organizations/harbour-minds', '/organizations/oceanic-ship-management-1a2b3c4d', '/organizations/a1'])(
    'marks a signed-out load of %s public for five minutes, with ten more stale',
    async (path) => {
      const response = await proxy(page(path))
      expect(response.headers.get('cache-control')).toBe(ORGANIZATION_PAGE_CACHE_CONTROL)
      expect(ORGANIZATION_PAGE_CACHE_CONTROL).toBe('public, max-age=0, s-maxage=300, stale-while-revalidate=600')
    },
  )

  it('keeps the other public pages at their one-minute header', async () => {
    expect((await proxy(page('/jobs'))).headers.get('cache-control')).toBe(PUBLIC_PAGE_CACHE_CONTROL)
    expect(PUBLIC_PAGE_CACHE_CONTROL).not.toBe(ORGANIZATION_PAGE_CACHE_CONTROL)
  })

  it.each([
    ['a session cookie', { cookie: 'sns_cognito_access=token' }],
    ['only a refresh cookie', { cookie: 'sns_cognito_refresh=token' }],
    ['a sign-in challenge', { cookie: 'sns_cognito_mfa_challenge=x' }],
    ['a remembered return path', { cookie: 'sns_return_to=%2Forganizations' }],
    ['a display-mode cookie', { cookie: 'sns_display_mode=compact' }],
  ])('never marks an organization page public with %s', async (_case, headers) => {
    const response = await proxy(page('/organizations/harbour-minds', headers))
    expect(response.headers.get('cache-control')).toBeNull()
  })

  it('never marks the directory, the register page or any sub-page public, even signed out', async () => {
    for (const path of [
      '/organizations',
      '/organizations/',
      '/organizations/register',
      '/organizations/harbour-minds/manage',
      '/organizations/harbour-minds/team',
      '/organizations/harbour-minds/training',
      '/organizations/harbour-minds/claim',
      '/organizations/harbour-minds/branding',
      '/organizations/harbour-minds/analytics',
      '/organizations/harbour-minds/anything-new',
      '/organizations/Harbour-Minds',
      '/organizations/-leading-hyphen',
      '/organization/harbour-minds',
    ]) {
      const response = await proxy(page(path))
      expect(response.headers.get('cache-control'), path).toBeNull()
    }
  })

  it('never marks RSC, prefetch or POST requests for an organization page public', async () => {
    for (const request of [
      new NextRequest('https://seanshore.in/organizations/harbour-minds', { headers: { rsc: '1' } }),
      new NextRequest('https://seanshore.in/organizations/harbour-minds?_rsc=abc12', { headers: document }),
      new NextRequest('https://seanshore.in/organizations/harbour-minds', { headers: { 'next-router-prefetch': '1', accept: 'text/html' } }),
      new NextRequest('https://seanshore.in/organizations/harbour-minds', { method: 'POST', body: 'x', headers: document }),
    ]) {
      const response = await proxy(request)
      expect(response.headers.get('cache-control')).not.toBe(ORGANIZATION_PAGE_CACHE_CONTROL)
    }
  })

  it('never marks an organization page public when the response sets a cookie or redirects', async () => {
    mocks.updateCognitoRouteSession.mockImplementationOnce(async (request: NextRequest) => {
      const response = NextResponse.next({ request })
      response.cookies.set('sns_cognito_access', 'refreshed')
      return response
    })
    expect((await proxy(page('/organizations/harbour-minds'))).headers.get('cache-control')).toBeNull()

    mocks.updateCognitoRouteSession.mockImplementationOnce(async () => NextResponse.redirect('https://seanshore.in/auth/sign-in'))
    expect((await proxy(page('/organizations/harbour-minds'))).headers.get('cache-control')).toBeNull()
  })
})
