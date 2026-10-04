import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlanPrice } from './subscription-types'

// Round 14 (3.8): the public pages' plan-price cache (5 minutes, tag "plan-prices") and the admin
// price change that expires it.
const mocks = vi.hoisted(() => ({
  unstableCache: vi.fn(),
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
  listActivePrices: vi.fn(),
  requireAdmin: vi.fn(),
  withTransaction: vi.fn(),
  replacePlanPrice: vi.fn(),
}))

vi.mock('next/cache', () => ({
  unstable_cache: mocks.unstableCache,
  revalidateTag: mocks.revalidateTag,
  revalidatePath: mocks.revalidatePath,
}))
vi.mock('@/lib/db/client', () => ({ withTransaction: mocks.withTransaction }))
vi.mock('@/features/admin/access', () => ({ requirePlatformAdministratorUser: mocks.requireAdmin }))
vi.mock('./subscription-repository', async () => {
  class PlanPriceError extends Error {
    constructor(readonly code: 'price_invalid' | 'price_unchanged') {
      super(code)
    }
  }
  return {
    PlanPriceError,
    endManualSubscription: vi.fn(),
    replacePlanPrice: mocks.replacePlanPrice,
    subscriptionRepository: { listActivePrices: mocks.listActivePrices },
  }
})
vi.mock('./trial-service', () => ({ trialService: {} }))
vi.mock('./subscription-service', () => ({
  BillingGatewayError: class extends Error {},
  BillingNotConfiguredError: class extends Error {},
  NothingToCancelError: class extends Error {},
  billingPaths: () => [],
  subscriptionService: {},
}))

const PRICE: PlanPrice = {
  id: 'price-1', planCode: 'creator_pro', interval: 'month', amountMinor: 99900, currency: 'INR', active: true,
  providerPlanId: null, providerEnvironment: null, createdBy: null, createdAt: '2026-09-01T00:00:00Z',
}

beforeEach(() => {
  vi.resetModules()
  mocks.unstableCache.mockImplementation((fn: () => unknown) => fn)
  mocks.listActivePrices.mockResolvedValue([PRICE])
  mocks.requireAdmin.mockResolvedValue({ id: 'admin-1' })
  mocks.withTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn({}))
  mocks.replacePlanPrice.mockResolvedValue({ ...PRICE, amountMinor: 120000 })
})

afterEach(() => vi.clearAllMocks())

describe('plan price cache', () => {
  it('caches the active-price read for five minutes under the plan-prices tag, shared by every visitor', async () => {
    const { listCachedActivePrices, PLAN_PRICES_CACHE_SECONDS, PLAN_PRICES_CACHE_TAG } = await import('./plan-price-cache')

    expect(PLAN_PRICES_CACHE_TAG).toBe('plan-prices')
    expect(PLAN_PRICES_CACHE_SECONDS).toBe(300)
    expect(mocks.unstableCache).toHaveBeenCalledTimes(1)
    const [loader, keyParts, options] = mocks.unstableCache.mock.calls[0]
    expect(loader).toBeTypeOf('function')
    // A constant key: no viewer, cookie or request data reaches the cached read.
    expect(keyParts).toEqual(['billing', 'active-plan-prices', 'v1'])
    expect(options).toEqual({ tags: ['plan-prices'], revalidate: 300 })
    expect(loader).toHaveLength(0)

    await expect(listCachedActivePrices()).resolves.toEqual([PRICE])
    expect(mocks.listActivePrices).toHaveBeenCalledWith()
  })

  it('lets a failed read throw (so it is not cached) and the public loader falls back', async () => {
    mocks.listActivePrices.mockRejectedValue(new Error('connect ETIMEDOUT'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { listCachedActivePrices } = await import('./plan-price-cache')
    await expect(listCachedActivePrices()).rejects.toThrow('connect ETIMEDOUT')

    const { loadPublicPlanPrices } = await import('./public-prices')
    await expect(loadPublicPlanPrices()).resolves.toEqual({ prices: [], available: false })
    error.mockRestore()
  })

  it('serves the public landing and pricing pages from the cached read by default', async () => {
    const cached = vi.fn(async () => [PRICE])
    mocks.unstableCache.mockImplementation(() => cached)
    const { loadPublicPlanPrices } = await import('./public-prices')

    await expect(loadPublicPlanPrices()).resolves.toEqual({ prices: [PRICE], available: true })
    expect(cached).toHaveBeenCalledTimes(1)
    expect(mocks.listActivePrices).not.toHaveBeenCalled()
  })

  it('expires the tag at once (no stale prices) when asked to revalidate', async () => {
    const { revalidatePlanPrices } = await import('./plan-price-cache')
    revalidatePlanPrices()
    expect(mocks.revalidateTag).toHaveBeenCalledExactlyOnceWith('plan-prices', { expire: 0 })
  })
})

describe('admin price change', () => {
  it('revalidates the plan-prices tag after a new price is saved', async () => {
    const { updatePlanPriceAction } = await import('./admin-actions')
    const result = await updatePlanPriceAction({ plan: 'creator_pro', interval: 'month', amount: '1200' })

    expect(result.ok).toBe(true)
    expect(mocks.replacePlanPrice).toHaveBeenCalledWith({}, { plan: 'creator_pro', interval: 'month', amountMinor: 120000, adminId: 'admin-1' })
    expect(mocks.revalidateTag).toHaveBeenCalledExactlyOnceWith('plan-prices', { expire: 0 })
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/plans')
  })

  it('leaves the cache alone when nothing was changed', async () => {
    const { PlanPriceError } = await import('./subscription-repository')
    mocks.replacePlanPrice.mockRejectedValue(new PlanPriceError('price_unchanged'))
    const { updatePlanPriceAction } = await import('./admin-actions')

    await expect(updatePlanPriceAction({ plan: 'creator_pro', interval: 'month', amount: '999' })).resolves.toMatchObject({ ok: false })
    await expect(updatePlanPriceAction({ plan: 'creator_pro', interval: 'month', amount: 'abc' })).resolves.toMatchObject({ ok: false })
    mocks.requireAdmin.mockRejectedValue(new Error('forbidden'))
    await expect(updatePlanPriceAction({ plan: 'creator_pro', interval: 'month', amount: '1200' })).resolves.toMatchObject({ ok: false })
    expect(mocks.revalidateTag).not.toHaveBeenCalled()
  })
})
