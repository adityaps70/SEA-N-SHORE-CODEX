import { CASHFREE_API_VERSION, CASHFREE_PG_BASE_URLS, cashfreeCustomerPhone } from '@/features/payments/cashfree'
import type { CashfreeConfig } from '@/features/payments/cashfree-config'
import { decimalAmountToMinor, minorToDecimalAmount } from '@/features/payments/currency'
import { PaymentProviderError } from '@/features/payments/types'
import type { BillingInterval } from './plans'

/**
 * Cashfree Subscriptions over plain HTTPS (no SDK), inside the Payment Gateway API: same
 * /pg base URL, PG keys and pinned x-api-version as features/payments/cashfree.ts.
 * Reference: /home/claude/brief5/cashfree-api.txt section 2.
 *   POST /plans                              create a PERIODIC plan (once per plan_prices row)
 *   POST /subscriptions                      create a subscription -> subscription_session_id
 *   GET  /subscriptions/{id}                 status (the only proof we accept besides webhooks)
 *   POST /subscriptions/{id}/manage          CANCEL
 *   POST /subscriptions/pay                  raise a charge (only when charge mode = merchant)
 *   GET  /subscriptions/{id}/payments        payments for a mandate [path unconfirmed; tolerated]
 * Amounts: integer paise here, rupees with 2 decimals on the wire (currency.ts).
 */

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

const REQUEST_TIMEOUT_MS = 15_000

export type CashfreeSubscriptionStatus =
  | 'INITIALIZED'
  | 'BANK_APPROVAL_PENDING'
  | 'ACTIVE'
  | 'ON_HOLD'
  | 'PAUSED'
  | 'COMPLETED'
  | 'CUSTOMER_CANCELLED'
  | 'CUSTOMER_PAUSED'
  | 'EXPIRED'
  | 'LINK_EXPIRED'
  | 'CARD_EXPIRED'
  | 'CANCELLED'

export type CashfreeSubscription = {
  subscriptionId: string
  cfSubscriptionId: string | null
  sessionId: string | null
  status: string
  nextScheduleDate: string | null
  firstChargeTime: string | null
  /** upi | card | enach | pnach, when Cashfree says which one the customer used. */
  paymentMethod: string | null
  authorizationStatus: string | null
}

