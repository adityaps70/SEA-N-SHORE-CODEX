import { createHmac, timingSafeEqual } from 'node:crypto'
import type { CashfreeConfig } from './cashfree-config'
import { decimalAmountToMinor, minorToDecimalAmount } from './currency'
import { gatewayCustomerId, isGatewayOrderId } from './order-ids'
import {
  PaymentProviderError,
  type CashfreeMode,
  type CheckoutClient,
  type HeaderLookup,
  type OrderConfirmation,
  type PaymentCurrency,
  type PaymentGateway,
  type RefundResult,
} from './types'

/**
 * Cashfree Payment Gateway over plain HTTPS (no SDK), following
 * /home/claude/brief5/cashfree-api.txt (official docs, researched 2026-09-27):
 *   POST /orders, GET /orders/{id}, GET /orders/{id}/payments, POST /orders/{id}/refunds
 * Headers: x-client-id, x-client-secret, x-api-version (pinned below).
 * Amounts: Cashfree takes rupees with up to 2 decimals; we keep integer paise and
 * convert from the digits (currency.ts), never with floating-point arithmetic.
 */

export const CASHFREE_API_VERSION = '2026-01-01'
export const CASHFREE_PG_BASE_URLS: Record<CashfreeMode, string> = {
  sandbox: 'https://sandbox.cashfree.com/pg',
  production: 'https://api.cashfree.com/pg',
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

const REQUEST_TIMEOUT_MS = 15_000

export type CashfreeOrderStatus = 'ACTIVE' | 'PAID' | 'EXPIRED' | 'TERMINATED' | 'TERMINATION_REQUESTED'
export type CashfreePaymentStatus = 'SUCCESS' | 'NOT_ATTEMPTED' | 'FAILED' | 'USER_DROPPED' | 'VOID' | 'CANCELLED' | 'PENDING'

export type CashfreeOrder = {
  cfOrderId: string | null
  orderId: string
  orderStatus: CashfreeOrderStatus | string
  amountMinor: number
  currency: string
  paymentSessionId: string | null
}

export type CashfreePayment = {
  cfPaymentId: string
  orderId: string | null
  paymentStatus: CashfreePaymentStatus | string
  amountMinor: number | null
  currency: string | null
  paymentMessage: string | null
  paymentTime: string | null
}

export type CashfreeRefund = {
  cfRefundId: string
  refundId: string
  refundStatus: string
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function text(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/** Cashfree customer_phone: 10 digits for Indian numbers, "+<country><number>" otherwise. */
export function cashfreeCustomerPhone(e164: string) {
  const digits = e164.replace(/[^0-9+]/g, '')
  if (/^\+91[6-9][0-9]{9}$/.test(digits)) return digits.slice(3)
  return digits.startsWith('+') ? digits : `+${digits}`
}

function clip(value: string | null | undefined, min: number, max: number) {
  const trimmed = value?.trim() ?? ''
  if (trimmed.length < min) return undefined
  return trimmed.slice(0, max)
}

/** Cashfree order_expiry_time: ISO 8601 in UTC, whole seconds. */
function expiryTime(date: Date) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

export function mapCashfreeOrder(value: unknown): CashfreeOrder {
  const order = record(value)
  const orderId = text(order.order_id)
  const amountMinor = decimalAmountToMinor(order.order_amount)
  const status = text(order.order_status)
  if (!orderId || amountMinor === null || !status) throw new PaymentProviderError('provider_response_invalid')
  return {
    cfOrderId: text(order.cf_order_id),
    orderId,
    orderStatus: status,
    amountMinor,
    currency: text(order.order_currency) ?? 'INR',
    paymentSessionId: text(order.payment_session_id),
  }
}

export function mapCashfreePayment(value: unknown): CashfreePayment | null {
  const payment = record(value)
  const cfPaymentId = text(payment.cf_payment_id)
  const status = text(payment.payment_status)
  if (!cfPaymentId || !status) return null
  const error = record(payment.error_details)
  return {
    cfPaymentId,
    orderId: text(payment.order_id),
    paymentStatus: status,
    amountMinor: decimalAmountToMinor(payment.payment_amount),
    currency: text(payment.payment_currency),
    paymentMessage: text(error.error_description) ?? text(payment.payment_message),
    paymentTime: text(payment.payment_completion_time) ?? text(payment.payment_time),
  }
}

/**
 * Turns Cashfree's order + payment attempts into our normalized answer.
 * Only order_status PAID with a SUCCESS payment counts as paid.
 */
export function cashfreeConfirmation(order: CashfreeOrder, payments: CashfreePayment[]): OrderConfirmation {
  const success = payments.find((payment) => payment.paymentStatus === 'SUCCESS')
  const latest = [...payments].sort((a, b) => Date.parse(b.paymentTime ?? '') - Date.parse(a.paymentTime ?? ''))[0] ?? null
  const base = {
    providerOrderId: order.orderId,
    providerPaymentId: null,
    amountMinor: null,
    currency: null,
    failureMessage: null,
  }
  if (order.orderStatus === 'PAID' && success) {
    return {
      ...base,
      status: 'paid',
      providerPaymentId: success.cfPaymentId,
      amountMinor: success.amountMinor ?? order.amountMinor,
      currency: success.currency ?? order.currency,
      lastAttempt: 'succeeded',
    }
  }
  if (order.orderStatus === 'EXPIRED' || order.orderStatus === 'TERMINATED' || order.orderStatus === 'TERMINATION_REQUESTED') {
    return { ...base, status: 'cancelled', lastAttempt: latest?.paymentStatus === 'FAILED' ? 'failed' : 'none' }
  }
  if (!latest || latest.paymentStatus === 'NOT_ATTEMPTED') return { ...base, status: 'pending', lastAttempt: 'none' }
  if (latest.paymentStatus === 'PENDING' || latest.paymentStatus === 'SUCCESS') return { ...base, status: 'pending', lastAttempt: 'processing' }
  if (latest.paymentStatus === 'USER_DROPPED') return { ...base, status: 'pending', lastAttempt: 'dropped' }
  return { ...base, status: 'failed', lastAttempt: 'failed', failureMessage: latest.paymentMessage }
}

export function mapCashfreeRefundStatus(status: string | null): RefundResult['status'] {
  if (status === 'SUCCESS') return 'processed'
  if (status === 'CANCELLED' || status === 'REJECTED') return 'failed'
  return 'pending'
}

/**
 * Cashfree webhook signature: Base64(HMAC-SHA256(key = client secret,
 * data = x-webhook-timestamp + rawBody)), compared in constant time.
 *
 * Timestamps: Cashfree documents no tolerance window and retries a delivery up to
 * 30 minutes later, so by default no age limit is applied. Replays are harmless
 * because every handler is idempotent and deliveries are de-duplicated. Pass
 * maxAgeMs to enforce one anyway.
 */
export function verifyCashfreeSignature(input: {
  secret: string
  rawBody: string
  timestamp: string | null
  signature: string | null
  maxAgeMs?: number | null
  now?: number
}) {
  const timestamp = input.timestamp?.trim() ?? ''
  const signature = input.signature?.trim() ?? ''
  if (!input.rawBody || !/^\d{10,13}$/.test(timestamp) || !signature) return false
  if (input.maxAgeMs) {
    const ms = timestamp.length === 13 ? Number(timestamp) : Number(timestamp) * 1000
    if (Math.abs((input.now ?? Date.now()) - ms) > input.maxAgeMs) return false
  }
  const expected = createHmac('sha256', input.secret).update(timestamp + input.rawBody, 'utf8').digest()
  const received = Buffer.from(signature, 'base64')
  if (received.length !== expected.length) return false
  return timingSafeEqual(expected, received)
}

export function createCashfreeClient(config: CashfreeConfig, fetchImpl: FetchLike = fetch) {
  const base = CASHFREE_PG_BASE_URLS[config.environment]

  async function request(path: string, init: { method: 'GET' | 'POST'; body?: unknown; idempotencyKey?: string }) {
    let response: Response
    try {
      response = await fetchImpl(`${base}${path}`, {
        method: init.method,
        headers: {
          Accept: 'application/json',
          'x-api-version': CASHFREE_API_VERSION,
          'x-client-id': config.clientId,
          'x-client-secret': config.clientSecret,
          ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(init.idempotencyKey ? { 'x-idempotency-key': init.idempotencyKey } : {}),
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
      const message = text(record(payload).message)
      throw new PaymentProviderError('provider_request_failed', response.status, message)
    }
    return payload
  }

  const orderPath = (orderId: string) => {
    if (!isGatewayOrderId(orderId)) throw new PaymentProviderError('provider_request_failed', 400, 'order_id_invalid')
    return `/orders/${encodeURIComponent(orderId)}`
  }

  async function getOrder(orderId: string): Promise<CashfreeOrder> {
    return mapCashfreeOrder(await request(orderPath(orderId), { method: 'GET' }))
  }

  return {
    environment: config.environment,

    async createOrder(input: {
      orderId: string
      amountMinor: number
      currency: PaymentCurrency
      customer: { id: string; phone: string; email: string | null; name: string | null }
      returnUrl: string | null
      notifyUrl: string | null
      expiresAt: Date
      note: string | null
      tags: Record<string, string>
    }): Promise<CashfreeOrder> {
      const tags = Object.fromEntries(
        Object.entries(input.tags).filter(([, value]) => value).slice(0, 15).map(([key, value]) => [key, value.slice(0, 255)]),
      )
      const body = {
        order_id: input.orderId,
        order_amount: minorToDecimalAmount(input.amountMinor),
        order_currency: input.currency,
        customer_details: {
          customer_id: gatewayCustomerId(input.customer.id),
          customer_phone: cashfreeCustomerPhone(input.customer.phone),
          ...(clip(input.customer.email, 3, 100) ? { customer_email: clip(input.customer.email, 3, 100) } : {}),
          ...(clip(input.customer.name, 3, 100) ? { customer_name: clip(input.customer.name, 3, 100) } : {}),
        },
        order_meta: {
          ...(input.returnUrl ? { return_url: input.returnUrl.slice(0, 250) } : {}),
          ...(input.notifyUrl?.startsWith('https://') ? { notify_url: input.notifyUrl.slice(0, 250) } : {}),
        },
        order_expiry_time: expiryTime(input.expiresAt),
        ...(clip(input.note, 3, 200) ? { order_note: clip(input.note, 3, 200) } : {}),
        ...(Object.keys(tags).length ? { order_tags: tags } : {}),
      }
      try {
        const order = mapCashfreeOrder(await request('/orders', { method: 'POST', body, idempotencyKey: input.orderId }))
        if (order.orderId !== input.orderId || order.amountMinor !== input.amountMinor || order.currency !== input.currency) {
          throw new PaymentProviderError('provider_response_invalid')
        }
        return order
      } catch (error) {
        // 409: this order id already exists (an earlier attempt reached Cashfree). Reuse it.
        if (error instanceof PaymentProviderError && error.status === 409) {
          const existing = await getOrder(input.orderId)
          if (existing.amountMinor !== input.amountMinor || existing.currency !== input.currency) {
            throw new PaymentProviderError('provider_response_invalid')
          }
          return existing
        }
        throw error
      }
    },

    getOrder,

    async getOrderPayments(orderId: string): Promise<CashfreePayment[]> {
      const payload = await request(`${orderPath(orderId)}/payments`, { method: 'GET' })
      if (!Array.isArray(payload)) throw new PaymentProviderError('provider_response_invalid')
      return payload.map(mapCashfreePayment).filter((payment): payment is CashfreePayment => payment !== null)
    },

    async createRefund(orderId: string, input: { refundId: string; amountMinor: number; note: string | null }): Promise<CashfreeRefund> {
      if (!/^[A-Za-z0-9]{3,40}$/.test(input.refundId)) throw new PaymentProviderError('provider_request_failed', 400, 'refund_id_invalid')
      const payload = record(await request(`${orderPath(orderId)}/refunds`, {
        method: 'POST',
        idempotencyKey: input.refundId,
        body: {
          refund_amount: minorToDecimalAmount(input.amountMinor),
          refund_id: input.refundId,
          ...(clip(input.note, 3, 100) ? { refund_note: clip(input.note, 3, 100) } : {}),
        },
      }))
      const cfRefundId = text(payload.cf_refund_id)
      if (!cfRefundId) throw new PaymentProviderError('provider_response_invalid')
      return { cfRefundId, refundId: text(payload.refund_id) ?? input.refundId, refundStatus: text(payload.refund_status) ?? 'PENDING' }
    },
  }
}

export type CashfreeClient = ReturnType<typeof createCashfreeClient>

/** Cashfree behind the shared PaymentGateway interface. */
export function createCashfreeGateway(config: CashfreeConfig, fetchImpl: FetchLike = fetch): PaymentGateway {
  const client = createCashfreeClient(config, fetchImpl)
  const currencies: PaymentCurrency[] = config.international ? ['INR', 'USD'] : ['INR']

  function browserClient(providerOrderId: string, paymentSessionId: string): CheckoutClient {
    return { provider: 'cashfree', providerOrderId, paymentSessionId, mode: config.environment }
  }

  return {
    name: 'cashfree',
    requiresCustomerPhone: true,
    currencies,

    async createCheckout(input) {
      if (!input.customer.phone) throw new PaymentProviderError('provider_request_failed', 400, 'customer_phone_required')
      const order = await client.createOrder({
        orderId: input.gatewayOrderId,
        amountMinor: input.amountMinor,
        currency: input.currency,
        customer: { id: input.customer.id, phone: input.customer.phone, email: input.customer.email, name: input.customer.name },
        returnUrl: input.returnUrl,
        notifyUrl: input.notifyUrl,
        expiresAt: input.expiresAt,
        note: input.description,
        tags: input.notes,
      })
      if (!order.paymentSessionId) throw new PaymentProviderError('provider_response_invalid')
      return {
        providerOrderId: order.orderId,
        providerSessionId: order.paymentSessionId,
        client: browserClient(order.orderId, order.paymentSessionId),
      }
    },

    restoreCheckout(stored) {
      return stored.providerSessionId ? browserClient(stored.providerOrderId, stored.providerSessionId) : null
    },

    async confirmOrder(providerOrderId) {
      const order = await client.getOrder(providerOrderId)
      const payments = order.orderStatus === 'ACTIVE' || order.orderStatus === 'PAID'
        ? await client.getOrderPayments(providerOrderId)
        : []
      return cashfreeConfirmation(order, payments)
    },

    async refund(input) {
      const refund = await client.createRefund(input.providerOrderId, {
        refundId: input.refundId,
        amountMinor: input.amountMinor,
        note: input.note,
      })
      return { providerRefundId: refund.cfRefundId, status: mapCashfreeRefundStatus(refund.refundStatus) }
    },

    verifyWebhook(rawBody: string, headers: HeaderLookup) {
      return verifyCashfreeSignature({
        secret: config.clientSecret,
        rawBody,
        timestamp: headers.get('x-webhook-timestamp'),
        signature: headers.get('x-webhook-signature'),
      })
    },
  }
}
