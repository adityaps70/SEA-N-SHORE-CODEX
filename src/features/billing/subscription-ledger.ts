import type { CashfreeSubscriptionPayment } from './cashfree-subscriptions'
import {
  addInterval,
  autoRenewAccessUntil,
  firstChargeAccessUntil,
  pastDueAccessUntil,
  type BillingSubject,
} from './plans'
import {
  CLOSED_CHECKOUT_STATUSES,
  CURRENT_ACCESS_STATUSES,
  type AccessRecord,
  type BillingStore,
  type CheckoutRecord,
  type CheckoutStatus,
  type LedgerActor,
  type LedgerFollowUp,
  type LedgerResult,
  type PaymentRecord,
  type SubscriptionPaymentStatus,
} from './subscription-types'

/**
 * The money rules for auto-renewing plans. Every function runs inside ONE database
 * transaction (the store is bound to it), locks the member / organization first, is
 * idempotent (webhooks retry, users double-click, the return page and webhooks race)
 * and writes a payment_audit_events row for every state change.
 *
 * Inputs are only ever verified facts: a signature-checked webhook, or Cashfree's own
 * answer to GET /subscriptions/{id}. The browser's word never reaches this module.
 *
 * Mandate (subscription_checkouts) -> access (account_subscriptions):
 *   ACTIVE                      the plan is on. A brand-new mandate gets access until its
 *                               first charge + grace; a mandate that replaces a current
 *                               plan (switch to yearly, auto-renew back on) takes over
 *                               that plan's paid-through date and the old mandate is
 *                               cancelled after commit. Never two current rows.
 *   charge SUCCESS              active; period = max(charge date, paid through) + 1 interval.
 *   charge FAILED / ON_HOLD     past_due; access continues for RENEWAL_GRACE_DAYS.
 *   PAUSED / CUSTOMER_PAUSED    auto-renew off; access until paid through.
 *   CANCELLED / COMPLETED / …   auto-renew off; access until paid through, then expired.
 *   AUTH payments               recorded, never extend access.
 */

type Now = Date

function time(value: string | null | undefined) {
  if (!value) return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? new Date(ms) : null
}

function iso(date: Date) {
  return date.toISOString()
}

function later(a: Date | null, b: Date | null) {
  if (!a) return b
  if (!b) return a
  return a.getTime() >= b.getTime() ? a : b
}

function isClosed(status: CheckoutStatus) {
  return CLOSED_CHECKOUT_STATUSES.includes(status)
}

function isCurrent(access: AccessRecord | null, now: Now): access is AccessRecord {
  if (!access || !CURRENT_ACCESS_STATUSES.includes(access.status)) return false
  const end = time(access.periodEndsAt)
  return !end || end.getTime() > now.getTime()
}

function subjectAudit(subject: BillingSubject) {
  return subject.kind === 'profile' ? { profileId: subject.profileId } : { companyId: subject.companyId }
}

function actorFields(actor: LedgerActor) {
  return { actorType: actor.type, actorProfileId: actor.profileId ?? null }
}

async function auditCheckout(store: BillingStore, actor: LedgerActor, checkout: CheckoutRecord, action: string, from: string | null, to: string | null, details: Record<string, unknown> = {}) {
  await store.audit({
    ...actorFields(actor),
    subjectType: 'subscription_checkout',
    subjectId: checkout.id,
    action,
    fromStatus: from,
    toStatus: to,
    amountMinor: checkout.amountMinor,
    currency: checkout.currency,
    provider: 'cashfree',
    providerReference: checkout.providerSubscriptionId,
    details: { ...subjectAudit(checkout.subject), plan: checkout.planCode, interval: checkout.interval, ...details },
  })
}

