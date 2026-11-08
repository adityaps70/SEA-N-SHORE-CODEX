import { loadCashfreeSettings, parseProviderPreference } from './cashfree-config'
import { createCashfreeGateway } from './cashfree'
import { cashfreeReportingFetch } from './cashfree-health'
import { loadRazorpayConfig } from './config'
import { createRazorpayGateway, type RazorpayGateway } from './razorpay'
import type { PaymentCurrency, PaymentGateway, PaymentProviderName } from './types'

/**
 * Which payment gateway new checkouts use. Server only.
 *
 * Cashfree is the live gateway. Razorpay is a backup that is only ever chosen by hand: new checkouts use it
 * only when RAZORPAY_CHECKOUTS_ENABLED is true in code AND PAYMENTS_PROVIDER (env) or "provider" in the
 * Cashfree secret says "razorpay" AND Razorpay is set up. Nothing switches to Razorpay on its own: when
 * Cashfree is not available (missing or unreadable secret), payments are off rather than moved to Razorpay.
 *
 * Existing orders are always confirmed and refunded through the gateway that created
 * them (getGatewayByName), whatever the current choice is.
 */

/**
 * The code switch for Razorpay checkouts (7 Nov 2026: off, Cashfree only). Turning it on needs the Content
 * Security Policy to allow Razorpay's checkout hosts in the same change: src/features/payments/
 * razorpay-csp.test.ts fails until it does (form-action does not allow Razorpay today).
 */
export const RAZORPAY_CHECKOUTS_ENABLED = false

export type PaymentCapabilities = {
  configured: boolean
  provider: PaymentProviderName | null
  /** Currencies buyers can pay in right now. Empty when payments are off. */
  currencies: PaymentCurrency[]
}

async function configuredGateways() {
  const [cashfree, razorpay] = await Promise.all([loadCashfreeSettings(), loadRazorpayConfig()])
  return {
    cashfree: cashfree.pg ? createCashfreeGateway(cashfree.pg, cashfreeReportingFetch('pg')) : null,
    razorpay: razorpay ? createRazorpayGateway(razorpay) : null,
    preferred: parseProviderPreference(process.env.PAYMENTS_PROVIDER) ?? cashfree.preferredProvider,
  }
}

export function chooseGateway<T extends { name: PaymentProviderName }>(input: {
  cashfree: T | null
  razorpay: T | null
  preferred: PaymentProviderName | null
  razorpayEnabled?: boolean
}): T | null {
  const razorpayEnabled = input.razorpayEnabled ?? RAZORPAY_CHECKOUTS_ENABLED
  if (razorpayEnabled && input.preferred === 'razorpay' && input.razorpay) return input.razorpay
  // Never a fallback to Razorpay: without Cashfree, payments are off.
  return input.cashfree
}

/** The gateway for new checkouts, or null when payments are not set up yet. */
export async function getPaymentGateway(): Promise<PaymentGateway | null> {
  return chooseGateway(await configuredGateways())
}

/** A specific gateway (for orders it created, and its webhook), or null when it is not set up. */
export async function getGatewayByName(name: 'razorpay'): Promise<RazorpayGateway | null>
export async function getGatewayByName(name: PaymentProviderName): Promise<PaymentGateway | null>
export async function getGatewayByName(name: PaymentProviderName): Promise<PaymentGateway | null> {
  const gateways = await configuredGateways()
  return name === 'cashfree' ? gateways.cashfree : gateways.razorpay
}

export async function getPaymentCapabilities(): Promise<PaymentCapabilities> {
  const gateway = await getPaymentGateway()
  return {
    configured: Boolean(gateway),
    provider: gateway?.name ?? null,
    currencies: gateway ? [...gateway.currencies] : [],
  }
}

export async function arePaymentsConfigured() {
  return Boolean(await getPaymentGateway())
}
