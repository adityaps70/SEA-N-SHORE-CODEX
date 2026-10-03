import { loadCashfreeSettings, parseProviderPreference } from './cashfree-config'
import { createCashfreeGateway } from './cashfree'
import { loadRazorpayConfig } from './config'
import { createRazorpayGateway, type RazorpayGateway } from './razorpay'
import type { PaymentCurrency, PaymentGateway, PaymentProviderName } from './types'

/**
 * Which payment gateway new checkouts use. Server only.
 *
 * 1. PAYMENTS_PROVIDER (env) or "provider" in the Cashfree secret, when that gateway is set up.
 * 2. Otherwise Cashfree when set up, else Razorpay when set up, else none (payments off).
 *
 * Existing orders are always confirmed and refunded through the gateway that created
 * them (getGatewayByName), whatever the current choice is.
 */

export type PaymentCapabilities = {
  configured: boolean
  provider: PaymentProviderName | null
  /** Currencies buyers can pay in right now. Empty when payments are off. */
  currencies: PaymentCurrency[]
}

async function configuredGateways() {
  const [cashfree, razorpay] = await Promise.all([loadCashfreeSettings(), loadRazorpayConfig()])
  return {
    cashfree: cashfree.pg ? createCashfreeGateway(cashfree.pg) : null,
    razorpay: razorpay ? createRazorpayGateway(razorpay) : null,
    preferred: parseProviderPreference(process.env.PAYMENTS_PROVIDER) ?? cashfree.preferredProvider,
  }
}

export function chooseGateway<T extends { name: PaymentProviderName }>(input: {
  cashfree: T | null
  razorpay: T | null
  preferred: PaymentProviderName | null
}): T | null {
  if (input.preferred === 'razorpay' && input.razorpay) return input.razorpay
  if (input.preferred === 'cashfree' && input.cashfree) return input.cashfree
  return input.cashfree ?? input.razorpay
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
