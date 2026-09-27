import type { QueryResultRow } from 'pg'
import { query as databaseQuery, type DatabaseQueryClient } from '@/lib/db/client'
import { recordPaymentAudit } from '@/features/payments/audit'
import type { CashfreeMode } from '@/features/payments/types'
import type { BillingInterval, BillingSubject, PaidPlanCode } from './plans'
import { mapAccess, mapCheckout, mapPayment, mapPlanPrice } from './subscription-store'
import type { AccessRecord, CheckoutRecord, PaymentRecord, PlanPrice } from './subscription-types'

type Row = QueryResultRow & Record<string, unknown>
type Query = (text: string, values?: readonly unknown[]) => Promise<Row[]>

function subjectColumns(subject: BillingSubject) {
  return subject.kind === 'profile'
    ? { column: 'profile_id' as const, id: subject.profileId }
    : { column: 'company_id' as const, id: subject.companyId }
}

export class PlanPriceError extends Error {
  constructor(readonly code: 'price_invalid' | 'price_unchanged') {
    super(code)
    this.name = 'PlanPriceError'
  }
}

export type SubjectBilling = {
  /** The row that grants the plan now, else the most recent one (for "ended on …"). */
  access: AccessRecord | null
  accessIsCurrent: boolean
  /** The mandate behind `access`, when it is a Cashfree subscription. */
  checkout: CheckoutRecord | null
  /** A newer mandate still waiting for approval, if any (shown as "waiting for your bank"). */
  pendingCheckout: CheckoutRecord | null
  payments: PaymentRecord[]
}

export type AdminSubscriptionRow = {
  access: AccessRecord
  /** Grants the plan right now. */
  current: boolean
  subjectName: string
  subjectHref: string
  checkout: CheckoutRecord | null
}

export type AdminPaymentRow = PaymentRecord & { subjectName: string; planCode: PaidPlanCode; interval: BillingInterval }

