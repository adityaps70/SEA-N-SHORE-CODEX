export const PAYMENT_CURRENCIES = ['INR', 'USD'] as const
export type PaymentCurrency = typeof PAYMENT_CURRENCIES[number]

export const PAYMENT_PROVIDERS = ['razorpay', 'cashfree'] as const
export type PaymentProviderName = typeof PAYMENT_PROVIDERS[number]

export const EVENT_PAYMENT_ORDER_STATUSES = ['created', 'paid', 'failed', 'refunded', 'cancelled'] as const
export type EventPaymentOrderStatus = typeof EVENT_PAYMENT_ORDER_STATUSES[number]

/** What a payment is for. The gateway order id starts with the matching prefix (see order-ids.ts). */
export type PaymentPurpose = 'event' | 'course' | 'plan'

export type CashfreeMode = 'sandbox' | 'production'

/**
 * Everything the browser needs to open the gateway's checkout. Contains no secrets.
 * Razorpay: public key id + Razorpay order. Cashfree: payment_session_id + SDK mode.
 */
export type CheckoutClient =
  | {
      provider: 'razorpay'
      providerOrderId: string
      keyId: string
      amountMinor: number
      currency: PaymentCurrency
    }
  | {
      provider: 'cashfree'
      providerOrderId: string
      paymentSessionId: string
      mode: CashfreeMode
    }

/** The buyer, as the gateway needs them. Cashfree requires a phone number. */
export type CheckoutCustomer = {
  /** Our profile id (dashes are removed for Cashfree). */
  id: string
  email: string | null
  /** E.164, e.g. +919876543210. */
  phone: string | null
  name: string | null
}

export type CreateCheckoutInput = {
  /**
   * Our gateway order id, e.g. "evt_<uuid without dashes>" (order-ids.ts).
   * Cashfree uses it as its order_id; Razorpay stores it as the receipt.
   */
  gatewayOrderId: string
  amountMinor: number
  currency: PaymentCurrency
  customer: CheckoutCustomer
  /** Short text for the gateway dashboard / receipt, e.g. the event title. */
  description: string
  /** Absolute https URL the buyer returns to after a redirect-based payment. */
  returnUrl: string | null
  /** Absolute https URL for this order's payment webhooks (Cashfree notify_url). */
  notifyUrl: string | null
  /** Must be one of the gateway's order lifetime limits; see each gateway. */
  expiresAt: Date
  notes: Record<string, string>
}

export type GatewayCheckout = {
  providerOrderId: string
  /** Cashfree payment_session_id, stored so a double click reopens the same checkout. */
  providerSessionId: string | null
  client: CheckoutClient
}

/** Optional browser evidence (Razorpay's signed handler response). Never proof on its own. */
export type CheckoutProof = {
  providerPaymentId?: string
  signature?: string
}

/**
 * The gateway's own answer about an order, read server to server.
 * - paid: money was received (payment id and amount are set)
 * - pending: nothing received yet and the order can still be paid
 * - failed: the latest attempt failed; the order may still be paid with another attempt
 * - cancelled: the order expired or was closed and can no longer be paid
 */
export type NormalizedOrderStatus = 'paid' | 'pending' | 'failed' | 'cancelled'

export type OrderConfirmation = {
  status: NormalizedOrderStatus
  providerOrderId: string
  providerPaymentId: string | null
  amountMinor: number | null
  currency: string | null
  /** 'none' = no attempt yet, 'processing' = the bank has not answered, 'dropped' = the buyer left. */
  lastAttempt: 'none' | 'processing' | 'failed' | 'dropped' | 'succeeded'
  /** Gateway's plain message for the latest failed attempt, if any. */
  failureMessage: string | null
}

export type RefundInput = {
  providerOrderId: string
  providerPaymentId: string
  amountMinor: number
  currency: PaymentCurrency
  /** Our unique refund id, 3..40 chars [A-Za-z0-9] (order-ids.ts refundIdFor). */
  refundId: string
  note: string | null
}

export type RefundResult = {
  providerRefundId: string
  /** processed = money on its way back; pending = the gateway will finish it; failed = not refunded. */
  status: 'processed' | 'pending' | 'failed'
}

/** Request headers as a plain lookup (Headers, or a record in tests). */
export type HeaderLookup = { get(name: string): string | null }

/**
 * A payment gateway (Razorpay or Cashfree). Server only; implementations never expose
 * secrets. The browser only ever receives a CheckoutClient.
 */
export interface PaymentGateway {
  readonly name: PaymentProviderName
  /** True when createCheckout needs customer.phone (Cashfree). */
  readonly requiresCustomerPhone: boolean
  /** Currencies this gateway account can charge in. */
  readonly currencies: readonly PaymentCurrency[]
  createCheckout(input: CreateCheckoutInput): Promise<GatewayCheckout>
  /** Rebuilds the browser checkout for an order created earlier (double click, retry). */
  restoreCheckout(stored: { providerOrderId: string; providerSessionId: string | null; amountMinor: number; currency: PaymentCurrency }): CheckoutClient | null
  /** Asks the gateway whether the order is paid. The only way an order becomes paid outside webhooks. */
  confirmOrder(providerOrderId: string, proof?: CheckoutProof): Promise<OrderConfirmation>
  refund(input: RefundInput): Promise<RefundResult>
  /** Verifies a webhook with the raw body text, before it is parsed. */
  verifyWebhook(rawBody: string, headers: HeaderLookup): boolean
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

/** Browser evidence did not match the gateway's signature. Nothing was changed. */
export class PaymentVerificationError extends Error {
  constructor() {
    super('payment_signature_invalid')
    this.name = 'PaymentVerificationError'
  }
}
