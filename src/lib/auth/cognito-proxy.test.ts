import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createCognitoProxyHandler, isCognitoProtectedRoute, isRealtimeTicketRoute, isSoftAuthRoute, rememberReturnPath, renewsSessionOnPublicRoute } from './cognito-proxy'
import { COGNITO_COOKIE_NAMES } from './cognito-cookies'
import { CognitoApiError } from './cognito-api'
import { createCognitoSessionManager } from './cognito-session'
import { RETURN_PATH_COOKIE } from './return-path'

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
    // Health checks authenticate with their own token, never a session redirect.
    const live = await handler(request('/api/health/live'))
    const deepHome = await handler(request('/api/health/home'))

    expect(marketing.status).toBe(200)
    expect(signIn.status).toBe(200)
    expect(publicProfile.status).toBe(200)
    expect(live.status).toBe(200)
    expect(deepHome.status).toBe(200)
    expect(getVerifiedPrincipal).not.toHaveBeenCalled()
    expect(refreshSession).not.toHaveBeenCalled()
  })

  it('renews an expired session on the landing page and sign-in, so the Home Screen app opens signed in (Round I, I3)', async () => {
    const getVerifiedPrincipal = vi.fn(async () => null)
    const refreshSession = vi.fn(async () => true)
    const handler = createCognitoProxyHandler({ getVerifiedPrincipal, refreshSession })
    const withRefreshOnly = (path: string) => {
      const incoming = request(path)
      incoming.cookies.set(COGNITO_COOKIE_NAMES.refresh, 'refresh-token')
      return incoming
    }

    for (const path of ['/', '/auth/sign-in', '/auth/sign-up', '/about', '/api/feed/impressions']) {
      refreshSession.mockClear()
      const response = await handler(withRefreshOnly(path))
      expect(response.status, path).toBe(200)
      expect(refreshSession, path).toHaveBeenCalledTimes(1)
    }
    // A public page never waits on, or is blocked by, a failed renewal.
    refreshSession.mockRejectedValueOnce(new Error('Cognito down'))
    expect((await handler(withRefreshOnly('/'))).status).toBe(200)
  })

  it('does not renew where nothing is to renew, or on auth steps that manage their own cookies', async () => {
    const live = request('/')
    live.cookies.set(COGNITO_COOKIE_NAMES.access, 'access-token')
    live.cookies.set(COGNITO_COOKIE_NAMES.refresh, 'refresh-token')
    expect(renewsSessionOnPublicRoute(live)).toBe(false)
    expect(renewsSessionOnPublicRoute(request('/'))).toBe(false)
    for (const path of ['/auth/google/callback', '/auth/session-ended', '/auth/mfa', '/api/auth/app-handoff', '/api/health/live']) {
      const incoming = request(path)
      incoming.cookies.set(COGNITO_COOKIE_NAMES.refresh, 'refresh-token')
      expect(renewsSessionOnPublicRoute(incoming), path).toBe(false)
    }
    const signIn = request('/auth/sign-in')
    signIn.cookies.set(COGNITO_COOKIE_NAMES.refresh, 'refresh-token')
    expect(renewsSessionOnPublicRoute(signIn)).toBe(true)
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
    // Round F: the sign-in page knows where to send the member back.
    expect(response.headers.get('location')).toBe('https://staging.seaandshore.in/auth/sign-in?next=%2Fnotifications')
  })

  it('keeps the page and its query in the return path, without Next\'s _rsc parameter, for page loads only', async () => {
    const handler = createCognitoProxyHandler({ getVerifiedPrincipal: vi.fn(async () => null), refreshSession: vi.fn(async () => false) })
    // Round H (H5): /jobs itself is public now; its signed-in-only pages keep the wall.
    const page = await handler(request('/jobs/saved?type=deck&_rsc=abc12'))
    expect(new URL(page.headers.get('location')!).searchParams.get('next')).toBe('/jobs/saved?type=deck')
    const action = await handler(new NextRequest('https://staging.seaandshore.in/jobs/saved', { method: 'POST' }))
    expect(action.headers.get('location')).toBe('https://staging.seaandshore.in/auth/sign-in')
  })

  it('opens a post page signed out, after trying to refresh a member session (round F)', async () => {
    const getVerifiedPrincipal = vi.fn(async () => null)
    const refreshSession = vi.fn(async () => false)
    const handler = createCognitoProxyHandler({ getVerifiedPrincipal, refreshSession }, { allowSignedOutView: () => true })

    const response = await handler(request('/posts/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'))

    expect(response.status).toBe(200)
    expect(response.headers.get('location')).toBeNull()
    expect(getVerifiedPrincipal).toHaveBeenCalledTimes(1)
    expect(refreshSession).toHaveBeenCalledTimes(1)
  })

  it('limits signed-out post views per visitor address (round F)', async () => {
    const seen: string[] = []
    let allowed = 2
    const handler = createCognitoProxyHandler(
      { getVerifiedPrincipal: vi.fn(async () => null), refreshSession: vi.fn(async () => false) },
      { allowSignedOutView: (key) => { seen.push(key); return allowed-- > 0 } },
    )
    const visit = () => handler(new NextRequest('https://staging.seaandshore.in/posts/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', {
      headers: { 'x-forwarded-for': '203.0.113.9, 198.51.100.1' },
    }))
    expect((await visit()).status).toBe(200)
    expect((await visit()).status).toBe(200)
    const limited = await visit()
    expect(limited.status).toBe(429)
    expect(limited.headers.get('retry-after')).toBe('60')
    expect(seen).toEqual(['203.0.113.9', '203.0.113.9', '203.0.113.9'])
  })

  it('never rate-limits a signed-in member on a post page', async () => {
    const allowSignedOutView = vi.fn(() => false)
    const handler = createCognitoProxyHandler({ getVerifiedPrincipal: vi.fn(async () => ({ sub: 'member' })), refreshSession: vi.fn(async () => false) }, { allowSignedOutView })
    expect((await handler(request('/posts/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'))).status).toBe(200)
    expect(allowSignedOutView).not.toHaveBeenCalled()
  })

  it('remembers a safe ?next= on the sign-in and sign-up pages and ignores anything else (round F)', () => {
    const remembered = rememberReturnPath(request('/auth/sign-in?next=%2Fposts%2Faaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'))
    expect(remembered.cookies.get(RETURN_PATH_COOKIE)?.value).toBe('/posts/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    expect(remembered.cookies.get(RETURN_PATH_COOKIE)?.httpOnly).toBe(true)
    expect(rememberReturnPath(request('/auth/sign-up?next=%2Fpeople%2Fcaptain')).cookies.get(RETURN_PATH_COOKIE)?.value).toBe('/people/captain')
    for (const next of ['//evil.com', 'https://other-site.example/x', '/\\evil.com', '/auth/sign-in', '%2F%2Fevil.com']) {
      const response = rememberReturnPath(request(`/auth/sign-in?next=${encodeURIComponent(next)}`))
      expect(response.cookies.get(RETURN_PATH_COOKIE)).toBeUndefined()
    }
  })

  it.each([
    '/activities',
    '/admin',
    '/community',
    '/events',
    '/hashtags/sire',
    '/help/requests',
    '/help/requests/11111111-1111-4111-8111-111111111111',
    '/hiring',
    '/home',
    '/jobs/saved',
    '/jobs/applications',
    '/jobs/alerts',
    '/jobs/not-a-job-id',
    '/jobs/11111111-1111-4111-8111-111111111111/anything-new',
    '/learn/my-learning',
    '/learn/studio',
    '/learn/studio/courses/33333333-3333-4333-8333-333333333333/edit',
    '/learn/teach',
    '/learn/courses/sire-2-0/learn',
    '/learn/courses/sire-2-0/preview/not-a-uuid',
    '/learn/courses/sire-2-0/anything-new',
    '/messages',
    '/network',
    '/notifications',
    '/profile',
    '/saved',
    '/search',
    '/onboarding',
  ])('%s is protected', async (path) => {
    const getVerifiedPrincipal = vi.fn(async () => null)
    const handler = createCognitoProxyHandler({
      getVerifiedPrincipal,
      refreshSession: vi.fn(async () => false),
    })

    const response = await handler(request(path))
    expect(getVerifiedPrincipal).toHaveBeenCalledTimes(1)
    expect(response.status).toBe(307)
  })

  it.each(['/jobs', '/jobs/11111111-1111-4111-8111-111111111111'])('%s opens signed out, after trying to refresh a member session (round H, H5)', async (path) => {
    const getVerifiedPrincipal = vi.fn(async () => null)
    const refreshSession = vi.fn(async () => false)
    const handler = createCognitoProxyHandler({ getVerifiedPrincipal, refreshSession }, { allowSignedOutView: () => true })

    const response = await handler(request(path))

    expect(response.status).toBe(200)
    expect(response.headers.get('location')).toBeNull()
    expect(refreshSession).toHaveBeenCalledTimes(1)
    expect(isCognitoProtectedRoute(path)).toBe(false)
  })

  it('a claimed organization page opens signed out, after trying to refresh a member session (Round ARCH, Phase 2)', async () => {
    const getVerifiedPrincipal = vi.fn(async () => null)
    const refreshSession = vi.fn(async () => false)
    const allowSignedOutView = vi.fn(() => true)
    const handler = createCognitoProxyHandler({ getVerifiedPrincipal, refreshSession }, { allowSignedOutView })

    const response = await handler(request('/organizations/harbour-minds'))

    expect(response.status).toBe(200)
    expect(response.headers.get('location')).toBeNull()
    expect(refreshSession).toHaveBeenCalledTimes(1)
    // Signed-out views share the per-visitor rate limit with post and job pages.
    expect(allowSignedOutView).toHaveBeenCalledTimes(1)
    expect(isSoftAuthRoute('/organizations/harbour-minds')).toBe(true)
  })

  it('a member with an expired access token on an organization page is refreshed, not shown the visitor page', async () => {
    const refreshSession = vi.fn(async () => true)
    const allowSignedOutView = vi.fn(() => true)
    const handler = createCognitoProxyHandler({ getVerifiedPrincipal: vi.fn(async () => null), refreshSession }, { allowSignedOutView })

    const response = await handler(request('/organizations/harbour-minds'))

    expect(response.status).toBe(200)
    expect(refreshSession).toHaveBeenCalledTimes(1)
    expect(allowSignedOutView).not.toHaveBeenCalled()
  })

  it.each([
    '/organizations',
    '/organizations/register',
    '/organizations/harbour-minds/manage',
    '/organizations/harbour-minds/team',
    '/organizations/harbour-minds/training',
    '/organizations/harbour-minds/claim',
    '/organizations/harbour-minds/branding',
    '/organizations/harbour-minds/analytics',
  ])('%s is not opened up: not a signed-out page, and its signed-in (app) layout still guards it', (path) => {
    expect(isSoftAuthRoute(path)).toBe(false)
    expect(isCognitoProtectedRoute(path)).toBe(false)
  })

  it.each(['/about', '/accessibility', '/help', '/privacy', '/terms', '/copyright', '/newsletter', '/contact', '/pricing', '/refunds', '/shipping'])('%s is public', async (path) => {
    const getVerifiedPrincipal = vi.fn(async () => null)
    const handler = createCognitoProxyHandler({
      getVerifiedPrincipal,
      refreshSession: vi.fn(async () => false),
    })

    await handler(request(path))
    expect(getVerifiedPrincipal).not.toHaveBeenCalled()
  })

  it.each([
    '/learn',
    '/learn/courses/sire-2-0-practical-vessel-inspection-readiness',
    '/learn/courses/sire-2-0/preview/33333333-3333-4333-8333-333333333333',
  ])('%s is public (catalogue, course page and free previews)', async (path) => {
    const getVerifiedPrincipal = vi.fn(async () => null)
    const handler = createCognitoProxyHandler({ getVerifiedPrincipal, refreshSession: vi.fn(async () => false) })

    const response = await handler(request(path))

    expect(response.headers.get('location')).toBeNull()
    expect(getVerifiedPrincipal).not.toHaveBeenCalled()
  })

  it('renews a rejected-but-present session on the realtime ticket route, once, and never redirects (Round ARCH)', async () => {
    const ticket = () => new NextRequest('https://staging.seaandshore.in/api/realtime/ticket', { method: 'POST' })
    expect(isRealtimeTicketRoute('/api/realtime/ticket')).toBe(true)
    expect(isRealtimeTicketRoute('/api/realtime/typing-token')).toBe(false)

    // Cognito rejects the access token: one renewal from the refresh cookie, then the route answers (no redirect).
    const rejected = vi.fn(async () => null)
    const renewed = vi.fn(async () => true)
    const afterRenewal = await createCognitoProxyHandler({ getVerifiedPrincipal: rejected, refreshSession: renewed })(ticket())
    expect(afterRenewal.status).toBe(200)
    expect(afterRenewal.headers.get('location')).toBeNull()
    expect(renewed).toHaveBeenCalledTimes(1)

    // The session cannot be renewed: still no redirect; the route itself answers 401.
    const notRenewed = vi.fn(async () => false)
    const signedOut = await createCognitoProxyHandler({ getVerifiedPrincipal: rejected, refreshSession: notRenewed })(ticket())
    expect(signedOut.status).toBe(200)
    expect(signedOut.headers.get('location')).toBeNull()
    expect(notRenewed).toHaveBeenCalledTimes(1)

    // A session Cognito accepts is never renewed.
    const accepted = vi.fn(async () => ({ sub: 'member-1' }))
    const untouched = vi.fn(async () => true)
    await createCognitoProxyHandler({ getVerifiedPrincipal: accepted, refreshSession: untouched })(ticket())
    expect(untouched).not.toHaveBeenCalled()

    // A failing check never throws out of the proxy.
    const failing = vi.fn(async () => { throw new Error('cognito down') })
    const failingRenewal = vi.fn(async () => { throw new Error('cognito down') })
    const tolerated = await createCognitoProxyHandler({ getVerifiedPrincipal: failing, refreshSession: failingRenewal })(ticket())
    expect(tolerated.status).toBe(200)
  })

  it('a reused refresh token signs the visitor out cleanly: sign-in on a protected page, the route answers on the ticket route (Round ARCH)', async () => {
    function sessionFor() {
      const values = new Map<string, string>([[COGNITO_COOKIE_NAMES.access, 'expired'], [COGNITO_COOKIE_NAMES.refresh, 'reused']])
      const cookieStore = {
        get: (name: string) => (values.has(name) ? { name, value: values.get(name)! } : undefined),
        set: (name: string, value: string) => { values.set(name, value) },
        delete: (name: string) => { values.delete(name) },
      }
      const api = {
        getUser: vi.fn(async () => { throw new CognitoApiError('NotAuthorizedException') }),
        refresh: vi.fn(async () => { throw new CognitoApiError('RefreshTokenReuseException') }),
      }
      return { values, session: createCognitoSessionManager({ cookieStore, api, siteUrl: 'https://staging.seaandshore.in' }) }
    }

    const page = sessionFor()
    const protectedPage = await createCognitoProxyHandler(page.session)(request('/network'))
    expect(protectedPage.status).toBe(307)
    expect(protectedPage.headers.get('location')).toContain('/auth/sign-in')
    expect(page.values.has(COGNITO_COOKIE_NAMES.refresh)).toBe(false)

    const ticket = sessionFor()
    const ticketResponse = await createCognitoProxyHandler(ticket.session)(new NextRequest('https://staging.seaandshore.in/api/realtime/ticket', { method: 'POST' }))
    expect(ticketResponse.status).toBe(200)
    expect(ticketResponse.headers.get('location')).toBeNull()
    expect(ticket.values.has(COGNITO_COOKIE_NAMES.refresh)).toBe(false)
  })
})
