import { describe, expect, it } from 'vitest'
import { buildPlanBillingView, formatBillingDate } from './billing-view'
import type { SubjectBilling } from './subscription-repository'
import type { AccessRecord, CheckoutRecord, PaymentRecord } from './subscription-types'
import { testPrice } from './testing/memory-billing-store'

const NOW = new Date('2026-10-10T06:00:00.000Z')
const profileId = '33333333-3333-4333-8333-333333333333'
const prices = [testPrice(), testPrice({ id: 'y', interval: 'year', amountMinor: 100000 })]

function checkout(overrides: Partial<CheckoutRecord> = {}): CheckoutRecord {
  return {
    id: 'c1', subject: { kind: 'profile', profileId }, createdBy: profileId, planCode: 'creator_pro', planPriceId: prices[0]!.id,
    interval: 'month', amountMinor: 10000, currency: 'INR', environment: 'sandbox', providerSubscriptionId: 'snss_c1', cfSubscriptionId: null,
    sessionId: null, status: 'active', providerStatus: 'ACTIVE', paymentMethod: 'upi', startsAt: null, nextChargeAt: '2026-11-01T06:00:00.000Z',
    paidThroughAt: '2026-11-01T06:00:00.000Z', replacesCheckoutId: null, failureReason: null, lastCheckedAt: null, lastStatusEventAt: null,
    activatedAt: '2026-10-01T06:00:00.000Z', cancelledAt: null, createdAt: '2026-10-01T06:00:00.000Z', updatedAt: '2026-10-01T06:00:00.000Z',
    ...overrides,
  }
}

function access(overrides: Partial<AccessRecord> = {}): AccessRecord {
  return {
    id: 'a1', subject: { kind: 'profile', profileId }, planCode: 'creator_pro', status: 'active', billingProvider: 'cashfree',
    providerSubscriptionId: 'snss_c1', periodStartedAt: '2026-10-01T06:00:00.000Z', periodEndsAt: '2026-11-04T06:00:00.000Z',
    cancelAtPeriodEnd: false, createdAt: '2026-10-01T06:00:00.000Z', updatedAt: '2026-10-01T06:00:00.000Z',
    ...overrides,
  }
}

function billing(overrides: Partial<SubjectBilling> = {}): SubjectBilling {
  return { access: null, accessIsCurrent: false, checkout: null, pendingCheckout: null, payments: [], trial: null, ...overrides }
}

function view(input: Partial<SubjectBilling>, configured = true) {
  return buildPlanBillingView({ plan: 'creator_pro', billing: billing(input), prices, configured, now: NOW })
}

