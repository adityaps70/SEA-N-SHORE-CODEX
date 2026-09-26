import { createHash } from 'node:crypto'
import { withTransaction } from '@/lib/db/client'
import { eventPaymentRepository, EventRegistrationError, type ConfirmPaymentOutcome, type EventPaymentOrder } from './event-payment-repository'
import type { PaymentProvider } from './types'

type Repository = typeof eventPaymentRepository
type RunInTransaction = typeof withTransaction

export type CheckoutSession = {
  orderId: string
  providerOrderId: string
  keyId: string
  amountMinor: number
  currency: string
  eventTitle: string
}

export class PaymentsNotConfiguredError extends Error {
  constructor() {
    super('payments_not_configured')
    this.name = 'PaymentsNotConfiguredError'
  }
}

export class PaymentVerificationError extends Error {
  constructor() {
    super('payment_signature_invalid')
    this.name = 'PaymentVerificationError'
  }
}

export class PaymentGatewayUnavailableError extends Error {
  constructor() {
    super('payment_gateway_unavailable')
    this.name = 'PaymentGatewayUnavailableError'
  }
}

export function createEventPaymentService(deps: {
  getProvider: () => Promise<PaymentProvider | null>
  repository?: Repository
  transaction?: RunInTransaction
  log?: (message: string, details?: Record<string, unknown>) => void
}) {
  const repository = deps.repository ?? eventPaymentRepository
  const transaction = deps.transaction ?? withTransaction
  const log = deps.log ?? ((message, details) => console.error(message, details ?? {}))

  async function requireProvider() {
    const provider = await deps.getProvider()
    if (!provider) throw new PaymentsNotConfiguredError()
    return provider
  }

  /** Tries to return money for a payment whose seat could not be confirmed. */
  async function refundIfDue(provider: PaymentProvider, outcome: ConfirmPaymentOutcome): Promise<ConfirmPaymentOutcome> {
    if (outcome.state !== 'refund_due' || !outcome.order.providerPaymentId) return outcome
    try {
      await provider.refundPayment(outcome.order.providerPaymentId, outcome.order.amountMinor, {
        sns_order_id: outcome.order.id,
        reason: outcome.reason,
      })
      const refunded = await transaction((client) => repository.markOrderRefunded(client, outcome.order.id))
      return refunded ? { state: 'refunded', order: refunded } : outcome
    } catch (error) {
      log('event_payment_auto_refund_failed', {
        orderId: outcome.order.id,
        reason: outcome.reason,
        message: error instanceof Error ? error.message : null,
      })
      return outcome
    }
  }

  /** Captures an authorised payment so the money is actually collected. Best effort. */
  async function ensureCaptured(provider: PaymentProvider, order: EventPaymentOrder, providerPaymentId: string) {
    try {
      const payment = await provider.fetchPayment(providerPaymentId)
      if (payment.status === 'authorized') {
        await provider.capturePayment(providerPaymentId, order.amountMinor, order.currency)
      }
    } catch (error) {
      log('event_payment_capture_check_failed', {
        orderId: order.id,
        message: error instanceof Error ? error.message : null,
      })
    }
  }

  async function startCheckout(input: { profileId: string; eventId: string }): Promise<CheckoutSession> {
    const provider = await requireProvider()
    const prepared = await repository.prepareCheckoutOrder({
      profileId: input.profileId,
      eventId: input.eventId,
      provider: provider.name,
    })
    let order = prepared.order
    if (!prepared.reused || !order.providerOrderId) {
      try {
        const providerOrder = await provider.createOrder({
          amountMinor: order.amountMinor,
          currency: order.currency,
          receipt: order.id,
          notes: {
            sns_order_id: order.id,
            sns_event_id: input.eventId,
            sns_profile_id: input.profileId,
          },
        })
        order = await repository.attachProviderOrder(order.id, providerOrder.providerOrderId)
      } catch (error) {
        await repository.markOrderFailed(order.id, 'provider_order_failed')
        log('event_payment_order_create_failed', {
          orderId: order.id,
          message: error instanceof Error ? error.message : null,
        })
        throw new PaymentGatewayUnavailableError()
      }
    }
    return {
      orderId: order.id,
      providerOrderId: order.providerOrderId!,
      keyId: provider.publicKeyId,
      amountMinor: order.amountMinor,
      currency: order.currency,
      eventTitle: order.eventTitle,
    }
  }

  /** Browser callback after Checkout succeeds. The signature proves Razorpay issued this payment for this order. */
  async function confirmCheckout(input: {
    profileId: string
    orderId: string
    providerOrderId: string
    providerPaymentId: string
    signature: string
  }): Promise<ConfirmPaymentOutcome> {
    const provider = await requireProvider()
    const order = await repository.getOrderForProfile(input.orderId, input.profileId)
    if (!order || !order.providerOrderId || order.providerOrderId !== input.providerOrderId) {
      throw new EventRegistrationError('order_not_found')
    }
    const valid = provider.verifyCheckoutSignature({
      providerOrderId: order.providerOrderId,
      providerPaymentId: input.providerPaymentId,
      signature: input.signature,
    })
    if (!valid) throw new PaymentVerificationError()

    await ensureCaptured(provider, order, input.providerPaymentId)
    const outcome = await transaction((client) => repository.confirmPaidOrder(client, {
      orderId: order.id,
      providerPaymentId: input.providerPaymentId,
    }))
    return refundIfDue(provider, outcome)
  }

  async function handleWebhook(input: { rawBody: string; signature: string | null; deliveryId: string | null }) {
    const provider = await requireProvider()
    if (!provider.verifyWebhookSignature(input.rawBody, input.signature)) throw new PaymentVerificationError()

    let payload: WebhookPayload
    try {
      payload = JSON.parse(input.rawBody) as WebhookPayload
    } catch {
      return { handled: false as const, reason: 'invalid_json' }
    }
    const eventType = typeof payload.event === 'string' ? payload.event : 'unknown'
    const deliveryId = input.deliveryId?.trim() || createHash('sha256').update(input.rawBody).digest('hex')
    const payment = entity(payload, 'payment')
    const orderEntity = entity(payload, 'order')
    const refund = entity(payload, 'refund')

    const result = await transaction(async (client) => {
      const firstDelivery = await repository.recordWebhookEvent(client, provider.name, deliveryId, eventType)
      if (!firstDelivery) return { handled: false as const, reason: 'duplicate' }

      const providerOrderId = text(payment.order_id) ?? text(orderEntity.id)
      const order = providerOrderId ? await repository.findOrderByProviderOrderId(client, provider.name, providerOrderId) : null

      switch (eventType) {
        case 'payment.captured':
        case 'order.paid': {
          const providerPaymentId = text(payment.id)
          if (!order || !providerPaymentId) return { handled: false as const, reason: 'order_unknown' }
          const outcome = await repository.confirmPaidOrder(client, {
            orderId: order.id,
            providerPaymentId,
            amountMinor: typeof payment.amount === 'number' ? payment.amount : undefined,
            currency: text(payment.currency) ?? undefined,
          })
          return { handled: true as const, outcome }
        }
        case 'payment.authorized': {
          const providerPaymentId = text(payment.id)
          if (!order || !providerPaymentId) return { handled: false as const, reason: 'order_unknown' }
          return { handled: true as const, capture: { order, providerPaymentId } }
        }
        case 'payment.failed': {
          if (!providerOrderId) return { handled: false as const, reason: 'order_unknown' }
          const description = text(payment.error_description) ?? 'payment_failed'
          await repository.markFailedByProviderOrder(client, provider.name, providerOrderId, description)
          return { handled: true as const }
        }
        case 'refund.processed':
        case 'payment.refunded': {
          const providerPaymentId = text(refund.payment_id) ?? text(payment.id)
          const refundedOrder = providerPaymentId
            ? await repository.findOrderByProviderPaymentId(client, provider.name, providerPaymentId)
            : null
          if (!refundedOrder) return { handled: false as const, reason: 'order_unknown' }
          const paymentAmount = typeof payment.amount === 'number' ? payment.amount : null
          const refundedAmount = typeof payment.amount_refunded === 'number' ? payment.amount_refunded : null
          const fullyRefunded = eventType === 'payment.refunded'
            || text(payment.status) === 'refunded'
            || (paymentAmount !== null && refundedAmount !== null && refundedAmount >= paymentAmount)
          if (!fullyRefunded) return { handled: false as const, reason: 'partial_refund' }
          await repository.markOrderRefunded(client, refundedOrder.id)
          return { handled: true as const }
        }
        default:
          return { handled: false as const, reason: 'ignored' }
      }
    })

    if (result.handled && 'capture' in result && result.capture) {
      await ensureCaptured(provider, result.capture.order, result.capture.providerPaymentId)
    }
    if (result.handled && 'outcome' in result && result.outcome) {
      await refundIfDue(provider, result.outcome)
    }
    return result
  }

  return { startCheckout, confirmCheckout, handleWebhook }
}

type WebhookPayload = {
  event?: unknown
  payload?: Record<string, { entity?: Record<string, unknown> } | undefined>
}

function entity(payload: WebhookPayload, name: string): Record<string, unknown> {
  const value = payload.payload?.[name]?.entity
  return value && typeof value === 'object' ? value : {}
}

function text(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}
