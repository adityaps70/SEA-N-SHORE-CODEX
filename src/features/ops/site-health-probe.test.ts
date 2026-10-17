import { describe, expect, it, vi } from 'vitest'
import { runSiteHealthProbe, siteHealthBaseUrl } from './site-health-probe'

describe('site health probe', () => {
  it('checks the home page and /api/health on the public site and writes SiteUp per check', async () => {
    const lines: string[] = []
    const fetchImpl = vi.fn(async (url: string | URL | Request) => new Response(null, { status: String(url).endsWith('/api/health') ? 503 : 200 }))
    const results = await runSiteHealthProbe({ baseUrl: 'https://seanshore.in', fetchImpl: fetchImpl as unknown as typeof fetch, write: (line) => lines.push(line) })
    expect(fetchImpl.mock.calls.map(([url]) => String(url))).toEqual(['https://seanshore.in/', 'https://seanshore.in/api/health'])
    expect(results.map((result) => [result.check, result.up])).toEqual([['home', true], ['api-health', false]])
    expect(lines.map((line) => JSON.parse(line))).toEqual([
      expect.objectContaining({ Check: 'home', SiteUp: 1 }),
      expect.objectContaining({ Check: 'api-health', SiteUp: 0 }),
    ])
  })

  it('counts a network error or timeout as down', async () => {
    const lines: string[] = []
    const results = await runSiteHealthProbe({ baseUrl: 'https://seanshore.in', fetchImpl: (async () => { throw new Error('timeout') }) as unknown as typeof fetch, write: (line) => lines.push(line) })
    expect(results.every((result) => !result.up && result.status === null)).toBe(true)
    expect(lines.every((line) => JSON.parse(line).SiteUp === 0)).toBe(true)
  })

  it('uses the public site address', () => {
    expect(siteHealthBaseUrl({ NEXT_PUBLIC_SITE_URL: 'https://seanshore.in/' })).toBe('https://seanshore.in')
    expect(siteHealthBaseUrl({})).toBe('https://seanshore.in')
  })
})
