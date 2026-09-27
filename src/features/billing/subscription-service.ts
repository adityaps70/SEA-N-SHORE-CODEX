import { randomUUID } from 'node:crypto'
import { withTransaction, type DatabaseQueryClient } from '@/lib/db/client'
import { verifyCashfreeSignature } from '@/features/payments/cashfree'
import { loadCashfreeConfig, type CashfreeConfig } from '@/features/payments/cashfree-config'
import { loadCheckoutCustomer } from '@/features/payments/customer-contact'
import { PaymentProviderError, PaymentVerificationError, type CheckoutCustomer, type HeaderLookup } from '@/features/payments/types'
import { recordWebhookDelivery } from '@/features/payments/webhook-deliveries'
import {
  cashfreePlanIdFor,
  cashfreeSubscriptionIdFor,
  chargePaymentIdFor,
  siteUrlFromEnvironment,
  subscriptionChargeMode,
  subscriptionPaymentMethods,
  type SubscriptionChargeMode,
} from './billing-config'
import { createCashfreeSubscriptionsClient, type CashfreeSubscription, type CashfreeSubscriptionsClient } from './cashfree-subscriptions'
import { PLAN_LABELS, planForSubject, type BillingInterval, type BillingSubject } from './plans'
import { applyCancellation, applyMandatePayment, applyMandateUpdate, expireAllLapsedAccess } from './subscription-ledger'
import { subscriptionRepository, type SubscriptionRepository } from './subscription-repository'
import { createSqlBillingStore } from './subscription-store'
import { CLOSED_CHECKOUT_STATUSES, type BillingStore, type CheckoutRecord, type LedgerFollowUp, type LedgerResult } from './subscription-types'
import { parseSubscriptionWebhook } from './subscription-webhook'

export class BillingNotConfiguredError extends Error {
  constructor() { super('billing_not_configured'); this.name = 'BillingNotConfiguredError' }
}
export class PlanPriceUnavailableError extends Error {
  constructor() { super('plan_price_unavailable'); this.name = 'PlanPriceUnavailableError' }
}
/** The subject already has this plan on auto-renew, or a plan that checkout cannot extend. */
export class AlreadySubscribedError extends Error {
  constructor(readonly code: 'same_plan_renewing' | 'open_ended_plan') { super(code); this.name = 'AlreadySubscribedError' }
}
/** Cashfree needs a mobile number and an email for the mandate. */
export class ContactDetailsRequiredError extends Error {
  constructor(readonly missing: { phone: boolean; email: boolean }, readonly invalid: { phone: boolean; email: boolean } = { phone: false, email: false }) {
    super('contact_details_required')
    this.name = 'ContactDetailsRequiredError'
  }
}
export class BillingGatewayError extends Error {
  constructor(readonly providerMessage: string | null) { super('billing_gateway_error'); this.name = 'BillingGatewayError' }
}
export class NothingToCancelError extends Error {
  constructor() { super('nothing_to_cancel'); this.name = 'NothingToCancelError' }
}

export type StartedSubscriptionCheckout = {
  checkoutId: string
  subscriptionSessionId: string
  mode: CashfreeConfig['environment']
  amountMinor: number
  interval: BillingInterval
  /** First charge date when the new plan starts at the end of the current one. */
  startsAt: string | null
}

type RunInTransaction = <T>(fn: (client: DatabaseQueryClient) => Promise<T>) => Promise<T>
type LoadCustomer = (user: { id: string; email: string | null }, typedPhone?: string | null) => Promise<{ customer: CheckoutCustomer; invalidPhone: boolean }>

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/
/** Double clicks and page reloads reopen the same Cashfree session for this long. */
const REUSE_WINDOW_MS = 20 * 60_000
/** A browser "check status" never asks Cashfree more often than this per mandate. */
const REFRESH_MIN_INTERVAL_MS = 8_000
/** Scheduled starts are only used when the current plan has more than a day left (UPI pre-debit rules). */
const SCHEDULED_START_MIN_MS = 26 * 60 * 60_000
const CLOSED_PROVIDER_STATUSES = new Set(['CANCELLED', 'CUSTOMER_CANCELLED', 'COMPLETED', 'EXPIRED', 'CARD_EXPIRED'])

function parseTime(value: string | null | undefined) {
  if (!value) return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? new Date(ms) : null
}

export function returnUrlFor(siteUrl: string | null, checkoutId: string) {
  return siteUrl ? `${siteUrl}/api/billing/cashfree/return?checkout=${encodeURIComponent(checkoutId)}` : null
}

