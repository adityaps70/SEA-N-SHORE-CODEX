import { loadRazorpayConfig } from './config'
import { createRazorpayProvider } from './razorpay'
import type { PaymentProvider } from './types'

/**
 * The active payment gateway, or null when payments are not configured yet.
 * Server only. Add another gateway here behind the same PaymentProvider interface.
 */
export async function getPaymentProvider(): Promise<PaymentProvider | null> {
  const config = await loadRazorpayConfig()
  return config ? createRazorpayProvider(config) : null
}

export async function arePaymentsConfigured() {
  return Boolean(await loadRazorpayConfig())
}