describe('billing page view', () => {
  it('offers monthly or yearly with the real saving when there is no plan', () => {
    const free = view({})
    expect(free).toMatchObject({
      state: 'free',
      statusLabel: 'Free plan',
      prices: { month: { amountMinor: 10000 }, year: { amountMinor: 100000 } },
      yearlySavingLabel: 'Save ₹200.00 a year — 2 months free',
      actions: { choosePlan: true, cancelAutoRenew: false },
      configured: true,
    })
    expect(view({}, false).configured).toBe(false)
  })

  it('offers the free trial only to a subject that never had one and has no plan', () => {
    expect(view({}).trial).toEqual({ months: 3, canStart: true, endsOn: null, daysLeft: null })
    const used = view({ trial: { id: 't1', subject: { kind: 'profile', profileId }, planCode: 'creator_pro', startedBy: profileId, startedAt: '2026-01-01T00:00:00.000Z', endsAt: '2026-04-01T00:00:00.000Z', endedAt: '2026-04-01T00:00:00.000Z', endedReason: 'expired', extendedBy: null, extendedAt: null, reminder7dSentAt: null, reminder1dSentAt: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-04-01T00:00:00.000Z' } })
    expect(used.trial.canStart).toBe(false)
    expect(view({ access: access(), accessIsCurrent: true, checkout: checkout() }).trial.canStart).toBe(false)
  })

  it('shows a running trial with the days left, the end date and a first charge on that day', () => {
    const trialing = view({ access: access({ status: 'trialing', billingProvider: 'trial', providerSubscriptionId: 'trial_t1', periodEndsAt: '2026-10-17T06:00:00.000Z' }), accessIsCurrent: true })
    expect(trialing).toMatchObject({
      state: 'trialing',
      statusLabel: 'Free trial — 7 days left',
      trial: { months: 3, canStart: false, endsOn: formatBillingDate('2026-10-17T06:00:00.000Z'), daysLeft: 7 },
      current: { priceLabel: 'Free trial', autoRenew: false, accessUntil: formatBillingDate('2026-10-17T06:00:00.000Z') },
      actions: { choosePlan: true, chooseStartsOn: formatBillingDate('2026-10-17T06:00:00.000Z'), cancelAutoRenew: false },
    })
    expect(trialing.statusHelp).toContain('the first payment is taken on the day the trial ends, not before')
    expect(trialing.statusHelp).toContain('locked, not deleted')
    expect(view({ access: access({ status: 'trialing', billingProvider: 'trial', periodEndsAt: '2026-10-11T00:00:00.000Z' }), accessIsCurrent: true }).statusLabel).toBe('Free trial — 1 day left')
  })

  it('lists every interval that has a price, including half-yearly', () => {
    const organization = buildPlanBillingView({ plan: 'organization_pro', billing: billing({}), prices: [testPrice({ id: 'om', planCode: 'organization_pro', amountMinor: 199900 }), testPrice({ id: 'oh', planCode: 'organization_pro', interval: 'half_year', amountMinor: 1000000 })], configured: true, now: NOW })
    expect(organization.prices).toEqual({ month: { id: 'om', amountMinor: 199900 }, half_year: { id: 'oh', amountMinor: 1000000 }, year: null })
    expect(organization.trial.months).toBe(2)
  })

  it('says when a previous plan ended', () => {
    const ended = view({ access: access({ status: 'expired', periodEndsAt: '2026-10-05T06:00:00.000Z' }), accessIsCurrent: false, checkout: checkout() })
    expect(ended.state).toBe('free')
    expect(ended.statusHelp).toBe(`Your Creator Pro plan ended on ${formatBillingDate('2026-10-05T06:00:00.000Z')}.`)
  })

  it('shows an active monthly plan with price, next payment, method, cancel and switch to yearly', () => {
    const active = view({ access: access(), accessIsCurrent: true, checkout: checkout() })
    expect(active).toMatchObject({
      state: 'active',
      statusLabel: 'Active — renews automatically',
      current: { priceLabel: '₹100.00 per month', renewsOn: formatBillingDate('2026-11-01T06:00:00.000Z'), paymentMethod: 'UPI AutoPay', autoRenew: true, paidThrough: formatBillingDate('2026-11-01T06:00:00.000Z') },
      actions: { cancelAutoRenew: true, switchToYearly: true, choosePlan: false, chooseStartsOn: formatBillingDate('2026-11-01T06:00:00.000Z') },
    })
    expect(active.statusHelp).toContain('The next payment of ₹100.00 is taken automatically on')
    const yearlyPlan = view({ access: access(), accessIsCurrent: true, checkout: checkout({ interval: 'year', amountMinor: 100000 }) })
    expect(yearlyPlan.actions.switchToYearly).toBe(false)
    expect(yearlyPlan.current?.priceLabel).toBe('₹1,000.00 per year')
  })

  it('explains the first payment is still to come right after approval', () => {
    const first = view({ access: access({ periodEndsAt: '2026-10-15T06:00:00.000Z' }), accessIsCurrent: true, checkout: checkout({ paidThroughAt: null, nextChargeAt: '2026-10-12T06:00:00.000Z' }) })
    expect(first.state).toBe('active')
    expect(first.statusHelp).toContain('The first payment of ₹100.00 is taken on')
    expect(first.current?.paidThrough).toBeNull()
  })

  it('explains a failed renewal and the grace period in plain words', () => {
    const pastDue = view({ access: access({ status: 'past_due', periodEndsAt: '2026-11-04T06:00:00.000Z' }), accessIsCurrent: true, checkout: checkout({ status: 'on_hold' }) })
    expect(pastDue).toMatchObject({ state: 'past_due', statusLabel: 'Payment didn’t go through', actions: { updatePaymentMethod: true, cancelAutoRenew: true } })
    expect(pastDue.statusHelp).toContain(`Your plan stays active until ${formatBillingDate('2026-11-04T06:00:00.000Z')}`)
  })

  it('shows auto-renew off with the last day and a way to turn it back on', () => {
    const cancelling = view({ access: access({ cancelAtPeriodEnd: true, periodEndsAt: '2026-11-01T06:00:00.000Z' }), accessIsCurrent: true, checkout: checkout({ status: 'cancelled' }) })
    expect(cancelling).toMatchObject({ state: 'cancelling', statusLabel: 'Auto-renew is off', actions: { resumeAutoRenew: true, cancelAutoRenew: false }, current: { autoRenew: false } })
    expect(cancelling.statusHelp).toContain('Nothing more will be charged')
  })

  it('shows a plan the team gave, with auto-renew starting after it', () => {
    const manual = view({ access: access({ billingProvider: null, providerSubscriptionId: null, periodEndsAt: '2026-12-31T00:00:00.000Z' }), accessIsCurrent: true })
    expect(manual).toMatchObject({ state: 'manual', actions: { choosePlan: true, chooseStartsOn: formatBillingDate('2026-12-31T00:00:00.000Z'), cancelAutoRenew: false } })
    const forever = view({ access: access({ billingProvider: null, providerSubscriptionId: null, periodEndsAt: null }), accessIsCurrent: true })
    expect(forever.actions.choosePlan).toBe(false)
  })

  it('shows a mandate waiting for the bank', () => {
    const waiting = view({ pendingCheckout: checkout({ id: 'c2', status: 'pending_approval', interval: 'year', amountMinor: 100000, paidThroughAt: null }) })
    expect(waiting.pending).toEqual({ checkoutId: 'c2', status: 'pending_approval', interval: 'year', priceLabel: '₹1,000.00 per year', startsAt: null })
  })

  it('lists billing history with plain statuses and periods', () => {
    const payment: PaymentRecord = {
      id: 'p1', checkoutId: 'c1', subject: { kind: 'profile', profileId }, providerPaymentId: 'x', cfPaymentId: '1', paymentType: 'CHARGE',
      amountMinor: 10000, currency: 'INR', status: 'success', rawStatus: 'SUCCESS', failureReason: null,
      periodStart: '2026-10-01T06:00:00.000Z', periodEnd: '2026-11-01T06:00:00.000Z', scheduledFor: null, paidAt: '2026-10-01T06:00:00.000Z',
      createdAt: '2026-10-01T06:00:00.000Z', updatedAt: '2026-10-01T06:00:00.000Z',
    }
    const rows = view({ access: access(), accessIsCurrent: true, checkout: checkout(), payments: [payment, { ...payment, id: 'p2', status: 'failed', periodStart: null, periodEnd: null }] }).history
    expect(rows[0]).toEqual({ id: 'p1', date: formatBillingDate(payment.paidAt), description: `Creator Pro · monthly · ${formatBillingDate(payment.periodStart)} – ${formatBillingDate(payment.periodEnd)}`, amount: '₹100.00', status: 'Paid', tone: 'success' })
    expect(rows[1]).toMatchObject({ status: 'Failed — not charged', tone: 'failed' })
  })
})