export function createSubscriptionService(deps: {
  loadConfig?: () => Promise<CashfreeConfig | null>
  createClient?: (config: CashfreeConfig) => CashfreeSubscriptionsClient
  repository?: SubscriptionRepository
  transaction?: RunInTransaction
  storeFor?: (tx: DatabaseQueryClient) => BillingStore
  loadCustomer?: LoadCustomer
  siteUrl?: () => string | null
  now?: () => Date
  chargeMode?: () => SubscriptionChargeMode
  paymentMethods?: () => string[]
  newId?: () => string
  log?: (message: string, details?: Record<string, unknown>) => void
} = {}) {
  const loadConfig = deps.loadConfig ?? (() => loadCashfreeConfig())
  const createClient = deps.createClient ?? ((config: CashfreeConfig) => createCashfreeSubscriptionsClient(config))
  const repository = deps.repository ?? subscriptionRepository
  const transaction: RunInTransaction = deps.transaction ?? withTransaction
  const storeFor = deps.storeFor ?? createSqlBillingStore
  const loadCustomer: LoadCustomer = deps.loadCustomer ?? loadCheckoutCustomer
  const siteUrl = deps.siteUrl ?? (() => siteUrlFromEnvironment())
  const now = deps.now ?? (() => new Date())
  const chargeMode = deps.chargeMode ?? (() => subscriptionChargeMode())
  const paymentMethods = deps.paymentMethods ?? (() => subscriptionPaymentMethods())
  const newId = deps.newId ?? randomUUID
  const log = deps.log ?? ((message, details) => console.error(message, details ?? {}))

  async function requireClient() {
    const config = await loadConfig()
    if (!config) throw new BillingNotConfiguredError()
    return { config, client: createClient(config) }
  }

  async function runFollowUps(client: CashfreeSubscriptionsClient | null, followUps: LedgerFollowUp[]) {
    for (const followUp of followUps) {
      if (followUp.kind !== 'cancel_mandate' || !client) continue
      try {
        await client.cancelSubscription(followUp.providerSubscriptionId)
        await transaction((tx) => applyMandateUpdate(storeFor(tx), followUp.checkoutId, {
          providerStatus: 'CANCELLED', occurredAt: now(), fromApi: true,
        }, now(), { type: 'system' }))
      } catch (error) {
        // The billing job retries replaced mandates that Cashfree has not cancelled yet.
        log('billing_replaced_mandate_cancel_failed', { checkoutId: followUp.checkoutId, message: error instanceof Error ? error.message : null })
      }
    }
  }

  async function ensurePlan(client: CashfreeSubscriptionsClient, config: CashfreeConfig, price: Awaited<ReturnType<SubscriptionRepository['getActivePrice']>> & object) {
    const planId = cashfreePlanIdFor(price.id)
    if (price.providerPlanId === planId && price.providerEnvironment === config.environment) return planId
    await client.createPlan({
      planId,
      name: `${PLAN_LABELS[price.planCode]} ${price.interval === 'year' ? 'yearly' : 'monthly'}`,
      amountMinor: price.amountMinor,
      interval: price.interval,
      note: `Sea N Shore ${PLAN_LABELS[price.planCode]}`,
    })
    await repository.markPlanCreated(price.id, planId, config.environment)
    return planId
  }

  function statusUpdate(subscription: CashfreeSubscription) {
    return {
      providerStatus: subscription.status,
      occurredAt: now(),
      nextScheduleDate: parseTime(subscription.nextScheduleDate),
      paymentMethod: subscription.paymentMethod,
      cfSubscriptionId: subscription.cfSubscriptionId,
      authorizationStatus: subscription.authorizationStatus,
      fromApi: true,
    }
  }

  /**
   * Starts (or reopens) a mandate for a member or organization. The caller has already
   * checked the actor may buy for this subject.
   */
  async function startCheckout(input: {
    subject: BillingSubject
    actor: { id: string; email: string | null }
    interval: BillingInterval
    typedPhone?: string | null
    typedEmail?: string | null
    /** e.g. the organization name, for Cashfree's dashboard. */
    label?: string | null
  }): Promise<StartedSubscriptionCheckout> {
    const { config, client } = await requireClient()
    const plan = planForSubject(input.subject)
    const price = await repository.getActivePrice(plan, input.interval)
    if (!price) throw new PlanPriceUnavailableError()

    const { customer, invalidPhone } = await loadCustomer(input.actor, input.typedPhone)
    const typedEmail = input.typedEmail?.trim() || null
    const emailInvalid = Boolean(typedEmail && !EMAIL.test(typedEmail))
    const email = typedEmail && !emailInvalid ? typedEmail : customer.email
    if (invalidPhone || emailInvalid || !customer.phone || !email || !EMAIL.test(email)) {
      throw new ContactDetailsRequiredError(
        { phone: !customer.phone || invalidPhone, email: !email || !EMAIL.test(email) },
        { phone: invalidPhone, email: emailInvalid },
      )
    }

    const at = now()
    const billing = await repository.getSubjectBilling(input.subject, at)
    let startsAt: Date | null = null
    let replacesCheckoutId: string | null = null
    if (billing.access && billing.accessIsCurrent) {
      const { access, checkout } = billing
      const renewing = access.billingProvider === 'cashfree' && !access.cancelAtPeriodEnd && checkout && !CLOSED_CHECKOUT_STATUSES.includes(checkout.status)
      if (renewing && checkout.interval === input.interval && access.status !== 'past_due') throw new AlreadySubscribedError('same_plan_renewing')
      if (!access.periodEndsAt) throw new AlreadySubscribedError('open_ended_plan')
      const paidThrough = parseTime(checkout?.paidThroughAt) ?? (access.billingProvider === 'cashfree' ? null : parseTime(access.periodEndsAt))
      const cancelledThrough = access.cancelAtPeriodEnd ? parseTime(access.periodEndsAt) : null
      const carryOver = paidThrough ?? cancelledThrough
      if (carryOver && carryOver.getTime() - at.getTime() > SCHEDULED_START_MIN_MS) startsAt = carryOver
      replacesCheckoutId = checkout?.id ?? null
    }

    const reusable = await repository.findReusableCheckout(input.subject, price.id, config.environment, new Date(at.getTime() - REUSE_WINDOW_MS))
    if (reusable?.sessionId && (reusable.startsAt ?? null) === (startsAt?.toISOString() ?? null)) {
      return { checkoutId: reusable.id, subscriptionSessionId: reusable.sessionId, mode: config.environment, amountMinor: reusable.amountMinor, interval: reusable.interval, startsAt: reusable.startsAt }
    }

    let planId: string
    try {
      planId = await ensurePlan(client, config, price)
    } catch (error) {
      log('billing_plan_create_failed', { priceId: price.id, message: error instanceof Error ? error.message : null })
      throw new BillingGatewayError(error instanceof PaymentProviderError ? error.providerMessage : null)
    }

    const checkoutId = newId()
    const providerSubscriptionId = cashfreeSubscriptionIdFor(checkoutId)
    // Saved before calling Cashfree so an early webhook always finds its mandate.
    const created = await transaction((tx) => storeFor(tx).insertCheckout({
      id: checkoutId,
      subject: input.subject,
      createdBy: input.actor.id,
      price,
      environment: config.environment,
      providerSubscriptionId,
      startsAt,
      replacesCheckoutId,
    }))

    let subscription: CashfreeSubscription
    try {
      subscription = await client.createSubscription({
        subscriptionId: providerSubscriptionId,
        planId,
        customer: {
          name: customer.name && customer.name.trim().length >= 3 ? customer.name.trim() : 'Sea N Shore member',
          email,
          phoneE164: customer.phone,
        },
        returnUrl: returnUrlFor(siteUrl(), created.id),
        firstChargeAt: startsAt,
        paymentMethods: paymentMethods(),
        note: `${PLAN_LABELS[plan]} (${input.interval === 'year' ? 'yearly' : 'monthly'})${input.label ? ` for ${input.label}` : ''}`,
        tags: { sns_checkout_id: created.id, sns_plan: plan, sns_interval: input.interval },
      })
      if (!subscription.sessionId) throw new PaymentProviderError('provider_response_invalid')
    } catch (error) {
      const providerMessage = error instanceof PaymentProviderError ? error.providerMessage : null
      await transaction(async (tx) => {
        const store = storeFor(tx)
        await store.updateCheckout(created.id, { status: 'failed', failureReason: (providerMessage ?? 'create_failed').slice(0, 500) })
        await store.audit({
          actorType: 'system', subjectType: 'subscription_checkout', subjectId: created.id, action: 'checkout_failed',
          fromStatus: 'created', toStatus: 'failed', amountMinor: created.amountMinor, currency: 'INR', provider: 'cashfree',
          providerReference: providerSubscriptionId, details: { reason: providerMessage },
        })
      })
      if (error instanceof PaymentProviderError && error.status === 400) {
        if (/phone/i.test(providerMessage ?? '')) throw new ContactDetailsRequiredError({ phone: true, email: false }, { phone: true, email: false })
        if (/email/i.test(providerMessage ?? '')) throw new ContactDetailsRequiredError({ phone: false, email: true }, { phone: false, email: true })
      }
      log('billing_subscription_create_failed', { checkoutId: created.id, status: error instanceof PaymentProviderError ? error.status : null, message: providerMessage })
      throw new BillingGatewayError(providerMessage)
    }

    await transaction((tx) => storeFor(tx).updateCheckout(created.id, {
      sessionId: subscription.sessionId,
      cfSubscriptionId: subscription.cfSubscriptionId,
      providerStatus: subscription.status.slice(0, 60),
    }))
    return {
      checkoutId: created.id,
      subscriptionSessionId: subscription.sessionId!,
      mode: config.environment,
      amountMinor: created.amountMinor,
      interval: created.interval,
      startsAt: created.startsAt,
    }
  }

  /**
   * Re-reads one mandate from Cashfree (GET /subscriptions/{id}) and applies it. Used by
   * the return route, the "check status" poll and the billing job. Never trusts the browser.
   */
  async function refreshCheckout(checkoutId: string, options: { force?: boolean } = {}): Promise<CheckoutRecord | null> {
    const checkout = await repository.getCheckout(checkoutId)
    if (!checkout) return null
    const config = await loadConfig()
    if (!config || config.environment !== checkout.environment) return checkout
    const lastChecked = parseTime(checkout.lastCheckedAt)
    if (!options.force && lastChecked && now().getTime() - lastChecked.getTime() < REFRESH_MIN_INTERVAL_MS) return checkout
    if (CLOSED_CHECKOUT_STATUSES.includes(checkout.status) && checkout.status !== 'replaced') return checkout

    const client = createClient(config)
    const subscription = await client.getSubscription(checkout.providerSubscriptionId)
    const result = await transaction((tx) => applyMandateUpdate(storeFor(tx), checkout.id, statusUpdate(subscription), now(), { type: 'provider' }))
    if (result) await runFollowUps(client, result.followUps)
    return result?.checkout ?? checkout
  }

  /** Pulls a mandate's payments (billing job). Tolerates Cashfree not offering the list. */
  async function syncPayments(client: CashfreeSubscriptionsClient, checkout: CheckoutRecord) {
    const payments = await client.listSubscriptionPayments(checkout.providerSubscriptionId)
    if (!payments) return 0
    let applied = 0
    for (const payment of [...payments].reverse()) {
      if (payment.status !== 'SUCCESS' && payment.status !== 'FAILED' && payment.status !== 'CANCELLED') continue
      const result = await transaction((tx) => applyMandatePayment(storeFor(tx), checkout.id, {
        payment,
        occurredAt: parseTime(payment.initiatedAt) ?? now(),
      }, now(), { type: 'provider' }))
      if (result?.changed) applied += 1
      if (result) await runFollowUps(client, result.followUps)
    }
    return applied
  }

  /** Member (or organization admin) turns auto-renew off. Access continues to the paid-through date. */
  async function cancelAutoRenew(input: { subject: BillingSubject; actorProfileId: string; actorType?: 'member' | 'admin'; endNow?: boolean }): Promise<LedgerResult> {
    const billing = await repository.getSubjectBilling(input.subject, now())
    const checkout = billing.checkout
    if (!billing.access || !billing.accessIsCurrent || !checkout || billing.access.billingProvider !== 'cashfree') throw new NothingToCancelError()
    if (billing.access.cancelAtPeriodEnd && !input.endNow) throw new NothingToCancelError()
    return cancelCheckout(checkout, { actorProfileId: input.actorProfileId, actorType: input.actorType ?? 'member', endNow: Boolean(input.endNow) })
  }

  async function cancelCheckout(checkout: CheckoutRecord, input: { actorProfileId: string; actorType: 'member' | 'admin'; endNow: boolean }) {
    const alreadyClosed = CLOSED_CHECKOUT_STATUSES.includes(checkout.status) || CLOSED_PROVIDER_STATUSES.has(checkout.providerStatus ?? '')
    if (!alreadyClosed) {
      const { config, client } = await requireClient()
      if (config.environment !== checkout.environment) throw new BillingNotConfiguredError()
      try {
        await client.cancelSubscription(checkout.providerSubscriptionId)
      } catch (error) {
        log('billing_cancel_failed', { checkoutId: checkout.id, message: error instanceof Error ? error.message : null })
        throw new BillingGatewayError(error instanceof PaymentProviderError ? error.providerMessage : null)
      }
    }
    const result = await transaction((tx) => applyCancellation(storeFor(tx), checkout.id, {
      now: now(),
      actor: { type: input.actorType, profileId: input.actorProfileId },
      endNow: input.endNow,
      reason: input.actorType === 'admin' ? 'admin_cancelled' : 'member_cancelled',
    }))
    if (!result) throw new NothingToCancelError()
    return result
  }

  /**
   * Cashfree subscription webhook. Verifies the raw body (same HMAC as PG webhooks),
   * processes each delivery once, and applies it in one transaction.
   * Returns null when Cashfree is not set up (answer 503 so Cashfree retries later).
   */
  async function handleWebhook(input: { rawBody: string; headers: HeaderLookup }) {
    const config = await loadConfig()
    if (!config) return null
    const verified = verifyCashfreeSignature({
      secret: config.clientSecret,
      rawBody: input.rawBody,
      timestamp: input.headers.get('x-webhook-timestamp'),
      signature: input.headers.get('x-webhook-signature'),
    })
    if (!verified) throw new PaymentVerificationError()

    const parsed = parseSubscriptionWebhook(input.rawBody)
    if (!parsed) return { status: 'ignored' as const, type: 'unknown', reason: 'invalid_json' }
    if (!parsed.event) return { status: 'ignored' as const, type: parsed.type, reason: 'not_needed' }
    const event = parsed.event
    const checkout = await repository.getCheckoutByProviderSubscriptionId(event.subscriptionId)
    if (!checkout) return { status: 'ignored' as const, type: parsed.type, reason: 'unknown_subscription' }

    const idempotency = input.headers.get('x-idempotency-key')?.trim() || input.headers.get('x-idempotency-header')?.trim()
    const deliveryId = idempotency ? `${parsed.type}:${idempotency}` : parsed.fallbackDeliveryId
    const at = now()
    const occurredAt = parseTime(event.occurredAt) ?? at

    const outcome = await transaction(async (tx): Promise<LedgerResult | null | 'duplicate'> => {
      if (!await recordWebhookDelivery(tx, 'cashfree', deliveryId, parsed.type)) return 'duplicate'
      const store = storeFor(tx)
      if (event.kind === 'status') {
        return applyMandateUpdate(store, checkout.id, {
          providerStatus: event.status,
          occurredAt,
          nextScheduleDate: parseTime(event.nextScheduleDate),
          paymentMethod: event.paymentMethod,
          cfSubscriptionId: event.cfSubscriptionId,
          authorizationStatus: event.authorizationStatus,
          failureReason: event.failureReason,
        }, at)
      }
      return applyMandatePayment(store, checkout.id, { payment: event.payment, occurredAt }, at)
    })
    if (outcome === 'duplicate') return { status: 'duplicate' as const, type: parsed.type }
    if (outcome?.followUps.length) {
      await runFollowUps(config.environment === checkout.environment ? createClient(config) : null, outcome.followUps)
    }
    return {
      status: 'handled' as const,
      type: parsed.type,
      changed: Boolean(outcome?.changed),
      revalidatePaths: billingPaths(checkout.subject),
    }
  }

  /**
   * The billing job (hourly from the outbox worker, or POST /api/billing/cashfree/jobs):
   * 1. expire plans whose paid period and grace are over,
   * 2. re-read open mandates from Cashfree (missed webhooks, closed tabs) and finish
   *    cancelling mandates we replaced,
   * 3. only in merchant charge mode: raise renewal charges that are due.
   * Idempotent: running it twice changes nothing more.
   */
  async function runSweep(options: { limit?: number } = {}) {
    const at = now()
    const expired = await transaction((tx) => expireAllLapsedAccess(storeFor(tx), at))
    const config = await loadConfig()
    const summary = { expired, reconciled: 0, paymentsApplied: 0, chargesRaised: 0, failures: 0, configured: Boolean(config) }
    if (!config) return summary
    const client = createClient(config)

    for (const checkout of await repository.listCheckoutsToReconcile(at, options.limit ?? 50)) {
      if (checkout.environment !== config.environment) continue
      try {
        if (checkout.status === 'replaced') {
          await runFollowUps(client, [{ kind: 'cancel_mandate', providerSubscriptionId: checkout.providerSubscriptionId, checkoutId: checkout.id }])
        } else {
          const refreshed = await refreshCheckout(checkout.id, { force: true })
          if (refreshed && (refreshed.status === 'active' || refreshed.status === 'on_hold')) {
            summary.paymentsApplied += await syncPayments(client, refreshed).catch((error: unknown) => {
              log('billing_payments_sync_failed', { checkoutId: checkout.id, message: error instanceof Error ? error.message : null })
              return 0
            })
          }
        }
        summary.reconciled += 1
      } catch (error) {
        summary.failures += 1
        log('billing_reconcile_failed', { checkoutId: checkout.id, message: error instanceof Error ? error.message : null })
      }
    }

    if (chargeMode() === 'merchant') {
      for (const { checkout, paidCycles } of await repository.listChargesDue(at, 48, options.limit ?? 50)) {
        if (checkout.environment !== config.environment) continue
        try {
          if (await raiseCharge(client, checkout, paidCycles + 1)) summary.chargesRaised += 1
        } catch (error) {
          summary.failures += 1
          log('billing_charge_raise_failed', { checkoutId: checkout.id, message: error instanceof Error ? error.message : null })
        }
      }
    }
    return summary
  }

  /** Merchant charge mode: one renewal charge per cycle, reserved in the database first. */
  async function raiseCharge(client: CashfreeSubscriptionsClient, checkout: CheckoutRecord, cycle: number) {
    const paymentId = chargePaymentIdFor(checkout.id, cycle)
    const dueAt = parseTime(checkout.nextChargeAt) ?? now()
    const earliest = new Date(now().getTime() + SCHEDULED_START_MIN_MS)
    const scheduleAt = dueAt.getTime() > earliest.getTime() ? dueAt : earliest
    const reserved = await transaction(async (tx) => {
      const store = storeFor(tx)
      await store.lockSubject(checkout.subject)
      const existing = await store.findPayment({ cfPaymentId: null, providerPaymentId: paymentId })
      if (existing) return existing.rawStatus === 'RAISE_ERROR' ? existing : null
      const payment = await store.insertPayment({
        checkoutId: checkout.id,
        subject: checkout.subject,
        providerPaymentId: paymentId,
        cfPaymentId: null,
        paymentType: 'CHARGE',
        amountMinor: checkout.amountMinor,
        currency: 'INR',
        status: 'pending',
        rawStatus: 'RAISING',
        failureReason: null,
        periodStart: null,
        periodEnd: null,
        scheduledFor: scheduleAt.toISOString(),
        paidAt: null,
      })
      await store.audit({
        actorType: 'system', subjectType: 'subscription_payment', subjectId: payment.id, action: 'charge_requested',
        toStatus: 'pending', amountMinor: payment.amountMinor, currency: 'INR', provider: 'cashfree', providerReference: paymentId,
        details: { checkoutId: checkout.id, cycle, scheduledFor: payment.scheduledFor },
      })
      return payment
    })
    if (!reserved) return false
    try {
      const raised = await client.raiseCharge({
        subscriptionId: checkout.providerSubscriptionId,
        paymentId,
        amountMinor: checkout.amountMinor,
        scheduleAt,
        remarks: `${PLAN_LABELS[checkout.planCode]} renewal`,
      })
      await transaction((tx) => storeFor(tx).updatePayment(reserved.id, {
        rawStatus: raised.status.slice(0, 60),
        ...(raised.cfPaymentId ? { cfPaymentId: raised.cfPaymentId } : {}),
      }))
      return true
    } catch (error) {
      await transaction((tx) => storeFor(tx).updatePayment(reserved.id, { rawStatus: 'RAISE_ERROR' }))
      throw error
    }
  }

  async function isConfigured() {
    const config = await loadConfig()
    return config ? { configured: true as const, environment: config.environment } : { configured: false as const, environment: null }
  }

  return {
    isConfigured,
    startCheckout,
    refreshCheckout,
    cancelAutoRenew,
    cancelCheckout,
    handleWebhook,
    runSweep,
  }
}

export function billingPaths(subject: BillingSubject) {
  return subject.kind === 'profile'
    ? ['/settings/billing']
    : ['/settings/billing', `/settings/billing/organizations/${subject.companyId}`]
}

export type SubscriptionService = ReturnType<typeof createSubscriptionService>

export const subscriptionService = createSubscriptionService()
