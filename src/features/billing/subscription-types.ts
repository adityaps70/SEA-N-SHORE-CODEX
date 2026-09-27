import type { PaymentAuditEntry } from '@/features/payments/audit'
import type { CashfreeMode } from '@/features/payments/types'
import type { BillingInterval, BillingSubject, PaidPlanCode } from './plans'

export const CHECKOUT_STATUSES = ['created', 'pending_approval', 'active', 'on_hold', 'paused', 'failed', 'cancelled', 'ended', 'replaced'] as const
/** Our state of one Cashfree subscription (mandate). */
export type CheckoutStatus = typeof CHECKOUT_STATUSES[number]

/** Mandates that can still take money or become active. */
export const OPEN_CHECKOUT_STATUSES: readonly CheckoutStatus[] = ['created', 'pending_approval', 'active', 'on_hold', 'paused']
/** Mandates that are over for good (Cashfree cancellations are final). */
export const CLOSED_CHECKOUT_STATUSES: readonly CheckoutStatus[] = ['cancelled', 'ended', 'replaced']

export type AccessStatus = 'pending' | 'trialing' | 'active' | 'past_due' | 'cancelled' | 'expired'
export const CURRENT_ACCESS_STATUSES: readonly AccessStatus[] = ['trialing', 'active', 'past_due']

export type PlanPrice = {
  id: string
  planCode: PaidPlanCode
  interval: BillingInterval
  amountMinor: number
  currency: 'INR'
  active: boolean
  providerPlanId: string | null
  providerEnvironment: CashfreeMode | null
  createdBy: string | null
  createdAt: string
}

export type CheckoutRecord = {
  id: string
  subject: BillingSubject
  createdBy: string | null
  planCode: PaidPlanCode
  planPriceId: string
  interval: BillingInterval
  amountMinor: number
  currency: 'INR'
  environment: CashfreeMode
  providerSubscriptionId: string
  cfSubscriptionId: string | null
  sessionId: string | null
  status: CheckoutStatus
  providerStatus: string | null
  paymentMethod: string | null
  startsAt: string | null
  nextChargeAt: string | null
  paidThroughAt: string | null
  replacesCheckoutId: string | null
  failureReason: string | null
  lastCheckedAt: string | null
  lastStatusEventAt: string | null
  activatedAt: string | null
  cancelledAt: string | null
  createdAt: string
  updatedAt: string
}

export type CheckoutPatch = Partial<Pick<CheckoutRecord,
  | 'cfSubscriptionId'
  | 'sessionId'
  | 'status'
  | 'providerStatus'
  | 'paymentMethod'
  | 'nextChargeAt'
  | 'paidThroughAt'
  | 'failureReason'
  | 'lastCheckedAt'
  | 'lastStatusEventAt'
  | 'activatedAt'
  | 'cancelledAt'
>>

/** A row of public.account_subscriptions: what actually grants the plan. */
export type AccessRecord = {
  id: string
  subject: BillingSubject
  planCode: PaidPlanCode
  status: AccessStatus
  billingProvider: string | null
  providerSubscriptionId: string | null
  periodStartedAt: string | null
  periodEndsAt: string | null
  cancelAtPeriodEnd: boolean
  createdAt: string
  updatedAt: string
}

export type AccessPatch = Partial<Pick<AccessRecord,
  'status' | 'billingProvider' | 'providerSubscriptionId' | 'periodStartedAt' | 'periodEndsAt' | 'cancelAtPeriodEnd'>>

export type SubscriptionPaymentStatus = 'pending' | 'success' | 'failed' | 'cancelled'

export type PaymentRecord = {
  id: string
  checkoutId: string
  subject: BillingSubject
  providerPaymentId: string | null
  cfPaymentId: string | null
  paymentType: 'AUTH' | 'CHARGE'
  amountMinor: number
  currency: 'INR'
  status: SubscriptionPaymentStatus
  rawStatus: string | null
  failureReason: string | null
  periodStart: string | null
  periodEnd: string | null
  scheduledFor: string | null
  paidAt: string | null
  createdAt: string
  updatedAt: string
}

export type PaymentInsert = Omit<PaymentRecord, 'id' | 'createdAt' | 'updatedAt'>
export type PaymentPatch = Partial<Pick<PaymentRecord,
  'providerPaymentId' | 'cfPaymentId' | 'status' | 'rawStatus' | 'failureReason' | 'periodStart' | 'periodEnd' | 'paidAt' | 'amountMinor'>>

export type AccessInsert = Omit<AccessRecord, 'id' | 'createdAt' | 'updatedAt'>

export type CheckoutInsert = {
  id: string
  subject: BillingSubject
  createdBy: string
  price: PlanPrice
  environment: CashfreeMode
  providerSubscriptionId: string
  startsAt: Date | null
  replacesCheckoutId: string | null
}

/**
 * Everything the ledger needs from the database, always inside ONE transaction (the
 * SQL implementation is bound to a transaction client). Kept small so the money rules in
 * subscription-ledger.ts are tested against an in-memory implementation too.
 */
export type BillingStore = {
  /** Serializes all billing changes for one member or organization until commit. */
  lockSubject(subject: BillingSubject): Promise<void>
  /** New mandate row (status created) with its audit row. */
  insertCheckout(input: CheckoutInsert): Promise<CheckoutRecord>
  getCheckout(id: string): Promise<CheckoutRecord | null>
  getCheckoutByProviderSubscriptionId(providerSubscriptionId: string): Promise<CheckoutRecord | null>
  updateCheckout(id: string, patch: CheckoutPatch): Promise<CheckoutRecord>
  /** The subject's access row that grants the plan right now, if any. */
  getCurrentAccess(subject: BillingSubject, now: Date): Promise<AccessRecord | null>
  /** The newest access row linked to this mandate, in any status. */
  getAccessByProviderSubscriptionId(providerSubscriptionId: string): Promise<AccessRecord | null>
  insertAccess(input: AccessInsert): Promise<AccessRecord>
  updateAccess(id: string, patch: AccessPatch): Promise<AccessRecord>
  /** Marks current-status rows whose period has ended as expired (all subjects when null). */
  expireLapsedAccess(subject: BillingSubject | null, now: Date): Promise<AccessRecord[]>
  findPayment(ref: { cfPaymentId: string | null; providerPaymentId: string | null }): Promise<PaymentRecord | null>
  insertPayment(input: PaymentInsert): Promise<PaymentRecord>
  updatePayment(id: string, patch: PaymentPatch): Promise<PaymentRecord>
  hasSuccessfulChargeAfter(checkoutId: string, after: Date): Promise<boolean>
  audit(entry: PaymentAuditEntry): Promise<void>
}

export type LedgerActor = { type: 'provider' | 'member' | 'admin' | 'system'; profileId?: string | null }

/** Follow-up work after the transaction commits, e.g. cancelling a replaced mandate at Cashfree. */
export type LedgerFollowUp = { kind: 'cancel_mandate'; providerSubscriptionId: string; checkoutId: string }

export type LedgerResult = {
  changed: boolean
  checkout: CheckoutRecord
  access: AccessRecord | null
  followUps: LedgerFollowUp[]
  /** For logs only. */
  note?: string
}
