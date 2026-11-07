// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  API_CONTENT_SECURITY_POLICY,
  CONTENT_SECURITY_POLICY_HEADER,
  CSP_REPORT_PATH,
  ENFORCE_CONTENT_SECURITY_POLICY,
  contentSecurityPolicySources,
  createCspNonce,
  pageContentSecurityPolicy,
  wantsApiContentSecurityPolicy,
  wantsContentSecurityPolicy,
} from './content-security-policy'

function request(method: string, pathname: string, headers: Record<string, string>) {
  return { method, nextUrl: { pathname }, headers: new Headers(headers) }
}

const productionEnvironment = {
  NODE_ENV: 'production',
  AWS_REGION: 'ap-south-1',
  AWS_MEDIA_BUCKET: 'sea-n-shore-prod-123456789012-media',
  REALTIME_WEBSOCKET_URL: 'wss://abc123.execute-api.ap-south-1.amazonaws.com/production',
  AWS_COGNITO_DOMAIN: 'auth.seanshore.in',
}

function directives(policy: string): Map<string, string[]> {
  return new Map(policy.split('; ').map((entry) => {
    const [name, ...sources] = entry.split(' ')
    return [name, sources] as [string, string[]]
  }))
}

describe('report-only Content Security Policy (Round 14, 2.4)', () => {
  it('makes a fresh, unguessable nonce per request', () => {
    const nonces = new Set(Array.from({ length: 50 }, () => createCspNonce()))
    expect(nonces.size).toBe(50)
    for (const nonce of nonces) expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/)
  })

  it('allows scripts only by nonce (strict-dynamic) and leaves reporting to the page reporter', () => {
    const policy = pageContentSecurityPolicy('abc123==')
    expect(policy).toContain("script-src 'self' 'nonce-abc123==' 'strict-dynamic'")
    expect(policy).toContain("object-src 'none'")
    expect(policy).toContain("frame-ancestors 'none'")
    expect(policy).toContain("base-uri 'self'")
    // Round P3: the inlined reporter (csp-reporter-script.ts) sends each unique violation once per page load.
    expect(policy).not.toContain('report-uri')
    expect(policy).not.toContain("'unsafe-eval'")
    expect(policy).not.toMatch(/script-src[^;]*'unsafe-inline'/)
  })

  it('applies to page loads only', () => {
    expect(wantsContentSecurityPolicy(request('GET', '/home', { 'sec-fetch-dest': 'document' }))).toBe(true)
    expect(wantsContentSecurityPolicy(request('GET', '/home', { accept: 'text/html,application/xhtml+xml' }))).toBe(true)
    expect(wantsContentSecurityPolicy(request('POST', '/home', { 'sec-fetch-dest': 'document' }))).toBe(false)
    expect(wantsContentSecurityPolicy(request('GET', '/api/health/live', { 'sec-fetch-dest': 'document' }))).toBe(false)
    expect(wantsContentSecurityPolicy(request('GET', '/home', { 'sec-fetch-dest': 'empty', rsc: '1' }))).toBe(false)
    expect(wantsContentSecurityPolicy(request('GET', '/home', { 'next-router-prefetch': '1', accept: 'text/html' }))).toBe(false)
    expect(wantsContentSecurityPolicy(request('GET', '/home', { 'sec-fetch-dest': 'image' }))).toBe(false)
  })
})

