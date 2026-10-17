import { describe, expect, it } from 'vitest'
import { hashSupportIp, supportIpHashFromHeaders, supportIpHashKey } from './request-context'

const SECRET = 'placeholder-secret-placeholder-secret-0001'

describe('support IP hash (round H, H7)', () => {
  it('hashes the trusted client IP with a key of its own, and never returns the IP', () => {
    const key = supportIpHashKey(SECRET)!
    const hash = hashSupportIp('203.0.113.7', key)
    expect(hash).toMatch(/^[0-9a-f]{32}$/)
    expect(hash).not.toContain('203')
    expect(hashSupportIp('203.0.113.7', key)).toBe(hash)
    expect(hashSupportIp('203.0.113.8', key)).not.toBe(hash)
    const headers = new Headers({ 'x-forwarded-for': '198.51.100.1, 203.0.113.7, 10.0.0.1' })
    expect(supportIpHashFromHeaders(headers, SECRET)).toBe(hash)
  })

  it('has no hash without a usable secret or IP', () => {
    expect(supportIpHashKey('short')).toBeNull()
    expect(supportIpHashKey(null)).toBeNull()
    expect(hashSupportIp(null, supportIpHashKey(SECRET))).toBeNull()
    expect(supportIpHashFromHeaders(new Headers(), SECRET)).toBeNull()
  })
})
