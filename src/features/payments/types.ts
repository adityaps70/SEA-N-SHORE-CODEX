export const PAYMENT_CURRENCIES = ['INR', 'USD'] as const
export type PaymentCurrency = typeof PAYMENT_CURRENCIES[number]

export const PAYMENT_PROVIDERS = ['razorpay'] as const
export type PaymentProviderName = typeof PAYMENT_PROVIDERS[number]

export const EVENT_PAYMENT_ORDER_STATUSES = ['created', 'paid', 'failed', 'refunded', 'cancelled'] as const
export type EventPaymentOrderStatus = typeof EVENT_PAYMENT_ORDER_STATUSES[number]

export type ProviderOrder = {
  providerOrderId: string
  amountMinor: number
  currency: PaymentCurrency
}

export type ProviderPaymentStatus = 'created' | 'authorized' | 'captured' | 'refunded' | 'failed'

export type ProviderPayment = {
  providerPaymentId: string
  providerOrderId: string | null
  amountMinor: number
  currency: string
  status: ProviderPaymentStatus
}

export type CheckoutSignatureInput = {
  providerOrderId: string
  providerPaymentId: string
  signature: string
}

/**
 * A payment gateway. Razorpay is the first implementation; another gateway can be
 * added by implementing this interface and returning it from getPaymentProvider().
 * Implementations run on the server only and never expose their secrets.
 */
export interface PaymentProvider {
  readonly name: PaymentProviderName
  /** Public key the browser checkout needs. Safe to send to the client. */
  readonly publicKeyId: string
  createOrder(input: {
    amountMinor: number
    currency: PaymentCurrency
    receipt: string
    notes: Record<string, string>
  }): Promise<ProviderOrder>
  verifyCheckoutSignature(input: CheckoutSignatureInput): boolean
  verifyWebhookSignature(rawBody: string, signature: string | null): boolean
  fetchPayment(providerPaymentId: string): Promise<ProviderPayment>
  capturePayment(providerPaymentId: string, amountMinor: number, currency: PaymentCurrency): Promise<ProviderPayment>
  refundPayment(providerPaymentId: string, amountMinor: number, notes?: Record<string, string>): Promise<{ providerRefundId: string }>
}

export class PaymentProviderError extends Error {
  constructor(
    readonly code: 'provider_request_failed' | 'provider_response_invalid' | 'provider_unreachable',
    readonly status: number | null = null,
    readonly providerMessage: string | null = null,
  ) {
    super(code)
    this.name = 'PaymentProviderError'
  }
}
