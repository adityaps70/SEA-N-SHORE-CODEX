import { describe, expect, it } from 'vitest'
import {
  createLoadTestAccounts, createRateLimiter, isLoadTestEmail, loadTestActivation, loadTestEmail, mapLimit,
  LOAD_TEST_ACCOUNT_CONCURRENCY, LOAD_TEST_ACCOUNT_COUNT, LOAD_TEST_COGNITO_CALLS_PER_SECOND, LOAD_TEST_FOLLOWS_PER_ACCOUNT,
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

  it('spaces Cognito calls to at most 8 a second, in order', async () => {
    expect(LOAD_TEST_COGNITO_CALLS_PER_SECOND).toBe(8)
    // Five calls asked for at once (the clock stands still): each waits one more gap than the one before it.
    const waits: number[] = []
    const limited = createRateLimiter(8, () => 0, async (ms) => { waits.push(ms) })
    expect(await Promise.all(Array.from({ length: 5 }, (_, i) => limited(async () => i)))).toEqual([0, 1, 2, 3, 4])
    expect(waits).toEqual([125, 250, 375, 500])
    // Once time has passed the schedule, a call goes straight through.
    let clock = 0
    const later = createRateLimiter(8, () => clock, async (ms) => { waits.push(ms) })
    await later(async () => 1)
    clock = 1000
    waits.length = 0
    await later(async () => 2)
    expect(waits).toEqual([])
    expect(() => createRateLimiter(0)).toThrow('rate_invalid')
  })

  it('lists the test users once (paged) instead of looking each one up, and signs out or deletes only those present', async () => {
    const calls: string[] = []
    const present = new Map([[loadTestEmail(2), 'sub-2'], [loadTestEmail(5), 'sub-5'], ['loadtest-0003@example.com', 'not-ours']])
    const deps = {
      query: async () => [{ profiles: 0, communities: 0, follows: 0, mixed_follows: 0, posts: 0 }],
      transaction: async () => { throw new Error('no transaction expected') },
      cognito: {
        listLoadTestUsers: async () => { calls.push('list'); return new Map(present) },
        createUser: async () => { throw new Error('no create expected') },
        setPassword: async () => undefined,
        signIn: async () => ({ accessToken: 'a', refreshToken: 'r' }),
        deleteUser: async (email: string) => { calls.push(`delete ${email}`) },
        globalSignOut: async (email: string) => { calls.push(`signout ${email}`) },
      },
      provisionProfile: async () => 'x',
      completeActivation: async () => undefined,
      accountCount: 10,
      cognitoCallsPerSecond: 100000,
      log: (line: string) => { calls.push(line) },
    }
    const accounts = createLoadTestAccounts(deps as never)
    await accounts.signOut()
    expect(calls.filter((c) => c === 'list')).toHaveLength(1)
    expect(calls.filter((c) => c.startsWith('signout')).sort()).toEqual([`signout ${loadTestEmail(2)}`, `signout ${loadTestEmail(5)}`])
    expect(calls).toContain('LOAD_TEST_SIGNED_OUT count=2')
    calls.length = 0
    await accounts.plan()
    expect(calls.filter((c) => c === 'list')).toHaveLength(1)
    expect(calls).toContain('LOAD_TEST_ACCOUNTS_COGNITO_USERS count=2 of=10')
  })
})

