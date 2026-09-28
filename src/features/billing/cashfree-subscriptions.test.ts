import { describe, expect, it, vi } from 'vitest'
import { CASHFREE_API_VERSION } from '@/features/payments/cashfree'
import { PaymentProviderError } from '@/features/payments/types'
import {
  CashfreeSubscriptionsError,
  createCashfreeSubscriptionsClient,
  isSubscriptionsNotEnabledError,
  mapCashfreeSubscription,
  mapCashfreeSubscriptionPayment,
  normalizePaymentMethod,
  logBillingEvent,
  PAYMENT_PROVIDER_ISSUE_TAG,
} from './cashfree-subscriptions'

const config = { clientId: 'TEST10123456789', clientSecret: 'cfsk_ma_test_secret', environment: 'sandbox' as const, international: false }
const subscriptionId = 'snss_0f7e5b1c111141118111111111111111'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function subscriptionEntity(overrides: Record<string, unknown> = {}) {
  return {
    cf_subscription_id: '5012345',
    subscription_id: subscriptionId,
    subscription_session_id: 'sub_session_abc',
    subscription_status: 'INITIALIZED',
    next_schedule_date: null,
    ...overrides,
  }
}

function call(fetchMock: ReturnType<typeof vi.fn>, index = 0) {
  const [url, init] = fetchMock.mock.calls[index] as unknown as [string, RequestInit]
  return { url, init, headers: init.headers as Record<string, string>, body: init.body ? JSON.parse(String(init.body)) : null }
}

