import { describe, expect, it } from 'vitest'
import {
  chargePaymentIdFor,
  cashfreePlanIdFor,
  cashfreeSubscriptionIdFor,
  checkoutIdFromSubscriptionId,
  billingJobsSecret,
  isOurSubscriptionId,
  siteUrlFromEnvironment,
  subscriptionChargeMode,
  subscriptionPaymentMethods,
} from './billing-config'
import {
  addInterval,
  autoRenewAccessUntil,
  firstChargeAccessUntil,
  formatRupees,
  formatRupeesShort,
  pastDueAccessUntil,
  yearlySaving,
} from './plans'
import { isSubscriptionWebhookBody, parseSubscriptionWebhook } from './subscription-webhook'

describe('plan money and dates', () => {
  it('formats paise as rupees with 2 decimals and Indian grouping', () => {
    expect(formatRupees(10000)).toBe('₹100.00')
    expect(formatRupees(2000000)).toBe('₹20,000.00')
    expect(formatRupees(12345678)).toBe('₹1,23,456.78')
    expect(formatRupees(5)).toBe('₹0.05')
    expect(formatRupeesShort(100000)).toBe('₹1,000')
    expect(formatRupeesShort(99950)).toBe('₹999.50')
  })

  it('shows the yearly saving against twelve monthly payments', () => {
    expect(yearlySaving(10000, 100000)).toEqual({ savingMinor: 20000, twelveMonthsMinor: 120000, monthsFree: 2 })
    expect(yearlySaving(200000, 2000000)).toEqual({ savingMinor: 400000, twelveMonthsMinor: 2400000, monthsFree: 2 })
    expect(yearlySaving(10000, 120000)).toBeNull()
  })

  it('adds months and years like a mandate calendar, clamping month ends', () => {
    expect(addInterval(new Date('2026-01-31T06:00:00Z'), 'month').toISOString()).toBe('2026-02-28T06:00:00.000Z')
    expect(addInterval(new Date('2028-01-31T06:00:00Z'), 'month').toISOString()).toBe('2028-02-29T06:00:00.000Z')
    expect(addInterval(new Date('2026-10-15T06:00:00Z'), 'month').toISOString()).toBe('2026-11-15T06:00:00.000Z')
    expect(addInterval(new Date('2028-02-29T00:00:00Z'), 'year').toISOString()).toBe('2029-02-28T00:00:00.000Z')
    expect(addInterval(new Date('2026-12-10T00:00:00Z'), 'month').toISOString()).toBe('2027-01-10T00:00:00.000Z')
  })

  it('gives 3 days of grace for renewals and failed payments', () => {
    const paid = new Date('2026-11-01T00:00:00Z')
    expect(autoRenewAccessUntil(paid).toISOString()).toBe('2026-11-04T00:00:00.000Z')
    expect(pastDueAccessUntil(paid, new Date('2026-10-31T00:00:00Z')).toISOString()).toBe('2026-11-04T00:00:00.000Z')
    expect(pastDueAccessUntil(paid, new Date('2026-11-02T00:00:00Z')).toISOString()).toBe('2026-11-05T00:00:00.000Z')
    const now = new Date('2026-10-01T00:00:00Z')
    expect(firstChargeAccessUntil(now, null).toISOString()).toBe('2026-10-05T00:00:00.000Z')
    expect(firstChargeAccessUntil(now, new Date('2026-10-03T00:00:00Z')).toISOString()).toBe('2026-10-06T00:00:00.000Z')
    expect(firstChargeAccessUntil(now, new Date('2026-12-01T00:00:00Z')).toISOString()).toBe('2026-10-09T00:00:00.000Z')
  })
})