async function auditAccess(store: BillingStore, actor: LedgerActor, access: AccessRecord, action: string, from: string | null, details: Record<string, unknown> = {}) {
  await store.audit({
    ...actorFields(actor),
    subjectType: 'account_subscription',
    subjectId: access.id,
    action,
    fromStatus: from,
    toStatus: access.status,
    provider: access.billingProvider,
    providerReference: access.providerSubscriptionId,
    details: {
      ...subjectAudit(access.subject),
      plan: access.planCode,
      periodEndsAt: access.periodEndsAt,
      cancelAtPeriodEnd: access.cancelAtPeriodEnd,
      ...details,
    },
  })
}

async function setCheckoutStatus(store: BillingStore, actor: LedgerActor, checkout: CheckoutRecord, status: CheckoutStatus, extra: Parameters<BillingStore['updateCheckout']>[1] = {}, details: Record<string, unknown> = {}) {
  const updated = await store.updateCheckout(checkout.id, { ...extra, status })
  if (checkout.status !== status) await auditCheckout(store, actor, updated, `mandate_${status}`, checkout.status, status, details)
  return updated
}

/** Access row that belongs to this mandate and still grants the plan. */
async function currentAccessForMandate(store: BillingStore, checkout: CheckoutRecord, now: Now) {
  const linked = await store.getAccessByProviderSubscriptionId(checkout.providerSubscriptionId)
  return isCurrent(linked, now) ? linked : null
}

async function expireLapsed(store: BillingStore, subject: BillingSubject, now: Now, actor: LedgerActor) {
  const expired = await store.expireLapsedAccess(subject, now)
  for (const row of expired) await auditAccess(store, actor, row, 'access_expired', 'active', { reason: 'period_ended' })
}

/**
 * Points the subject's access at this mandate. Reuses the current row when there is one
 * (switch / resume / manual grant), otherwise creates a row after expiring lapsed ones,
 * so the "one current subscription per subject" unique index is never violated.
 */
async function attachAccess(store: BillingStore, checkout: CheckoutRecord, input: {
  now: Now
  periodStartedAt: Date
  accessUntil: Date
  actor: LedgerActor
  status?: 'active' | 'past_due'
}): Promise<{ access: AccessRecord; replaced: CheckoutRecord | null }> {
  const current = await store.getCurrentAccess(checkout.subject, input.now)
  if (current) {
    let replaced: CheckoutRecord | null = null
    if (current.providerSubscriptionId && current.providerSubscriptionId !== checkout.providerSubscriptionId && current.billingProvider === 'cashfree') {
      replaced = await store.getCheckoutByProviderSubscriptionId(current.providerSubscriptionId)
    }
    const end = time(current.periodEndsAt)
    const updated = await store.updateAccess(current.id, {
      status: input.status ?? (current.status === 'past_due' ? 'past_due' : 'active'),
      billingProvider: 'cashfree',
      providerSubscriptionId: checkout.providerSubscriptionId,
      cancelAtPeriodEnd: false,
      // A manual grant without an end date stays open-ended; otherwise never shorten access.
      periodEndsAt: end ? iso(later(end, input.accessUntil)!) : null,
    })
    await auditAccess(store, input.actor, updated, 'access_linked_to_mandate', current.status, {
      previousProvider: current.billingProvider,
      previousProviderReference: current.providerSubscriptionId,
    })
    return { access: updated, replaced }
  }

  await expireLapsed(store, checkout.subject, input.now, input.actor)
  const lapsed = await store.getAccessByProviderSubscriptionId(checkout.providerSubscriptionId)
  if (lapsed) {
    // This mandate's own row lapsed (e.g. a late retry succeeded): bring it back.
    const revived = await store.updateAccess(lapsed.id, {
      status: input.status ?? 'active',
      periodStartedAt: iso(input.periodStartedAt),
      periodEndsAt: iso(input.accessUntil),
      cancelAtPeriodEnd: false,
    })
    await auditAccess(store, input.actor, revived, 'access_restored', lapsed.status)
    return { access: revived, replaced: null }
  }
  const created = await store.insertAccess({
    subject: checkout.subject,
    planCode: checkout.planCode,
    status: input.status ?? 'active',
    billingProvider: 'cashfree',
    providerSubscriptionId: checkout.providerSubscriptionId,
    periodStartedAt: iso(input.periodStartedAt),
    periodEndsAt: iso(input.accessUntil),
    cancelAtPeriodEnd: false,
  })
  await auditAccess(store, input.actor, created, 'access_started', null)
  return { access: created, replaced: null }
}

