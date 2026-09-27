import { withTransaction, type DatabaseQueryClient } from '@/lib/db/client'
import { GATEWAY_ORDER_LIFETIME_MINUTES } from '@/features/payments/event-payment-rules'
import {
  cashfreeNotifyUrl,
  CustomerPhoneRejectedError,
  CustomerPhoneRequiredError,
  PaymentGatewayUnavailableError,
  PaymentsNotConfiguredError,
  paymentReturnUrl,
  RefundFailedError,
  siteUrlFromEnvironment,
} from '@/features/payments/event-payment-service'
import type { GatewayOrderEvent, OrderHandlerResult } from '@/features/payments/order-handler-types'
import { gatewayOrderId, refundIdFor } from '@/features/payments/order-ids'
import {
  PaymentProviderError,
  type CheckoutClient,
  type CheckoutCustomer,
  type CheckoutProof,
  type PaymentCurrency,
  type PaymentGateway,
  type PaymentProviderName,
} from '@/features/payments/types'
import {
  coursePaymentRepository,
  CoursePurchaseError,
  type CourseConfirmOutcome,
  type CoursePaymentActor,
  type CoursePaymentOrder,
} from './course-payment-repository'

type Repository = typeof coursePaymentRepository
type RunInTransaction = typeof withTransaction

/** What the browser gets to open checkout. Never contains secrets. */
export type CourseCheckoutSession = {
  orderId: string
  client: CheckoutClient
  amountMinor: number
  currency: PaymentCurrency
  courseTitle: string
}

/** Result of asking the gateway about a course order. */
export type CourseCheckoutOutcome =
  | CourseConfirmOutcome
  | { state: 'processing'; order: CoursePaymentOrder }
  | { state: 'not_paid'; order: CoursePaymentOrder }
  | { state: 'failed'; order: CoursePaymentOrder; message: string | null }
  | { state: 'expired'; order: CoursePaymentOrder }

export type CourseRefundOutcome =
  | { state: 'refunded'; order: CoursePaymentOrder }
  | { state: 'refund_pending'; order: CoursePaymentOrder }

/** Pages to refresh after a purchase or refund changes. */
export function coursePurchasePaths(courseSlug: string | null) {
  return ['/learn', '/learn/my-learning', '/learn/studio/sales', ...(courseSlug ? [`/learn/courses/${courseSlug}`, `/learn/courses/${courseSlug}/learn`] : [])]
}

