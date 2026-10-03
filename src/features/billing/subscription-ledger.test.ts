import { describe, expect, it } from 'vitest'
import type { CashfreeSubscriptionPayment } from './cashfree-subscriptions'
import { applyCancellation, applyMandatePayment, applyMandateUpdate, expireAllLapsedAccess } from './subscription-ledger'
import { createMemoryBillingStore, testPrice } from './testing/memory-billing-store'

const profileId = '33333333-3333-4333-8333-333333333333'
const subject = { kind: 'profile' as const, profileId }
const monthly = testPrice()
const yearly = testPrice({ id: '44444444-4444-4444-8444-444444444444', interval: 'year', amountMinor: 100000 })

const T0 = new Date('2026-10-01T06:00:00.000Z')
const days = (n: number, from = T0) => new Date(from.getTime() + n * 86_400_000)

function charge(overrides: Partial<CashfreeSubscriptionPayment> = {}): CashfreeSubscriptionPayment {
  return {
    paymentId: 'cfpay_1',
    cfPaymentId: '900001',
    paymentType: 'CHARGE',
    status: 'SUCCESS',
    amountMinor: 10000,
    currency: 'INR',
    scheduledFor: null,
    initiatedAt: days(2).toISOString(),
    failureReason: null,
    ...overrides,
  }
}

function setup() {
  const memory = createMemoryBillingStore(() => T0)
  const checkout = memory.seedCheckout({ price: monthly, subject })
  return { ...memory, checkout }
}

describe('mandate approval', () => {
  it('turns Creator Pro on until the first charge + grace, once, however often it is reported', async () => {
    const { store, checkout, currentRows, audits } = setup()
    const update = { providerStatus: 'ACTIVE', occurredAt: T0, nextScheduleDate: days(2), paymentMethod: 'upi' }

    const first = await applyMandateUpdate(store, checkout.id, update, T0)
    expect(first?.changed).toBe(true)
    expect(first?.checkout.status).toBe('active')
    expect(first?.checkout.paymentMethod).toBe('upi')
    expect(first?.access).toMatchObject({ status: 'active', billingProvider: 'cashfree', providerSubscriptionId: checkout.providerSubscriptionId, cancelAtPeriodEnd: false })
    // First charge in 2 days + 3 days grace = 5 days.
    expect(first?.access?.periodEndsAt).toBe(days(5).toISOString())

    // Webhook retry, return page and poll all report ACTIVE again.
    await applyMandateUpdate(store, checkout.id, update, T0)
    await applyMandateUpdate(store, checkout.id, { ...update, fromApi: true }, days(0.01))
    expect(currentRows(subject)).toHaveLength(1)
    expect(audits.filter((entry) => entry.action === 'access_started')).toHaveLength(1)
    expect(audits.filter((entry) => entry.action === 'mandate_active')).toHaveLength(1)
  })

  it('never gives more than a few days before the first successful charge', async () => {
    const { store, checkout } = setup()
    const result = await applyMandateUpdate(store, checkout.id, { providerStatus: 'ACTIVE', occurredAt: T0, nextScheduleDate: days(40) }, T0)
    expect(result?.access?.periodEndsAt).toBe(days(8).toISOString())
  })

  it('records bank approval pending and a failed approval without granting anything', async () => {
    const { store, checkout, currentRows } = setup()
    const pending = await applyMandateUpdate(store, checkout.id, { providerStatus: 'BANK_APPROVAL_PENDING', occurredAt: T0 }, T0)
    expect(pending?.checkout.status).toBe('pending_approval')
    const failed = await applyMandateUpdate(store, checkout.id, { providerStatus: 'INITIALIZED', authorizationStatus: 'FAILED', occurredAt: days(0.1), failureReason: 'No action performed by customer' }, days(0.1))
    expect(failed?.checkout.status).toBe('failed')
    expect(failed?.checkout.failureReason).toBe('No action performed by customer')
    expect(currentRows(subject)).toHaveLength(0)
  })

  it('ignores a webhook older than the last one applied', async () => {
    const { store, checkout } = setup()
    await applyMandateUpdate(store, checkout.id, { providerStatus: 'ACTIVE', occurredAt: days(0.2) }, days(0.2))
    const stale = await applyMandateUpdate(store, checkout.id, { providerStatus: 'BANK_APPROVAL_PENDING', occurredAt: days(0.1) }, days(0.3))
    expect(stale?.changed).toBe(false)
    expect(stale?.note).toBe('stale_event')
    expect((await store.getCheckout(checkout.id))?.status).toBe('active')
  })
})