export function createSubscriptionRepository(input: { query?: Query } = {}) {
  const queryRows: Query = input.query ?? ((text, values) => databaseQuery<Row>(text, values))

  async function listActivePrices(): Promise<PlanPrice[]> {
    const rows = await queryRows(
      `select * from public.plan_prices where active order by plan_code asc, billing_interval asc`,
    )
    return rows.map(mapPlanPrice)
  }

  async function listPriceHistory(limit = 40): Promise<PlanPrice[]> {
    const rows = await queryRows(
      `select * from public.plan_prices order by plan_code asc, billing_interval asc, created_at desc limit $1::int`,
      [limit],
    )
    return rows.map(mapPlanPrice)
  }

  async function getActivePrice(plan: PaidPlanCode, interval: BillingInterval): Promise<PlanPrice | null> {
    const rows = await queryRows(
      `select * from public.plan_prices where plan_code = $1::text and billing_interval = $2::text and active limit 1`,
      [plan, interval],
    )
    return rows[0] ? mapPlanPrice(rows[0]) : null
  }

  async function markPlanCreated(priceId: string, planId: string, environment: CashfreeMode) {
    await queryRows(
      `update public.plan_prices
       set provider_plan_id = $2::text, provider_environment = $3::text, updated_at = now()
       where id = $1::uuid`,
      [priceId, planId, environment],
    )
  }

  async function getSubjectBilling(subject: BillingSubject, now: Date = new Date()): Promise<SubjectBilling> {
    const { column, id } = subjectColumns(subject)
    const [accessRows, pendingRows, paymentRows] = await Promise.all([
      queryRows(
        `select * from public.account_subscriptions
         where ${column} = $1::uuid
         order by
           case when status in ('trialing', 'active', 'past_due')
                 and (current_period_ends_at is null or current_period_ends_at > $2::timestamptz) then 0 else 1 end,
           case status when 'active' then 0 when 'trialing' then 1 when 'past_due' then 2 else 3 end,
           updated_at desc, id desc
         limit 1`,
        [id, now.toISOString()],
      ),
      queryRows(
        `select * from public.subscription_checkouts
         where ${column} = $1::uuid
           and status in ('created', 'pending_approval', 'failed')
           and created_at > $2::timestamptz - interval '7 days'
         order by created_at desc
         limit 1`,
        [id, now.toISOString()],
      ),
      queryRows(
        `select * from public.subscription_payments
         where ${column} = $1::uuid
           and (payment_type = 'CHARGE' or amount_minor > 0)
         order by coalesce(paid_at, created_at) desc, id desc
         limit 24`,
        [id],
      ),
    ])
    const access = accessRows[0] ? mapAccess(accessRows[0]) : null
    const end = access?.periodEndsAt ? Date.parse(access.periodEndsAt) : null
    const accessIsCurrent = Boolean(access
      && ['trialing', 'active', 'past_due'].includes(access.status)
      && (end === null || end > now.getTime()))
    let checkout: CheckoutRecord | null = null
    if (access?.billingProvider === 'cashfree' && access.providerSubscriptionId) {
      const rows = await queryRows(
        `select * from public.subscription_checkouts where provider = 'cashfree' and provider_subscription_id = $1::text limit 1`,
        [access.providerSubscriptionId],
      )
      checkout = rows[0] ? mapCheckout(rows[0]) : null
    }
    let pendingCheckout = pendingRows[0] ? mapCheckout(pendingRows[0]) : null
    // A failed attempt only matters until something newer succeeds.
    if (pendingCheckout && checkout && Date.parse(checkout.createdAt) > Date.parse(pendingCheckout.createdAt)) pendingCheckout = null
    return { access, accessIsCurrent, checkout, pendingCheckout, payments: paymentRows.map(mapPayment) }
  }

  async function getAccessById(id: string): Promise<AccessRecord | null> {
    const rows = await queryRows(`select * from public.account_subscriptions where id = $1::uuid limit 1`, [id])
    return rows[0] ? mapAccess(rows[0]) : null
  }

  async function getCheckout(id: string): Promise<CheckoutRecord | null> {
    const rows = await queryRows(`select * from public.subscription_checkouts where id = $1::uuid limit 1`, [id])
    return rows[0] ? mapCheckout(rows[0]) : null
  }

  async function getCheckoutByProviderSubscriptionId(providerSubscriptionId: string): Promise<CheckoutRecord | null> {
    const rows = await queryRows(
      `select * from public.subscription_checkouts where provider = 'cashfree' and provider_subscription_id = $1::text limit 1`,
      [providerSubscriptionId],
    )
    return rows[0] ? mapCheckout(rows[0]) : null
  }

  /** A checkout started moments ago for the same price, to reopen instead of creating a second one. */
  async function findReusableCheckout(subject: BillingSubject, priceId: string, environment: CashfreeMode, since: Date): Promise<CheckoutRecord | null> {
    const { column, id } = subjectColumns(subject)
    const rows = await queryRows(
      `select * from public.subscription_checkouts
       where ${column} = $1::uuid and plan_price_id = $2::uuid and provider_environment = $3::text
         and status = 'created' and subscription_session_id is not null and created_at > $4::timestamptz
       order by created_at desc
       limit 1`,
      [id, priceId, environment, since.toISOString()],
    )
    return rows[0] ? mapCheckout(rows[0]) : null
  }

  /** Mandates whose state we should re-read from Cashfree (missed webhooks, closed tabs). */
  async function listCheckoutsToReconcile(now: Date, limit = 50): Promise<CheckoutRecord[]> {
    const rows = await queryRows(
      `select * from public.subscription_checkouts
       where (
           status in ('created', 'pending_approval')
           and created_at > $1::timestamptz - interval '7 days'
           and (last_checked_at is null or last_checked_at < $1::timestamptz - interval '30 minutes')
         ) or (
           status in ('active', 'on_hold', 'paused')
           and (last_checked_at is null or last_checked_at < $1::timestamptz - interval '20 hours')
         ) or (
           status = 'replaced'
           and coalesce(provider_status, '') not in ('CANCELLED', 'CUSTOMER_CANCELLED', 'COMPLETED', 'EXPIRED', 'CARD_EXPIRED')
           and updated_at > $1::timestamptz - interval '60 days'
         )
       order by coalesce(last_checked_at, created_at) asc
       limit $2::int`,
      [now.toISOString(), limit],
    )
    return rows.map(mapCheckout)
  }

  /** Merchant charge mode: active mandates whose next renewal is due within `horizonHours`. */
  async function listChargesDue(now: Date, horizonHours: number, limit = 50) {
    const rows = await queryRows(
      `select checkout.*,
         (select count(*) from public.subscription_payments p
          where p.checkout_id = checkout.id and p.payment_type = 'CHARGE' and p.status = 'success')::int as paid_cycles
       from public.subscription_checkouts checkout
       where checkout.status in ('active', 'on_hold')
         and checkout.next_charge_at is not null
         and checkout.next_charge_at <= $1::timestamptz + ($2::int * interval '1 hour')
         and checkout.next_charge_at > $1::timestamptz - interval '3 days'
       order by checkout.next_charge_at asc
       limit $3::int`,
      [now.toISOString(), horizonHours, limit],
    )
    return rows.map((row) => ({ checkout: mapCheckout(row), paidCycles: Number(row.paid_cycles ?? 0) }))
  }

  async function listSubscriptionsForAdmin(options: { status?: string | null; limit?: number } = {}): Promise<AdminSubscriptionRow[]> {
    const status = options.status && ['active', 'past_due', 'cancelled', 'expired', 'trialing', 'pending'].includes(options.status) ? options.status : null
    const rows = await queryRows(
      `select subscription.*,
         coalesce(profile.full_name, company.name, 'Unknown') as subject_name,
         profile.slug as profile_slug,
         company.slug as company_slug,
         case when checkout.id is null then null else to_jsonb(checkout.*) end as checkout_row,
         (subscription.status in ('trialing', 'active', 'past_due')
           and (subscription.current_period_ends_at is null or subscription.current_period_ends_at > now())) as is_current
       from public.account_subscriptions subscription
       left join public.profiles profile on profile.id = subscription.profile_id
       left join public.companies company on company.id = subscription.company_id
       left join public.subscription_checkouts checkout
         on subscription.billing_provider = 'cashfree'
        and checkout.provider = 'cashfree'
        and checkout.provider_subscription_id = subscription.provider_subscription_id
       where ($1::text is null or subscription.status = $1::text)
       order by
         case subscription.status when 'past_due' then 0 when 'active' then 1 when 'trialing' then 2 else 3 end,
         subscription.updated_at desc
       limit $2::int`,
      [status, Math.min(Math.max(options.limit ?? 100, 1), 200)],
    )
    return rows.map((row) => {
      const checkoutRow = row.checkout_row && typeof row.checkout_row === 'object' ? row.checkout_row as Row : null
      const access = mapAccess(row)
      return {
        access,
        current: Boolean(row.is_current),
        subjectName: String(row.subject_name),
        subjectHref: access.subject.kind === 'profile'
          ? `/admin/users/${access.subject.profileId}`
          : `/admin/organizations`,
        checkout: checkoutRow ? mapCheckout(checkoutRow) : null,
      }
    })
  }

  async function listRecentPaymentsForAdmin(limit = 50): Promise<AdminPaymentRow[]> {
    const rows = await queryRows(
      `select payment.*, checkout.plan_code, checkout.billing_interval,
         coalesce(profile.full_name, company.name, 'Unknown') as subject_name
       from public.subscription_payments payment
       join public.subscription_checkouts checkout on checkout.id = payment.checkout_id
       left join public.profiles profile on profile.id = payment.profile_id
       left join public.companies company on company.id = payment.company_id
       where payment.payment_type = 'CHARGE' or payment.amount_minor > 0
       order by coalesce(payment.paid_at, payment.created_at) desc
       limit $1::int`,
      [Math.min(Math.max(limit, 1), 200)],
    )
    return rows.map((row) => ({
      ...mapPayment(row),
      subjectName: String(row.subject_name),
      planCode: row.plan_code === 'organization_pro' ? 'organization_pro' : 'creator_pro',
      interval: row.billing_interval === 'year' ? 'year' : 'month',
    }))
  }

  return {
    listActivePrices,
    listPriceHistory,
    getActivePrice,
    markPlanCreated,
    getSubjectBilling,
    getAccessById,
    getCheckout,
    getCheckoutByProviderSubscriptionId,
    findReusableCheckout,
    listCheckoutsToReconcile,
    listChargesDue,
    listSubscriptionsForAdmin,
    listRecentPaymentsForAdmin,
  }
}

