import { subscriptionRepository } from './subscription-repository'
import type { PlanPrice } from './subscription-types'

export type PublicPlanPrices = { prices: PlanPrice[]; available: boolean }

/** A public page must stay fast even when the database is slow or unreachable. */
export const PUBLIC_PRICES_TIMEOUT_MS = 4000

/**
 * Active plan prices for the public /pricing page. Never throws: when the prices cannot
 * be read in time, returns `available: false` so the page shows its fallback text.
 */
export async function loadPublicPlanPrices({
  listActivePrices = () => subscriptionRepository.listActivePrices(),
  timeoutMs = PUBLIC_PRICES_TIMEOUT_MS,
}: {
  listActivePrices?: () => Promise<PlanPrice[]>
  timeoutMs?: number
} = {}): Promise<PublicPlanPrices> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Timed out reading plan prices')), timeoutMs)
  })
  const read = Promise.resolve().then(listActivePrices)
  // If the timeout wins, a later rejection of the read must not become unhandled.
  read.catch(() => undefined)

  try {
    const rows = await Promise.race([read, timeout])
    const prices = rows.filter((price) => price.active !== false && price.currency === 'INR' && Number.isInteger(price.amountMinor) && price.amountMinor > 0)
    return { prices, available: prices.length > 0 }
  } catch (error) {
    console.error('pricing_prices_unavailable', { message: error instanceof Error ? error.message : null })
    return { prices: [], available: false }
  } finally {
    if (timer) clearTimeout(timer)
  }
}
