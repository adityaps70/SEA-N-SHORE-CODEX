// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { CSP_REPORT_PATH, createCspNonce, reportOnlyContentSecurityPolicy, wantsContentSecurityPolicy } from './content-security-policy'

function request(method: string, pathname: string, headers: Record<string, string>) {
  return { method, nextUrl: { pathname }, headers: new Headers(headers) }
}

describe('report-only Content Security Policy (Round 14, 2.4)', () => {
  it('makes a fresh, unguessable nonce per request', () => {
    const nonces = new Set(Array.from({ length: 50 }, () => createCspNonce()))
    expect(nonces.size).toBe(50)
    for (const nonce of nonces) expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/)
  })

  it('allows scripts only by nonce (strict-dynamic) and reports to the site', () => {
    const policy = reportOnlyContentSecurityPolicy('abc123==')
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
