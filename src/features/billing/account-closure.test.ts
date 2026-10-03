import { describe, expect, it, vi } from 'vitest'
import { stopAutoRenewForClosingAccount } from './account-closure'
import { NothingToCancelError } from './subscription-service'

const profileId = '33333333-3333-4333-8333-333333333333'

describe('stopping auto-renew before an account is deleted', () => {
  it('cancels every open mandate the member set up, keeping access already paid for', async () => {
    const query = vi.fn(async () => [{ id: 'checkout-1' }, { id: 'checkout-2' }])
    const getCheckout = vi.fn(async (id: string) => ({ id }) as never)
    const cancelCheckout = vi.fn(async () => ({}) as never)
    await expect(stopAutoRenewForClosingAccount(profileId, { query, getCheckout, cancelCheckout })).resolves.toEqual({ cancelled: 2 })
    const [sql, values] = query.mock.calls[0] as unknown as [string, unknown[]]
    expect(sql).toContain('(profile_id = $1 or created_by = $1)')
    expect(sql).toContain("status in ('pending_approval', 'active', 'on_hold', 'paused')")
    expect(values).toEqual([profileId])
    expect(cancelCheckout).toHaveBeenCalledWith({ id: 'checkout-1' }, { actorProfileId: profileId, actorType: 'member', endNow: false })
    expect(cancelCheckout).toHaveBeenCalledTimes(2)
  })

  it('treats a mandate with nothing left to cancel as done, and stops on any other failure', async () => {
    const query = vi.fn(async () => [{ id: 'checkout-1' }])
    const getCheckout = vi.fn(async (id: string) => ({ id }) as never)
    await expect(stopAutoRenewForClosingAccount(profileId, {
      query, getCheckout, cancelCheckout: vi.fn(async () => { throw new NothingToCancelError() }),
    })).resolves.toEqual({ cancelled: 1 })
    await expect(stopAutoRenewForClosingAccount(profileId, {
      query, getCheckout, cancelCheckout: vi.fn(async () => { throw new Error('billing_gateway_error') }),
    })).rejects.toThrow('billing_gateway_error')
  })
})