describe('tightened Content Security Policy (Round H, H4)', () => {
  it('is enforced by the single switch', () => {
    expect(ENFORCE_CONTENT_SECURITY_POLICY).toBe(true)
    expect(CONTENT_SECURITY_POLICY_HEADER).toBe('Content-Security-Policy')
  })

  it('names the exact media bucket, realtime endpoint and Cognito domain from the runtime environment', () => {
    const policy = directives(pageContentSecurityPolicy('n0nce==', contentSecurityPolicySources(productionEnvironment)))
    const bucket = 'https://sea-n-shore-prod-123456789012-media.s3.ap-south-1.amazonaws.com'
    expect(policy.get('img-src')).toEqual(["'self'", 'data:', 'blob:', bucket])
    expect(policy.get('media-src')).toEqual(["'self'", 'blob:', bucket])
    expect(policy.get('connect-src')).toEqual([
      "'self'",
      bucket,
      'wss://abc123.execute-api.ap-south-1.amazonaws.com',
      // Round P3: the sign-in domain (a soft navigation that ends at sign-in follows the redirect).
      'https://auth.seanshore.in',
      'https://*.cashfree.com',
      'https://api.razorpay.com',
      'https://lumberjack.razorpay.com',
    ])
    expect(policy.get('frame-src')).toEqual([
      "'self'",
      bucket,
      'https://www.youtube-nocookie.com',
      'https://player.vimeo.com',
      'https://*.cashfree.com',
      'https://api.razorpay.com',
      'https://checkout.razorpay.com',
    ])
    expect(policy.get('script-src')).toEqual(["'self'", "'nonce-n0nce=='", "'strict-dynamic'", 'https://sdk.cashfree.com', 'https://checkout.razorpay.com'])
    // Fonts are self-hosted: no Google Fonts hosts.
    expect(policy.get('style-src')).toEqual(["'self'", "'unsafe-inline'"])
    expect(policy.get('font-src')).toEqual(["'self'", 'data:'])
    expect(policy.get('form-action')).toEqual(["'self'", 'https://auth.seanshore.in', 'https://*.cashfree.com'])
    expect(policy.get('frame-ancestors')).toEqual(["'none'"])
  })

  // CSP host-source matching (scheme, host with an optional leading *. wildcard, default port) for the sources used here.
  function allowedBy(sources: string[], url: string, self = 'https://seanshore.in') {
    const target = new URL(url)
    return sources.some((source) => {
      if (source === "'self'") return target.origin === new URL(self).origin
      const match = /^(https):\/\/(\*\.)?([a-z0-9.-]+)$/.exec(source)
      if (!match || target.protocol !== `${match[1]}:` || target.port !== '') return false
      return match[2] ? target.hostname.endsWith(`.${match[3]}`) : target.hostname === match[3]
    })
  }

  it("form-action lets Cashfree's checkout forms through and still refuses any other outside host", () => {
    const formAction = directives(pageContentSecurityPolicy('n0nce==', contentSecurityPolicySources(productionEnvironment))).get('form-action')!
    // Every fixed form target in Cashfree's JS SDK v3: the checkout (pop-up and redirect) and Pro auto-pay.
    for (const target of [
      'https://api.cashfree.com/pg/view/sessions/checkout',
      'https://api.cashfree.com/pg/view/sessions/checkout/subs',
      'https://sandbox.cashfree.com/pg/view/sessions/checkout',
      'https://sandbox.cashfree.com/pg/view/sessions/checkout/subs',
      'https://payments.cashfree.com/pg/redirect',
    ]) expect(allowedBy(formAction, target), target).toBe(true)
    // Our own forms and the Cognito sign-out still work.
    expect(allowedBy(formAction, 'https://seanshore.in/auth/sign-out')).toBe(true)
    expect(allowedBy(formAction, 'https://auth.seanshore.in/logout')).toBe(true)
    // Nothing else: other sites, look-alikes, Cashfree over plain http, another port, and Razorpay (not in this scope).
    for (const target of [
      'https://evil.example.com/collect',
      'https://cashfree.com.evil.example/checkout',
      'https://notcashfree.com/checkout',
      'https://cashfree.com/checkout',
      'http://api.cashfree.com/pg/view/sessions/checkout',
      'https://api.cashfree.com:8443/pg/view/sessions/checkout',
      'https://api.razorpay.com/v1/checkout/embedded',
      'https://accounts.google.com/o/oauth2/auth',
    ]) expect(allowedBy(formAction, target), target).toBe(false)
    expect(formAction).toEqual(["'self'", 'https://auth.seanshore.in', 'https://*.cashfree.com'])
  })

  it('never allows a blanket scheme for network sources', () => {
    const policy = pageContentSecurityPolicy('n0nce==', contentSecurityPolicySources(productionEnvironment))
    for (const [name, sources] of directives(policy)) {
      for (const blanket of ['https:', 'http:', 'wss:', 'ws:', '*']) expect(sources, `${name} ${blanket}`).not.toContain(blanket)
    }
  })

  it('falls back to S3 and API Gateway wildcards when the environment does not name them', () => {
    const sources = contentSecurityPolicySources({ AWS_MEDIA_BUCKET: 'Bad.Bucket.Name', REALTIME_WEBSOCKET_URL: 'https://not-a-socket.example' })
    expect(sources).toEqual({
      mediaOrigins: ['https://*.s3.ap-south-1.amazonaws.com', 'https://*.s3.amazonaws.com'],
      realtimeOrigins: ['wss://*.execute-api.ap-south-1.amazonaws.com'],
      signInOrigins: [],
      development: false,
    })
    expect(directives(pageContentSecurityPolicy('n0nce==', sources)).get('form-action')).toEqual(["'self'", 'https://*.cashfree.com'])
  })

  it('lets next dev evaluate code and reach its HMR socket', () => {
    const policy = directives(pageContentSecurityPolicy('n0nce==', contentSecurityPolicySources({ NODE_ENV: 'development' })))
    expect(policy.get('script-src')).toContain("'unsafe-eval'")
    expect(policy.get('connect-src')).toContain('ws:')
  })

  it('locks API responses down with a fixed policy, except SCORM package files', () => {
    expect(API_CONTENT_SECURITY_POLICY).toBe(`default-src 'none'; frame-ancestors 'none'; report-uri ${CSP_REPORT_PATH}`)
    expect(wantsApiContentSecurityPolicy({ nextUrl: { pathname: '/api/health/live' } })).toBe(true)
    expect(wantsApiContentSecurityPolicy({ nextUrl: { pathname: '/api/feed-media/posts/a.mp4' } })).toBe(true)
    expect(wantsApiContentSecurityPolicy({ nextUrl: { pathname: '/api/learning/scorm/lesson-1/progress' } })).toBe(true)
    expect(wantsApiContentSecurityPolicy({ nextUrl: { pathname: '/api/learning/scorm/lesson-1/content/token/index.html' } })).toBe(false)
    expect(wantsApiContentSecurityPolicy({ nextUrl: { pathname: '/home' } })).toBe(false)
  })
})
