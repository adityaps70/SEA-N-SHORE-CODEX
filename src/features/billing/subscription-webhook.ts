import { createHash } from 'node:crypto'
import { mapCashfreeSubscriptionPayment, normalizePaymentMethod, type CashfreeSubscriptionPayment } from './cashfree-subscriptions'

/**
 * Cashfree subscription webhooks (reference section 2.7), after the signature check:
 *   SUBSCRIPTION_STATUS_CHANGED, SUBSCRIPTION_AUTH_STATUS                 -> status
 *   SUBSCRIPTION_PAYMENT_SUCCESS / _FAILED / _CANCELLED                   -> payment
 *   everything else (pre-debit notices, refunds, card expiry reminders…) -> ignored
 * The payload samples are 2025-01-01; field names are read defensively.
 */

export type SubscriptionWebhookEvent =
  | {
      kind: 'status'
      subscriptionId: string
      cfSubscriptionId: string | null
      status: string
      authorizationStatus: string | null
      nextScheduleDate: string | null
      paymentMethod: string | null
      failureReason: string | null
      occurredAt: string | null
    }
  | {
      kind: 'payment'
      subscriptionId: string
      payment: CashfreeSubscriptionPayment
      occurredAt: string | null
    }

export type ParsedSubscriptionWebhook = {
  type: string
  event: SubscriptionWebhookEvent | null
  /** Stable id for de-duplication when the idempotency header is missing. */
  fallbackDeliveryId: string
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function text(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/** True when a Cashfree webhook body is about subscriptions (so it belongs to billing). */
export function isSubscriptionWebhookBody(rawBody: string) {
  try {
    const payload = record(JSON.parse(rawBody))
    const type = text(payload.type) ?? text(record(payload.data).type)
    return Boolean(type?.startsWith('SUBSCRIPTION_'))
  } catch {
    return false
  }
}

export function parseSubscriptionWebhook(rawBody: string): ParsedSubscriptionWebhook | null {
  let payload: Record<string, unknown>
  try {
    payload = record(JSON.parse(rawBody))
  } catch {
    return null
  }
  const data = record(payload.data)
  const type = text(payload.type) ?? text(data.type) ?? 'unknown'
  const occurredAt = text(payload.event_time) ?? text(data.event_time)
  const hash = createHash('sha256').update(rawBody).digest('hex')
  const details = record(data.subscription_details)
  const subscriptionId = text(details.subscription_id) ?? text(data.subscription_id)

  if (type === 'SUBSCRIPTION_STATUS_CHANGED' || type === 'SUBSCRIPTION_AUTH_STATUS') {
    const authorization = { ...record(data.authorisation_details), ...record(data.authorization_details) }
    const authorizationStatus = text(authorization.authorization_status)
    const status = text(details.subscription_status) ?? text(data.subscription_status)
      ?? (authorizationStatus?.toUpperCase() === 'ACTIVE' ? 'ACTIVE' : authorizationStatus ? 'INITIALIZED' : null)
    if (!subscriptionId || !status) return { type, event: null, fallbackDeliveryId: hash }
    return {
      type,
      fallbackDeliveryId: `${type}:${subscriptionId}:${status}:${authorizationStatus ?? ''}:${occurredAt ?? hash}`,
      event: {
        kind: 'status',
        subscriptionId,
        cfSubscriptionId: text(details.cf_subscription_id) ?? text(data.cf_subscription_id),
        status,
        authorizationStatus,
        nextScheduleDate: text(details.next_schedule_date),
        paymentMethod: normalizePaymentMethod(authorization.payment_method ?? authorization.payment_group),
        failureReason: text(record(authorization.failure_details).failure_reason) ?? text(authorization.failure_reason),
        occurredAt,
      },
    }
  }

  if (type === 'SUBSCRIPTION_PAYMENT_SUCCESS' || type === 'SUBSCRIPTION_PAYMENT_FAILED' || type === 'SUBSCRIPTION_PAYMENT_CANCELLED') {
    const fallbackStatus = type === 'SUBSCRIPTION_PAYMENT_SUCCESS' ? 'SUCCESS' : type === 'SUBSCRIPTION_PAYMENT_FAILED' ? 'FAILED' : 'CANCELLED'
    const payment = mapCashfreeSubscriptionPayment({ payment_status: fallbackStatus, ...data })
    if (!subscriptionId || !payment) return { type, event: null, fallbackDeliveryId: hash }
    // The webhook type is the authority on the outcome.
    const normalized: CashfreeSubscriptionPayment = { ...payment, status: fallbackStatus }
    return {
      type,
      fallbackDeliveryId: `${type}:${payment.cfPaymentId ?? payment.paymentId}`,
      event: { kind: 'payment', subscriptionId, payment: normalized, occurredAt },
    }
  }

  return { type, event: null, fallbackDeliveryId: hash }
}
