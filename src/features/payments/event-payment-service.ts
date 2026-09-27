import { createHash } from 'node:crypto'
import { withTransaction, type DatabaseQueryClient } from '@/lib/db/client'
import { GATEWAY_ORDER_LIFETIME_MINUTES } from './event-payment-rules'
import {
  eventPaymentRepository,
  EventRegistrationError,
  type ConfirmPaymentOutcome,
  type EventPaymentOrder,
  type PaymentActor,
} from './event-payment-repository'
import type { GatewayOrderEvent, OrderHandlerResult } from './order-handler-types'
import { gatewayOrderId, refundIdFor } from './order-ids'
import {
  PaymentProviderError,
  PaymentVerificationError,
  type CheckoutClient,
  type CheckoutCustomer,
  type CheckoutProof,
  type HeaderLookup,
  type PaymentCurrency,
  type PaymentGateway,
  type PaymentProviderName,
} from './types'

export { PaymentVerificationError } from './types'

type Repository = typeof eventPaymentRepository
type RunInTransaction = typeof withTransaction

/** What the browser gets to open checkout. Never contains secrets. */
export type EventCheckoutSession = {
  orderId: string
  client: CheckoutClient
  amountMinor: number
  currency: PaymentCurrency
  eventTitle: string
}

/** Result of asking the gateway about an order. */
export type EventConfirmOutcome =
  | ConfirmPaymentOutcome
  | { state: 'processing'; order: EventPaymentOrder }
  | { state: 'not_paid'; order: EventPaymentOrder }
  | { state: 'failed'; order: EventPaymentOrder; message: string | null }
  | { state: 'expired'; order: EventPaymentOrder }

export type EventRefundOutcome =
  | { state: 'refunded'; order: EventPaymentOrder }
  | { state: 'refund_pending'; order: EventPaymentOrder }

export class PaymentsNotConfiguredError extends Error {
  constructor() {
    super('payments_not_configured')
    this.name = 'PaymentsNotConfiguredError'
  }
}

export class PaymentGatewayUnavailableError extends Error {
  constructor() {
    super('payment_gateway_unavailable')
    this.name = 'PaymentGatewayUnavailableError'
  }
}

/** The gateway needs the buyer's mobile number and we do not have one. */
export class CustomerPhoneRequiredError extends Error {
  constructor() {
    super('customer_phone_required')
    this.name = 'CustomerPhoneRequiredError'
  }
}

/** The gateway refused the buyer's mobile number (e.g. not a real mobile). Ask for another. */
export class CustomerPhoneRejectedError extends Error {
  constructor() {
    super('customer_phone_rejected')
    this.name = 'CustomerPhoneRejectedError'
  }
}

export class RefundFailedError extends Error {
  constructor(readonly providerMessage: string | null) {
    super('refund_failed')
    this.name = 'RefundFailedError'
  }
}

/** Absolute site URL for gateway redirects and webhooks, or null (then none are sent). */
export function siteUrlFromEnvironment(environment: Record<string, string | undefined> = process.env) {
  const value = environment.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, '')
  return value && /^https?:\/\//.test(value) ? value : null
}

export function paymentReturnUrl(siteUrl: string | null, providerOrderId: string) {
  return siteUrl ? `${siteUrl}/payments/return?order=${encodeURIComponent(providerOrderId)}` : null
}

export function cashfreeNotifyUrl(siteUrl: string | null) {
  return siteUrl?.startsWith('https://') ? `${siteUrl}/api/payments/cashfree/webhook` : null
}

