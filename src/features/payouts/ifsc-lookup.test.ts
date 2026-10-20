import { describe, expect, it, vi } from 'vitest'
import { createIfscLookup, describeIfsc } from './ifsc-lookup'

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('IFSC lookup (hotfix P1)', () => {
  it('returns the bank and branch, sends only the IFSC, and caches the answer', async () => {
    const fetchImpl = vi.fn(async () => json(200, { BANK: 'HDFC Bank', IFSC: 'HDFC0000001', BRANCH: 'Fort', CITY: 'Mumbai' }))
    const lookup = createIfscLookup({ fetchImpl })
    const result = await lookup(' hdfc0000001 ')
    expect(result).toEqual({ status: 'found', bank: 'HDFC Bank', branch: 'Fort', city: 'Mumbai' })
    expect(describeIfsc(result)).toBe('HDFC Bank · Fort, Mumbai')
    await lookup('HDFC0000001')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl).toHaveBeenCalledWith('https://ifsc.razorpay.com/HDFC0000001', expect.objectContaining({ headers: { Accept: 'application/json' } }))
  })

  it('says not found only when the service is sure', async () => {
    expect(await createIfscLookup({ fetchImpl: async () => json(404, 'Not Found') })('HDFC0999999')).toEqual({ status: 'not_found' })
    expect(await createIfscLookup({ fetchImpl: vi.fn() })('HDFC1')).toEqual({ status: 'not_found' })
  })

  it('falls back to the bank from the first four letters when the service fails, so saving is not blocked', async () => {
    const down = createIfscLookup({ fetchImpl: async () => { throw new TypeError('fetch failed') } })
    expect(await down('SBIN0001234')).toEqual({ status: 'unavailable', bank: 'State Bank of India' })
    expect(describeIfsc(await down('SBIN0001234'))).toBe('State Bank of India')
    expect(await createIfscLookup({ fetchImpl: async () => json(500, {}) })('ZZZZ0001234')).toEqual({ status: 'unavailable', bank: null })
    // An answer for a different IFSC is not trusted.
    expect(await createIfscLookup({ fetchImpl: async () => json(200, { BANK: 'Other', IFSC: 'XXXX0000001' }) })('HDFC0000001')).toEqual({ status: 'unavailable', bank: 'HDFC Bank' })
  })
})