describe('Cashfree subscriptions client', () => {
  it('creates a PERIODIC plan with the exact rupee amount, pinned version and idempotency key', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ plan_id: 'snsp_1', plan_status: 'ACTIVE' }))
    const client = createCashfreeSubscriptionsClient(config, fetchMock)
    await expect(client.createPlan({ planId: 'snsp_22222222222242228222222222222222', name: 'Creator Pro yearly', amountMinor: 100000, interval: 'year' }))
      .resolves.toEqual({ planId: 'snsp_22222222222242228222222222222222' })
    const { url, init, headers, body } = call(fetchMock)
    expect(url).toBe('https://sandbox.cashfree.com/pg/plans')
    expect(init.method).toBe('POST')
    expect(headers['x-api-version']).toBe(CASHFREE_API_VERSION)
    expect(headers['x-client-id']).toBe(config.clientId)
    expect(headers['x-client-secret']).toBe(config.clientSecret)
    expect(headers['x-idempotency-key']).toBe('snsp_22222222222242228222222222222222')
    expect(body).toEqual({
      plan_id: 'snsp_22222222222242228222222222222222',
      plan_name: 'Creator Pro yearly',
      plan_type: 'PERIODIC',
      plan_currency: 'INR',
      plan_recurring_amount: 1000,
      plan_max_amount: 1000,
      plan_intervals: 1,
      plan_interval_type: 'YEAR',
    })
    expect(url).not.toContain(config.clientSecret)
  })

  it('treats an existing plan id as success (a retry of a create that reached Cashfree)', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ message: 'plan_id already exists' }, 409))
    const client = createCashfreeSubscriptionsClient(config, fetchMock)
    await expect(client.createPlan({ planId: 'snsp_x', name: 'Creator Pro monthly', amountMinor: 10050, interval: 'month' })).resolves.toEqual({ planId: 'snsp_x' })
    expect(call(fetchMock).body.plan_recurring_amount).toBe(100.5)
  })

  it('creates a subscription for an existing plan with the customer, return URL and scheduled start', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(subscriptionEntity()))
    const client = createCashfreeSubscriptionsClient({ ...config, environment: 'production' }, fetchMock)
    const created = await client.createSubscription({
      subscriptionId,
      planId: 'snsp_22222222222242228222222222222222',
      customer: { name: 'Capt. Meera Rao', email: 'meera@example.com', phoneE164: '+919876543210' },
      returnUrl: 'https://seanshore.example/api/billing/cashfree/return?checkout=0f7e5b1c-1111-4111-8111-111111111111',
      firstChargeAt: new Date('2026-11-01T06:00:00.456Z'),
      paymentMethods: ['upi', 'card', 'enach'],
      note: 'Creator Pro (yearly)',
      tags: { sns_checkout_id: '0f7e5b1c-1111-4111-8111-111111111111', empty: '' },
    })
    expect(created).toMatchObject({ subscriptionId, sessionId: 'sub_session_abc', status: 'INITIALIZED', cfSubscriptionId: '5012345' })
    const { url, headers, body } = call(fetchMock)
    expect(url).toBe('https://api.cashfree.com/pg/subscriptions')
    expect(headers['x-idempotency-key']).toBe(subscriptionId)
    expect(body).toEqual({
      subscription_id: subscriptionId,
      customer_details: { customer_name: 'Capt. Meera Rao', customer_email: 'meera@example.com', customer_phone: '9876543210' },
      plan_details: { plan_id: 'snsp_22222222222242228222222222222222' },
      authorization_details: { payment_methods: ['upi', 'card', 'enach'] },
      subscription_meta: {
        return_url: 'https://seanshore.example/api/billing/cashfree/return?checkout=0f7e5b1c-1111-4111-8111-111111111111',
        notification_channel: ['EMAIL', 'SMS'],
      },
      subscription_first_charge_time: '2026-11-01T06:00:00Z',
      subscription_note: 'Creator Pro (yearly)',
      subscription_tags: { sns_checkout_id: '0f7e5b1c-1111-4111-8111-111111111111' },
    })
  })

  it('reuses the subscription when a retried create hits "already exists"', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ message: 'subscription already exists' }, 409))
      .mockResolvedValueOnce(jsonResponse(subscriptionEntity({ subscription_status: 'ACTIVE' })))
    const client = createCashfreeSubscriptionsClient(config, fetchMock)
    const created = await client.createSubscription({
      subscriptionId, planId: 'snsp_1', customer: { name: 'Member', email: 'a@b.co', phoneE164: '+447700900123' },
      returnUrl: null, firstChargeAt: null, paymentMethods: ['upi'], note: 'Creator Pro', tags: {},
    })
    expect(created.status).toBe('ACTIVE')
    expect(call(fetchMock).body.customer_details.customer_phone).toBe('+447700900123')
    expect(call(fetchMock).body.subscription_first_charge_time).toBeUndefined()
    expect(call(fetchMock, 1).url).toBe(`https://sandbox.cashfree.com/pg/subscriptions/${subscriptionId}`)
  })

  it('reads a subscription and its payment method', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(subscriptionEntity({
      subscription_status: 'ACTIVE',
      next_schedule_date: '2026-10-03T10:00:00+05:30',
      authorisation_details: { authorization_status: 'ACTIVE', payment_method: { upi: { upi_id: 'x@okaxis' } } },
    })))
    const client = createCashfreeSubscriptionsClient(config, fetchMock)
    await expect(client.getSubscription(subscriptionId)).resolves.toMatchObject({
      status: 'ACTIVE', nextScheduleDate: '2026-10-03T10:00:00+05:30', paymentMethod: 'upi', authorizationStatus: 'ACTIVE',
    })
    expect(call(fetchMock).init.method).toBe('GET')
  })

  it('cancels through manage and accepts an already-cancelled mandate', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(subscriptionEntity({ subscription_status: 'CANCELLED' })))
    const client = createCashfreeSubscriptionsClient(config, fetchMock)
    await expect(client.cancelSubscription(subscriptionId)).resolves.toMatchObject({ status: 'CANCELLED' })
    const { url, body } = call(fetchMock)
    expect(url).toBe(`https://sandbox.cashfree.com/pg/subscriptions/${subscriptionId}/manage`)
    expect(body).toEqual({ subscription_id: subscriptionId, action: 'CANCEL' })

    const again = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ message: 'Subscription is already cancelled' }, 400))
      .mockResolvedValueOnce(jsonResponse(subscriptionEntity({ subscription_status: 'CUSTOMER_CANCELLED' })))
    await expect(createCashfreeSubscriptionsClient(config, again).cancelSubscription(subscriptionId)).resolves.toMatchObject({ status: 'CUSTOMER_CANCELLED' })
  })

  it('raises a charge with our payment id and exact amount', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ cf_payment_id: '77001', payment_status: 'PENDING' }))
    const client = createCashfreeSubscriptionsClient(config, fetchMock)
    await expect(client.raiseCharge({ subscriptionId, paymentId: 'sc0f7e5b1c1111411181111111111111112', amountMinor: 200000, scheduleAt: new Date('2026-11-01T06:00:00Z'), remarks: 'Organization Pro renewal' }))
      .resolves.toEqual({ cfPaymentId: '77001', status: 'PENDING' })
    const { url, headers, body } = call(fetchMock)
    expect(url).toBe('https://sandbox.cashfree.com/pg/subscriptions/pay')
    expect(headers['x-idempotency-key']).toBe('sc0f7e5b1c1111411181111111111111112')
    expect(body).toMatchObject({ subscription_id: subscriptionId, payment_type: 'CHARGE', payment_amount: 2000, payment_schedule_date: '2026-11-01T06:00:00Z' })
  })

  it('treats a missing payments list endpoint as "not available" and surfaces other failures', async () => {
    const missing = vi.fn(async () => jsonResponse({ message: 'not found' }, 404))
    await expect(createCashfreeSubscriptionsClient(config, missing).listSubscriptionPayments(subscriptionId)).resolves.toBeNull()
    const listed = vi.fn(async () => jsonResponse([{ cf_payment_id: '1', payment_id: 'p1', payment_status: 'SUCCESS', payment_amount: 100, payment_type: 'CHARGE' }]))
    await expect(createCashfreeSubscriptionsClient(config, listed).listSubscriptionPayments(subscriptionId)).resolves.toEqual([
      expect.objectContaining({ cfPaymentId: '1', paymentId: 'p1', status: 'SUCCESS', amountMinor: 10000, paymentType: 'CHARGE' }),
    ])
    const broken = vi.fn(async () => jsonResponse({ message: 'server error' }, 500))
    await expect(createCashfreeSubscriptionsClient(config, broken).listSubscriptionPayments(subscriptionId)).rejects.toBeInstanceOf(PaymentProviderError)
  })

  it('reports an unreachable Cashfree without leaking details', async () => {
    const fetchMock = vi.fn(async () => { throw new Error('ECONNRESET') })
    await expect(createCashfreeSubscriptionsClient(config, fetchMock).getSubscription(subscriptionId)).rejects.toMatchObject({ code: 'provider_unreachable' })
  })

  it('refuses ids outside Cashfree alphabets before calling out', async () => {
    const fetchMock = vi.fn()
    const client = createCashfreeSubscriptionsClient(config, fetchMock)
    await expect(client.getSubscription('../orders')).rejects.toBeInstanceOf(PaymentProviderError)
    await expect(client.createPlan({ planId: 'bad id!', name: 'x', amountMinor: 100, interval: 'month' })).rejects.toBeInstanceOf(PaymentProviderError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('Cashfree subscriptions errors', () => {
  it('logs the HTTP status and Cashfree error code, type and message without any secret', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ message: 'Profile is inactive', code: 'request_failed', type: 'invalid_request_error' }, 400))
    const log = vi.fn()
    const client = createCashfreeSubscriptionsClient(config, fetchMock, { log })
    const failure = client.createPlan({ planId: 'snsp_org', name: 'Organization Pro monthly', amountMinor: 200000, interval: 'month' })
    await expect(failure).rejects.toBeInstanceOf(CashfreeSubscriptionsError)
    await expect(failure).rejects.toMatchObject({ code: 'provider_request_failed', status: 400, providerCode: 'request_failed', providerMessage: 'Profile is inactive' })
    expect(log).toHaveBeenCalledWith('cashfree_subscriptions_request_failed', {
      method: 'POST',
      endpoint: '/plans',
      environment: 'sandbox',
      error: 'provider_request_failed',
      httpStatus: 400,
      cashfreeCode: 'request_failed',
      cashfreeType: 'invalid_request_error',
      cashfreeMessage: 'Profile is inactive',
    })
    const logged = JSON.stringify(log.mock.calls)
    expect(logged).not.toContain(config.clientSecret)
    expect(logged).not.toContain(config.clientId)
  })

  it('hides subscription ids from the logged endpoint', async () => {
    const log = vi.fn()
    const client = createCashfreeSubscriptionsClient(config, vi.fn(async () => jsonResponse({ message: 'boom' }, 500)), { log })
    await expect(client.getSubscription(subscriptionId)).rejects.toBeInstanceOf(PaymentProviderError)
    expect(log.mock.calls[0]![1]).toMatchObject({ endpoint: '/subscriptions/:id', httpStatus: 500, cashfreeMessage: 'boom' })
  })

  it('recognises "Subscriptions not enabled" answers and nothing else', () => {
    expect(isSubscriptionsNotEnabledError(new CashfreeSubscriptionsError(400, 'Profile is inactive', null, null))).toBe(true)
    expect(isSubscriptionsNotEnabledError(new CashfreeSubscriptionsError(403, 'Subscription product is not activated for this merchant', null, null))).toBe(true)
    expect(isSubscriptionsNotEnabledError(new CashfreeSubscriptionsError(400, null, 'feature_not_enabled', null))).toBe(true)
    expect(isSubscriptionsNotEnabledError(new PaymentProviderError('provider_request_failed', 400, 'Subscriptions is not enabled'))).toBe(true)
    expect(isSubscriptionsNotEnabledError(new CashfreeSubscriptionsError(400, 'customer_phone is invalid', 'customer_phone_invalid', null))).toBe(false)
    expect(isSubscriptionsNotEnabledError(new CashfreeSubscriptionsError(401, 'authentication Failed', 'request_failed', null))).toBe(false)
    expect(isSubscriptionsNotEnabledError(new PaymentProviderError('provider_unreachable'))).toBe(false)
    expect(isSubscriptionsNotEnabledError(new Error('Profile is inactive'))).toBe(false)
  })
})

