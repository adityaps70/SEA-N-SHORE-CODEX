import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./subscription-repository', () => ({ subscriptionRepository: { listActivePrices: vi.fn() } }))

import { loadPublicPlanPrices } from './public-prices'
import type { PlanPrice } from './subscription-types'

function price(overrides: Partial<PlanPrice>): PlanPrice {
  return {
    id: 'p', planCode: 'creator_pro', interval: 'month', amountMinor: 99900, currency: 'INR', active: true,
    providerPlanId: null, providerEnvironment: null, createdBy: null, createdAt: '2026-09-01T00:00:00Z', ...overrides,
  }
}

afterEach(() => vi.restoreAllMocks())

describe('loadPublicPlanPrices', () => {
  it('returns the active INR prices', async () => {
    const rows = [price({ id: 'a' }), price({ id: 'b', planCode: 'organization_pro', interval: 'year', amountMinor: 5000000 })]
    await expect(loadPublicPlanPrices({ listActivePrices: async () => rows })).resolves.toEqual({ prices: rows, available: true })
  })

  it('drops rows that must never be shown as a price', async () => {
    const rows = [price({ id: 'off', active: false }), price({ id: 'zero', amountMinor: 0 }), price({ id: 'frac', amountMinor: 1.5 })]
    await expect(loadPublicPlanPrices({ listActivePrices: async () => rows })).resolves.toEqual({ prices: [], available: false })
  })

  it('falls back without throwing when the database fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(loadPublicPlanPrices({ listActivePrices: async () => { throw new Error('connect ETIMEDOUT') } }))
      .resolves.toEqual({ prices: [], available: false })
    expect(error).toHaveBeenCalledWith('pricing_prices_unavailable', { message: 'connect ETIMEDOUT' })
  })

  it('stops waiting for a slow database so the public page stays fast', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    let rejectLate: (reason: Error) => void = () => {}
    const slow = new Promise<PlanPrice[]>((_, reject) => { rejectLate = reject })
    const started = Date.now()
    await expect(loadPublicPlanPrices({ listActivePrices: () => slow, timeoutMs: 20 })).resolves.toEqual({ prices: [], available: false })
    expect(Date.now() - started).toBeLessThan(1000)
    // A failure that arrives after the timeout is swallowed, never unhandled.
    rejectLate(new Error('late failure'))
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(error).toHaveBeenCalledTimes(1)
  })
})
