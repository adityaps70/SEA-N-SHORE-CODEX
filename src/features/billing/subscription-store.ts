import type { QueryResultRow } from 'pg'
import type { DatabaseQueryClient } from '@/lib/db/client'
import { recordPaymentAudit } from '@/features/payments/audit'
import { isBillingInterval, isPaidPlanCode, subjectKey, type BillingSubject } from './plans'
import {
  CHECKOUT_STATUSES,
  type AccessPatch,
  type AccessRecord,
  type AccessStatus,
  type BillingStore,
  type CheckoutInsert,
  type CheckoutPatch,
  type CheckoutRecord,
  type CheckoutStatus,
  type PaymentPatch,
  type PaymentRecord,
  type PlanPrice,
  type SubscriptionPaymentStatus,
  type TrialEndedReason,
  type TrialPatch,
  type TrialRecord,
} from './subscription-types'

/** Rows as pg returns them (timestamps may be Date objects). */
type Row = QueryResultRow & Record<string, unknown>

function iso(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return value.toISOString()
  return typeof value === 'string' ? value : null
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function num(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(parsed)) throw new Error('billing_amount_invalid')
  return parsed
}

function subjectOf(row: Row): BillingSubject {
  if (typeof row.profile_id === 'string') return { kind: 'profile', profileId: row.profile_id }
  if (typeof row.company_id === 'string') return { kind: 'company', companyId: row.company_id }
  throw new Error('billing_subject_missing')
}

function subjectColumns(subject: BillingSubject) {
  return subject.kind === 'profile'
    ? { column: 'profile_id' as const, id: subject.profileId }
    : { column: 'company_id' as const, id: subject.companyId }
}

export function mapPlanPrice(row: Row): PlanPrice {
  const plan = row.plan_code
  const interval = row.billing_interval
  if (!isPaidPlanCode(plan) || !isBillingInterval(interval)) throw new Error('plan_price_invalid')
  const environment = str(row.provider_environment)
  return {
    id: String(row.id),
    planCode: plan,
    interval,
    amountMinor: num(row.amount_minor),
    currency: 'INR',
    active: Boolean(row.active),
    providerPlanId: str(row.provider_plan_id),
    providerEnvironment: environment === 'sandbox' || environment === 'production' ? environment : null,
    createdBy: str(row.created_by),
    createdAt: iso(row.created_at) ?? '',
  }
}

export function mapCheckout(row: Row): CheckoutRecord {
  const plan = row.plan_code
  const interval = row.billing_interval
  const status = row.status
  if (!isPaidPlanCode(plan) || !isBillingInterval(interval) || !CHECKOUT_STATUSES.includes(status as CheckoutStatus)) {
    throw new Error('subscription_checkout_invalid')
  }
  return {
    id: String(row.id),
    subject: subjectOf(row),
    createdBy: str(row.created_by),
    planCode: plan,
    planPriceId: String(row.plan_price_id),
    interval,
    amountMinor: num(row.amount_minor),
    currency: 'INR',
    environment: row.provider_environment === 'production' ? 'production' : 'sandbox',
    providerSubscriptionId: String(row.provider_subscription_id),
    cfSubscriptionId: str(row.cf_subscription_id),
    sessionId: str(row.subscription_session_id),
    status: status as CheckoutStatus,
    providerStatus: str(row.provider_status),
    paymentMethod: str(row.payment_method),
    startsAt: iso(row.starts_at),
    nextChargeAt: iso(row.next_charge_at),
    paidThroughAt: iso(row.paid_through_at),
    replacesCheckoutId: str(row.replaces_checkout_id),
    failureReason: str(row.failure_reason),
    lastCheckedAt: iso(row.last_checked_at),
    lastStatusEventAt: iso(row.last_status_event_at),
    activatedAt: iso(row.activated_at),
    cancelledAt: iso(row.cancelled_at),
    createdAt: iso(row.created_at) ?? '',
    updatedAt: iso(row.updated_at) ?? '',
  }
}

export function mapAccess(row: Row): AccessRecord {
  const plan = row.plan_code
  if (!isPaidPlanCode(plan)) throw new Error('account_subscription_invalid')
  return {
    id: String(row.id),
    subject: subjectOf(row),
    planCode: plan,
    status: String(row.status) as AccessStatus,
    billingProvider: str(row.billing_provider),
    providerSubscriptionId: str(row.provider_subscription_id),
    periodStartedAt: iso(row.current_period_started_at),
    periodEndsAt: iso(row.current_period_ends_at),
    cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
    createdAt: iso(row.created_at) ?? '',
    updatedAt: iso(row.updated_at) ?? '',
  }
}