async function retireReplaced(store: BillingStore, actor: LedgerActor, replaced: CheckoutRecord | null, by: CheckoutRecord): Promise<LedgerFollowUp[]> {
  if (!replaced || replaced.id === by.id || isClosed(replaced.status)) return []
  const updated = await setCheckoutStatus(store, actor, replaced, 'replaced', {}, { replacedBy: by.id })
  return [{ kind: 'cancel_mandate', providerSubscriptionId: updated.providerSubscriptionId, checkoutId: updated.id }]
}

export type MandateUpdate = {
  /** Cashfree subscription_status (INITIALIZED, ACTIVE, ON_HOLD, CANCELLED…). */
  providerStatus: string
  occurredAt: Date
  nextScheduleDate?: Date | null
  paymentMethod?: string | null
  cfSubscriptionId?: string | null
  /** From SUBSCRIPTION_AUTH_STATUS / authorization_details: ACTIVE, PENDING, FAILED. */
  authorizationStatus?: string | null
  failureReason?: string | null
  /** True for Cashfree's answer to GET (fresh), false for webhooks (may arrive out of order). */
  fromApi?: boolean
}

function unchanged(checkout: CheckoutRecord, access: AccessRecord | null, note: string): LedgerResult {
  return { changed: false, checkout, access, followUps: [], note }
}

async function activate(store: BillingStore, checkout: CheckoutRecord, update: MandateUpdate, now: Now, actor: LedgerActor): Promise<LedgerResult> {
  const wasStatus = checkout.status
  let current = await setCheckoutStatus(store, actor, checkout, 'active', {
    activatedAt: checkout.activatedAt ?? iso(now),
    failureReason: null,
    ...(update.nextScheduleDate ? { nextChargeAt: iso(update.nextScheduleDate) } : {}),
  })

  const own = await currentAccessForMandate(store, current, now)
  if (own) {
    // Resumed after a pause: auto-renew is on again.
    if (own.cancelAtPeriodEnd) {
      const paidThrough = time(current.paidThroughAt)
      const resumed = await store.updateAccess(own.id, {
        cancelAtPeriodEnd: false,
        ...(paidThrough ? { periodEndsAt: iso(later(time(own.periodEndsAt), autoRenewAccessUntil(paidThrough))!) } : {}),
      })
      await auditAccess(store, actor, resumed, 'auto_renew_resumed', own.status)
      return { changed: true, checkout: current, access: resumed, followUps: [] }
    }
    return { changed: wasStatus !== 'active', checkout: current, access: own, followUps: [] }
  }

  const existing = await store.getCurrentAccess(current.subject, now)
  let paidThrough = time(current.paidThroughAt)
  if (existing && !paidThrough) {
    // Taking over a current plan: carry its paid-through date so nobody pays twice for it.
    const previous = existing.providerSubscriptionId && existing.billingProvider === 'cashfree'
      ? await store.getCheckoutByProviderSubscriptionId(existing.providerSubscriptionId)
      : null
    paidThrough = time(previous?.paidThroughAt) ?? time(existing.periodEndsAt)
    if (paidThrough && paidThrough.getTime() > now.getTime()) {
      current = await store.updateCheckout(current.id, {
        paidThroughAt: iso(paidThrough),
        nextChargeAt: current.nextChargeAt ?? iso(paidThrough),
      })
    } else {
      paidThrough = null
    }
  }

  const firstCharge = update.nextScheduleDate ?? time(current.startsAt)
  const accessUntil = paidThrough && paidThrough.getTime() > now.getTime()
    ? autoRenewAccessUntil(paidThrough)
    : firstChargeAccessUntil(now, firstCharge)
  const { access, replaced } = await attachAccess(store, current, { now, periodStartedAt: now, accessUntil, actor })
  const followUps = await retireReplaced(store, actor, replaced, current)
  return { changed: true, checkout: current, access, followUps }
}

