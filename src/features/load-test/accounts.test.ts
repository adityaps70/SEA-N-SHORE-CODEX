import { describe, expect, it } from 'vitest'
import {
  isLoadTestEmail, loadTestActivation, loadTestEmail, mapLimit,
  LOAD_TEST_ACCOUNT_CONCURRENCY, LOAD_TEST_ACCOUNT_COUNT, LOAD_TEST_FOLLOWS_PER_ACCOUNT,
} from './accounts'

describe('load-test accounts at 1,000 (owner, 18 Nov)', () => {
  it('makes 1,000 accounts, each following the next 49, at most 4 calls at a time', () => {
    expect(LOAD_TEST_ACCOUNT_COUNT).toBe(1000)
    expect(LOAD_TEST_FOLLOWS_PER_ACCOUNT).toBe(49)
    expect(LOAD_TEST_ACCOUNT_CONCURRENCY).toBe(4)
  })

  it('numbers them with four digits on the reserved .invalid domain, and accepts only those', () => {
    expect(loadTestEmail(1)).toBe('loadtest-0001@loadtest.seanshore.invalid')
    expect(loadTestEmail(1000)).toBe('loadtest-1000@loadtest.seanshore.invalid')
    expect(() => loadTestEmail(0)).toThrow('load_test_index_invalid')
    expect(() => loadTestEmail(1001)).toThrow('load_test_index_invalid')
    expect(isLoadTestEmail('loadtest-0007@loadtest.seanshore.invalid')).toBe(true)
    expect(isLoadTestEmail('LOADTEST-1000@loadtest.seanshore.invalid')).toBe(true)
    expect(isLoadTestEmail('loadtest-1001@loadtest.seanshore.invalid')).toBe(false)
    expect(isLoadTestEmail('loadtest-07@loadtest.seanshore.invalid')).toBe(false)
    expect(isLoadTestEmail('loadtest-0007@seanshore.in')).toBe(false)
    expect(loadTestActivation(42)).toMatchObject({ fullName: 'Load Test 0042', slug: 'sns-load-test-0042' })
  })

  it('mapLimit keeps the order and never runs more than the limit at once', async () => {
    let running = 0
    let peak = 0
    const out = await mapLimit(Array.from({ length: 25 }, (_, i) => i), 4, async (i) => {
      running += 1
      peak = Math.max(peak, running)
      await new Promise((resolve) => setTimeout(resolve, (i * 7) % 5))
      running -= 1
      return i * 2
    })
    expect(out).toEqual(Array.from({ length: 25 }, (_, i) => i * 2))
    expect(peak).toBe(4)
    await expect(mapLimit([1, 2, 3], 2, async (i) => { if (i === 2) throw new Error('boom'); return i })).rejects.toThrow('boom')
    expect(await mapLimit([], 4, async () => 1)).toEqual([])
  })
})
