import { createHmac, timingSafeEqual } from 'node:crypto'
import type { RazorpayConfig } from './config'
import {
  PaymentProviderError,
  type PaymentCurrency,
  type PaymentProvider,
  type ProviderPayment,
  type ProviderPaymentStatus,
} from './types'

/**
 * Razorpay implementation of PaymentProvider using the REST API directly
 * (https://razorpay.com/docs/api/). No SDK: requests use fetch with HTTP Basic
 * auth, and signatures are HMAC-SHA256 checks with node:crypto.
 */

export const RAZORPAY_API_BASE = 'https://api.razorpay.com/v1'

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

const REQUEST_TIMEOUT_MS = 15_000
const PAYMENT_STATUSES: ProviderPaymentStatus[] = ['created', 'authorized', 'captured', 'refunded', 'failed']

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

function mapPayment(value: unknown): ProviderPayment {
  const payment = record(value)
  const status = PAYMENT_STATUSES.find((candidate) => candidate === payment.status)
  if (typeof payment.id !== 'string' || typeof payment.amount !== 'number' || !status) {
    throw new PaymentProviderError('provider_response_invalid')
  }
  return {
    providerPaymentId: payment.id,
    providerOrderId: typeof payment.order_id === 'string' ? payment.order_id : null,
    amountMinor: payment.amount,
    currency: typeof payment.currency === 'string' ? payment.currency : '',
    status,
  }
}

export function createRazorpayProvider(config: RazorpayConfig, fetchImpl: FetchLike = fetch): PaymentProvider {
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

  return {
    name: 'razorpay',
    publicKeyId: config.keyId,

    async createOrder(input) {
      const payload = record(await request('/orders', {
        method: 'POST',
        body: {
          amount: input.amountMinor,
          currency: input.currency,
          receipt: input.receipt.slice(0, 40),
          notes: input.notes,
        },
      }))
      if (typeof payload.id !== 'string' || payload.amount !== input.amountMinor || payload.currency !== input.currency) {
        throw new PaymentProviderError('provider_response_invalid')
      }
      return { providerOrderId: payload.id, amountMinor: input.amountMinor, currency: input.currency }
    },

    verifyCheckoutSignature(input) {
      if (!input.providerOrderId || !input.providerPaymentId) return false
      const expected = hmacSha256Hex(config.keySecret, `${input.providerOrderId}|${input.providerPaymentId}`)
      return signaturesMatch(expected, input.signature)
    },

    verifyWebhookSignature(rawBody, signature) {
      if (!rawBody) return false
      return signaturesMatch(hmacSha256Hex(config.webhookSecret, rawBody), signature)
    },

    async fetchPayment(providerPaymentId) {
      return mapPayment(await request(`/payments/${encodeURIComponent(providerPaymentId)}`, { method: 'GET' }))
    },

    async capturePayment(providerPaymentId: string, amountMinor: number, currency: PaymentCurrency) {
      return mapPayment(await request(`/payments/${encodeURIComponent(providerPaymentId)}/capture`, {
        method: 'POST',
        body: { amount: amountMinor, currency },
      }))
    },

    async refundPayment(providerPaymentId, amountMinor, notes = {}) {
      const payload = record(await request(`/payments/${encodeURIComponent(providerPaymentId)}/refund`, {
        method: 'POST',
        body: { amount: amountMinor, notes },
      }))
      if (typeof payload.id !== 'string') throw new PaymentProviderError('provider_response_invalid')
      return { providerRefundId: payload.id }
    },
  }
}
