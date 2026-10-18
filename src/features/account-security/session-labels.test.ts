import { describe, expect, it } from 'vitest'
import { approximateLocation, sessionRequestContext } from './request-context'
import { lastActiveLabel, sessionViews } from './session-labels'
import { summarizeUserAgent } from './user-agent'

const NOW = Date.parse('2026-10-18T06:00:00.000Z')

describe('device and location summaries (Round H, H3)', () => {
  it('summarizes common browsers and devices without keeping the raw user agent', () => {
    expect(summarizeUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36').summary).toBe('Chrome on Windows')
    expect(summarizeUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')).toMatchObject({ summary: 'Safari on iPhone', kind: 'phone' })
    expect(summarizeUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36').summary).toBe('Chrome on Android phone')
    expect(summarizeUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 Edg/129.0').summary).toBe('Edge on Mac')
    expect(summarizeUserAgent('Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0').summary).toBe('Firefox on Linux')
    expect(summarizeUserAgent('')).toMatchObject({ summary: null, kind: 'unknown' })
  })

  it('reads the approximate city and country only from CloudFront\'s viewer headers', () => {
    const headers = new Headers({
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/129.0',
      'cloudfront-viewer-city': 'Navi%20Mumbai',
      'cloudfront-viewer-country': 'in',
      'x-forwarded-for': '198.51.100.1, 203.0.113.5, 10.0.0.1',
    })
    expect(sessionRequestContext(headers)).toEqual({ userAgentSummary: 'Chrome on Windows', city: 'Navi Mumbai', country: 'IN', ip: '203.0.113.5' })
    expect(sessionRequestContext(new Headers())).toEqual({ userAgentSummary: null, city: null, country: null, ip: null })
    expect(approximateLocation('Navi Mumbai', 'IN')).toBe('Navi Mumbai, India')
    expect(approximateLocation(null, 'IN')).toBe('India')
    expect(approximateLocation(null, null)).toBeNull()
  })

  it('lists this device first with a "This device" flag, and says "Location unavailable" without a location', () => {
    const views = sessionViews([
      { id: 'other', createdAt: '2026-10-01T06:00:00.000Z', lastSeenAt: '2026-10-18T03:00:00.000Z', signInMethod: 'password', userAgentSummary: 'Safari on iPhone', approxCity: null, approxCountry: null },
      { id: 'mine', createdAt: '2026-10-10T06:00:00.000Z', lastSeenAt: '2026-10-18T05:59:00.000Z', signInMethod: 'password', userAgentSummary: 'Chrome on Windows', approxCity: 'Kochi', approxCountry: 'IN' },
    ], 'mine', NOW)
    expect(views).toEqual([
      { id: 'mine', device: 'Chrome on Windows', kind: 'computer', location: 'Kochi, India', lastActive: 'Active now', signedIn: 'Signed in 10 Oct 2026', current: true },
      { id: 'other', device: 'Safari on iPhone', kind: 'phone', location: 'Location unavailable', lastActive: 'Active 3 hours ago', signedIn: 'Signed in 1 Oct 2026', current: false },
    ])
    expect(lastActiveLabel('2026-10-01T06:00:00.000Z', NOW)).toBe('Active 1 Oct')
  })
})
