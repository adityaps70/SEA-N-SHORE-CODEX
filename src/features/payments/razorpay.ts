import { createHmac, timingSafeEqual } from 'node:crypto'
import type { RazorpayConfig } from './config'
import {
  PaymentProviderError,
  PaymentVerificationError,
  type HeaderLookup,
  type OrderConfirmation,
  type PaymentGateway,
  type RefundResult,
} from './types'

/**
 * Razorpay behind the shared PaymentGateway interface, using the REST API directly
 * (https://razorpay.com/docs/api/). No SDK: requests use fetch with HTTP Basic
 * auth, and signatures are HMAC-SHA256 checks with node:crypto.
 */

export const RAZORPAY_API_BASE = 'https://api.razorpay.com/v1'

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

const REQUEST_TIMEOUT_MS = 15_000

export type RazorpayPaymentStatus = 'created' | 'authorized' | 'captured' | 'refunded' | 'failed'
const PAYMENT_STATUSES: RazorpayPaymentStatus[] = ['created', 'authorized', 'captured', 'refunded', 'failed']

export type RazorpayPayment = {
  providerPaymentId: string
  providerOrderId: string | null
  amountMinor: number
  currency: string
  status: RazorpayPaymentStatus
  errorDescription: string | null
  createdAt: number
}

export function hmacSha256Hex(secret: string, payload: string) {
  return createHmac('sha256', secret).update(payload, 'utf8').digest('hex')
}