export function mapTrial(row: Row): TrialRecord {
  const plan = row.plan_code
  if (!isPaidPlanCode(plan)) throw new Error('plan_trial_invalid')
  const reason = str(row.ended_reason)
  return {
    id: String(row.id),
    subject: subjectOf(row),
    planCode: plan,
    startedBy: str(row.started_by),
    startedAt: iso(row.started_at) ?? '',
    endsAt: iso(row.ends_at) ?? '',
    endedAt: iso(row.ended_at),
    endedReason: reason === 'expired' || reason === 'converted' || reason === 'admin_ended' ? (reason as TrialEndedReason) : null,
    extendedBy: str(row.extended_by),
    extendedAt: iso(row.extended_at),
    reminder7dSentAt: iso(row.reminder_7d_sent_at),
    reminder1dSentAt: iso(row.reminder_1d_sent_at),
    createdAt: iso(row.created_at) ?? '',
    updatedAt: iso(row.updated_at) ?? '',
  }
}

export function mapPayment(row: Row): PaymentRecord {
  return {
    id: String(row.id),
    checkoutId: String(row.checkout_id),
    subject: subjectOf(row),
    providerPaymentId: str(row.provider_payment_id),
    cfPaymentId: str(row.cf_payment_id),
    paymentType: row.payment_type === 'AUTH' ? 'AUTH' : 'CHARGE',
    amountMinor: num(row.amount_minor),
    currency: 'INR',
    status: String(row.status) as SubscriptionPaymentStatus,
    rawStatus: str(row.raw_status),
    failureReason: str(row.failure_reason),
    periodStart: iso(row.period_start),
    periodEnd: iso(row.period_end),
    scheduledFor: iso(row.scheduled_for),
    paidAt: iso(row.paid_at),
    createdAt: iso(row.created_at) ?? '',
    updatedAt: iso(row.updated_at) ?? '',
  }
}

const CHECKOUT_COLUMNS: Record<keyof CheckoutPatch, [column: string, cast: string]> = {
  cfSubscriptionId: ['cf_subscription_id', 'text'],
  sessionId: ['subscription_session_id', 'text'],
  status: ['status', 'text'],
  providerStatus: ['provider_status', 'text'],
  paymentMethod: ['payment_method', 'text'],
  nextChargeAt: ['next_charge_at', 'timestamptz'],
  paidThroughAt: ['paid_through_at', 'timestamptz'],
  failureReason: ['failure_reason', 'text'],
  lastCheckedAt: ['last_checked_at', 'timestamptz'],
  lastStatusEventAt: ['last_status_event_at', 'timestamptz'],
  activatedAt: ['activated_at', 'timestamptz'],
  cancelledAt: ['cancelled_at', 'timestamptz'],
}

const TRIAL_COLUMNS: Record<keyof TrialPatch, [column: string, cast: string]> = {
  endsAt: ['ends_at', 'timestamptz'],
  endedAt: ['ended_at', 'timestamptz'],
  endedReason: ['ended_reason', 'text'],
  extendedBy: ['extended_by', 'uuid'],
  extendedAt: ['extended_at', 'timestamptz'],
  reminder7dSentAt: ['reminder_7d_sent_at', 'timestamptz'],
  reminder1dSentAt: ['reminder_1d_sent_at', 'timestamptz'],
}

const ACCESS_COLUMNS: Record<keyof AccessPatch, [column: string, cast: string]> = {
  status: ['status', 'text'],
  billingProvider: ['billing_provider', 'text'],
  providerSubscriptionId: ['provider_subscription_id', 'text'],
  periodStartedAt: ['current_period_started_at', 'timestamptz'],
  periodEndsAt: ['current_period_ends_at', 'timestamptz'],
  cancelAtPeriodEnd: ['cancel_at_period_end', 'boolean'],
}

const PAYMENT_COLUMNS: Record<keyof PaymentPatch, [column: string, cast: string]> = {
  providerPaymentId: ['provider_payment_id', 'text'],
  cfPaymentId: ['cf_payment_id', 'text'],
  status: ['status', 'text'],
  rawStatus: ['raw_status', 'text'],
  failureReason: ['failure_reason', 'text'],
  periodStart: ['period_start', 'timestamptz'],
  periodEnd: ['period_end', 'timestamptz'],
  paidAt: ['paid_at', 'timestamptz'],
  amountMinor: ['amount_minor', 'bigint'],
}

/** "col = $2::type, …" for the patch keys that are set, with their values. */
function setClause<T extends object>(patch: T, columns: Record<keyof T, [string, string]>, firstIndex: number) {
  const parts: string[] = []
  const values: unknown[] = []
  for (const key of Object.keys(patch) as (keyof T)[]) {
    const value = patch[key]
    if (value === undefined || !columns[key]) continue
    const [column, cast] = columns[key]
    values.push(value)
    parts.push(`${column} = $${firstIndex + values.length - 1}::${cast}`)
  }
  return { sql: parts.join(', '), values }
}

