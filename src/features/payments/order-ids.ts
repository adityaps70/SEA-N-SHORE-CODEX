import type { PaymentPurpose } from './types'

/**
 * Gateway order ids. Every order we send to a gateway gets an id that starts with
 * its purpose, so a webhook can be routed without a database lookup:
 *   evt_  event tickets      crs_  paid courses      pln_  membership plans (reserved)
 * Format: prefix + our order uuid without dashes = 36 characters, inside Cashfree's
 * 3..45 character limit and its [A-Za-z0-9_-] alphabet.
 */
export const PAYMENT_ORDER_PREFIXES = {
  event: 'evt_',
  course: 'crs_',
  plan: 'pln_',
} as const satisfies Record<PaymentPurpose, string>

export type PaymentOrderPrefix = typeof PAYMENT_ORDER_PREFIXES[PaymentPurpose]

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const GATEWAY_ORDER_ID = /^[A-Za-z0-9_-]{3,45}$/

function compactUuid(uuid: string) {
  if (!UUID.test(uuid)) throw new RangeError('order_uuid_invalid')
  return uuid.replace(/-/g, '').toLowerCase()
}

/** "evt_" + 32 hex characters for an event order uuid. */
export function gatewayOrderId(purpose: PaymentPurpose, orderUuid: string) {
  return `${PAYMENT_ORDER_PREFIXES[purpose]}${compactUuid(orderUuid)}`
}

export function isGatewayOrderId(value: unknown): value is string {
  return typeof value === 'string' && GATEWAY_ORDER_ID.test(value)
}

/** The purpose encoded in a gateway order id, or null for ids we did not create. */
export function purposeOfGatewayOrderId(value: string): PaymentPurpose | null {
  for (const [purpose, prefix] of Object.entries(PAYMENT_ORDER_PREFIXES) as [PaymentPurpose, string][]) {
    if (value.startsWith(prefix)) return purpose
  }
  return null
}

/** Our order uuid back from "evt_<32 hex>", or null when the id has another shape. */
export function orderUuidFromGatewayOrderId(value: string): string | null {
  const match = /^[a-z]{3}_([0-9a-f]{32})$/.exec(value)
  if (!match) return null
  const hex = match[1]!
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * Our refund id for the n-th refund attempt of an order: "rf" + 32 hex + attempt
 * (1..20), at most 36 characters and alphanumeric only, as Cashfree requires.
 */
export function refundIdFor(orderUuid: string, attempt: number) {
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > 20) throw new RangeError('refund_attempt_invalid')
  return `rf${compactUuid(orderUuid)}${attempt}`
}

/** Cashfree customer_id: alphanumeric only, 3..50 characters. */
export function gatewayCustomerId(profileId: string) {
  const compact = profileId.replace(/[^A-Za-z0-9]/g, '')
  return compact.length >= 3 ? compact.slice(0, 50) : `sns${compact}`.padEnd(3, '0')
}
