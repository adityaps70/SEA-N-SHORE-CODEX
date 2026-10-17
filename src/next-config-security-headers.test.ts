import { describe, expect, it } from 'vitest'
import nextConfig from '../next.config'

async function headersFor(source: string) {
  const rules = (await nextConfig.headers?.()) ?? []
  return Object.fromEntries(rules.filter((rule) => rule.source === source).flatMap((rule) => rule.headers.map((header) => [header.key, header.value])))
}

describe('Next.js security headers (Round 14, 2.4; Round H, H4)', () => {
  it('sends the security headers on every page and API response', async () => {
    expect(await headersFor('/(.*)')).toEqual({
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
      // Payment checkouts may open pop-ups that report back to the page.
      'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
    })
  })

  it('does not advertise the framework', () => {
    expect(nextConfig.poweredByHeader).toBe(false)
  })

  it('leaves the Content Security Policy to the proxy (per-request nonce)', async () => {
    const rules = (await nextConfig.headers?.()) ?? []
    const keys = rules.flatMap((rule) => rule.headers.map((header) => header.key.toLowerCase()))
    expect(keys).not.toContain('content-security-policy')
    expect(keys).not.toContain('content-security-policy-report-only')
  })
})
