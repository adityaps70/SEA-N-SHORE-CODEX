import { revalidateTag, unstable_cache } from 'next/cache'
import { subscriptionRepository } from './subscription-repository'
import type { PlanPrice } from './subscription-types'

/**
 * Round 14 (3.8): the public landing and /pricing pages read active plan prices from a shared
 * five-minute cache instead of the database on every request. Plan prices are the same for every
 * visitor (nothing user-specific is cached). Signed-in billing pages and checkout keep reading the
 * database directly, so the price charged is always the current one.
 *
 * The cache lives in each web task's Next.js data cache: an admin price change expires it at once
 * on the task that handled the change; other tasks pick it up within the five minutes.
 */
export const PLAN_PRICES_CACHE_TAG = 'plan-prices'
export const PLAN_PRICES_CACHE_SECONDS = 300

export function createCachedActivePrices(
  cache: typeof unstable_cache = unstable_cache,
  listActivePrices: () => Promise<PlanPrice[]> = () => subscriptionRepository.listActivePrices(),
): () => Promise<PlanPrice[]> {
  // A failed read throws and is not cached; the next request tries the database again.
  return cache(() => listActivePrices(), ['billing', 'active-plan-prices', 'v1'], {
    tags: [PLAN_PRICES_CACHE_TAG],
    revalidate: PLAN_PRICES_CACHE_SECONDS,
  })
}

export const listCachedActivePrices = createCachedActivePrices()

/** Call after any change to plan_prices. The next public page view reads the new prices. */
export function revalidatePlanPrices(revalidate: typeof revalidateTag = revalidateTag) {
  revalidate(PLAN_PRICES_CACHE_TAG, { expire: 0 })
}