describe('Cashfree subscription mapping', () => {
  it('reads webhook-wrapped and flat subscription entities', () => {
    expect(mapCashfreeSubscription({ subscription_details: { subscription_id: 's1', subscription_status: 'ON_HOLD' } })).toMatchObject({ subscriptionId: 's1', status: 'ON_HOLD' })
    expect(() => mapCashfreeSubscription({})).toThrow(PaymentProviderError)
  })

  it('maps payments and payment methods', () => {
    expect(mapCashfreeSubscriptionPayment({ cf_payment_id: 9, payment_status: 'failed', payment_amount: '100.50', payment_type: 'CHARGE', failure_details: { failure_reason: 'Insufficient funds' } }))
      .toMatchObject({ cfPaymentId: '9', status: 'FAILED', amountMinor: 10050, failureReason: 'Insufficient funds' })
    expect(mapCashfreeSubscriptionPayment({ payment_status: 'SUCCESS' })).toBeNull()
    expect(normalizePaymentMethod('UPI_AUTOPAY')).toBe('upi')
    expect(normalizePaymentMethod({ enach: {} })).toBe('enach')
    expect(normalizePaymentMethod('card')).toBe('card')
    expect(normalizePaymentMethod(null)).toBeNull()
  })
})

describe('billing event logging', () => {
  it('logs a 4xx Cashfree refusal as one tagged warning line, not a runtime error', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      logBillingEvent('billing_plan_create_failed', {
        httpStatus: 400,
        cashfreeType: 'invalid_request_error',
        cashfreeMessage: 'Profile is inactive',
      })
      expect(error).not.toHaveBeenCalled()
      expect(warn).toHaveBeenCalledTimes(1)
      const [tag, line] = warn.mock.calls[0] as [string, string]
      expect(tag).toBe(PAYMENT_PROVIDER_ISSUE_TAG)
      expect(line).not.toContain('\n')
      expect(JSON.parse(line)).toEqual({
        event: 'billing_plan_create_failed',
        httpStatus: 400,
        cashfreeType: 'invalid_request_error',
        cashfreeMessage: 'Profile is inactive',
      })
    } finally {
      warn.mockRestore()
      error.mockRestore()
    }
  })

  it('keeps network failures and 5xx answers as errors', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      logBillingEvent('cashfree_subscriptions_request_failed', { httpStatus: 502 })
      logBillingEvent('cashfree_subscriptions_unreachable', { reason: 'TimeoutError' })
      expect(warn).not.toHaveBeenCalled()
      expect(error).toHaveBeenCalledTimes(2)
    } finally {
      warn.mockRestore()
      error.mockRestore()
    }
  })
})