describe('renewal charges', () => {
  it('extends the plan one month from the charge date, exactly once per payment', async () => {
    const { store, checkout, audits } = setup()
    await applyMandateUpdate(store, checkout.id, { providerStatus: 'ACTIVE', occurredAt: T0, nextScheduleDate: days(2) }, T0)
    const paid = await applyMandatePayment(store, checkout.id, { payment: charge(), occurredAt: days(2) }, days(2))
    expect(paid?.payment).toMatchObject({ status: 'success', amountMinor: 10000, periodStart: days(2).toISOString(), periodEnd: '2026-11-03T06:00:00.000Z' })
    expect(paid?.checkout).toMatchObject({ paidThroughAt: '2026-11-03T06:00:00.000Z', nextChargeAt: '2026-11-03T06:00:00.000Z' })
    // Auto-renewing: access runs 3 days past the paid-through date.
    expect(paid?.access).toMatchObject({ status: 'active', periodStartedAt: days(2).toISOString(), periodEndsAt: '2026-11-06T06:00:00.000Z' })

    const replay = await applyMandatePayment(store, checkout.id, { payment: charge(), occurredAt: days(2) }, days(2.1))
    expect(replay?.changed).toBe(false)
    expect(audits.filter((entry) => entry.action === 'payment_success')).toHaveLength(1)
    expect(audits.filter((entry) => entry.action === 'period_paid')).toHaveLength(1)
  })

  it('starts a new period at the paid-through date when Cashfree charges early', async () => {
    const { store, checkout } = setup()
    await applyMandatePayment(store, checkout.id, { payment: charge({ initiatedAt: T0.toISOString() }), occurredAt: T0 }, T0)
    const second = await applyMandatePayment(store, checkout.id, {
      payment: charge({ paymentId: 'cfpay_2', cfPaymentId: '900002', initiatedAt: '2026-10-30T06:00:00.000Z' }),
      occurredAt: new Date('2026-10-30T06:00:00.000Z'),
    }, new Date('2026-10-30T06:00:00.000Z'))
    expect(second?.payment.periodStart).toBe('2026-11-01T06:00:00.000Z')
    expect(second?.payment.periodEnd).toBe('2026-12-01T06:00:00.000Z')
  })

  it('creates access from a charge even when the ACTIVE webhook was missed', async () => {
    const { store, checkout, currentRows } = setup()
    const paid = await applyMandatePayment(store, checkout.id, { payment: charge(), occurredAt: days(2) }, days(2))
    expect(paid?.checkout.status).toBe('active')
    expect(currentRows(subject)).toHaveLength(1)
    expect(paid?.access?.status).toBe('active')
  })

  it('moves to past due with a 3-day grace on a failed renewal, and back to active when a retry succeeds', async () => {
    const { store, checkout } = setup()
    await applyMandatePayment(store, checkout.id, { payment: charge({ initiatedAt: T0.toISOString() }), occurredAt: T0 }, T0)
    const renewalAt = new Date('2026-11-01T06:00:00.000Z')
    const failed = await applyMandatePayment(store, checkout.id, {
      payment: charge({ paymentId: 'cfpay_2', cfPaymentId: '900002', status: 'FAILED', initiatedAt: renewalAt.toISOString(), failureReason: 'Insufficient funds' }),
      occurredAt: renewalAt,
    }, renewalAt)
    expect(failed?.payment).toMatchObject({ status: 'failed', failureReason: 'Insufficient funds' })
    expect(failed?.access).toMatchObject({ status: 'past_due', periodEndsAt: '2026-11-04T06:00:00.000Z' })

    const retryAt = new Date('2026-11-02T08:00:00.000Z')
    const retried = await applyMandatePayment(store, checkout.id, {
      payment: charge({ paymentId: 'cfpay_3', cfPaymentId: '900003', initiatedAt: retryAt.toISOString() }),
      occurredAt: retryAt,
    }, retryAt)
    expect(retried?.access).toMatchObject({ status: 'active' })
    expect(retried?.payment.periodStart).toBe(retryAt.toISOString())
  })

  it('does not mark a plan past due for a failure reported after a later success', async () => {
    const { store, checkout } = setup()
    const failedAt = new Date('2026-11-01T06:00:00.000Z')
    await applyMandatePayment(store, checkout.id, { payment: charge({ initiatedAt: T0.toISOString() }), occurredAt: T0 }, T0)
    await applyMandatePayment(store, checkout.id, { payment: charge({ paymentId: 'p3', cfPaymentId: '3', initiatedAt: '2026-11-01T09:00:00.000Z' }), occurredAt: failedAt }, failedAt)
    const late = await applyMandatePayment(store, checkout.id, {
      payment: charge({ paymentId: 'p2', cfPaymentId: '2', status: 'FAILED', initiatedAt: failedAt.toISOString() }),
      occurredAt: failedAt,
    }, new Date('2026-11-01T10:00:00.000Z'))
    expect(late?.access?.status).toBe('active')
  })

  it('never downgrades a payment that was already recorded as successful', async () => {
    const { store, checkout } = setup()
    await applyMandatePayment(store, checkout.id, { payment: charge(), occurredAt: days(2) }, days(2))
    const flipped = await applyMandatePayment(store, checkout.id, { payment: charge({ status: 'FAILED' }), occurredAt: days(2) }, days(2.1))
    expect(flipped?.changed).toBe(false)
    expect(flipped?.payment.status).toBe('success')
  })

  it('records the mandate approval payment without counting it as a paid month', async () => {
    const { store, checkout, currentRows } = setup()
    const auth = await applyMandatePayment(store, checkout.id, { payment: charge({ paymentType: 'AUTH', amountMinor: 100 }), occurredAt: T0 }, T0)
    expect(auth?.payment).toMatchObject({ paymentType: 'AUTH', status: 'success' })
    expect(auth?.checkout.paidThroughAt).toBeNull()
    expect(currentRows(subject)).toHaveLength(0)
  })

  it('does not extend the plan for a charge below its price', async () => {
    const { store, checkout, currentRows } = setup()
    const short = await applyMandatePayment(store, checkout.id, { payment: charge({ amountMinor: 5000 }), occurredAt: days(2) }, days(2))
    expect(short?.note).toBe('amount_mismatch')
    expect(currentRows(subject)).toHaveLength(0)
  })

  it('treats ON_HOLD as a failed renewal', async () => {
    const { store, checkout } = setup()
    await applyMandatePayment(store, checkout.id, { payment: charge({ initiatedAt: T0.toISOString() }), occurredAt: T0 }, T0)
    const holdAt = new Date('2026-11-01T07:00:00.000Z')
    const held = await applyMandateUpdate(store, checkout.id, { providerStatus: 'ON_HOLD', occurredAt: holdAt }, holdAt)
    expect(held?.checkout.status).toBe('on_hold')
    expect(held?.access).toMatchObject({ status: 'past_due', periodEndsAt: '2026-11-04T07:00:00.000Z' })
  })
})