/** Inserts a new checkout (mandate) row in `tx`, with its audit row. */
export async function insertCheckout(tx: DatabaseQueryClient, input: CheckoutInsert): Promise<CheckoutRecord> {
  const { column, id } = subjectColumns(input.subject)
  const result = await tx.query<Row>(
    `insert into public.subscription_checkouts (
       id, ${column}, created_by, plan_code, plan_price_id, billing_interval, amount_minor, currency,
       provider, provider_environment, provider_subscription_id, status, starts_at, replaces_checkout_id
     )
     values ($1::uuid, $2::uuid, $3::uuid, $4::text, $5::uuid, $6::text, $7::bigint, 'INR',
       'cashfree', $8::text, $9::text, 'created', $10::timestamptz, $11::uuid)
     returning *`,
    [
      input.id, id, input.createdBy, input.price.planCode, input.price.id, input.price.interval, input.price.amountMinor,
      input.environment, input.providerSubscriptionId, input.startsAt?.toISOString() ?? null, input.replacesCheckoutId,
    ],
  )
  const checkout = mapCheckout(result.rows[0]!)
  await recordPaymentAudit(tx, {
    actorType: 'member',
    actorProfileId: input.createdBy,
    subjectType: 'subscription_checkout',
    subjectId: checkout.id,
    action: 'checkout_created',
    toStatus: 'created',
    amountMinor: checkout.amountMinor,
    currency: 'INR',
    provider: 'cashfree',
    providerReference: checkout.providerSubscriptionId,
    details: {
      ...(input.subject.kind === 'profile' ? { profileId: input.subject.profileId } : { companyId: input.subject.companyId }),
      plan: checkout.planCode,
      interval: checkout.interval,
      startsAt: checkout.startsAt,
      replacesCheckoutId: input.replacesCheckoutId,
    },
  })
  return checkout
}


const CURRENT_STATUSES_SQL = `('trialing', 'active', 'past_due')`