export type SubscriptionRepository = ReturnType<typeof createSubscriptionRepository>

export const subscriptionRepository = createSubscriptionRepository()

/**
 * New price for a plan and interval (admin). Prices are immutable: the current active
 * row is deactivated and a new one inserted, so existing subscribers keep their price.
 */
export async function replacePlanPrice(tx: DatabaseQueryClient, input: {
  plan: PaidPlanCode
  interval: BillingInterval
  amountMinor: number
  adminId: string
}): Promise<PlanPrice> {
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor < 100 || input.amountMinor > 100000000) throw new PlanPriceError('price_invalid')
  await tx.query(`select pg_advisory_xact_lock(hashtextextended($1::text, 0))`, [`plan_price:${input.plan}:${input.interval}`])
  const current = await tx.query<Row>(
    `select * from public.plan_prices where plan_code = $1::text and billing_interval = $2::text and active for update`,
    [input.plan, input.interval],
  )
  const previous = current.rows[0] ? mapPlanPrice(current.rows[0]) : null
  if (previous && previous.amountMinor === input.amountMinor) throw new PlanPriceError('price_unchanged')
  if (previous) {
    await tx.query(`update public.plan_prices set active = false, updated_at = now() where id = $1::uuid`, [previous.id])
  }
  const inserted = await tx.query<Row>(
    `insert into public.plan_prices (plan_code, billing_interval, amount_minor, currency, active, provider, created_by)
     values ($1::text, $2::text, $3::bigint, 'INR', true, 'cashfree', $4::uuid)
     returning *`,
    [input.plan, input.interval, input.amountMinor, input.adminId],
  )
  const price = mapPlanPrice(inserted.rows[0]!)
  await recordPaymentAudit(tx, {
    actorType: 'admin',
    actorProfileId: input.adminId,
    subjectType: 'plan_price',
    subjectId: price.id,
    action: 'price_changed',
    amountMinor: price.amountMinor,
    currency: 'INR',
    details: { plan: input.plan, interval: input.interval, previousPriceId: previous?.id ?? null, previousAmountMinor: previous?.amountMinor ?? null },
  })
  return price
}

