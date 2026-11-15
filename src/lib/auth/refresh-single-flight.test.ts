import { describe, expect, it, vi } from 'vitest'
import { CognitoApiError, type CognitoAuthenticationResult } from './cognito-api'
import { createRefreshSingleFlight, renewalTokenHash, type SharedRenewal, type SharedRenewalStore } from './refresh-single-flight'

function result(refreshToken: string): CognitoAuthenticationResult {
  return { accessToken: `access-${refreshToken}`, refreshToken, expiresIn: 3600 }
}

/** An in-memory shared store, standing in for the database one (features/account-security/refresh-renewals). */
function memoryStore() {
  const rows = new Map<string, CognitoAuthenticationResult | null>()
  const store: SharedRenewalStore = {
    read: vi.fn(async (tokenHash: string): Promise<SharedRenewal> => {
      if (!rows.has(tokenHash)) return { state: 'none' }
      const authentication = rows.get(tokenHash)
      return authentication ? { state: 'ready', authentication } : { state: 'pending' }
    }),
    claim: vi.fn(async (tokenHash: string) => {
      if (rows.has(tokenHash)) return false
      rows.set(tokenHash, null)
      return true
    }),
    publish: vi.fn(async (tokenHash: string, authentication: CognitoAuthenticationResult) => {
      rows.set(tokenHash, authentication)
    }),
    release: vi.fn(async (tokenHash: string) => {
      rows.delete(tokenHash)
    }),
  }
  return { rows, store }
}

const noSleep = async () => undefined

describe('one renewal per refresh token', () => {
  it('shares one Cognito renewal between requests on the same server that carry the same token', async () => {
    const renew = createRefreshSingleFlight()
    const refresh = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      return result('r2')
    })
    const results = await Promise.all([renew('r1', refresh), renew('r1', refresh), renew('r1', refresh)])
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(new Set(results.map((r) => r.refreshToken))).toEqual(new Set(['r2']))
  })

  it('renews again after the 60-second share ends, and never mixes different tokens', async () => {
    let now = 0
    const renew = createRefreshSingleFlight({ now: () => now })
    const refresh = vi.fn(async () => result(`n${refresh.mock.calls.length}`))
    await renew('r1', refresh)
    await renew('other', refresh)
    expect(refresh).toHaveBeenCalledTimes(2)
    now += 59_000
    await renew('r1', refresh)
    expect(refresh).toHaveBeenCalledTimes(2)
    now += 2_000
    await renew('r1', refresh)
    expect(refresh).toHaveBeenCalledTimes(3)
  })

  it('does not keep a failed renewal: every waiting request gets the same refusal, and the next one asks again', async () => {
    const renew = createRefreshSingleFlight()
    const refresh = vi.fn(async () => {
      throw new CognitoApiError('NotAuthorizedException')
    })
    const settled = await Promise.allSettled([renew('r1', refresh), renew('r1', refresh)])
    expect(settled.every((s) => s.status === 'rejected')).toBe(true)
    expect(refresh).toHaveBeenCalledTimes(1)
    await expect(renew('r1', refresh)).rejects.toThrow()
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it('a second server uses the renewal the first one left in the shared store', async () => {
    const { store } = memoryStore()
    const serverA = createRefreshSingleFlight({ shared: store, sleep: noSleep })
    const serverB = createRefreshSingleFlight({ shared: store, sleep: noSleep })
    const refreshA = vi.fn(async () => result('r2'))
    const refreshB = vi.fn(async () => result('r3'))
    expect((await serverA('r1', refreshA)).refreshToken).toBe('r2')
    expect((await serverB('r1', refreshB)).refreshToken).toBe('r2')
    expect(refreshA).toHaveBeenCalledTimes(1)
    expect(refreshB).not.toHaveBeenCalled()
    // The store holds only hashes as keys.
    expect(store.claim).toHaveBeenCalledWith(renewalTokenHash('r1'))
  })

  it('a server that finds the renewal in flight elsewhere waits for it instead of renewing', async () => {
    const { rows, store } = memoryStore()
    const tokenHash = renewalTokenHash('r1')
    rows.set(tokenHash, null)
    let polls = 0
    const serverB = createRefreshSingleFlight({
      shared: store,
      sleep: async () => {
        polls += 1
        if (polls === 3) rows.set(tokenHash, result('r2'))
      },
    })
    const refreshB = vi.fn(async () => result('r3'))
    expect((await serverB('r1', refreshB)).refreshToken).toBe('r2')
    expect(refreshB).not.toHaveBeenCalled()
  })

  it('renews itself when the other server gives up (claim released) or does not answer in time', async () => {
    const { rows, store } = memoryStore()
    const tokenHash = renewalTokenHash('r1')
    rows.set(tokenHash, null)
    const released = createRefreshSingleFlight({ shared: store, sleep: async () => { rows.delete(tokenHash) } })
    const refresh = vi.fn(async () => result('r3'))
    expect((await released('r1', refresh)).refreshToken).toBe('r3')

    const { rows: stuckRows, store: stuck } = memoryStore()
    stuckRows.set(renewalTokenHash('r9'), null)
    const timedOut = createRefreshSingleFlight({ shared: stuck, sleep: noSleep, waitMs: 300, pollMs: 100 })
    const refreshStuck = vi.fn(async () => result('r10'))
    expect((await timedOut('r9', refreshStuck)).refreshToken).toBe('r10')
    expect(stuck.read).toHaveBeenCalledTimes(4)
  })

  it('when the shared store fails, the request renews as before and only the stage is logged', async () => {
    const warn = vi.fn()
    const broken: SharedRenewalStore = {
      read: async () => { throw new Error('relation "public.auth_refresh_renewals" does not exist') },
      claim: async () => { throw new Error('down') },
      publish: async () => { throw new Error('down') },
      release: async () => { throw new Error('down') },
    }
    const renew = createRefreshSingleFlight({ shared: broken, warn, sleep: noSleep })
    const refresh = vi.fn(async () => result('secret-new-token'))
    expect((await renew('secret-old-token', refresh)).refreshToken).toBe('secret-new-token')
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith('[auth_renewal_share_unavailable]', { stage: 'read' })
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/secret/)

    // A store that reads but cannot publish still returns the renewal.
    const { store } = memoryStore()
    store.publish = async () => { throw new Error('down') }
    const partial = createRefreshSingleFlight({ shared: store, warn, sleep: noSleep })
    expect((await partial('r1', async () => result('r2'))).refreshToken).toBe('r2')
  })

  it('a failed renewal releases its claim so other servers renew themselves', async () => {
    const { rows, store } = memoryStore()
    const renew = createRefreshSingleFlight({ shared: store, sleep: noSleep })
    await expect(renew('r1', async () => { throw new CognitoApiError('RefreshTokenReuseException') })).rejects.toThrow()
    expect(store.release).toHaveBeenCalledWith(renewalTokenHash('r1'))
    expect(rows.size).toBe(0)
  })
})