/** The BillingStore bound to one transaction client. */
export function createSqlBillingStore(tx: DatabaseQueryClient): BillingStore {
  async function one(text: string, values: readonly unknown[]) {
    const result = await tx.query<Row>(text, values)
    return result.rows[0] ?? null
  }

  return {
    async lockSubject(subject) {
      await tx.query(`select pg_advisory_xact_lock(hashtextextended($1::text, 0))`, [`billing:${subjectKey(subject)}`])
    },

    insertCheckout(input) {
      return insertCheckout(tx, input)
    },

    async getCheckout(id) {
      const row = await one(`select * from public.subscription_checkouts where id = $1::uuid for update`, [id])
      return row ? mapCheckout(row) : null
    },

    async getCheckoutByProviderSubscriptionId(providerSubscriptionId) {
      const row = await one(
        `select * from public.subscription_checkouts where provider = 'cashfree' and provider_subscription_id = $1::text for update`,
        [providerSubscriptionId],
      )
      return row ? mapCheckout(row) : null
    },

    async updateCheckout(id, patch) {
      const set = setClause(patch, CHECKOUT_COLUMNS, 2)
      const row = await one(
        `update public.subscription_checkouts
         set ${set.sql ? `${set.sql}, ` : ''}updated_at = now()
         where id = $1::uuid
         returning *`,
        [id, ...set.values],
      )
      if (!row) throw new Error('subscription_checkout_missing')
      return mapCheckout(row)
    },

    async getCurrentAccess(subject, now) {
      const { column, id } = subjectColumns(subject)
      const row = await one(
        `select * from public.account_subscriptions
         where ${column} = $1::uuid
           and status in ${CURRENT_STATUSES_SQL}
           and (current_period_ends_at is null or current_period_ends_at > $2::timestamptz)
         order by case status when 'active' then 0 when 'trialing' then 1 else 2 end, updated_at desc, id desc
         limit 1
         for update`,
        [id, now.toISOString()],
      )
      return row ? mapAccess(row) : null
    },

    async getAccessByProviderSubscriptionId(providerSubscriptionId) {
      const row = await one(
        `select * from public.account_subscriptions
         where billing_provider = 'cashfree' and provider_subscription_id = $1::text
         order by updated_at desc, id desc
         limit 1
         for update`,
        [providerSubscriptionId],
      )
      return row ? mapAccess(row) : null
    },

    async insertAccess(input) {
      const { column, id } = subjectColumns(input.subject)
      const row = await one(
        `insert into public.account_subscriptions (
           ${column}, plan_code, status, billing_provider, provider_subscription_id,
           current_period_started_at, current_period_ends_at, cancel_at_period_end
         )
         values ($1::uuid, $2::text, $3::text, $4::text, $5::text, $6::timestamptz, $7::timestamptz, $8::boolean)
         returning *`,
        [id, input.planCode, input.status, input.billingProvider, input.providerSubscriptionId, input.periodStartedAt, input.periodEndsAt, input.cancelAtPeriodEnd],
      )
      return mapAccess(row!)
    },

    async updateAccess(id, patch) {
      const set = setClause(patch, ACCESS_COLUMNS, 2)
      const row = await one(
        `update public.account_subscriptions
         set ${set.sql ? `${set.sql}, ` : ''}updated_at = now()
         where id = $1::uuid
         returning *`,
        [id, ...set.values],
      )
      if (!row) throw new Error('account_subscription_missing')
      return mapAccess(row)
    },

    async expireLapsedAccess(subject, now) {
      const filter = subject ? subjectColumns(subject) : null
      const result = await tx.query<Row>(
        `update public.account_subscriptions
         set status = 'expired', updated_at = now()
         where status in ${CURRENT_STATUSES_SQL}
           and current_period_ends_at is not null
           and current_period_ends_at <= $1::timestamptz
           ${filter ? `and ${filter.column} = $2::uuid` : ''}
         returning *`,
        filter ? [now.toISOString(), filter.id] : [now.toISOString()],
      )
      return result.rows.map(mapAccess)
    },

    async findPayment(ref) {
      if (!ref.cfPaymentId && !ref.providerPaymentId) return null
      const row = await one(
        `select * from public.subscription_payments
         where provider = 'cashfree'
           and (($1::text is not null and cf_payment_id = $1::text) or ($2::text is not null and provider_payment_id = $2::text))
         order by created_at asc
         limit 1
         for update`,
        [ref.cfPaymentId, ref.providerPaymentId],
      )
      return row ? mapPayment(row) : null
    },

    async insertPayment(input) {
      const { column, id } = subjectColumns(input.subject)
      const row = await one(
        `insert into public.subscription_payments (
           checkout_id, ${column}, provider, provider_payment_id, cf_payment_id, payment_type, amount_minor, currency,
           status, raw_status, failure_reason, period_start, period_end, scheduled_for, paid_at
         )
         values ($1::uuid, $2::uuid, 'cashfree', $3::text, $4::text, $5::text, $6::bigint, 'INR',
           $7::text, $8::text, $9::text, $10::timestamptz, $11::timestamptz, $12::timestamptz, $13::timestamptz)
         returning *`,
        [
          input.checkoutId, id, input.providerPaymentId, input.cfPaymentId, input.paymentType, input.amountMinor,
          input.status, input.rawStatus, input.failureReason, input.periodStart, input.periodEnd, input.scheduledFor, input.paidAt,
        ],
      )
      return mapPayment(row!)
    },

    async updatePayment(id, patch) {
      const set = setClause(patch, PAYMENT_COLUMNS, 2)
      const row = await one(
        `update public.subscription_payments
         set ${set.sql ? `${set.sql}, ` : ''}updated_at = now()
         where id = $1::uuid
         returning *`,
        [id, ...set.values],
      )
      if (!row) throw new Error('subscription_payment_missing')
      return mapPayment(row)
    },

    async hasSuccessfulChargeAfter(checkoutId, after) {
      const row = await one(
        `select 1 as found from public.subscription_payments
         where checkout_id = $1::uuid and payment_type = 'CHARGE' and status = 'success'
           and coalesce(paid_at, created_at) > $2::timestamptz
         limit 1`,
        [checkoutId, after.toISOString()],
      )
      return Boolean(row)
    },

    async audit(entry) {
      await recordPaymentAudit(tx, entry)
    },

    async getTrial(subject) {
      const { column, id } = subjectColumns(subject)
      const row = await one(`select * from public.plan_trials where ${column} = $1::uuid limit 1 for update`, [id])
      return row ? mapTrial(row) : null
    },

    async getTrialById(id) {
      const row = await one(`select * from public.plan_trials where id = $1::uuid limit 1 for update`, [id])
      return row ? mapTrial(row) : null
    },

    async insertTrial(input) {
      const { column, id } = subjectColumns(input.subject)
      const row = await one(
        `insert into public.plan_trials (${column}, plan_code, started_by, started_at, ends_at)
         values ($1::uuid, $2::text, $3::uuid, $4::timestamptz, $5::timestamptz)
         returning *`,
        [id, input.planCode, input.startedBy, input.startedAt, input.endsAt],
      )
      return mapTrial(row!)
    },

    async updateTrial(id, patch) {
      const set = setClause(patch, TRIAL_COLUMNS, 2)
      const row = await one(
        `update public.plan_trials
         set ${set.sql ? `${set.sql}, ` : ''}updated_at = now()
         where id = $1::uuid
         returning *`,
        [id, ...set.values],
      )
      if (!row) throw new Error('plan_trial_missing')
      return mapTrial(row)
    },
  }
}