describe('billing configuration and ids', () => {
  const checkoutId = '0f7e5b1c-1111-4111-8111-111111111111'

  it('builds Cashfree ids inside its alphabets and limits, and reads them back', () => {
    const planId = cashfreePlanIdFor(checkoutId)
    expect(planId).toMatch(/^[A-Za-z0-9._-]{1,40}$/)
    const subscriptionId = cashfreeSubscriptionIdFor(checkoutId)
    expect(isOurSubscriptionId(subscriptionId)).toBe(true)
    expect(checkoutIdFromSubscriptionId(subscriptionId)).toBe(checkoutId)
    expect(checkoutIdFromSubscriptionId('evt_0f7e5b1c111141118111111111111111')).toBeNull()
    const paymentId = chargePaymentIdFor(checkoutId, 123456)
    expect(paymentId.length).toBeLessThanOrEqual(40)
    expect(paymentId).toMatch(/^[A-Za-z0-9]+$/)
    expect(() => chargePaymentIdFor(checkoutId, 0)).toThrow()
    expect(() => cashfreePlanIdFor('not-a-uuid')).toThrow()
  })

  it('keeps charging automatic unless merchant mode is chosen, and filters payment methods', () => {
    expect(subscriptionChargeMode({})).toBe('auto')
    expect(subscriptionChargeMode({ CASHFREE_SUBSCRIPTION_CHARGE_MODE: ' Merchant ' })).toBe('merchant')
    expect(subscriptionChargeMode({ CASHFREE_SUBSCRIPTION_CHARGE_MODE: 'other' })).toBe('auto')
    expect(subscriptionPaymentMethods({})).toEqual(['upi', 'card', 'enach'])
    expect(subscriptionPaymentMethods({ CASHFREE_SUBSCRIPTION_PAYMENT_METHODS: 'card, UPI, bogus, card' })).toEqual(['card', 'upi'])
  })

  it('only enables the jobs route with a long secret, and only uses absolute site URLs', () => {
    expect(billingJobsSecret({})).toBeNull()
    expect(billingJobsSecret({ BILLING_JOBS_SECRET: 'short' })).toBeNull()
    expect(billingJobsSecret({ BILLING_JOBS_SECRET: 'x'.repeat(32) })).toBe('x'.repeat(32))
    expect(siteUrlFromEnvironment({ NEXT_PUBLIC_SITE_URL: 'https://seanshore.example/' })).toBe('https://seanshore.example')
    expect(siteUrlFromEnvironment({ NEXT_PUBLIC_SITE_URL: 'seanshore.example' })).toBeNull()
  })
})

describe('subscription webhook parsing', () => {
  it('routes only SUBSCRIPTION_* bodies to billing', () => {
    expect(isSubscriptionWebhookBody(JSON.stringify({ type: 'SUBSCRIPTION_STATUS_CHANGED', data: {} }))).toBe(true)
    expect(isSubscriptionWebhookBody(JSON.stringify({ type: 'PAYMENT_SUCCESS_WEBHOOK', data: {} }))).toBe(false)
    expect(isSubscriptionWebhookBody('not json')).toBe(false)
  })

  it('reads status changes (2025-01-01 sample shape)', () => {
    const parsed = parseSubscriptionWebhook(JSON.stringify({
      data: {
        subscription_details: { cf_subscription_id: '1', subscription_id: 'snss_a', subscription_status: 'BANK_APPROVAL_PENDING', next_schedule_date: null },
        authorization_details: { authorization_status: 'PENDING', payment_method: 'enach' },
      },
      event_time: '2026-10-01T10:00:00+05:30',
      type: 'SUBSCRIPTION_STATUS_CHANGED',
    }))
    expect(parsed?.event).toEqual({
      kind: 'status', subscriptionId: 'snss_a', cfSubscriptionId: '1', status: 'BANK_APPROVAL_PENDING', authorizationStatus: 'PENDING',
      nextScheduleDate: null, paymentMethod: 'enach', failureReason: null, occurredAt: '2026-10-01T10:00:00+05:30',
    })
  })

  it('reads an auth result even without a subscription status', () => {
    const parsed = parseSubscriptionWebhook(JSON.stringify({
      data: { subscription_id: 'snss_a', authorization_details: { authorization_status: 'FAILED', failure_details: { failure_reason: 'No action performed by customer' } } },
      type: 'SUBSCRIPTION_AUTH_STATUS',
    }))
    expect(parsed?.event).toMatchObject({ kind: 'status', status: 'INITIALIZED', authorizationStatus: 'FAILED', failureReason: 'No action performed by customer' })
  })

  it('reads payments, trusting the webhook type for the outcome', () => {
    const parsed = parseSubscriptionWebhook(JSON.stringify({
      data: { subscription_id: 'snss_a', payment_id: 'p1', cf_payment_id: 55, payment_type: 'CHARGE', payment_amount: 2000.0, payment_status: 'PENDING' },
      type: 'SUBSCRIPTION_PAYMENT_SUCCESS',
    }))
    expect(parsed?.event).toMatchObject({ kind: 'payment', subscriptionId: 'snss_a', payment: { cfPaymentId: '55', paymentId: 'p1', status: 'SUCCESS', amountMinor: 200000 } })
    expect(parsed?.fallbackDeliveryId).toBe('SUBSCRIPTION_PAYMENT_SUCCESS:55')
  })

  it('ignores types it does not need and bad JSON', () => {
    expect(parseSubscriptionWebhook(JSON.stringify({ type: 'SUBSCRIPTION_PAYMENT_NOTIFICATION_INITIATED', data: {} }))?.event).toBeNull()
    expect(parseSubscriptionWebhook('{')).toBeNull()
  })
})