/** Constant-time comparison of two hex signatures. */
export function signaturesMatch(expectedHex: string, receivedHex: string | null | undefined) {
  if (typeof receivedHex !== 'string') return false
  const received = receivedHex.trim().toLowerCase()
  if (!/^[0-9a-f]+$/.test(received) || received.length !== expectedHex.length) return false
  return timingSafeEqual(Buffer.from(expectedHex, 'hex'), Buffer.from(received, 'hex'))
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function mapPayment(value: unknown): RazorpayPayment {
  const payment = record(value)
  const status = PAYMENT_STATUSES.find((candidate) => candidate === payment.status)
  if (typeof payment.id !== 'string' || typeof payment.amount !== 'number' || !Number.isSafeInteger(payment.amount) || !status) {
    throw new PaymentProviderError('provider_response_invalid')
  }
  return {
    providerPaymentId: payment.id,
    providerOrderId: typeof payment.order_id === 'string' ? payment.order_id : null,
    amountMinor: payment.amount,
    currency: typeof payment.currency === 'string' ? payment.currency : '',
    status,
    errorDescription: typeof payment.error_description === 'string' ? payment.error_description : null,
    createdAt: typeof payment.created_at === 'number' ? payment.created_at : 0,
  }
}

/** Razorpay payments of one order to our normalized answer. Captured means paid. */
export function razorpayConfirmation(providerOrderId: string, payments: RazorpayPayment[]): OrderConfirmation {
  const captured = payments.find((payment) => payment.status === 'captured' || payment.status === 'refunded')
  const base = { providerOrderId, providerPaymentId: null, amountMinor: null, currency: null, failureMessage: null }
  if (captured) {
    return {
      ...base,
      status: 'paid',
      providerPaymentId: captured.providerPaymentId,
      amountMinor: captured.amountMinor,
      currency: captured.currency,
      lastAttempt: 'succeeded',
    }
  }
  const latest = [...payments].sort((a, b) => b.createdAt - a.createdAt)[0]
  if (!latest) return { ...base, status: 'pending', lastAttempt: 'none' }
  if (latest.status === 'failed') return { ...base, status: 'failed', lastAttempt: 'failed', failureMessage: latest.errorDescription }
  return { ...base, status: 'pending', lastAttempt: 'processing' }
}

export function createRazorpayGateway(config: RazorpayConfig, fetchImpl: FetchLike = fetch): PaymentGateway & {
  /** Razorpay-only helpers kept for the Razorpay webhook. */
  fetchPayment(providerPaymentId: string): Promise<RazorpayPayment>
  verifyCheckoutSignature(input: { providerOrderId: string; providerPaymentId: string; signature: string }): boolean
} {
  const authorization = `Basic ${Buffer.from(`${config.keyId}:${config.keySecret}`).toString('base64')}`

  async function request(path: string, init: { method: 'GET' | 'POST'; body?: unknown }) {
    let response: Response
    try {
      response = await fetchImpl(`${RAZORPAY_API_BASE}${path}`, {
        method: init.method,
        headers: {
          Authorization: authorization,
          Accept: 'application/json',
          ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        cache: 'no-store',
      })
    } catch {
      throw new PaymentProviderError('provider_unreachable')
    }

    let payload: unknown = null
    try {
      payload = await response.json()
    } catch {
      payload = null
    }
    if (!response.ok) {
      const description = record(record(payload).error).description
      throw new PaymentProviderError('provider_request_failed', response.status, typeof description === 'string' ? description : null)
    }
    return payload
  }

  async function fetchPayment(providerPaymentId: string) {
    return mapPayment(await request(`/payments/${encodeURIComponent(providerPaymentId)}`, { method: 'GET' }))
  }

  async function capture(payment: RazorpayPayment) {
    return mapPayment(await request(`/payments/${encodeURIComponent(payment.providerPaymentId)}/capture`, {
      method: 'POST',
      body: { amount: payment.amountMinor, currency: payment.currency },
    }))
  }

  function verifyCheckoutSignature(input: { providerOrderId: string; providerPaymentId: string; signature: string }) {
    if (!input.providerOrderId || !input.providerPaymentId) return false
    const expected = hmacSha256Hex(config.keySecret, `${input.providerOrderId}|${input.providerPaymentId}`)
    return signaturesMatch(expected, input.signature)
  }

  return {
    name: 'razorpay',
    requiresCustomerPhone: false,
    currencies: ['INR', 'USD'],

    async createCheckout(input) {
      const payload = record(await request('/orders', {
        method: 'POST',
        body: {
          amount: input.amountMinor,
          currency: input.currency,
          receipt: input.gatewayOrderId.slice(0, 40),
          notes: input.notes,
        },
      }))
      if (typeof payload.id !== 'string' || payload.amount !== input.amountMinor || payload.currency !== input.currency) {
        throw new PaymentProviderError('provider_response_invalid')
      }
      return {
        providerOrderId: payload.id,
        providerSessionId: null,
        client: { provider: 'razorpay', providerOrderId: payload.id, keyId: config.keyId, amountMinor: input.amountMinor, currency: input.currency },
      }
    },

    restoreCheckout(stored) {
      return { provider: 'razorpay', providerOrderId: stored.providerOrderId, keyId: config.keyId, amountMinor: stored.amountMinor, currency: stored.currency }
    },

    /**
     * Reads the order's payments from Razorpay. An authorised (not yet captured)
     * payment is captured here so the money is actually collected. When the browser
     * sent Razorpay's signed response, the signature must match.
     */
    async confirmOrder(providerOrderId, proof) {
      if (proof?.signature || proof?.providerPaymentId) {
        const valid = verifyCheckoutSignature({
          providerOrderId,
          providerPaymentId: proof.providerPaymentId ?? '',
          signature: proof.signature ?? '',
        })
        if (!valid) throw new PaymentVerificationError()
      }
      const payload = record(await request(`/orders/${encodeURIComponent(providerOrderId)}/payments`, { method: 'GET' }))
      if (!Array.isArray(payload.items)) throw new PaymentProviderError('provider_response_invalid')
      const payments = payload.items.map(mapPayment)
      const authorized = payments.find((payment) => payment.status === 'authorized')
      if (authorized && !payments.some((payment) => payment.status === 'captured')) {
        const captured = await capture(authorized)
        return razorpayConfirmation(providerOrderId, [captured, ...payments.filter((payment) => payment !== authorized)])
      }
      return razorpayConfirmation(providerOrderId, payments)
    },

    async refund(input): Promise<RefundResult> {
      const payload = record(await request(`/payments/${encodeURIComponent(input.providerPaymentId)}/refund`, {
        method: 'POST',
        body: { amount: input.amountMinor, receipt: input.refundId, notes: input.note ? { reason: input.note } : {} },
      }))
      if (typeof payload.id !== 'string') throw new PaymentProviderError('provider_response_invalid')
      const status = payload.status === 'failed' ? 'failed' : payload.status === 'processed' ? 'processed' : 'pending'
      return { providerRefundId: payload.id, status }
    },

    verifyWebhook(rawBody: string, headers: HeaderLookup) {
      if (!rawBody) return false
      return signaturesMatch(hmacSha256Hex(config.webhookSecret, rawBody), headers.get('x-razorpay-signature'))
    },

    fetchPayment,
    verifyCheckoutSignature,
  }
}

export type RazorpayGateway = ReturnType<typeof createRazorpayGateway>