export function createCoursePaymentService(deps: {
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
  const repository = deps.repository ?? coursePaymentRepository
  const transaction = deps.transaction ?? withTransaction
  const log = deps.log ?? ((message, details) => console.error(message, details ?? {}))
  const siteUrl = deps.siteUrl ?? (() => siteUrlFromEnvironment())
  const now = deps.now ?? (() => new Date())

  async function gatewayFor(order: CoursePaymentOrder) {
    const gateway = await deps.getGatewayByName(order.provider)
    if (!gateway) throw new PaymentsNotConfiguredError()
    return gateway
  }

  /**
   * Sends the money back through the gateway that took it. The order is marked
   * 'requested' first (a double click cannot refund twice), then refunded or failed.
   * Course access ends and the seller's earning is reversed in the same transaction.
   */
  async function refundOrder(input: { orderId: string; actor: CoursePaymentActor; reason: string }): Promise<CourseRefundOutcome> {
    const existing = await repository.getOrderById(input.orderId)
    if (!existing) throw new CoursePurchaseError('order_not_found')
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
        note: 'Sea N Shore course refund',
      })
    } catch (error) {
      const message = error instanceof PaymentProviderError ? error.providerMessage ?? error.code : 'refund_request_failed'
      await transaction((client) => repository.recordRefundFailure(client, { orderId: order.id, reason: message, actor: input.actor }))
      log('course_payment_refund_failed', { orderId: order.id, message })
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

  /** Returns the money for a payment that could not unlock the course (e.g. a duplicate). */
  async function refundIfDue(outcome: CourseCheckoutOutcome): Promise<CourseCheckoutOutcome> {
    if (outcome.state !== 'refund_due' || !outcome.order.providerPaymentId) return outcome
    try {
      const refunded = await refundOrder({ orderId: outcome.order.id, actor: { type: 'system' }, reason: outcome.reason })
      return { state: 'refunded', order: refunded.order }
    } catch (error) {
      log('course_payment_auto_refund_failed', {
        orderId: outcome.order.id,
        reason: outcome.reason,
        message: error instanceof Error ? error.message : null,
      })
      return outcome
    }
  }

  async function startCheckout(input: { profileId: string; courseId: string; customer: CheckoutCustomer }): Promise<CourseCheckoutSession> {
    const gateway = await deps.getGateway()
    if (!gateway) throw new PaymentsNotConfiguredError()
    if (gateway.requiresCustomerPhone && !input.customer.phone) throw new CustomerPhoneRequiredError()
    const prepared = await repository.prepareCheckoutOrder({
      profileId: input.profileId,
      courseId: input.courseId,
      provider: gateway.name,
      currencies: gateway.currencies,
      now: now(),
    })
    let order = prepared.order
    if (prepared.reused && order.providerOrderId) {
      const client = gateway.restoreCheckout({
        providerOrderId: order.providerOrderId,
        providerSessionId: order.providerSessionId,
        amountMinor: order.amountMinor,
        currency: order.currency,
      })
      if (client) return { orderId: order.id, client, amountMinor: order.amountMinor, currency: order.currency, courseTitle: order.courseTitle }
    }

    const reference = gatewayOrderId('course', order.id)
    let client: CheckoutClient
    try {
      const checkout = await gateway.createCheckout({
        gatewayOrderId: reference,
        amountMinor: order.amountMinor,
        currency: order.currency,
        customer: input.customer,
        description: order.courseTitle || 'Sea N Shore course',
        returnUrl: paymentReturnUrl(siteUrl(), reference),
        notifyUrl: cashfreeNotifyUrl(siteUrl()),
        expiresAt: new Date(now().getTime() + GATEWAY_ORDER_LIFETIME_MINUTES * 60_000),
        notes: { sns_order_id: order.id, sns_course_id: input.courseId, sns_profile_id: input.profileId },
      })
      order = await repository.attachProviderOrder(order.id, checkout.providerOrderId, checkout.providerSessionId)
      client = checkout.client
    } catch (error) {
      await repository.markOrderFailed(order.id, 'provider_order_failed')
      if (error instanceof PaymentProviderError && error.status === 400 && /phone/i.test(error.providerMessage ?? '')) {
        throw new CustomerPhoneRejectedError()
      }
      log('course_payment_order_create_failed', {
        orderId: order.id,
        provider: gateway.name,
        message: error instanceof PaymentProviderError ? `${error.code}:${error.status ?? ''}:${error.providerMessage ?? ''}` : error instanceof Error ? error.message : null,
      })
      throw new PaymentGatewayUnavailableError()
    }
    return { orderId: order.id, client, amountMinor: order.amountMinor, currency: order.currency, courseTitle: order.courseTitle }
  }

  /** Asks the order's gateway, server to server, and applies the answer. */
  async function confirmOrder(order: CoursePaymentOrder, proof: CheckoutProof | undefined, actor: CoursePaymentActor): Promise<CourseCheckoutOutcome> {
    if (order.status === 'paid' || order.status === 'refunded') {
      return transaction((client) => repository.confirmPaidOrder(client, { orderId: order.id, providerPaymentId: order.providerPaymentId ?? '' }))
    }
    if (!order.providerOrderId) throw new CoursePurchaseError('order_not_found')
    const gateway = await gatewayFor(order)
    const confirmation = await gateway.confirmOrder(order.providerOrderId, proof)

    if (confirmation.status === 'paid' && confirmation.providerPaymentId) {
      const outcome = await transaction((client) => repository.confirmPaidOrder(client, {
        orderId: order.id,
        providerPaymentId: confirmation.providerPaymentId!,
        amountMinor: confirmation.amountMinor ?? undefined,
        currency: confirmation.currency ?? undefined,
        actor,
        now: now(),
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

  /** The learner's browser says checkout finished. Only the gateway's answer counts. */
  async function confirmCheckout(input: { profileId: string; orderId: string; proof?: CheckoutProof }): Promise<CourseCheckoutOutcome> {
    const order = await repository.getOrderForProfile(input.orderId, input.profileId)
    if (!order) throw new CoursePurchaseError('order_not_found')
    return confirmOrder(order, input.proof, { type: 'member', profileId: input.profileId })
  }

  /** Return page: the learner came back with the gateway order id. */
  async function confirmByProviderOrderId(input: { profileId: string; providerOrderId: string }): Promise<CourseCheckoutOutcome | null> {
    const order = await repository.getOrderForProfileByProviderOrderId(input.providerOrderId, input.profileId)
    if (!order) return null
    return confirmOrder(order, undefined, { type: 'member', profileId: input.profileId })
  }

  /**
   * A verified gateway event for a course order (Cashfree webhook), inside the
   * webhook transaction. A refund that is due runs after the transaction commits.
   */
  async function applyGatewayEvent(tx: DatabaseQueryClient, event: GatewayOrderEvent): Promise<OrderHandlerResult> {
    const order = await repository.findOrderByProviderOrderId(tx, event.provider, event.providerOrderId)
    if (!order) return { handled: false, reason: 'order_unknown' }
    const paths = coursePurchasePaths(null)
    const actor: CoursePaymentActor = { type: 'provider' }

    if (event.kind === 'payment_succeeded') {
      const occurredAt = event.occurredAt ? new Date(event.occurredAt) : null
      const outcome = await repository.confirmPaidOrder(tx, {
        orderId: order.id,
        providerPaymentId: event.providerPaymentId,
        providerOrderId: event.providerOrderId,
        amountMinor: event.amountMinor ?? undefined,
        currency: event.currency ?? undefined,
        actor,
        now: occurredAt && !Number.isNaN(occurredAt.getTime()) ? occurredAt : now(),
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

  return {
    startCheckout,
    confirmCheckout,
    confirmByProviderOrderId,
    refundOrder,
    applyGatewayEvent,
  }
}