async function markPastDue(store: BillingStore, checkout: CheckoutRecord, failedAt: Date, now: Now, actor: LedgerActor, reason: string | null) {
  const access = await store.getAccessByProviderSubscriptionId(checkout.providerSubscriptionId)
  if (!access || access.cancelAtPeriodEnd || !['active', 'trialing', 'past_due', 'expired'].includes(access.status)) return access
  if (await store.hasSuccessfulChargeAfter(checkout.id, failedAt)) return access
  const until = pastDueAccessUntil(time(checkout.paidThroughAt), failedAt)
  const end = time(access.periodEndsAt)
  if (access.status === 'expired') {
    // Only a lapse inside the grace window comes back as past due.
    if (until.getTime() <= now.getTime()) return access
    const current = await store.getCurrentAccess(checkout.subject, now)
    if (current) return access
    // Free the "one current row" slot held by any lapsed row before reviving this one.
    await expireLapsed(store, checkout.subject, now, actor)
  }
  const nextEnd = end ? later(end, until)! : until
  if (access.status === 'past_due' && end && end.getTime() >= nextEnd.getTime()) return access
  const updated = await store.updateAccess(access.id, { status: 'past_due', periodEndsAt: iso(nextEnd) })
  await auditAccess(store, actor, updated, 'renewal_failed', access.status, { failedAt: iso(failedAt), reason })
  return updated
}

async function endMandate(store: BillingStore, checkout: CheckoutRecord, target: 'paused' | 'cancelled' | 'ended', update: MandateUpdate, now: Now, actor: LedgerActor): Promise<LedgerResult> {
  const nextStatus: CheckoutStatus = checkout.status === 'replaced' ? 'replaced' : target
  const updated = await setCheckoutStatus(store, actor, checkout, nextStatus, {
    ...(target === 'paused' ? {} : { cancelledAt: checkout.cancelledAt ?? iso(now) }),
  }, { providerStatus: update.providerStatus })

  const access = await currentAccessForMandate(store, updated, now)
  if (!access) return { changed: checkout.status !== nextStatus, checkout: updated, access: null, followUps: [] }

  const paidThrough = time(updated.paidThroughAt)
  if (!paidThrough || paidThrough.getTime() <= now.getTime()) {
    // Nothing paid beyond today (never charged, or the grace after a failed renewal): stop now.
    const stopped = await store.updateAccess(access.id, {
      status: paidThrough ? 'expired' : 'cancelled',
      cancelAtPeriodEnd: true,
      periodEndsAt: iso(now),
    })
    await auditAccess(store, actor, stopped, 'access_ended', access.status, { reason: update.providerStatus })
    return { changed: true, checkout: updated, access: stopped, followUps: [] }
  }
  if (access.cancelAtPeriodEnd && access.periodEndsAt === iso(paidThrough)) {
    return { changed: checkout.status !== nextStatus, checkout: updated, access, followUps: [] }
  }
  const scheduled = await store.updateAccess(access.id, { cancelAtPeriodEnd: true, periodEndsAt: iso(paidThrough) })
  await auditAccess(store, actor, scheduled, target === 'paused' ? 'auto_renew_paused' : 'auto_renew_cancelled', access.status, { reason: update.providerStatus })
  return { changed: true, checkout: updated, access: scheduled, followUps: [] }
}

/**
 * Applies a verified subscription status (webhook or GET /subscriptions/{id}).
 * Returns what changed plus follow-ups to run after commit.
 */
