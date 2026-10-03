'use client'

export const RAZORPAY_CHECKOUT_SRC = 'https://checkout.razorpay.com/v1/checkout.js'

export type RazorpaySuccessResponse = {
  razorpay_payment_id: string
  razorpay_order_id: string
  razorpay_signature: string
}

export type RazorpayFailureResponse = {
  error?: { description?: string; reason?: string; code?: string }
}

export type RazorpayCheckoutOptions = {
  key: string
  amount: number
  currency: string
  name: string
  description: string
  order_id: string
  prefill?: { email?: string; name?: string; contact?: string }
  notes?: Record<string, string>
  theme?: { color?: string }
  timeout?: number
  handler: (response: RazorpaySuccessResponse) => void
  modal?: { ondismiss?: () => void; escape?: boolean; confirm_close?: boolean }
}

export type RazorpayCheckoutInstance = {
  open(): void
  on(event: 'payment.failed', handler: (response: RazorpayFailureResponse) => void): void
}

type RazorpayConstructor = new (options: RazorpayCheckoutOptions) => RazorpayCheckoutInstance

declare global {
  interface Window {
    Razorpay?: RazorpayConstructor
  }
}

let loading: Promise<RazorpayConstructor> | null = null

/**
 * Loads Razorpay Checkout on demand, only on pages where someone starts a payment.
 * The script is fetched once per page load.
 */
export function loadRazorpayCheckout(): Promise<RazorpayConstructor> {
  if (typeof window === 'undefined') return Promise.reject(new Error('razorpay_checkout_unavailable'))
  if (window.Razorpay) return Promise.resolve(window.Razorpay)
  if (loading) return loading

  loading = new Promise<RazorpayConstructor>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = RAZORPAY_CHECKOUT_SRC
    script.async = true
    script.onload = () => {
      if (window.Razorpay) resolve(window.Razorpay)
      else reject(new Error('razorpay_checkout_unavailable'))
    }
    script.onerror = () => reject(new Error('razorpay_checkout_unavailable'))
    document.head.appendChild(script)
  }).catch((error: unknown) => {
    loading = null
    throw error
  })
  return loading
}
