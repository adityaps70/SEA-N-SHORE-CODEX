// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/site-url', () => ({ siteOrigin: () => 'https://seanshore.in' }))

import { POST } from './route'

afterEach(() => vi.restoreAllMocks())

function post(body: string, headers: Record<string, string> = {}) {
  return POST(new Request('https://seanshore.in/api/security/csp-report', { method: 'POST', body, headers }))
}

describe('CSP report endpoint (Round 14, 2.4)', () => {
  it('logs one compact line per violation without query strings or samples', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const response = await post(JSON.stringify({ 'csp-report': {
      'document-uri': 'https://seanshore.in/home?token=secret',
      'effective-directive': 'script-src-elem',
      'blocked-uri': 'https://evil.example.com/x.js?session=abc',
      'script-sample': 'alert(document.cookie)',
    } }))
    expect(response.status).toBe(204)
    expect(log).toHaveBeenCalledTimes(1)
    const line = String(log.mock.calls[0]?.[0])
    expect(JSON.parse(line)).toEqual({ event: 'csp_report_only_violation', directive: 'script-src-elem', blocked: 'https://evil.example.com', page: '/home' })
    expect(line).not.toContain('secret')
    expect(line).not.toContain('cookie')
  })

  it('reads Reporting API batches, capped per request', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const batch = Array.from({ length: 9 }, () => ({ type: 'csp-violation', body: { documentURL: 'https://seanshore.in/jobs', effectiveDirective: 'img-src', blockedURL: 'inline' } }))
    expect((await post(JSON.stringify(batch))).status).toBe(204)
    expect(log).toHaveBeenCalledTimes(5)
  })

  it('ignores other origins, oversized bodies and junk', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const report = JSON.stringify({ 'csp-report': { 'effective-directive': 'script-src', 'document-uri': 'https://seanshore.in/' } })
    expect((await post(report, { origin: 'https://evil.example.com' })).status).toBe(204)
    expect((await post('x'.repeat(20_000))).status).toBe(204)
    expect((await post('not json')).status).toBe(204)
    expect(log).not.toHaveBeenCalled()
  })
})