export function createEventPaymentService(deps: {
  /** Gateway for new checkouts (provider.ts getPaymentGateway). */
  getGateway: () => Promise<PaymentGateway | null>
  /** Gateway that created an existing order (provider.ts getGatewayByName). */
  getGatewayByName: (name: PaymentProviderName) => Promise<PaymentGateway | null>
  repository?: Repository
  transaction?: RunInTransaction
  log?: (message: string, details?: Record<string, unknown>) => void
  siteUrl?: () => string | null
  now?: () => Date
}) {
  const repository = deps.repository ?? eventPaymentRepository
  const transaction = deps.transaction ?? withTransaction
  const log = deps.log ?? ((message, details) => console.error(message, details ?? {}))
  const siteUrl = deps.siteUrl ?? (() => siteUrlFromEnvironment())
  const now = deps.now ?? (() => new Date())

  async function requireGateway() {
    const gateway = await deps.getGateway()
    if (!gateway) throw new PaymentsNotConfiguredError()
    return gateway
  }

  async function gatewayFor(order: EventPaymentOrder) {
    const gateway = await deps.getGatewayByName(order.provider)
    if (!gateway) throw new PaymentsNotConfiguredError()
    return gateway
  }

  /**
   * Sends money back through the gateway that took it. Marks the order 'requested'
   * first (so a double click cannot refund twice), then refunded / failed. The seat
   * is released and the seller's earning reversed in the same transaction.
   */
  async function refundOrder(input: { orderId: string; actor: PaymentActor; reason: string }): Promise<EventRefundOutcome> {
    const existing = await repository.getOrderById(input.orderId)
    if (!existing) throw new EventRegistrationError('order_not_found')
    const gateway = await gatewayFor(existing)
    const { order, attempt } = await transaction((client) => repository.requestRefund(client, input))

    let result
    try {
      result = await gateway.refund({
        providerOrderId: order.providerOrderId!,
        providerPaymentId: order.providerPaymentId!,
        amountMinor: order.amountMinor,
        currency: order.currency,
        refundId: refundIdFor(order.id, attempt),
        note: 'Sea N Shore event ticket refund',
      })
    } catch (error) {
      const message = error instanceof PaymentProviderError ? error.providerMessage ?? error.code : 'refund_request_failed'
      await transaction((client) => repository.recordRefundFailure(client, { orderId: order.id, reason: message, actor: input.actor }))
      log('event_payment_refund_failed', { orderId: order.id, message })
      throw new RefundFailedError(error instanceof PaymentProviderError ? error.providerMessage : null)
    }

    if (result.status === 'failed') {
      await transaction((client) => repository.recordRefundFailure(client, { orderId: order.id, reason: 'gateway_rejected', actor: input.actor, providerRefundId: result.providerRefundId }))
      throw new RefundFailedError(null)
    }
    const refunded = await transaction((client) => repository.markOrderRefunded(client, order.id, {
      providerRefundId: result.providerRefundId,
      refundStatus: result.status === 'processed' ? 'processed' : 'pending',
      actor: input.actor,
      reason: input.reason,
    }))
    const final = refunded ?? order
    return result.status === 'processed' ? { state: 'refunded', order: final } : { state: 'refund_pending', order: final }
  }

  /** Tries to return money for a payment whose seat could not be confirmed. */
  async function refundIfDue(outcome: EventConfirmOutcome): Promise<EventConfirmOutcome> {
    if (outcome.state !== 'refund_due' || !outcome.order.providerPaymentId) return outcome
    try {
      const refunded = await refundOrder({ orderId: outcome.order.id, actor: { type: 'system' }, reason: outcome.reason })
      return { state: 'refunded', order: refunded.order }
    } catch (error) {
      log('event_payment_auto_refund_failed', {
        orderId: outcome.order.id,
        reason: outcome.reason,
        message: error instanceof Error ? error.message : null,
      })
      return outcome
    }
  }

  async function startCheckout(input: { profileId: string; eventId: string; customer: CheckoutCustomer }): Promise<EventCheckoutSession> {
    const gateway = await requireGateway()
    if (gateway.requiresCustomerPhone && !input.customer.phone) throw new CustomerPhoneRequiredError()
    const prepared = await repository.prepareCheckoutOrder({
      profileId: input.profileId,
      eventId: input.eventId,
      provider: gateway.name,
      currencies: gateway.currencies,
    })
    let order = prepared.order
    if (prepared.reused && order.providerOrderId) {
      const client = gateway.restoreCheckout({
        providerOrderId: order.providerOrderId,
        providerSessionId: order.providerSessionId,
        amountMinor: order.amountMinor,
        currency: order.currency,
      })
      if (client) return { orderId: order.id, client, amountMinor: order.amountMinor, currency: order.currency, eventTitle: order.eventTitle }
    }

    const reference = gatewayOrderId('event', order.id)
    let client: CheckoutClient
    try {
      const checkout = await gateway.createCheckout({
        gatewayOrderId: reference,
        amountMinor: order.amountMinor,
        currency: order.currency,
        customer: input.customer,
        description: order.eventTitle || 'Sea N Shore event ticket',
        returnUrl: paymentReturnUrl(siteUrl(), reference),
        notifyUrl: cashfreeNotifyUrl(siteUrl()),
        expiresAt: new Date(now().getTime() + GATEWAY_ORDER_LIFETIME_MINUTES * 60_000),
        notes: { sns_order_id: order.id, sns_event_id: input.eventId, sns_profile_id: input.profileId },
      })
      order = await repository.attachProviderOrder(order.id, checkout.providerOrderId, checkout.providerSessionId)
      client = checkout.client
    } catch (error) {
      await repository.markOrderFailed(order.id, 'provider_order_failed')
      if (error instanceof PaymentProviderError && error.status === 400 && /phone/i.test(error.providerMessage ?? '')) {
        throw new CustomerPhoneRejectedError()
      }
      log('event_payment_order_create_failed', {
        orderId: order.id,
        provider: gateway.name,
        message: error instanceof PaymentProviderError ? `${error.code}:${error.status ?? ''}:${error.providerMessage ?? ''}` : error instanceof Error ? error.message : null,
      })
      throw new PaymentGatewayUnavailableError()
    }
    return { orderId: order.id, client, amountMinor: order.amountMinor, currency: order.currency, eventTitle: order.eventTitle }
  }

  /** Asks the order's gateway, server to server, and applies the answer. */
  async function confirmOrder(order: EventPaymentOrder, proof: CheckoutProof | undefined, actor: PaymentActor): Promise<EventConfirmOutcome> {
    if (order.status === 'paid' || order.status === 'refunded') {
      const outcome = await transaction((client) => repository.confirmPaidOrder(client, { orderId: order.id, providerPaymentId: order.providerPaymentId ?? '' }))
      return outcome
    }
    if (!order.providerOrderId) throw new EventRegistrationError('order_not_found')
    const gateway = await gatewayFor(order)
    const confirmation = await gateway.confirmOrder(order.providerOrderId, proof)

    if (confirmation.status === 'paid' && confirmation.providerPaymentId) {
      const outcome = await transaction((client) => repository.confirmPaidOrder(client, {
        orderId: order.id,
        providerPaymentId: confirmation.providerPaymentId!,
        amountMinor: confirmation.amountMinor ?? undefined,
        currency: confirmation.currency ?? undefined,
        actor,
      }))
      return refundIfDue(outcome)
    }
    if (confirmation.status === 'cancelled') {
      await repository.markOrderFailed(order.id, 'checkout_expired')
      return { state: 'expired', order }
    }
    if (confirmation.status === 'failed') return { state: 'failed', order, message: confirmation.failureMessage }
    if (confirmation.lastAttempt === 'processing') return { state: 'processing', order }
    return { state: 'not_paid', order }
  }

  /** The buyer's browser says checkout finished. Only the gateway's answer counts. */
  async function confirmCheckout(input: { profileId: string; orderId: string; proof?: CheckoutProof }): Promise<EventConfirmOutcome> {
    const order = await repository.getOrderForProfile(input.orderId, input.profileId)
    if (!order) throw new EventRegistrationError('order_not_found')
    return confirmOrder(order, input.proof, { type: 'member', profileId: input.profileId })
  }

  /** Return page: the buyer came back with the gateway order id. */
  async function confirmByProviderOrderId(input: { profileId: string; providerOrderId: string }): Promise<EventConfirmOutcome | null> {
    const order = await repository.getOrderForProfileByProviderOrderId(input.providerOrderId, input.profileId)
    if (!order) return null
    return confirmOrder(order, undefined, { type: 'member', profileId: input.profileId })
  }

  /**
   * A verified gateway event for an event-ticket order (Cashfree webhook). Runs inside
   * the webhook transaction; refunds happen after it commits.
   */
  async function applyGatewayEvent(tx: DatabaseQueryClient, event: GatewayOrderEvent): Promise<OrderHandlerResult> {
    const order = await repository.findOrderByProviderOrderId(tx, event.provider, event.providerOrderId)
    if (!order) return { handled: false, reason: 'order_unknown' }
    const paths = order.eventId ? eventPaths(order.eventId) : []
    const actor: PaymentActor = { type: 'provider' }

    if (event.kind === 'payment_succeeded') {
      const outcome = await repository.confirmPaidOrder(tx, {
        orderId: order.id,
        providerPaymentId: event.providerPaymentId,
        providerOrderId: event.providerOrderId,
        amountMinor: event.amountMinor ?? undefined,
        currency: event.currency ?? undefined,
        actor,
      })
      return {
        handled: true,
        revalidatePaths: paths,
        afterCommit: outcome.state === 'refund_due' ? async () => { await refundIfDue(outcome) } : undefined,
      }
    }

    if (event.kind === 'payment_failed') {
      await repository.recordAttemptFailure(tx, {
        provider: event.provider,
        providerOrderId: event.providerOrderId,
        providerPaymentId: event.providerPaymentId,
        reason: event.reason,
        dropped: event.dropped,
      })
      return { handled: true, revalidatePaths: paths }
    }

    if (event.status === 'failed') {
      await repository.recordRefundFailure(tx, { orderId: order.id, reason: 'gateway_refund_failed', actor, providerRefundId: event.providerRefundId })
    } else {
      await repository.markOrderRefunded(tx, order.id, { providerRefundId: event.providerRefundId, refundStatus: event.status, actor })
    }
    return { handled: true, revalidatePaths: paths }
  }

  /**
   * Razorpay webhook (kept working alongside Cashfree). The raw body is verified with
   * the Razorpay webhook secret before anything is parsed; each delivery is processed once.
   */
  async function handleRazorpayWebhook(input: { rawBody: string; headers: HeaderLookup }) {
    const gateway = await deps.getGatewayByName('razorpay')
    if (!gateway) throw new PaymentsNotConfiguredError()
    if (!gateway.verifyWebhook(input.rawBody, input.headers)) throw new PaymentVerificationError()

    let payload: RazorpayWebhookPayload
    try {
      payload = JSON.parse(input.rawBody) as RazorpayWebhookPayload
    } catch {
      return { handled: false as const, reason: 'invalid_json' }
    }
    const eventType = typeof payload.event === 'string' ? payload.event : 'unknown'
    const deliveryId = input.headers.get('x-razorpay-event-id')?.trim() || createHash('sha256').update(input.rawBody).digest('hex')
    const payment = entity(payload, 'payment')
    const orderEntity = entity(payload, 'order')
    const refund = entity(payload, 'refund')
    const actor: PaymentActor = { type: 'provider' }

    const result = await transaction(async (client) => {
      const firstDelivery = await repository.recordWebhookEvent(client, 'razorpay', deliveryId, eventType)
      if (!firstDelivery) return { handled: false as const, reason: 'duplicate' }

      const providerOrderId = text(payment.order_id) ?? text(orderEntity.id)
      const order = providerOrderId ? await repository.findOrderByProviderOrderId(client, 'razorpay', providerOrderId) : null

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
            actor,
          })
          return { handled: true as const, outcome }
        }
        case 'payment.authorized': {
          if (!order || !providerOrderId) return { handled: false as const, reason: 'order_unknown' }
          return { handled: true as const, capture: { order, providerOrderId } }
        }
        case 'payment.failed': {
          if (!providerOrderId) return { handled: false as const, reason: 'order_unknown' }
          const description = text(payment.error_description) ?? 'payment_failed'
          await repository.markFailedByProviderOrder(client, 'razorpay', providerOrderId, description)
          return { handled: true as const }
        }
        case 'refund.processed':
        case 'payment.refunded': {
          const providerPaymentId = text(refund.payment_id) ?? text(payment.id)
          const refundedOrder = providerPaymentId
            ? await repository.findOrderByProviderPaymentId(client, 'razorpay', providerPaymentId)
            : null
          if (!refundedOrder) return { handled: false as const, reason: 'order_unknown' }
          const paymentAmount = typeof payment.amount === 'number' ? payment.amount : null
          const refundedAmount = typeof payment.amount_refunded === 'number' ? payment.amount_refunded : null
          const fullyRefunded = eventType === 'payment.refunded'
            || text(payment.status) === 'refunded'
            || (paymentAmount !== null && refundedAmount !== null && refundedAmount >= paymentAmount)
          if (!fullyRefunded) return { handled: false as const, reason: 'partial_refund' }
          await repository.markOrderRefunded(client, refundedOrder.id, { providerRefundId: text(refund.id), refundStatus: 'processed', actor })
          return { handled: true as const, eventId: refundedOrder.eventId }
        }
        default:
          return { handled: false as const, reason: 'ignored' }
      }
    })

    if (result.handled && 'capture' in result && result.capture) {
      try {
        // Reading the order's payments captures an authorised payment.
        await gateway.confirmOrder(result.capture.providerOrderId)
      } catch (error) {
        log('event_payment_capture_check_failed', {
          orderId: result.capture.order.id,
          message: error instanceof Error ? error.message : null,
        })
      }
    }
    if (result.handled && 'outcome' in result && result.outcome) {
      await refundIfDue(result.outcome)
    }
    return result
  }

  return {
    startCheckout,
    confirmCheckout,
    confirmByProviderOrderId,
    refundOrder,
    applyGatewayEvent,
    handleRazorpayWebhook,
  }
}

export function eventPaths(eventId: string) {
  return ['/events', '/events/my', '/events/hosting', `/events/${eventId}`, `/events/${eventId}/registrations`]
}

type RazorpayWebhookPayload = {
  event?: unknown
  payload?: Record<string, { entity?: Record<string, unknown> } | undefined>
}

function entity(payload: RazorpayWebhookPayload, name: string): Record<string, unknown> {
  const value = payload.payload?.[name]?.entity
  return value && typeof value === 'object' ? value : {}
}

function text(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}
