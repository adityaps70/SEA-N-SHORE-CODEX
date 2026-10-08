import { describe, expect, it } from 'vitest'
import { trustedClientIp } from './client-ip'

const headers = (value: string | null) => ({ get: (name: string) => (name === 'x-forwarded-for' ? value : null) })

describe('trustedClientIp', () => {
  it('takes the address CloudFront appended (second to last), not client-sent entries', () => {
    expect(trustedClientIp(headers('198.51.100.9, 203.0.113.7, 130.176.1.1'))).toBe('203.0.113.7')
    expect(trustedClientIp(headers('1.1.1.1, 2.2.2.2, 203.0.113.7, 130.176.1.1'))).toBe('203.0.113.7')
    expect(trustedClientIp(headers('2001:db8::1, 130.176.1.1'))).toBe('2001:db8::1')
  })

  it('falls back to a single entry and rejects junk', () => {
    expect(trustedClientIp(headers('203.0.113.7'))).toBe('203.0.113.7')
    expect(trustedClientIp(headers(null))).toBeNull()
    expect(trustedClientIp(headers('evil<script>, 130.176.1.1'))).toBeNull()
  })
})
