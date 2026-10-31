// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/site-url', () => ({ siteOrigin: () => 'https://seanshore.in' }))

import { CSP_REPORT_REQUESTS_PER_MINUTE, resetCspReportRateLimit } from '@/lib/security/csp-report-rate-limit'
import { CSP_REPORT_FLUSH_INTERVAL_MS, flushCspViolationSummary } from '@/lib/security/csp-report-summary'
import { POST } from './route'

beforeEach(() => {
  vi.useFakeTimers()
  flushCspViolationSummary()
  resetCspReportRateLimit()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function post(body: string, headers: Record<string, string> = {}) {
  return POST(new Request('https://seanshore.in/api/security/csp-report', { method: 'POST', body, headers }))
}

function summaries(log: { mock: { calls: unknown[][] } }) {
  return log.mock.calls.map((call) => JSON.parse(String(call[0])))
}

describe('CSP report endpoint (Round 14, 2.4; Round H, H4)', () => {
  it('counts violations per directive and blocked host, without query strings, paths or samples', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const report = JSON.stringify({ 'csp-report': {
      'document-uri': 'https://seanshore.in/profile/3f1c2b9e-1111-4222-8333-444455556666?token=secret',
      'effective-directive': 'script-src-elem',
      'blocked-uri': 'https://evil.example.com/x.js?session=abc',
      'script-sample': 'alert(document.cookie)',
    } })
    for (let index = 0; index < 3; index += 1) expect((await post(report)).status).toBe(204)
    expect((await post(JSON.stringify({ 'csp-report': { 'effective-directive': 'img-src', 'blocked-uri': 'data' } }))).status).toBe(204)
    expect(log).not.toHaveBeenCalled()

    vi.advanceTimersByTime(CSP_REPORT_FLUSH_INTERVAL_MS)
    expect(log).toHaveBeenCalledTimes(1)
    const line = String(log.mock.calls[0]?.[0])
    expect(JSON.parse(line)).toEqual({
      event: 'csp_violation_summary',
      windowSeconds: 60,
      total: 4,
      violations: [
        { directive: 'script-src-elem', blocked: 'evil.example.com', source: 'none', section: 'api', count: 3 },
        { directive: 'img-src', blocked: 'data', source: 'none', section: 'api', count: 1 },
      ],
    })
    for (const leaked of ['secret', 'session', 'abc', 'cookie', 'x.js', '/profile', '3f1c2b9e', '?']) expect(line).not.toContain(leaked)
  })

  it('logs at most one summary a minute', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const report = JSON.stringify({ 'csp-report': { 'effective-directive': 'connect-src', 'blocked-uri': 'wss://other.example:8443/socket?ticket=t' } })
    await post(report)
    vi.advanceTimersByTime(30_000)
    await post(report)
    expect(log).not.toHaveBeenCalled()
    vi.advanceTimersByTime(30_000)
    await post(report)
    vi.advanceTimersByTime(CSP_REPORT_FLUSH_INTERVAL_MS)
    expect(summaries(log)).toEqual([
      expect.objectContaining({ total: 2, violations: [{ directive: 'connect-src', blocked: 'other.example:8443', source: 'none', section: 'api', count: 2 }] }),
      expect.objectContaining({ total: 1, violations: [{ directive: 'connect-src', blocked: 'other.example:8443', source: 'none', section: 'api', count: 1 }] }),
    ])
  })

  it('reads Reporting API batches, capped per request', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const batch = Array.from({ length: 9 }, () => ({ type: 'csp-violation', body: { documentURL: 'https://seanshore.in/jobs', effectiveDirective: 'img-src', blockedURL: 'inline' } }))
    expect((await post(JSON.stringify(batch))).status).toBe(204)
    vi.advanceTimersByTime(CSP_REPORT_FLUSH_INTERVAL_MS)
    expect(summaries(log)).toEqual([expect.objectContaining({ total: 5, violations: [{ directive: 'img-src', blocked: 'inline', source: 'none', section: 'api', count: 5 }] })])
  })

  it('reduces odd directives and blocked values to safe labels', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    await post(JSON.stringify({ 'csp-report': { 'violated-directive': 'style-src-attr \'self\'', 'blocked-uri': 'blob:https://seanshore.in/7a1b' } }))
    await post(JSON.stringify({ 'csp-report': { 'effective-directive': '<script>', 'blocked-uri': 'not a url with spaces/and?query=1' } }))
    vi.advanceTimersByTime(CSP_REPORT_FLUSH_INTERVAL_MS)
    expect(summaries(log)[0]?.violations).toEqual([
      { directive: 'style-src-attr', blocked: 'blob', source: 'none', section: 'api', count: 1 },
      { directive: 'other', blocked: 'other', source: 'none', section: 'api', count: 1 },
    ])
  })

  it('reads the page reporter batches (Round P3), capped per request', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const violations = [
      { directive: 'style-src-attr', blocked: 'inline' },
      { directive: 'img-src', blocked: 'https://cdn.example.com' },
      ...Array.from({ length: 30 }, () => ({ directive: 'connect-src', blocked: 'wss://rt.example.com' })),
    ]
    expect((await post(JSON.stringify({ violations }))).status).toBe(204)
    vi.advanceTimersByTime(CSP_REPORT_FLUSH_INTERVAL_MS)
    expect(summaries(log)).toEqual([expect.objectContaining({
      total: 20,
      violations: [
        { directive: 'connect-src', blocked: 'rt.example.com', source: 'none', section: 'other', count: 18 },
        { directive: 'style-src-attr', blocked: 'inline', source: 'none', section: 'other', count: 1 },
        { directive: 'img-src', blocked: 'cdn.example.com', source: 'none', section: 'other', count: 1 },
      ],
    })])
    expect(summaries(log)[0]).not.toHaveProperty('rateLimited')
  })

  it('keeps the source by origin only and the section from a fixed list (Round P3, enforcement prep)', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const violations = [
      { directive: 'script-src', blocked: 'eval', source: 'extension', section: 'jobs' },
      { directive: 'script-src', blocked: 'wasm-eval', source: 'https://sdk.cashfree.com', section: 'payments' },
      { directive: 'script-src', blocked: 'eval', source: 'https://sdk.cashfree.com/js/v3/cashfree.js?session=secret', section: 'payments' },
      { directive: 'connect-src', blocked: 'https://auth.seanshore.in', source: 'self', section: 'learn' },
      { directive: 'frame-src', blocked: 'none', source: 'javascript:alert(1)', section: 'courses-11111111-1111' },
      { directive: 'script-src-attr', blocked: 'inline', source: { not: 'a string' }, section: 42 },
    ]
    expect((await post(JSON.stringify({ violations }))).status).toBe(204)
    vi.advanceTimersByTime(CSP_REPORT_FLUSH_INTERVAL_MS)
    expect(summaries(log)[0].violations).toEqual([
      { directive: 'script-src', blocked: 'eval', source: 'extension', section: 'jobs', count: 1 },
      { directive: 'script-src', blocked: 'wasm-eval', source: 'sdk.cashfree.com', section: 'payments', count: 1 },
      { directive: 'script-src', blocked: 'eval', source: 'sdk.cashfree.com', section: 'payments', count: 1 },
      { directive: 'connect-src', blocked: 'auth.seanshore.in', source: 'self', section: 'learn', count: 1 },
      { directive: 'frame-src', blocked: 'none', source: 'other', section: 'other', count: 1 },
      { directive: 'script-src-attr', blocked: 'inline', source: 'none', section: 'other', count: 1 },
    ])
    expect(JSON.stringify(summaries(log))).not.toMatch(/session|secret|cashfree\.js|alert|1111/)
  })

  it('rate-limits each visitor (Round P3) and counts what it turned away, without touching other visitors', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const report = JSON.stringify({ violations: [{ directive: 'script-src-elem', blocked: 'inline' }] })
    const flood = { 'x-forwarded-for': '203.0.113.9, 130.176.0.1' }
    for (let index = 0; index < CSP_REPORT_REQUESTS_PER_MINUTE + 12; index += 1) expect((await post(report, flood)).status).toBe(204)
    await post(JSON.stringify({ violations: [{ directive: 'img-src', blocked: 'data' }] }), { 'x-forwarded-for': '198.51.100.4, 130.176.0.1' })

    vi.advanceTimersByTime(CSP_REPORT_FLUSH_INTERVAL_MS)
    expect(summaries(log)).toEqual([expect.objectContaining({
      total: CSP_REPORT_REQUESTS_PER_MINUTE + 1,
      rateLimited: 12,
      violations: [
        { directive: 'script-src-elem', blocked: 'inline', source: 'none', section: 'other', count: CSP_REPORT_REQUESTS_PER_MINUTE },
        { directive: 'img-src', blocked: 'data', source: 'none', section: 'other', count: 1 },
      ],
    })])

    // The next minute the visitor is counted again.
    await post(report, flood)
    vi.advanceTimersByTime(CSP_REPORT_FLUSH_INTERVAL_MS)
    expect(summaries(log)[1]).toEqual(expect.objectContaining({ total: 1 }))
  })

  it('ignores other origins, oversized bodies and junk', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const report = JSON.stringify({ 'csp-report': { 'effective-directive': 'script-src', 'document-uri': 'https://seanshore.in/' } })
    expect((await post(report, { origin: 'https://evil.example.com' })).status).toBe(204)
    expect((await post('x'.repeat(20_000))).status).toBe(204)
    expect((await post('not json')).status).toBe(204)
    vi.advanceTimersByTime(CSP_REPORT_FLUSH_INTERVAL_MS)
    expect(log).not.toHaveBeenCalled()
  })
})