/**
 * Admin: stop a plan that has no Cashfree mandate (given by the team). Ends access now,
 * or at the end of its period when it has one.
 */
export async function endManualSubscription(tx: DatabaseQueryClient, input: { accessId: string; adminId: string; endNow: boolean; now: Date }) {
  const result = await tx.query<Row>(`select * from public.account_subscriptions where id = $1::uuid for update`, [input.accessId])
  const row = result.rows[0]
  if (!row) return null
  const access = mapAccess(row)
  const endNow = input.endNow || !access.periodEndsAt
  const updated = await tx.query<Row>(
    `update public.account_subscriptions
     set cancel_at_period_end = true,
         status = case when $2::boolean then 'cancelled' else status end,
         current_period_ends_at = case when $2::boolean then $3::timestamptz else current_period_ends_at end,
         updated_at = now()
     where id = $1::uuid
     returning *`,
    [access.id, endNow, input.now.toISOString()],
  )
  const next = mapAccess(updated.rows[0]!)
  await recordPaymentAudit(tx, {
    actorType: 'admin',
    actorProfileId: input.adminId,
    subjectType: 'account_subscription',
    subjectId: access.id,
    action: endNow ? 'access_ended' : 'auto_renew_cancelled',
    fromStatus: access.status,
    toStatus: next.status,
    provider: access.billingProvider,
    details: {
      ...(access.subject.kind === 'profile' ? { profileId: access.subject.profileId } : { companyId: access.subject.companyId }),
      plan: access.planCode,
      periodEndsAt: next.periodEndsAt,
      reason: 'admin_cancelled',
    },
  })
  return next
}
