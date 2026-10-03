import { createHash } from 'node:crypto'
import { withTransaction } from '@/lib/db/client'
import { mapCashfreeRefundStatus } from './cashfree'
import { decimalAmountToMinor } from './currency'
import type { GatewayOrderEvent, OrderHandlerResult, PaymentOrderHandler } from './order-handler-types'
import { PaymentVerificationError, type HeaderLookup, type PaymentGateway } from './types'
import { recordWebhookDelivery } from './webhook-deliveries'

/**
 * Cashfree Payment Gateway webhooks (versions 2025-01-01 and 2026-01-01):
 * PAYMENT_SUCCESS_WEBHOOK, PAYMENT_FAILED_WEBHOOK, PAYMENT_USER_DROPPED_WEBHOOK,
 * REFUND_STATUS_WEBHOOK, AUTO_REFUND_STATUS_WEBHOOK. Other types are acknowledged
 * and ignored (e.g. PAYMENT_CHARGES_WEBHOOK).
 */

export type ParsedCashfreeWebhook = {
  type: string
  event: GatewayOrderEvent | null
  /** Stable id for de-duplication when the idempotency header is missing. */
  fallbackDeliveryId: string
}

export type CashfreeWebhookResult =
  | { status: 'handled'; type: string; revalidatePaths: string[] }
  | { status: 'ignored'; type: string; reason: string }
  | { status: 'duplicate'; type: string }

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function text(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function failureReason(data: Record<string, unknown>, payment: Record<string, unknown>) {
  // The docs sample is ambiguous about where error_details sits; read both.
  const details = { ...record(data.error_details), ...record(payment.error_details) }
  return text(details.error_description) ?? text(details.error_reason) ?? text(payment.payment_message) ?? 'payment_failed'
}

/** Normalizes a Cashfree webhook body. Call only after the signature was verified. */
export function parseCashfreeWebhook(rawBody: string): ParsedCashfreeWebhook | null {
  let payload: Record<string, unknown>
  try {
    payload = record(JSON.parse(rawBody))
  } catch {
    return null
  }
  const data = record(payload.data)
  const type = text(payload.type) ?? text(data.type) ?? 'unknown'
  const order = record(data.order)
  const payment = record(data.payment)
  const hash = createHash('sha256').update(rawBody).digest('hex')

  if (type === 'PAYMENT_SUCCESS_WEBHOOK' || type === 'PAYMENT_FAILED_WEBHOOK' || type === 'PAYMENT_USER_DROPPED_WEBHOOK') {
    const providerOrderId = text(order.order_id)
    const providerPaymentId = text(payment.cf_payment_id)
    const status = text(payment.payment_status)
    if (!providerOrderId) return { type, event: null, fallbackDeliveryId: hash }
    const fallbackDeliveryId = `${type}:${providerPaymentId ?? hash}`
    if (type === 'PAYMENT_SUCCESS_WEBHOOK') {
      if (status !== 'SUCCESS' || !providerPaymentId) return { type, event: null, fallbackDeliveryId }
      return {
        type,
        fallbackDeliveryId,
        event: {
          kind: 'payment_succeeded',
          provider: 'cashfree',
          providerOrderId,
          providerPaymentId,
          amountMinor: decimalAmountToMinor(payment.payment_amount),
          currency: text(payment.payment_currency),
          occurredAt: text(payment.payment_time) ?? text(payload.event_time),
        },
      }
    }
    return {
      type,
      fallbackDeliveryId,
      event: {
        kind: 'payment_failed',
        provider: 'cashfree',
        providerOrderId,
        providerPaymentId,
        reason: type === 'PAYMENT_USER_DROPPED_WEBHOOK' ? 'user_dropped' : failureReason(data, payment),
        dropped: type === 'PAYMENT_USER_DROPPED_WEBHOOK',
      },
    }
  }

  if (type === 'REFUND_STATUS_WEBHOOK' || type === 'AUTO_REFUND_STATUS_WEBHOOK') {
    const refund = { ...record(data.auto_refund), ...record(data.refund) }
    const providerOrderId = text(refund.order_id)
    const providerRefundId = text(refund.cf_refund_id)
    const refundStatus = text(refund.refund_status)
    if (!providerOrderId || !providerRefundId) return { type, event: null, fallbackDeliveryId: hash }
    return {
      type,
      fallbackDeliveryId: `${type}:${providerRefundId}:${refundStatus ?? ''}`,
      event: {
        kind: 'refund_updated',
        provider: 'cashfree',
        providerOrderId,
        providerPaymentId: text(refund.cf_payment_id),
        providerRefundId,
        refundId: text(refund.refund_id),
        amountMinor: decimalAmountToMinor(refund.refund_amount),
        status: mapCashfreeRefundStatus(refundStatus),
      },
    }
  }

  return { type, event: null, fallbackDeliveryId: hash }
}

export function createCashfreeWebhookHandler(deps: {
  getGateway: () => Promise<PaymentGateway | null>
  resolveHandler: (providerOrderId: string) => PaymentOrderHandler | null
  transaction?: typeof withTransaction
  log?: (message: string, details?: Record<string, unknown>) => void
}) {
  const transaction = deps.transaction ?? withTransaction
  const log = deps.log ?? ((message, details) => console.error(message, details ?? {}))

  /**
   * Verifies the raw body first, then processes each delivery once. Throws
   * PaymentVerificationError (answer 400) or a gateway/database error (answer 5xx so
   * Cashfree retries; the delivery record rolls back with the failed transaction).
   */
  return async function handleCashfreeWebhook(input: { rawBody: string; headers: HeaderLookup }): Promise<CashfreeWebhookResult | null> {
    const gateway = await deps.getGateway()
    if (!gateway) return null
    if (!gateway.verifyWebhook(input.rawBody, input.headers)) throw new PaymentVerificationError()

    const parsed = parseCashfreeWebhook(input.rawBody)
    if (!parsed) return { status: 'ignored', type: 'unknown', reason: 'invalid_json' }
    if (!parsed.event) return { status: 'ignored', type: parsed.type, reason: 'not_needed' }
    const event = parsed.event
    const handler = deps.resolveHandler(event.providerOrderId)
    if (!handler) return { status: 'ignored', type: parsed.type, reason: 'unknown_order_prefix' }

    // The docs name the header x-idempotency-key (payments reference) and x-idempotency-header (overview).
    const idempotency = input.headers.get('x-idempotency-key')?.trim() || input.headers.get('x-idempotency-header')?.trim()
    const deliveryId = idempotency ? `${parsed.type}:${idempotency}` : parsed.fallbackDeliveryId

    const outcome = await transaction(async (client): Promise<OrderHandlerResult | 'duplicate'> => {
      const first = await recordWebhookDelivery(client, 'cashfree', deliveryId, parsed.type)
      if (!first) return 'duplicate'
      return handler.applyGatewayEvent(client, event)
    })
    if (outcome === 'duplicate') return { status: 'duplicate', type: parsed.type }

    if (outcome.afterCommit) {
      try {
        await outcome.afterCommit()
      } catch (error) {
        log('cashfree_webhook_after_commit_failed', { type: parsed.type, message: error instanceof Error ? error.message : null })
      }
    }
    if (!outcome.handled) return { status: 'ignored', type: parsed.type, reason: outcome.reason ?? 'not_handled' }
    return { status: 'handled', type: parsed.type, revalidatePaths: outcome.revalidatePaths ?? [] }
  }
}