export type CashfreeSubscriptionPayment = {
  paymentId: string | null
  cfPaymentId: string | null
  paymentType: 'AUTH' | 'CHARGE'
  status: string
  amountMinor: number | null
  currency: string | null
  scheduledFor: string | null
  initiatedAt: string | null
  failureReason: string | null
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function text(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/** Cashfree ISO 8601 time in UTC, whole seconds. */
export function cashfreeTime(date: Date) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

const INTERVAL_TYPES: Record<BillingInterval, 'MONTH' | 'YEAR'> = { month: 'MONTH', year: 'YEAR' }

/** "upi" from "upi", {upi:{…}}, "UPI_AUTOPAY", "enach", "card"… */
export function normalizePaymentMethod(value: unknown): string | null {
  const raw = typeof value === 'string' ? value : Object.keys(record(value))[0] ?? null
  if (!raw) return null
  const lower = raw.toLowerCase()
  if (lower.includes('upi')) return 'upi'
  if (lower.includes('pnach') || lower.includes('physical')) return 'pnach'
  if (lower.includes('nach') || lower.includes('mandate') || lower.includes('bank')) return 'enach'
  if (lower.includes('card')) return 'card'
  return lower.slice(0, 40)
}

export function mapCashfreeSubscription(value: unknown): CashfreeSubscription {
  const body = record(value)
  // Webhooks wrap the entity in subscription_details; the API returns it flat.
  const details = { ...body, ...record(body.subscription_details) }
  const subscriptionId = text(details.subscription_id)
  const status = text(details.subscription_status)
  if (!subscriptionId || !status) throw new PaymentProviderError('provider_response_invalid')
  const authorization = { ...record(body.authorisation_details), ...record(body.authorization_details) }
  return {
    subscriptionId,
    cfSubscriptionId: text(details.cf_subscription_id),
    sessionId: text(details.subscription_session_id),
    status,
    nextScheduleDate: text(details.next_schedule_date),
    firstChargeTime: text(details.subscription_first_charge_time),
    paymentMethod: normalizePaymentMethod(authorization.payment_method ?? authorization.payment_group),
    authorizationStatus: text(authorization.authorization_status),
  }
}

export function mapCashfreeSubscriptionPayment(value: unknown): CashfreeSubscriptionPayment | null {
  const payment = record(value)
  const cfPaymentId = text(payment.cf_payment_id)
  const paymentId = text(payment.payment_id)
  const status = text(payment.payment_status)
  if ((!cfPaymentId && !paymentId) || !status) return null
  const type = text(payment.payment_type)?.toUpperCase()
  const failure = record(payment.failure_details)
  return {
    paymentId,
    cfPaymentId,
    paymentType: type === 'AUTH' ? 'AUTH' : 'CHARGE',
    status: status.toUpperCase(),
    amountMinor: decimalAmountToMinor(payment.payment_amount),
    currency: text(payment.payment_currency),
    scheduledFor: text(payment.payment_schedule_date),
    initiatedAt: text(payment.payment_initiated_date) ?? text(payment.payment_time),
    failureReason: text(failure.failure_reason) ?? text(payment.failure_reason) ?? text(payment.payment_message),
  }
}

/**
 * A failed Cashfree Subscriptions call, with what Cashfree said about it. Never carries
 * request headers or keys: only the HTTP status and Cashfree's own error code, type and message.
 */
export class CashfreeSubscriptionsError extends PaymentProviderError {
  constructor(
    status: number,
    providerMessage: string | null,
    readonly providerCode: string | null,
    readonly providerType: string | null,
  ) {
    super('provider_request_failed', status, providerMessage)
    this.name = 'CashfreeSubscriptionsError'
  }
}

/**
 * Cashfree's answer when the merchant account does not have the Subscriptions product
 * switched on yet (e.g. "Profile is inactive", "Subscription is not enabled for this
 * merchant"). Checkout cannot work until Cashfree activates it, so the member sees a
 * setup message rather than a retry hint.
 */
const SUBSCRIPTIONS_NOT_ENABLED = /profile is inactive|inactive profile|not (?:been )?activated|not (?:been )?enabled|feature[_ ]not[_ ]enabled|product[_ ]not[_ ]activ|not activ(?:e|ated) for (?:this )?(?:merchant|account)/i

export function isSubscriptionsNotEnabledError(error: unknown) {
  if (!(error instanceof PaymentProviderError) || error.code !== 'provider_request_failed') return false
  const parts = [error.providerMessage]
  if (error instanceof CashfreeSubscriptionsError) parts.push(error.providerCode, error.providerType)
  return parts.some((part) => typeof part === 'string' && SUBSCRIPTIONS_NOT_ENABLED.test(part))
}

/** Safe fields to log about a failed Cashfree call (no keys, no customer details). */
export function cashfreeErrorDetails(error: unknown) {
  if (!(error instanceof PaymentProviderError)) return { message: error instanceof Error ? error.message : null }
  return {
    error: error.code,
    httpStatus: error.status,
    cashfreeCode: error instanceof CashfreeSubscriptionsError ? error.providerCode : null,
    cashfreeType: error instanceof CashfreeSubscriptionsError ? error.providerType : null,
    cashfreeMessage: error.providerMessage,
  }
}

/** "/subscriptions/snss_abc/manage" -> "/subscriptions/:id/manage", for logs. */
function endpointLabel(path: string) {
  return path.replace(/^\/subscriptions\/(?!pay$)[^/]+/, '/subscriptions/:id')
}

/** Is this Cashfree error "that id already exists" (a retry of a create that reached Cashfree)? */
function isAlreadyExists(error: unknown) {
  if (!(error instanceof PaymentProviderError)) return false
  if (error.status === 409) return true
  return error.status === 400 && /already exist/i.test(error.providerMessage ?? '')
}

type ClientLog = (message: string, details: Record<string, unknown>) => void

export function createCashfreeSubscriptionsClient(
  config: CashfreeConfig,
  fetchImpl: FetchLike = fetch,
  options: { log?: ClientLog } = {},
) {
  const base = CASHFREE_PG_BASE_URLS[config.environment]
  const log: ClientLog = options.log ?? ((message, details) => console.error(message, details))

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
    } catch (error) {
      log('cashfree_subscriptions_unreachable', {
        method: init.method,
        endpoint: endpointLabel(path),
        environment: config.environment,
        reason: error instanceof Error ? error.name : null,
      })
      throw new PaymentProviderError('provider_unreachable')
    }
    let payload: unknown = null
    try {
      payload = await response.json()
    } catch {
      payload = null
    }
    if (!response.ok) {
      const body = record(payload)
      const error = new CashfreeSubscriptionsError(
        response.status,
        text(body.message)?.slice(0, 300) ?? null,
        text(body.code)?.slice(0, 100) ?? null,
        text(body.type)?.slice(0, 100) ?? null,
      )
      // Only Cashfree's own error fields: never headers, keys or the request body.
      log('cashfree_subscriptions_request_failed', {
        method: init.method,
        endpoint: endpointLabel(path),
        environment: config.environment,
        ...cashfreeErrorDetails(error),
      })
      throw error
    }
    return payload
  }

  function subscriptionPath(subscriptionId: string) {
    if (!/^[A-Za-z0-9._ -]{1,250}$/.test(subscriptionId)) throw new PaymentProviderError('provider_request_failed', 400, 'subscription_id_invalid')
    return `/subscriptions/${encodeURIComponent(subscriptionId)}`
  }

  async function getSubscription(subscriptionId: string): Promise<CashfreeSubscription> {
    return mapCashfreeSubscription(await request(subscriptionPath(subscriptionId), { method: 'GET' }))
  }

  return {
    environment: config.environment,

    /**
     * Creates the PERIODIC plan for one price. Safe to repeat: an existing plan with the
     * same id counts as success (prices are immutable, so the plan never needs updating).
     */
    async createPlan(input: { planId: string; name: string; amountMinor: number; interval: BillingInterval; note?: string }) {
      if (!/^[A-Za-z0-9._-]{1,40}$/.test(input.planId)) throw new PaymentProviderError('provider_request_failed', 400, 'plan_id_invalid')
      const amount = minorToDecimalAmount(input.amountMinor)
      try {
        await request('/plans', {
          method: 'POST',
          idempotencyKey: input.planId,
          body: {
            plan_id: input.planId,
            plan_name: input.name.slice(0, 40),
            plan_type: 'PERIODIC',
            plan_currency: 'INR',
            plan_recurring_amount: amount,
            plan_max_amount: amount,
            plan_intervals: 1,
            plan_interval_type: INTERVAL_TYPES[input.interval],
            ...(input.note ? { plan_note: input.note.slice(0, 200) } : {}),
          },
        })
      } catch (error) {
        if (!isAlreadyExists(error)) throw error
      }
      return { planId: input.planId }
    },

    async createSubscription(input: {
      subscriptionId: string
      planId: string
      customer: { name: string; email: string; phoneE164: string }
      returnUrl: string | null
      /** First renewal charge; omit to let Cashfree schedule it right after approval. */
      firstChargeAt: Date | null
      paymentMethods: readonly string[]
      note: string
      tags: Record<string, string>
    }): Promise<CashfreeSubscription> {
      const tags = Object.fromEntries(
        Object.entries(input.tags).filter(([, value]) => value).slice(0, 10).map(([key, value]) => [key, value.slice(0, 255)]),
      )
      const body = {
        subscription_id: input.subscriptionId,
        customer_details: {
          customer_name: input.customer.name.slice(0, 100),
          customer_email: input.customer.email.slice(0, 100),
          customer_phone: cashfreeCustomerPhone(input.customer.phoneE164),
        },
        plan_details: { plan_id: input.planId },
        authorization_details: { payment_methods: [...input.paymentMethods] },
        subscription_meta: {
          ...(input.returnUrl ? { return_url: input.returnUrl.slice(0, 250) } : {}),
          notification_channel: ['EMAIL', 'SMS'],
        },
        ...(input.firstChargeAt ? { subscription_first_charge_time: cashfreeTime(input.firstChargeAt) } : {}),
        subscription_note: input.note.slice(0, 200),
        ...(Object.keys(tags).length ? { subscription_tags: tags } : {}),
      }
      let subscription: CashfreeSubscription
      try {
        subscription = mapCashfreeSubscription(await request('/subscriptions', { method: 'POST', body, idempotencyKey: input.subscriptionId }))
      } catch (error) {
        if (!isAlreadyExists(error)) throw error
        subscription = await getSubscription(input.subscriptionId)
      }
      if (subscription.subscriptionId !== input.subscriptionId) throw new PaymentProviderError('provider_response_invalid')
      return subscription
    },

    getSubscription,

    /** Stops the mandate at Cashfree. Already-cancelled counts as success. */
    async cancelSubscription(subscriptionId: string): Promise<CashfreeSubscription | null> {
      try {
        return mapCashfreeSubscription(await request(`${subscriptionPath(subscriptionId)}/manage`, {
          method: 'POST',
          body: { subscription_id: subscriptionId, action: 'CANCEL' },
        }))
      } catch (error) {
        if (error instanceof PaymentProviderError && error.status === 400 && /cancel/i.test(error.providerMessage ?? '')) {
          const current = await getSubscription(subscriptionId)
          if (current.status === 'CANCELLED' || current.status === 'CUSTOMER_CANCELLED' || current.status === 'COMPLETED' || current.status === 'EXPIRED') return current
        }
        throw error
      }
    },

    /** Raises one renewal charge. paymentId is ours and makes the call idempotent. */
    async raiseCharge(input: { subscriptionId: string; paymentId: string; amountMinor: number; scheduleAt: Date; remarks: string }) {
      if (!/^[A-Za-z0-9_-]{3,40}$/.test(input.paymentId)) throw new PaymentProviderError('provider_request_failed', 400, 'payment_id_invalid')
      const payload = record(await request('/subscriptions/pay', {
        method: 'POST',
        idempotencyKey: input.paymentId,
        body: {
          subscription_id: input.subscriptionId,
          payment_id: input.paymentId,
          payment_type: 'CHARGE',
          payment_amount: minorToDecimalAmount(input.amountMinor),
          payment_schedule_date: cashfreeTime(input.scheduleAt),
          payment_remarks: input.remarks.slice(0, 100),
        },
      }))
      return { cfPaymentId: text(payload.cf_payment_id), status: text(payload.payment_status) ?? 'PENDING' }
    },

    /**
     * Payments of a mandate, newest first as Cashfree returns them. The path is from the
     * docs' endpoint list but was not confirmed; a 404 means "not available" (empty list).
     */
    async listSubscriptionPayments(subscriptionId: string): Promise<CashfreeSubscriptionPayment[] | null> {
      try {
        const payload = await request(`${subscriptionPath(subscriptionId)}/payments`, { method: 'GET' })
        const list = Array.isArray(payload) ? payload : Array.isArray(record(payload).data) ? record(payload).data as unknown[] : []
        return list.map(mapCashfreeSubscriptionPayment).filter((entry): entry is CashfreeSubscriptionPayment => entry !== null)
      } catch (error) {
        if (error instanceof PaymentProviderError && (error.status === 404 || error.status === 405)) return null
        throw error
      }
    },
  }
}

export type CashfreeSubscriptionsClient = ReturnType<typeof createCashfreeSubscriptionsClient>