describe('cancelling', () => {
  it('keeps access until the paid-through date and never charges again', async () => {
    const { store, checkout, audits } = setup()
    await applyMandatePayment(store, checkout.id, { payment: charge({ initiatedAt: T0.toISOString() }), occurredAt: T0 }, T0)
    const cancelled = await applyCancellation(store, checkout.id, { now: days(10), actor: { type: 'member', profileId }, reason: 'member_cancelled' })
    expect(cancelled?.checkout.status).toBe('cancelled')
    expect(cancelled?.access).toMatchObject({ status: 'active', cancelAtPeriodEnd: true, periodEndsAt: '2026-11-01T06:00:00.000Z' })

    // Cashfree's CANCELLED webhook arrives afterwards: nothing more changes.
    const webhook = await applyMandateUpdate(store, checkout.id, { providerStatus: 'CANCELLED', occurredAt: days(10.01) }, days(10.01))
    expect(webhook?.changed).toBe(false)
    expect(audits.filter((entry) => entry.action === 'auto_renew_cancelled')).toHaveLength(1)
  })

  it('ends access now when nothing was paid yet', async () => {
    const { store, checkout, currentRows } = setup()
    await applyMandateUpdate(store, checkout.id, { providerStatus: 'ACTIVE', occurredAt: T0 }, T0)
    const cancelled = await applyMandateUpdate(store, checkout.id, { providerStatus: 'CUSTOMER_CANCELLED', occurredAt: days(1) }, days(1))
    expect(cancelled?.access).toMatchObject({ status: 'cancelled', periodEndsAt: days(1).toISOString() })
    expect(currentRows(subject)).toHaveLength(0)
  })

  it('an admin can end access immediately', async () => {
    const { store, checkout } = setup()
    await applyMandatePayment(store, checkout.id, { payment: charge({ initiatedAt: T0.toISOString() }), occurredAt: T0 }, T0)
    const ended = await applyCancellation(store, checkout.id, { now: days(3), actor: { type: 'admin', profileId: 'admin' }, endNow: true, reason: 'admin_cancelled' })
    expect(ended?.access).toMatchObject({ status: 'cancelled', periodEndsAt: days(3).toISOString() })
  })

  it('pausing stops auto-renew and resuming turns it back on', async () => {
    const { store, checkout } = setup()
    await applyMandatePayment(store, checkout.id, { payment: charge({ initiatedAt: T0.toISOString() }), occurredAt: T0 }, T0)
    const paused = await applyMandateUpdate(store, checkout.id, { providerStatus: 'CUSTOMER_PAUSED', occurredAt: days(5) }, days(5))
    expect(paused?.access).toMatchObject({ cancelAtPeriodEnd: true, periodEndsAt: '2026-11-01T06:00:00.000Z' })
    const resumed = await applyMandateUpdate(store, checkout.id, { providerStatus: 'ACTIVE', occurredAt: days(6) }, days(6))
    expect(resumed?.access).toMatchObject({ cancelAtPeriodEnd: false, periodEndsAt: '2026-11-04T06:00:00.000Z' })
  })

  it('expires plans whose paid period and grace are over', async () => {
    const { store, checkout, currentRows } = setup()
    await applyMandatePayment(store, checkout.id, { payment: charge({ initiatedAt: T0.toISOString() }), occurredAt: T0 }, T0)
    expect(await expireAllLapsedAccess(store, days(20))).toBe(0)
    expect(await expireAllLapsedAccess(store, new Date('2026-11-05T00:00:00.000Z'))).toBe(1)
    expect(currentRows(subject)).toHaveLength(0)
    expect(await expireAllLapsedAccess(store, new Date('2026-11-06T00:00:00.000Z'))).toBe(0)
  })
})

