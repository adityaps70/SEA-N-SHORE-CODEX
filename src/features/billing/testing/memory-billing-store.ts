import type { PaymentAuditEntry } from '@/features/payments/audit'
import { subjectKey, type BillingSubject } from '../plans'
import {
  CURRENT_ACCESS_STATUSES,
  type AccessRecord,
  type BillingStore,
  type CheckoutRecord,
  type PaymentRecord,
  type PlanPrice,
  type TrialRecord,
} from '../subscription-types'

/**
 * In-memory BillingStore for tests. Enforces the same invariants as the database:
 * one current-status account_subscriptions row per subject (the partial unique index
 * from 0032, which ignores period end), unique provider subscription ids and unique
 * Cashfree payment ids.
 */

let sequence = 0
function nextId() {
  sequence += 1
  return `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`
}

function sameSubject(a: BillingSubject, b: BillingSubject) {
  return subjectKey(a) === subjectKey(b)
}

export function createMemoryBillingStore(clock: () => Date = () => new Date()) {
  const checkouts = new Map<string, CheckoutRecord>()
  const access = new Map<string, AccessRecord>()
  const payments = new Map<string, PaymentRecord>()
  const trials = new Map<string, TrialRecord>()
  const audits: PaymentAuditEntry[] = []
  const locks: string[] = []

  function stamp() {
    return clock().toISOString()
  }

  function assertAccessInvariant() {
    const current = new Map<string, number>()
    for (const row of access.values()) {
      if (!CURRENT_ACCESS_STATUSES.includes(row.status)) continue
      const key = subjectKey(row.subject)
      current.set(key, (current.get(key) ?? 0) + 1)
      if ((current.get(key) ?? 0) > 1) throw new Error(`unique_violation: two current subscriptions for ${key}`)
    }
    const providerIds = new Set<string>()
    for (const row of access.values()) {
      if (!row.providerSubscriptionId) continue
      const key = `${row.billingProvider}:${row.providerSubscriptionId}`
      if (providerIds.has(key)) throw new Error(`unique_violation: provider subscription ${key}`)
      providerIds.add(key)
    }
  }

  function assertPaymentInvariant() {
    const cf = new Set<string>()
    const ours = new Set<string>()
    for (const row of payments.values()) {
      if (row.cfPaymentId) {
        if (cf.has(row.cfPaymentId)) throw new Error('unique_violation: cf_payment_id')
        cf.add(row.cfPaymentId)
      }
      if (row.providerPaymentId) {
        if (ours.has(row.providerPaymentId)) throw new Error('unique_violation: provider_payment_id')
        ours.add(row.providerPaymentId)
      }
    }
  }

  const store: BillingStore = {
    async lockSubject(subject) {
      locks.push(subjectKey(subject))
    },
    async insertCheckout(input) {
      if ([...checkouts.values()].some((row) => row.providerSubscriptionId === input.providerSubscriptionId)) throw new Error('unique_violation: checkout provider id')
      const row: CheckoutRecord = {
        id: input.id,
        subject: input.subject,
        createdBy: input.createdBy,
        planCode: input.price.planCode,
        planPriceId: input.price.id,
        interval: input.price.interval,
        amountMinor: input.price.amountMinor,
        currency: 'INR',
        environment: input.environment,
        providerSubscriptionId: input.providerSubscriptionId,
        cfSubscriptionId: null,
        sessionId: null,
        status: 'created',
        providerStatus: null,
        paymentMethod: null,
        startsAt: input.startsAt?.toISOString() ?? null,
        nextChargeAt: null,
        paidThroughAt: null,
        replacesCheckoutId: input.replacesCheckoutId,
        failureReason: null,
        lastCheckedAt: null,
        lastStatusEventAt: null,
        activatedAt: null,
        cancelledAt: null,
        createdAt: stamp(),
        updatedAt: stamp(),
      }
      checkouts.set(row.id, row)
      audits.push({ actorType: 'member', actorProfileId: input.createdBy, subjectType: 'subscription_checkout', subjectId: row.id, action: 'checkout_created' })
      return { ...row }
    },
    async getCheckout(id) {
      const row = checkouts.get(id)
      return row ? { ...row } : null
    },
    async getCheckoutByProviderSubscriptionId(providerSubscriptionId) {
      const row = [...checkouts.values()].find((entry) => entry.providerSubscriptionId === providerSubscriptionId)
      return row ? { ...row } : null
    },
    async updateCheckout(id, patch) {
      const row = checkouts.get(id)
      if (!row) throw new Error('subscription_checkout_missing')
      const next = { ...row, ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)), updatedAt: stamp() } as CheckoutRecord
      checkouts.set(id, next)
      return { ...next }
    },
    async getCurrentAccess(subject, now) {
      const rows = [...access.values()]
        .filter((row) => sameSubject(row.subject, subject) && CURRENT_ACCESS_STATUSES.includes(row.status))
        .filter((row) => !row.periodEndsAt || Date.parse(row.periodEndsAt) > now.getTime())
      return rows[0] ? { ...rows[0] } : null
    },
    async getAccessByProviderSubscriptionId(providerSubscriptionId) {
      const rows = [...access.values()].filter((row) => row.billingProvider === 'cashfree' && row.providerSubscriptionId === providerSubscriptionId)
      return rows[0] ? { ...rows[0] } : null
    },
    async insertAccess(input) {
      const row: AccessRecord = { ...input, id: nextId(), createdAt: stamp(), updatedAt: stamp() }
      access.set(row.id, row)
      assertAccessInvariant()
      return { ...row }
    },
    async updateAccess(id, patch) {
      const row = access.get(id)
      if (!row) throw new Error('account_subscription_missing')
      const next = { ...row, ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)), updatedAt: stamp() } as AccessRecord
      access.set(id, next)
      assertAccessInvariant()
      return { ...next }
    },
    async expireLapsedAccess(subject, now) {
      const expired: AccessRecord[] = []
      for (const row of access.values()) {
        if (subject && !sameSubject(row.subject, subject)) continue
        if (!CURRENT_ACCESS_STATUSES.includes(row.status) || !row.periodEndsAt) continue
        if (Date.parse(row.periodEndsAt) > now.getTime()) continue
        const next = { ...row, status: 'expired' as const, updatedAt: stamp() }
        access.set(row.id, next)
        expired.push({ ...next })
      }
      return expired
    },
    async findPayment(ref) {
      const row = [...payments.values()].find((entry) => (ref.cfPaymentId && entry.cfPaymentId === ref.cfPaymentId) || (ref.providerPaymentId && entry.providerPaymentId === ref.providerPaymentId))
      return row ? { ...row } : null
    },
    async insertPayment(input) {
      const row: PaymentRecord = { ...input, id: nextId(), createdAt: stamp(), updatedAt: stamp() }
      payments.set(row.id, row)
      assertPaymentInvariant()
      return { ...row }
    },
    async updatePayment(id, patch) {
      const row = payments.get(id)
      if (!row) throw new Error('subscription_payment_missing')
      const next = { ...row, ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)), updatedAt: stamp() } as PaymentRecord
      payments.set(id, next)
      assertPaymentInvariant()
      return { ...next }
    },
    async hasSuccessfulChargeAfter(checkoutId, after) {
      return [...payments.values()].some((row) => row.checkoutId === checkoutId && row.paymentType === 'CHARGE' && row.status === 'success'
        && Date.parse(row.paidAt ?? row.createdAt) > after.getTime())
    },
    async audit(entry) {
      audits.push(entry)
    },
    async getTrial(subject) {
      const row = [...trials.values()].find((entry) => sameSubject(entry.subject, subject))
      return row ? { ...row } : null
    },
    async getTrialById(id) {
      const row = trials.get(id)
      return row ? { ...row } : null
    },
    async insertTrial(input) {
      // plan_trials_profile_uq / plan_trials_company_uq: one trial per subject, ever.
      if ([...trials.values()].some((entry) => sameSubject(entry.subject, input.subject))) throw new Error('unique_violation: plan_trials subject')
      const row: TrialRecord = {
        ...input,
        id: nextId(),
        endedAt: null,
        endedReason: null,
        extendedBy: null,
        extendedAt: null,
        reminder7dSentAt: null,
        reminder1dSentAt: null,
        createdAt: stamp(),
        updatedAt: stamp(),
      }
      trials.set(row.id, row)
      return { ...row }
    },
    async updateTrial(id, patch) {
      const row = trials.get(id)
      if (!row) throw new Error('plan_trial_missing')
      const next = { ...row, ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)), updatedAt: stamp() } as TrialRecord
      trials.set(id, next)
      return { ...next }
    },
  }

  return {
    store,
    checkouts,
    access,
    payments,
    trials,
    audits,
    locks,
    /** Seeds a checkout row as if checkout had started. */
    seedCheckout(input: { price: PlanPrice; subject: BillingSubject; id?: string; providerSubscriptionId?: string; startsAt?: Date | null; status?: CheckoutRecord['status']; paidThroughAt?: string | null; nextChargeAt?: string | null; environment?: 'sandbox' | 'production' }) {
      const id = input.id ?? nextId()
      const row: CheckoutRecord = {
        id,
        subject: input.subject,
        createdBy: input.subject.kind === 'profile' ? input.subject.profileId : '11111111-1111-4111-8111-111111111111',
        planCode: input.price.planCode,
        planPriceId: input.price.id,
        interval: input.price.interval,
        amountMinor: input.price.amountMinor,
        currency: 'INR',
        environment: input.environment ?? 'sandbox',
        providerSubscriptionId: input.providerSubscriptionId ?? `snss_${id.replace(/-/g, '')}`,
        cfSubscriptionId: null,
        sessionId: 'session_test',
        status: input.status ?? 'created',
        providerStatus: 'INITIALIZED',
        paymentMethod: null,
        startsAt: input.startsAt?.toISOString() ?? null,
        nextChargeAt: input.nextChargeAt ?? null,
        paidThroughAt: input.paidThroughAt ?? null,
        replacesCheckoutId: null,
        failureReason: null,
        lastCheckedAt: null,
        lastStatusEventAt: null,
        activatedAt: null,
        cancelledAt: null,
        createdAt: stamp(),
        updatedAt: stamp(),
      }
      checkouts.set(id, row)
      return row
    },
    seedAccess(input: Omit<AccessRecord, 'id' | 'createdAt' | 'updatedAt'>) {
      const row: AccessRecord = { ...input, id: nextId(), createdAt: stamp(), updatedAt: stamp() }
      access.set(row.id, row)
      assertAccessInvariant()
      return row
    },
    currentRows(subject: BillingSubject) {
      return [...access.values()].filter((row) => sameSubject(row.subject, subject) && CURRENT_ACCESS_STATUSES.includes(row.status))
    },
  }
}

export function testPrice(overrides: Partial<PlanPrice> = {}): PlanPrice {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    planCode: 'creator_pro',
    interval: 'month',
    amountMinor: 10000,
    currency: 'INR',
    active: true,
    providerPlanId: null,
    providerEnvironment: null,
    createdBy: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  }
}
