import type { BillingInput } from '@/features/tax/billing'
import { lutForDate } from '@/features/tax/tax-settings'
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
import { completeSeatRefund, failSeatRefund, findSeatRefundForEvent, requestSeatRefund } from './company-training/seat-refund-repository'
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

/** `amountMinor` is what this refund sends back (less than the order after a partial refund). */
export type CourseRefundOutcome =
  | { state: 'refunded'; order: CoursePaymentOrder; amountMinor?: number }
  | { state: 'refund_pending'; order: CoursePaymentOrder; amountMinor?: number }

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
  /** C4: the LUT ARN for the financial year of an instant; USD (export) sales are off without one. */
  lutForDate?: (at: Date) => Promise<string | null>
}) {
  const repository = deps.repository ?? coursePaymentRepository
  const transaction = deps.transaction ?? withTransaction
  const log = deps.log ?? ((message, details) => console.error(message, details ?? {}))
  const siteUrl = deps.siteUrl ?? (() => siteUrlFromEnvironment())
  const now = deps.now ?? (() => new Date())
  const lutFor = deps.lutForDate ?? ((at: Date) => lutForDate(at))

  /** What the gateway can charge, less USD until an LUT is saved for the current financial year (C4). */
  async function chargeableCurrencies(gateway: PaymentGateway, at: Date) {
    if (!gateway.currencies.includes('USD')) return gateway.currencies
    return (await lutFor(at)) ? gateway.currencies : gateway.currencies.filter((currency) => currency !== 'USD')
  }

  async function gatewayFor(order: CoursePaymentOrder) {
    const gateway = await deps.getGatewayByName(order.provider)
    if (!gateway) throw new PaymentsNotConfiguredError()
    return gateway
  }

  /**
   * Sends the money back through the gateway that took it (what is left after any
   * partial refund). The order is marked 'requested' first (a double click cannot
   * refund twice), then refunded, pending or failed. Course access ends, and the
   * seller's earning is reversed, only once the gateway confirms the refund; a pending
   * refund keeps the learner's access until the webhook confirms it.
   */
  async function refundOrder(input: { orderId: string; actor: CoursePaymentActor; reason: string }): Promise<CourseRefundOutcome> {
    const existing = await repository.getOrderById(input.orderId)
    if (!existing) throw new CoursePurchaseError('order_not_found')
    const gateway = await gatewayFor(existing)
    const { order, attempt, refundableMinor } = await transaction((client) => repository.requestRefund(client, input))

    let result
    try {
      result = await gateway.refund({
        providerOrderId: order.providerOrderId!,
        providerPaymentId: order.providerPaymentId!,
        amountMinor: refundableMinor,
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
    if (result.status !== 'processed') {
      const pending = await transaction((client) => repository.markRefundPending(client, order.id, {
        providerRefundId: result.providerRefundId,
        actor: input.actor,
        reason: input.reason,
      }))
      const final = pending ?? order
      return { state: final.status === 'refunded' ? 'refunded' : 'refund_pending', order: final, amountMinor: refundableMinor }
    }
    const refunded = await transaction((client) => repository.markOrderRefunded(client, order.id, {
      providerRefundId: result.providerRefundId,
      refundStatus: 'processed',
      actor: input.actor,
      reason: input.reason,
    }))
    return { state: 'refunded', order: refunded ?? order, amountMinor: refundableMinor }
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

  async function startCheckout(input: {
    profileId: string
    courseId: string
    customer: CheckoutCustomer
    /** Round C: the plan the buyer chose (the first plan when absent) and the promo code text they typed. */
    planId?: string | null
    promoCode?: string | null
    /** C4: billing state or country, and an optional company + GSTIN, for the GST invoice. */
    billing?: BillingInput | null
    /** Round D: the batch chosen on a batch course. */
    batchId?: string | null
  }): Promise<CourseCheckoutSession> {
    const gateway = await deps.getGateway()
    if (!gateway) throw new PaymentsNotConfiguredError()
    if (gateway.requiresCustomerPhone && !input.customer.phone) throw new CustomerPhoneRequiredError()
    const at = now()
    const prepared = await repository.prepareCheckoutOrder({
      profileId: input.profileId,
      courseId: input.courseId,
      provider: gateway.name,
      currencies: await chargeableCurrencies(gateway, at),
      planId: input.planId ?? null,
      promoCode: input.promoCode ?? null,
      billing: input.billing ?? null,
      batchId: input.batchId ?? null,
      now: at,
    })
    return openGatewayCheckout(gateway, prepared, {
      customer: input.customer,
      description: prepared.order.courseTitle || 'Sea N Shore course',
      notes: { sns_order_id: prepared.order.id, sns_course_id: input.courseId, sns_profile_id: input.profileId },
    })
  }

  /** Reopens a reused checkout, or creates the gateway order for a new one. */
  async function openGatewayCheckout(
    gateway: PaymentGateway,
    prepared: { order: CoursePaymentOrder; reused: boolean },
    input: { customer: CheckoutCustomer; description: string; notes: Record<string, string> },
  ): Promise<CourseCheckoutSession> {
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
        description: input.description,
        returnUrl: paymentReturnUrl(siteUrl(), reference),
        notifyUrl: cashfreeNotifyUrl(siteUrl()),
        expiresAt: new Date(now().getTime() + GATEWAY_ORDER_LIFETIME_MINUTES * 60_000),
        notes: input.notes,
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

  /**
   * D3: a company admin buys a pack of seats of one course. The same gateways and webhooks as a course purchase; a
   * paid pack gives the company its seats (no one is enrolled).
   */
  async function startSeatCheckout(input: {
    profileId: string
    companyId: string
    courseId: string
    quantity: number
    planId?: string | null
    billing?: BillingInput | null
    customer: CheckoutCustomer
  }): Promise<CourseCheckoutSession> {
    const gateway = await deps.getGateway()
    if (!gateway) throw new PaymentsNotConfiguredError()
    if (gateway.requiresCustomerPhone && !input.customer.phone) throw new CustomerPhoneRequiredError()
    const prepared = await repository.prepareSeatCheckoutOrder({
      profileId: input.profileId,
      companyId: input.companyId,
      courseId: input.courseId,
      provider: gateway.name,
      quantity: input.quantity,
      planId: input.planId ?? null,
      billing: input.billing ?? null,
      currencies: gateway.currencies,
      now: now(),
    })
    return openGatewayCheckout(gateway, prepared, {
      customer: input.customer,
      description: `${prepared.quote.quantity} ${prepared.quote.quantity === 1 ? 'seat' : 'seats'} · ${prepared.order.courseTitle}`.slice(0, 120),
      notes: { sns_order_id: prepared.order.id, sns_course_id: input.courseId, sns_profile_id: input.profileId, sns_company_id: input.companyId },
    })
  }

  /**
   * D3: refunds `seats` unassigned seats of a pack within 30 days of the purchase. Every seat of a pack with none
   * assigned is the whole order (the ordinary refund); otherwise only those seats' price goes back, with a credit note
   * for it and that share of the seller's earning taken back.
   */
  async function refundSeats(input: { orderId: string; companyId: string; seats: number; actorProfileId: string; platformAdmin?: boolean }): Promise<CourseRefundOutcome | { state: 'seats_refunded' | 'seats_refund_pending'; order: CoursePaymentOrder; seats: number; amountMinor: number }> {
    const existing = await repository.getOrderById(input.orderId)
    if (!existing || existing.seatPack?.companyId !== input.companyId) throw new CoursePurchaseError('order_not_found')
    const gateway = await gatewayFor(existing)
    const actor = { type: input.platformAdmin ? 'admin' as const : 'member' as const, profileId: input.actorProfileId }
    const plan = await transaction((client) => requestSeatRefund(client, { ...input, actor, now: now() }))
    if (plan.kind === 'whole_pack') {
      return refundOrder({ orderId: plan.orderId, actor: { type: input.platformAdmin ? 'admin' : 'organizer', profileId: input.actorProfileId }, reason: 'company_seats_refunded' })
    }

    const { refund } = plan
    let result
    try {
      result = await gateway.refund({
        providerOrderId: plan.providerOrderId,
        providerPaymentId: plan.providerPaymentId,
        amountMinor: refund.amountMinor,
        currency: refund.currency,
        refundId: refundIdFor(refund.id, refund.attempts),
        note: 'Sea N Shore company seats refund',
      })
    } catch (error) {
      const message = error instanceof PaymentProviderError ? error.providerMessage ?? error.code : 'refund_request_failed'
      await transaction((client) => failSeatRefund(client, { refundId: refund.id, reason: message, actor }))
      log('company_seat_refund_failed', { orderId: existing.id, message })
      throw new RefundFailedError(error instanceof PaymentProviderError ? error.providerMessage : null)
    }
    if (result.status === 'failed') {
      await transaction((client) => failSeatRefund(client, { refundId: refund.id, reason: 'gateway_rejected', providerRefundId: result.providerRefundId, actor }))
      throw new RefundFailedError(null)
    }
    await transaction((client) => completeSeatRefund(client, {
      refundId: refund.id,
      providerRefundId: result.providerRefundId,
      status: result.status === 'processed' ? 'processed' : 'pending',
      actor,
    }))
    return {
      state: result.status === 'processed' ? 'seats_refunded' : 'seats_refund_pending',
      order: existing,
      seats: refund.seatCount,
      amountMinor: refund.amountMinor,
    }
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

    // D3: a refund of some seats of a pack belongs to its seat refund; the order itself stays paid.
    if (order.seatPack && order.refundStatus === null) {
      const seatRefund = await findSeatRefundForEvent(tx, order.id, event.providerRefundId)
      if (!seatRefund) return { handled: false, reason: 'order_unknown' }
      if (event.status === 'failed') await failSeatRefund(tx, { refundId: seatRefund.id, reason: 'gateway_refund_failed', providerRefundId: event.providerRefundId, actor })
      else await completeSeatRefund(tx, { refundId: seatRefund.id, providerRefundId: event.providerRefundId, status: event.status, actor })
      return { handled: true, revalidatePaths: paths }
    }
    if (event.status === 'failed') {
      await repository.recordRefundFailure(tx, { orderId: order.id, reason: 'gateway_refund_failed', actor, providerRefundId: event.providerRefundId })
    } else {
      // A partial refund keeps access; a full one ends it only once processed.
      await repository.applyRefundUpdate(tx, order.id, { providerRefundId: event.providerRefundId, amountMinor: event.amountMinor, status: event.status, actor })
    }
    return { handled: true, revalidatePaths: paths }
  }

  return {
    startCheckout,
    confirmCheckout,
    confirmByProviderOrderId,
    refundOrder,
    applyGatewayEvent,
    startSeatCheckout,
    refundSeats,
  }
}