export async function applyMandateUpdate(store: BillingStore, checkoutId: string, update: MandateUpdate, now: Now, actor: LedgerActor = { type: 'provider' }): Promise<LedgerResult | null> {
  const loaded = await store.getCheckout(checkoutId)
  if (!loaded) return null
  await store.lockSubject(loaded.subject)
  let checkout = (await store.getCheckout(checkoutId))!

  const lastEvent = time(checkout.lastStatusEventAt)
  if (!update.fromApi && lastEvent && update.occurredAt.getTime() < lastEvent.getTime()) {
    return unchanged(checkout, null, 'stale_event')
  }
  checkout = await store.updateCheckout(checkout.id, {
    providerStatus: update.providerStatus.slice(0, 60),
    // Only webhooks advance the event clock (they can arrive out of order); a GET answer
    // is always current. Each transition below also refuses to move backwards.
    ...(update.fromApi ? { lastCheckedAt: iso(now) } : { lastStatusEventAt: iso(later(lastEvent, update.occurredAt)!) }),
    ...(update.cfSubscriptionId && !checkout.cfSubscriptionId ? { cfSubscriptionId: update.cfSubscriptionId } : {}),
    ...(update.paymentMethod ? { paymentMethod: update.paymentMethod } : {}),
  })

  const status = update.providerStatus.toUpperCase()
  const authFailed = update.authorizationStatus?.toUpperCase() === 'FAILED'

  if (status === 'CANCELLED' || status === 'CUSTOMER_CANCELLED') return endMandate(store, checkout, 'cancelled', update, now, actor)
  if (status === 'COMPLETED' || status === 'EXPIRED' || status === 'CARD_EXPIRED') return endMandate(store, checkout, 'ended', update, now, actor)
  if (isClosed(checkout.status)) return unchanged(checkout, null, 'mandate_closed')
  if (status === 'PAUSED' || status === 'CUSTOMER_PAUSED') return endMandate(store, checkout, 'paused', update, now, actor)

  if (status === 'ACTIVE' && !authFailed) return activate(store, checkout, update, now, actor)

  if (status === 'ON_HOLD') {
    const updated = await setCheckoutStatus(store, actor, checkout, 'on_hold')
    const access = await markPastDue(store, updated, update.occurredAt, now, actor, update.failureReason ?? 'on_hold')
    return { changed: true, checkout: updated, access, followUps: [] }
  }

  if (status === 'BANK_APPROVAL_PENDING' || (status === 'INITIALIZED' && update.authorizationStatus?.toUpperCase() === 'PENDING')) {
    if (checkout.status !== 'created' && checkout.status !== 'failed') return unchanged(checkout, null, 'already_past_approval')
    const updated = await setCheckoutStatus(store, actor, checkout, 'pending_approval', { failureReason: null })
    return { changed: true, checkout: updated, access: null, followUps: [] }
  }

  if (authFailed || status === 'LINK_EXPIRED') {
    if (checkout.status !== 'created' && checkout.status !== 'pending_approval') return unchanged(checkout, null, 'not_awaiting_approval')
    const updated = await setCheckoutStatus(store, actor, checkout, 'failed', {
      failureReason: (update.failureReason ?? (status === 'LINK_EXPIRED' ? 'link_expired' : 'authorization_failed')).slice(0, 500),
    })
    return { changed: true, checkout: updated, access: null, followUps: [] }
  }

  return unchanged(checkout, null, 'status_recorded')
}

function paymentStatus(raw: string): SubscriptionPaymentStatus {
  const status = raw.toUpperCase()
  if (status === 'SUCCESS') return 'success'
  if (status === 'FAILED') return 'failed'
  if (status === 'CANCELLED' || status === 'VOID') return 'cancelled'
  return 'pending'
}

export type PaymentUpdate = {
  payment: CashfreeSubscriptionPayment
  occurredAt: Date
}

/**
 * Records one mandate payment (idempotent on Cashfree's payment ids) and applies it:
 * a successful CHARGE extends the plan by one interval, a failed CHARGE starts the grace
 * period. A payment that was already recorded as successful never changes again.
 */
