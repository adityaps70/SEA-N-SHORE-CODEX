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

  it('allows scripts only by nonce (strict-dynamic) and reports to the site', () => {
    const policy = pageContentSecurityPolicy('abc123==')
    expect(policy).toContain("script-src 'self' 'nonce-abc123==' 'strict-dynamic'")
    expect(policy).toContain("object-src 'none'")
    expect(policy).toContain("frame-ancestors 'none'")
    expect(policy).toContain("base-uri 'self'")
    expect(policy).toContain(`report-uri ${CSP_REPORT_PATH}`)
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
  it('stays report-only until the single enforce switch is flipped', () => {
    expect(ENFORCE_CONTENT_SECURITY_POLICY).toBe(false)
    expect(CONTENT_SECURITY_POLICY_HEADER).toBe('Content-Security-Policy-Report-Only')
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
    expect(policy.get('style-src')).toEqual(["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'])
    expect(policy.get('font-src')).toEqual(["'self'", 'data:', 'https://fonts.gstatic.com'])
    expect(policy.get('form-action')).toEqual(["'self'", 'https://auth.seanshore.in'])
    expect(policy.get('frame-ancestors')).toEqual(["'none'"])
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
    expect(directives(pageContentSecurityPolicy('n0nce==', sources)).get('form-action')).toEqual(["'self'"])
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
