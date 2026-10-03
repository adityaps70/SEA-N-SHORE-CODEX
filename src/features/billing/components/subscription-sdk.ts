'use client'

import { loadCashfreeCheckout } from '@/features/payments/components/gateway-checkout'

/**
 * Opens Cashfree's hosted auto-pay (mandate) approval with the JS SDK v3:
 *   Cashfree({ mode }).subscriptionsCheckout({ subsSessionId, redirectTarget })
 * The documented target is "_blank" (a new tab); "_self" is offered as a fallback when
 * the new tab could not open. The result is never proof of anything: the page then asks
 * the server, which asks Cashfree.
 */

export type SubscriptionRedirectTarget = '_blank' | '_self'

export type SubscriptionCheckoutOutcome =
  /** The approval page opened (new tab) or this tab is being sent to it. */
  | { outcome: 'opened'; target: SubscriptionRedirectTarget }
  /** Cashfree reported an error (window blocked or closed, session expired…). */
  | { outcome: 'error'; message: string | null }
  /** The Cashfree script could not load. Nothing was charged. */
  | { outcome: 'unavailable' }

type SubscriptionsCheckoutResult = { error?: { message?: string }; redirect?: boolean } | undefined

type CashfreeWithSubscriptions = {
  subscriptionsCheckout?: (options: { subsSessionId: string; redirectTarget: SubscriptionRedirectTarget }) => Promise<SubscriptionsCheckoutResult>
}

export async function openSubscriptionCheckout(input: {
  subscriptionSessionId: string
  mode: 'sandbox' | 'production'
  target: SubscriptionRedirectTarget
}): Promise<SubscriptionCheckoutOutcome> {
  let factory: Awaited<ReturnType<typeof loadCashfreeCheckout>>
  try {
    factory = await loadCashfreeCheckout()
  } catch {
    return { outcome: 'unavailable' }
  }
  try {
    const cashfree = factory({ mode: input.mode }) as unknown as CashfreeWithSubscriptions
    if (typeof cashfree.subscriptionsCheckout !== 'function') return { outcome: 'unavailable' }
    const result = await cashfree.subscriptionsCheckout({ subsSessionId: input.subscriptionSessionId, redirectTarget: input.target })
    if (result?.error) return { outcome: 'error', message: result.error.message ?? null }
    return { outcome: 'opened', target: input.target }
  } catch (error) {
    return { outcome: 'error', message: error instanceof Error ? error.message : null }
  }
}