export async function applyMandatePayment(store: BillingStore, checkoutId: string, input: PaymentUpdate, now: Now, actor: LedgerActor = { type: 'provider' }): Promise<(LedgerResult & { payment: PaymentRecord }) | null> {
  const loaded = await store.getCheckout(checkoutId)
  if (!loaded) return null
  await store.lockSubject(loaded.subject)
  let checkout = (await store.getCheckout(checkoutId))!
  const { payment } = input
  const status = paymentStatus(payment.status)
  const amountMinor = payment.amountMinor ?? (payment.paymentType === 'AUTH' ? 0 : checkout.amountMinor)

  const existing = await store.findPayment({ cfPaymentId: payment.cfPaymentId, providerPaymentId: payment.paymentId })
  if (existing && (existing.status === 'success' || existing.status === status)) {
    return { changed: false, checkout, access: null, followUps: [], payment: existing, note: 'payment_already_recorded' }
  }

  const chargedAt = time(payment.initiatedAt) ?? time(payment.scheduledFor) ?? input.occurredAt
  let record: PaymentRecord
  if (existing) {
    record = await store.updatePayment(existing.id, {
      status,
      rawStatus: payment.status.slice(0, 60),
      failureReason: status === 'failed' ? (payment.failureReason ?? 'payment_failed').slice(0, 500) : null,
      ...(payment.cfPaymentId && !existing.cfPaymentId ? { cfPaymentId: payment.cfPaymentId } : {}),
      ...(payment.paymentId && !existing.providerPaymentId ? { providerPaymentId: payment.paymentId } : {}),
    })
  } else {
    record = await store.insertPayment({
      checkoutId: checkout.id,
      subject: checkout.subject,
      providerPaymentId: payment.paymentId,
      cfPaymentId: payment.cfPaymentId,
      paymentType: payment.paymentType,
      amountMinor,
      currency: 'INR',
      status,
      rawStatus: payment.status.slice(0, 60),
      failureReason: status === 'failed' ? (payment.failureReason ?? 'payment_failed').slice(0, 500) : null,
      periodStart: null,
      periodEnd: null,
      scheduledFor: payment.scheduledFor ? time(payment.scheduledFor)?.toISOString() ?? null : null,
      paidAt: null,
    })
  }
  await store.audit({
    ...actorFields(actor),
    subjectType: 'subscription_payment',
    subjectId: record.id,
    action: `payment_${status}`,
    fromStatus: existing?.status ?? null,
    toStatus: status,
    amountMinor: record.amountMinor,
    currency: 'INR',
    provider: 'cashfree',
    providerReference: payment.cfPaymentId ?? payment.paymentId,
    details: { ...subjectAudit(checkout.subject), checkoutId: checkout.id, paymentType: payment.paymentType, reason: record.failureReason },
  })

  if (payment.paymentType === 'AUTH') {
    return { changed: true, checkout, access: null, followUps: [], payment: record, note: 'auth_payment_recorded' }
  }

  if (status === 'failed') {
    checkout = await store.updateCheckout(checkout.id, { failureReason: record.failureReason })
    const access = await markPastDue(store, checkout, chargedAt, now, actor, record.failureReason)
    return { changed: true, checkout, access, followUps: [], payment: record }
  }
  if (status !== 'success') return { changed: true, checkout, access: null, followUps: [], payment: record }

  if (amountMinor < checkout.amountMinor) {
    // Never extend a plan for less than its price; the team reviews it from the audit trail.
    await auditCheckout(store, actor, checkout, 'charge_amount_mismatch', checkout.status, checkout.status, { paymentId: record.id, amountMinor })
    return { changed: true, checkout, access: null, followUps: [], payment: record, note: 'amount_mismatch' }
  }

  const paidThrough = time(checkout.paidThroughAt)
  const periodStart = later(chargedAt, paidThrough)!
  const periodEnd = addInterval(periodStart, checkout.interval)
  record = await store.updatePayment(record.id, { periodStart: iso(periodStart), periodEnd: iso(periodEnd), paidAt: iso(chargedAt) })

  const linked = await store.getAccessByProviderSubscriptionId(checkout.providerSubscriptionId)
  if (checkout.status === 'replaced' && !isCurrent(linked, now)) {
    // Money taken on a mandate we already replaced. Keep it on record for a refund review
    // instead of extending the plan twice.
    await auditCheckout(store, actor, checkout, 'charge_on_replaced_mandate', checkout.status, checkout.status, { paymentId: record.id })
    return { changed: true, checkout, access: null, followUps: [], payment: record, note: 'replaced_mandate_charged' }
  }

  checkout = await store.updateCheckout(checkout.id, {
    paidThroughAt: iso(later(paidThrough, periodEnd)!),
    nextChargeAt: iso(periodEnd),
    failureReason: null,
    ...(checkout.status === 'on_hold' || checkout.status === 'created' || checkout.status === 'pending_approval'
      ? { status: 'active' as const, activatedAt: checkout.activatedAt ?? iso(now) }
      : {}),
  })

  const autoRenew = !isClosed(checkout.status) && checkout.status !== 'paused'
  const accessUntil = autoRenew ? autoRenewAccessUntil(periodEnd) : periodEnd
  if (isCurrent(linked, now)) {
    const updated = await store.updateAccess(linked.id, {
      status: 'active',
      periodStartedAt: iso(periodStart),
      periodEndsAt: iso(later(time(linked.periodEndsAt), accessUntil)!),
      cancelAtPeriodEnd: !autoRenew,
    })
    await auditAccess(store, actor, updated, 'period_paid', linked.status, { paymentId: record.id, periodStart: iso(periodStart), periodEnd: iso(periodEnd) })
    return { changed: true, checkout, access: updated, followUps: [], payment: record }
  }

  const { access, replaced } = await attachAccess(store, checkout, { now, periodStartedAt: periodStart, accessUntil, actor, status: 'active' })
  let finalAccess = access
  if (!autoRenew && !access.cancelAtPeriodEnd) finalAccess = await store.updateAccess(access.id, { cancelAtPeriodEnd: true })
  await auditAccess(store, actor, finalAccess, 'period_paid', null, { paymentId: record.id, periodStart: iso(periodStart), periodEnd: iso(periodEnd) })
  const followUps = await retireReplaced(store, actor, replaced, checkout)
  return { changed: true, checkout, access: finalAccess, followUps, payment: record }
}

