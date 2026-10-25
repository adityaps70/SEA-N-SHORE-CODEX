// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/site-url', () => ({ siteUrlFor: (path: string) => new URL(path, 'https://seanshore.in') }))

import { GET } from './route'

afterEach(() => vi.useRealTimers())

describe('security.txt (Round H, H4)', () => {
  it('publishes the contact, a one-year expiry, the language and the canonical address as plain text', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-17T14:30:00Z'))
    const response = GET()
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    const text = await response.text()
    expect(text).toBe([
      'Contact: mailto:info@beaufortmarine.in',
      'Expires: 2027-10-17T00:00:00.000Z',
      'Preferred-Languages: en',
      'Canonical: https://seanshore.in/.well-known/security.txt',
      '',
    ].join('\n'))
  })

  it('always expires about a year ahead, in RFC 3339 form', async () => {
    const text = await GET().text()
    const expires = /^Expires: (\S+)$/m.exec(text)?.[1] ?? ''
    expect(expires).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    const days = (Date.parse(expires) - Date.now()) / (24 * 60 * 60 * 1000)
    expect(days).toBeGreaterThan(363)
    expect(days).toBeLessThanOrEqual(365)
  })
})
