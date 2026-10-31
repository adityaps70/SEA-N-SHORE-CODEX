// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cspBlockedHost, cspDirectiveName, flushCspViolationSummary, recordCspViolation } from './csp-report-summary'

afterEach(() => {
  flushCspViolationSummary()
  vi.restoreAllMocks()
})

describe('CSP violation summary (Round H, H4)', () => {
  it('keeps only hosts, schemes and short keywords', () => {
    expect(cspBlockedHost('https://cdn.example.com/a/b.js?token=1#x')).toBe('cdn.example.com')
    expect(cspBlockedHost('data:image/png;base64,AAAA')).toBe('data')
    expect(cspBlockedHost('inline')).toBe('inline')
    expect(cspBlockedHost('eval')).toBe('eval')
    expect(cspBlockedHost('/relative/path?q=1')).toBe('other')
    expect(cspBlockedHost(undefined)).toBe('none')
    expect(cspDirectiveName('script-src-elem')).toBe('script-src-elem')
    expect(cspDirectiveName("img-src 'self' data:")).toBe('img-src')
    expect(cspDirectiveName('x'.repeat(80))).toBe('other')
  })

  it('caps the distinct keys kept in one window', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    for (let index = 0; index < 150; index += 1) recordCspViolation('img-src', `host-${index}.example`)
    flushCspViolationSummary()
    const summary = JSON.parse(String(log.mock.calls[0]?.[0]))
    expect(summary.total).toBe(150)
    expect(summary.violations).toHaveLength(101)
    expect(summary.violations[0]).toEqual({ directive: 'other', blocked: 'other', source: 'other', section: 'other', count: 50 })
  })

  it('writes nothing for an empty window', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    flushCspViolationSummary()
    expect(log).not.toHaveBeenCalled()
  })
})
