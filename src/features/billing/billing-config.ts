/**
 * Subscription settings. Server only. Cashfree keys themselves come from
 * features/payments/cashfree-config.ts (the same PG keys); nothing here is required.
 *
 *   CASHFREE_SUBSCRIPTION_CHARGE_MODE = auto | merchant   (default auto)
 *     auto:     Cashfree debits PERIODIC mandates on schedule by itself ("For periodic
 *               subscriptions, Cashfree automatically initiates payments on your behalf").
 *               We only record its webhooks.
 *     merchant: the billing job raises each renewal charge (POST /subscriptions/pay) about
 *               two days before it is due. Use only if a sandbox test shows Cashfree does
 *               not charge PERIODIC plans automatically on this account.
 *   CASHFREE_SUBSCRIPTION_PAYMENT_METHODS = comma list of upi, card, enach, pnach
 *               (default "upi,card,enach")
 *   BILLING_JOBS_SECRET = long random string; enables POST /api/billing/cashfree/jobs for
 *               a scheduler (Authorization: Bearer <secret>). Unset = route disabled.
 */

export type SubscriptionChargeMode = 'auto' | 'merchant'

type Environment = Record<string, string | undefined>

const ALLOWED_METHODS = ['upi', 'card', 'enach', 'pnach'] as const
const DEFAULT_METHODS = ['upi', 'card', 'enach']

export function subscriptionChargeMode(environment: Environment = process.env): SubscriptionChargeMode {
  return environment.CASHFREE_SUBSCRIPTION_CHARGE_MODE?.trim().toLowerCase() === 'merchant' ? 'merchant' : 'auto'
}

export function subscriptionPaymentMethods(environment: Environment = process.env): string[] {
  const configured = (environment.CASHFREE_SUBSCRIPTION_PAYMENT_METHODS ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter((value): value is typeof ALLOWED_METHODS[number] => (ALLOWED_METHODS as readonly string[]).includes(value))
  return configured.length ? [...new Set(configured)] : [...DEFAULT_METHODS]
}

/** Absolute site URL (NEXT_PUBLIC_SITE_URL) for Cashfree's return_url, or null. */
export function siteUrlFromEnvironment(environment: Environment = process.env) {
  const value = environment.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, '')
  return value && /^https?:\/\//.test(value) ? value : null
}

export function billingJobsSecret(environment: Environment = process.env) {
  const value = environment.BILLING_JOBS_SECRET?.trim() ?? ''
  return value.length >= 24 ? value : null
}

/** Ids we send to Cashfree. All inside its alphabets and length limits. */
function compactUuid(uuid: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)) throw new RangeError('uuid_invalid')
  return uuid.replace(/-/g, '').toLowerCase()
}

/** Cashfree plan_id for one plan_prices row: "snsp_" + 32 hex (37 chars, limit 40). */
export function cashfreePlanIdFor(priceId: string) {
  return `snsp_${compactUuid(priceId)}`
}

/** Cashfree subscription_id for one subscription_checkouts row: "snss_" + 32 hex. */
export function cashfreeSubscriptionIdFor(checkoutId: string) {
  return `snss_${compactUuid(checkoutId)}`
}

export function isOurSubscriptionId(value: unknown): value is string {
  return typeof value === 'string' && /^snss_[0-9a-f]{32}$/.test(value)
}

export function checkoutIdFromSubscriptionId(value: string): string | null {
  const match = /^snss_([0-9a-f]{32})$/.exec(value)
  if (!match) return null
  const hex = match[1]!
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** Our payment_id for renewal number `cycle` of a checkout: "sc" + 32 hex + cycle (<= 40 chars). */
export function chargePaymentIdFor(checkoutId: string, cycle: number) {
  if (!Number.isInteger(cycle) || cycle < 1 || cycle > 999999) throw new RangeError('cycle_invalid')
  return `sc${compactUuid(checkoutId)}${cycle}`
}
