'use client'

import type { CheckoutClient, CheckoutProof } from '../types'
import { loadRazorpayCheckout } from './load-razorpay-checkout'

/**
 * Opens the payment gateway's own checkout in the browser (Cashfree JS SDK v3 as a
 * pop-up, or Razorpay Checkout) for a CheckoutClient the server created. The result
 * is only what the browser saw — never proof of payment. Callers must then ask the
 * server to confirm with the gateway (see gateway-checkout-button.tsx).
 */

export const CASHFREE_SDK_SRC = 'https://sdk.cashfree.com/js/v3/cashfree.js'

export type GatewayCheckoutResult =
  /** The gateway says checkout finished; ask the server to confirm. */
  | { outcome: 'completed'; proof: CheckoutProof | null }
  /** The window was closed, or the gateway reported an error. Ask the server anyway for Cashfree. */
  | { outcome: 'closed'; message: string | null }
  /** The gateway is sending the browser to another page; /payments/return confirms there. */
  | { outcome: 'redirecting' }
  /** The gateway script could not load (offline, content blocker). Nothing was charged. */
  | { outcome: 'unavailable' }

export type GatewayCheckoutDisplay = {
  /** Shown in Razorpay's window, e.g. the event title. */
  description: string
  prefill?: { email?: string | null; phone?: string | null; name?: string | null }
  notes?: Record<string, string>
  /** Razorpay only: called when one attempt fails while its window stays open. */
  onAttemptFailed?: (message: string | null) => void
  timeoutSeconds?: number
}

type CashfreeCheckoutResult = {
  error?: { message?: string; code?: string; type?: string }
  redirect?: boolean
  paymentDetails?: { paymentMessage?: string }
}

type CashfreeInstance = {
  checkout(options: { paymentSessionId: string; redirectTarget: '_modal' | '_self' | '_blank' | '_top' }): Promise<CashfreeCheckoutResult>
}

type CashfreeFactory = (options: { mode: 'sandbox' | 'production' }) => CashfreeInstance

declare global {
  interface Window {
    Cashfree?: CashfreeFactory
  }
}

let cashfreeLoading: Promise<CashfreeFactory> | null = null

/** Loads Cashfree's SDK on demand, once per page, only when someone starts a payment. */
export function loadCashfreeCheckout(): Promise<CashfreeFactory> {
  if (typeof window === 'undefined' || typeof document === 'undefined') return Promise.reject(new Error('cashfree_checkout_unavailable'))
  if (typeof window.Cashfree === 'function') return Promise.resolve(window.Cashfree)
  if (cashfreeLoading) return cashfreeLoading

  cashfreeLoading = new Promise<CashfreeFactory>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = CASHFREE_SDK_SRC
    script.async = true
    script.onload = () => {
      if (typeof window.Cashfree === 'function') resolve(window.Cashfree)
      else reject(new Error('cashfree_checkout_unavailable'))
    }
    script.onerror = () => reject(new Error('cashfree_checkout_unavailable'))
    document.head.appendChild(script)
  }).catch((error: unknown) => {
    cashfreeLoading = null
    throw error
  })
  return cashfreeLoading
}

async function openCashfree(client: Extract<CheckoutClient, { provider: 'cashfree' }>): Promise<GatewayCheckoutResult> {
  let factory: CashfreeFactory
  try {
    factory = await loadCashfreeCheckout()
  } catch {
    return { outcome: 'unavailable' }
  }
  let result: CashfreeCheckoutResult | undefined
  try {
    const cashfree = factory({ mode: client.mode })
    result = await cashfree.checkout({ paymentSessionId: client.paymentSessionId, redirectTarget: '_modal' })
  } catch (error) {
    return { outcome: 'closed', message: error instanceof Error ? error.message : null }
  }
  if (result?.redirect) return { outcome: 'redirecting' }
  if (result?.paymentDetails) return { outcome: 'completed', proof: null }
  return { outcome: 'closed', message: result?.error?.message ?? null }
}

async function openRazorpay(client: Extract<CheckoutClient, { provider: 'razorpay' }>, display: GatewayCheckoutDisplay): Promise<GatewayCheckoutResult> {
  let Razorpay
  try {
    Razorpay = await loadRazorpayCheckout()
  } catch {
    return { outcome: 'unavailable' }
  }
  return new Promise<GatewayCheckoutResult>((resolve) => {
    let settled = false
    const finish = (value: GatewayCheckoutResult) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    const prefill = display.prefill
    const instance = new Razorpay({
      key: client.keyId,
      amount: client.amountMinor,
      currency: client.currency,
      name: 'Sea N Shore',
      description: display.description.slice(0, 250),
      order_id: client.providerOrderId,
      prefill: prefill && (prefill.email || prefill.phone || prefill.name)
        ? {
            ...(prefill.email ? { email: prefill.email } : {}),
            ...(prefill.name ? { name: prefill.name } : {}),
            ...(prefill.phone ? { contact: prefill.phone } : {}),
          }
        : undefined,
      notes: display.notes,
      theme: { color: '#0d9488' },
      timeout: display.timeoutSeconds,
      handler: (response) => finish({
        outcome: 'completed',
        proof: { providerPaymentId: response.razorpay_payment_id, signature: response.razorpay_signature },
      }),
      modal: {
        escape: true,
        confirm_close: true,
        ondismiss: () => finish({ outcome: 'closed', message: null }),
      },
    })
    instance.on('payment.failed', (response) => {
      display.onAttemptFailed?.(response.error?.description ?? null)
    })
    instance.open()
  })
}

export function openGatewayCheckout(client: CheckoutClient, display: GatewayCheckoutDisplay): Promise<GatewayCheckoutResult> {
  return client.provider === 'cashfree' ? openCashfree(client) : openRazorpay(client, display)
}

/**
 * Should the page ask the server after this result? Always after "completed"; also
 * after Cashfree closes, because its pop-up can close after a payment went through.
 */
export function shouldConfirmWithServer(client: CheckoutClient, result: GatewayCheckoutResult) {
  if (result.outcome === 'completed') return true
  return result.outcome === 'closed' && client.provider === 'cashfree'
}