describe('switching to yearly', () => {
  it('moves the one current plan to the new mandate, keeps the paid-through date and retires the old mandate', async () => {
    const memory = createMemoryBillingStore(() => T0)
    const { store, currentRows } = memory
    const monthlyCheckout = memory.seedCheckout({ price: monthly, subject })
    await applyMandatePayment(store, monthlyCheckout.id, { payment: charge({ initiatedAt: T0.toISOString() }), occurredAt: T0 }, T0)

    const yearlyCheckout = memory.seedCheckout({ price: yearly, subject, startsAt: new Date('2026-11-01T06:00:00.000Z') })
    const switched = await applyMandateUpdate(store, yearlyCheckout.id, { providerStatus: 'ACTIVE', occurredAt: days(5), nextScheduleDate: new Date('2026-11-01T06:00:00.000Z') }, days(5))
    expect(currentRows(subject)).toHaveLength(1)
    expect(switched?.access).toMatchObject({ providerSubscriptionId: yearlyCheckout.providerSubscriptionId, cancelAtPeriodEnd: false, periodEndsAt: '2026-11-04T06:00:00.000Z' })
    expect(switched?.checkout.paidThroughAt).toBe('2026-11-01T06:00:00.000Z')
    expect(switched?.followUps).toEqual([{ kind: 'cancel_mandate', providerSubscriptionId: monthlyCheckout.providerSubscriptionId, checkoutId: monthlyCheckout.id }])
    expect((await store.getCheckout(monthlyCheckout.id))?.status).toBe('replaced')

    // The old mandate's CANCELLED webhook does not touch the plan.
    const oldCancelled = await applyMandateUpdate(store, monthlyCheckout.id, { providerStatus: 'CANCELLED', occurredAt: days(5.1) }, days(5.1))
    expect(oldCancelled?.access).toBeNull()
    expect((await store.getCheckout(monthlyCheckout.id))?.status).toBe('replaced')

    // The first yearly charge on the renewal date starts a year from the paid-through date.
    const renewal = new Date('2026-11-01T06:00:00.000Z')
    const yearlyPaid = await applyMandatePayment(store, yearlyCheckout.id, {
      payment: charge({ paymentId: 'y1', cfPaymentId: '800001', amountMinor: 100000, initiatedAt: renewal.toISOString() }),
      occurredAt: renewal,
    }, renewal)
    expect(yearlyPaid?.payment).toMatchObject({ periodStart: renewal.toISOString(), periodEnd: '2027-11-01T06:00:00.000Z' })
    expect(currentRows(subject)).toHaveLength(1)
  })

  it('keeps money taken on a replaced mandate on record without extending the plan twice', async () => {
    const memory = createMemoryBillingStore(() => T0)
    const { store, audits } = memory
    const monthlyCheckout = memory.seedCheckout({ price: monthly, subject })
    await applyMandatePayment(store, monthlyCheckout.id, { payment: charge({ initiatedAt: T0.toISOString() }), occurredAt: T0 }, T0)
    const yearlyCheckout = memory.seedCheckout({ price: yearly, subject })
    await applyMandateUpdate(store, yearlyCheckout.id, { providerStatus: 'ACTIVE', occurredAt: days(5) }, days(5))
    const late = await applyMandatePayment(store, monthlyCheckout.id, {
      payment: charge({ paymentId: 'late', cfPaymentId: 'late', initiatedAt: '2026-11-01T06:00:00.000Z' }),
      occurredAt: new Date('2026-11-01T06:00:00.000Z'),
    }, new Date('2026-11-01T06:00:00.000Z'))
    expect(late?.note).toBe('replaced_mandate_charged')
    expect(audits.some((entry) => entry.action === 'charge_on_replaced_mandate')).toBe(true)
  })

  it('links a mandate to a plan the Sea N Shore team gave, without shortening it', async () => {
    const memory = createMemoryBillingStore(() => T0)
    const manual = memory.seedAccess({
      subject,
      planCode: 'creator_pro',
      status: 'active',
      billingProvider: null,
      providerSubscriptionId: null,
      periodStartedAt: '2026-09-01T00:00:00.000Z',
      periodEndsAt: '2026-10-20T00:00:00.000Z',
      cancelAtPeriodEnd: false,
    })
    const checkout = memory.seedCheckout({ price: monthly, subject, startsAt: new Date('2026-10-20T00:00:00.000Z') })
    const linked = await applyMandateUpdate(memory.store, checkout.id, { providerStatus: 'ACTIVE', occurredAt: T0 }, T0)
    expect(linked?.access?.id).toBe(manual.id)
    expect(linked?.access).toMatchObject({ billingProvider: 'cashfree', providerSubscriptionId: checkout.providerSubscriptionId, periodEndsAt: '2026-10-23T00:00:00.000Z' })
    expect(linked?.checkout.paidThroughAt).toBe('2026-10-20T00:00:00.000Z')
    expect(memory.currentRows(subject)).toHaveLength(1)
  })
})

describe('organizations', () => {
  it('keeps Organization Pro on the organization, not the person who paid', async () => {
    const memory = createMemoryBillingStore(() => T0)
    const companyId = '55555555-5555-4555-8555-555555555555'
    const orgPrice = testPrice({ id: '66666666-6666-4666-8666-666666666666', planCode: 'organization_pro', amountMinor: 200000 })
    const checkout = memory.seedCheckout({ price: orgPrice, subject: { kind: 'company', companyId } })
    const paid = await applyMandatePayment(memory.store, checkout.id, { payment: charge({ amountMinor: 200000 }), occurredAt: days(2) }, days(2))
    expect(paid?.access).toMatchObject({ subject: { kind: 'company', companyId }, planCode: 'organization_pro', status: 'active' })
    expect(memory.locks).toContain(`company:${companyId}`)
  })
})