/**
 * Our own cancellation (member "Cancel auto-renew", or admin), applied after Cashfree
 * accepted the CANCEL. Access continues to the paid-through date unless endNow.
 */
export async function applyCancellation(store: BillingStore, checkoutId: string, input: { now: Now; actor: LedgerActor; endNow?: boolean; reason: string }): Promise<LedgerResult | null> {
  const result = await applyMandateUpdate(store, checkoutId, {
    providerStatus: 'CANCELLED',
    occurredAt: input.now,
    fromApi: true,
  }, input.now, input.actor)
  if (!result || !input.endNow) return result
  const access = result.access ?? await store.getCurrentAccess(result.checkout.subject, input.now)
  if (!access || !isCurrent(access, input.now) || access.providerSubscriptionId !== result.checkout.providerSubscriptionId) return result
  const ended = await store.updateAccess(access.id, { status: 'cancelled', cancelAtPeriodEnd: true, periodEndsAt: iso(input.now) })
  await auditAccess(store, input.actor, ended, 'access_ended', access.status, { reason: input.reason })
  return { ...result, changed: true, access: ended }
}

/** Daily tidy-up: rows whose paid period (and grace) is over become expired. */
export async function expireAllLapsedAccess(store: BillingStore, now: Now) {
  const expired = await store.expireLapsedAccess(null, now)
  for (const row of expired) await auditAccess(store, { type: 'system' }, row, 'access_expired', 'active', { reason: 'period_ended' })
  return expired.length
}
