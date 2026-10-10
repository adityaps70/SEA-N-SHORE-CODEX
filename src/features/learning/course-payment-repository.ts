import type { QueryResultRow } from 'pg'
import { query, withTransaction, type DatabaseQueryClient } from '@/lib/db/client'
import { recordPaymentAudit, type PaymentAuditActorType } from '@/features/payments/audit'
import { recordSaleEarning, reverseSaleEarning } from '@/features/payments/earnings'
import { orderUuidFromGatewayOrderId } from '@/features/payments/order-ids'
import type { EventPaymentOrderStatus, PaymentCurrency, PaymentProviderName } from '@/features/payments/types'
import { resolveEnrolmentBatch } from './batches/batch-repository'
import { courseManagerAccessSql } from './course-access'
import { coursePrice, type CoursePrice } from './course-pricing'
import { courseOpenToNewLearnersSql } from './course-publication'
import { listStoredPlansWithQuery } from './course-plan-repository'
import { DEFAULT_PLAN_NAME, planPrice, type AccessMonths, type CoursePlan } from './course-plans'
import { lockedPromoDiscount, lockPromoCodeForCourse, promoUsageRefusal, redeemPromoUse, releasePromoUse, reservePromoUse, type LockedPromoCode } from './promo-code-repository'
import { normalisePromoCode, type PromoCodeRefusal } from './promo-codes'
import { GATEWAY_ORDER_LIFETIME_MINUTES } from '@/features/payments/event-payment-rules'
import { notifyEnrolled } from './learning-notifications'
import { resolveOrderBilling, sameBilling, type BillingInput, type BillingRefusal, type OrderBilling } from '@/features/tax/billing'
import { issueCreditNoteForOrder, issueInvoiceForOrder, withTaxSavepoint } from '@/features/tax/tax-document-repository'
import { COURSE_CHECKOUT_REUSE_MINUTES, COURSE_PENDING_CHECK_MINUTES, type CoursePurchaseBlocker, type CourseRefundDueReason } from './course-payment-rules'

/**
 * Paid course purchases (public.course_payment_orders, migration 0047). Mirrors the
 * event ticket repository: the amount always comes from the course row, every money
 * state change happens in one transaction with its audit row, and every write is
 * idempotent so webhooks, return pages and double clicks can repeat safely.
 */

export type CourseOrderStatus = EventPaymentOrderStatus
export type CourseRefundStatus = 'requested' | 'pending' | 'processed' | 'failed'

export type CoursePaymentOrder = {
  id: string
  courseId: string | null
  profileId: string | null
  courseTitle: string
  listPriceMinor: number
  discountPriceMinor: number | null
  amountMinor: number
  currency: PaymentCurrency
  provider: PaymentProviderName
  providerOrderId: string | null
  providerPaymentId: string | null
  providerSessionId: string | null
  status: CourseOrderStatus
  enrollmentId: string | null
  enrollmentConfirmedAt: string | null
  refundDueReason: string | null
  failureReason: string | null
  paidAt: string | null
  refundedAt: string | null
  refundStatus: CourseRefundStatus | null
  refundAttempts: number
  providerRefundId: string | null
  createdAt: string
  /** Round C: the plan bought (null for orders before plans), its access period, and any promo code used. */
  planId: string | null
  planName: string | null
  accessMonths: AccessMonths
  promoCode: string | null
  promoDiscountMinor: number
  /** C4: the billing details asked at checkout (null for orders from before GST invoices). */
  billing: OrderBilling
  /** C4: the GST documents issued for this order. */
  invoiceId: string | null
  invoiceNumber: string | null
  creditNoteId: string | null
  creditNoteNumber: string | null
}

/** A purchase as the learner sees it (My Learning → Purchases). */
export type LearnerCoursePurchase = CoursePaymentOrder & { courseSlug: string | null }

/** A purchase as the course team or the Sea N Shore team sees it. */
export type CourseSaleRow = CoursePaymentOrder & {
  courseSlug: string | null
  buyerName: string | null
  buyerSlug: string | null
}

export type CourseConfirmOutcome =
  | { state: 'enrolled'; order: CoursePaymentOrder }
  | { state: 'refund_due'; order: CoursePaymentOrder; reason: string }
  | { state: 'refunded'; order: CoursePaymentOrder }

export type CoursePaymentActor = { type: PaymentAuditActorType; profileId?: string | null }

export class CoursePurchaseError extends Error {
  constructor(readonly code: CoursePurchaseBlocker | PromoCodeRefusal | BillingRefusal | 'plan_not_found' | 'checkout_in_progress' | 'order_not_found' | 'refund_not_allowed' | 'refund_in_progress') {
    super(code)
    this.name = 'CoursePurchaseError'
  }
}

type OrderRow = QueryResultRow & {
  id: string
  course_id: string | null
  profile_id: string | null
  course_title: string
  list_price_minor: string | number
  discount_price_minor: string | number | null
  amount_minor: string | number
  currency: PaymentCurrency
  provider: PaymentProviderName
  provider_order_id: string | null
  provider_payment_id: string | null
  provider_session_id: string | null
  status: CourseOrderStatus
  enrollment_id: string | null
  enrollment_confirmed_at: string | Date | null
  refund_due_reason: string | null
  failure_reason: string | null
  paid_at: string | Date | null
  refunded_at: string | Date | null
  refund_status: CourseRefundStatus | null
  refund_attempts: number | string | null
  provider_refund_id: string | null
  created_at: string | Date
  plan_id?: string | null
  plan_name?: string | null
  access_months?: number | null
  promo_code?: string | null
  promo_discount_minor?: string | number | null
  billing_state_code?: string | null
  billing_country?: string | null
  billing_company?: string | null
  billing_gstin?: string | null
  invoice_id?: string | null
  invoice_number?: string | null
  credit_note_id?: string | null
  credit_note_number?: string | null
}

type CourseRow = QueryResultRow & {
  id: string
  title: string
  access_type: 'free' | 'paid'
  price_minor: string | number
  discount_price_minor: string | number | null
  currency: string
  company_id: string | null
  mentor_id: string | null
  seller_profile_id: string | null
  visible: boolean
  is_manager: boolean
}

type EnrollmentRow = QueryResultRow & { id: string; status: string; enrollment_source: string; access_expires_at?: string | Date | null }

export type LockedCourse = {
  id: string
  title: string
  visible: boolean
  isManager: boolean
  accessType: 'free' | 'paid'
  price: CoursePrice | null
  /** The raw currency on the course, for a clear "currency not supported" message. */
  currency: string
  companyId: string | null
  mentorId: string | null
  sellerProfileId: string | null
  /** Round D: a batch course sells seats in dated batches. */
  batchMode: 'self_paced' | 'batches'
}

const ORDER_COLUMNS = `
  o.id, o.course_id, o.profile_id, o.course_title, o.list_price_minor, o.discount_price_minor, o.amount_minor,
  o.currency, o.provider, o.provider_order_id, o.provider_payment_id, o.provider_session_id, o.status,
  o.enrollment_id, o.enrollment_confirmed_at, o.refund_due_reason, o.failure_reason, o.paid_at, o.refunded_at,
  o.refund_status, o.refund_attempts, o.provider_refund_id, o.created_at,
  o.plan_id, o.plan_name, o.access_months, o.promo_code, o.promo_discount_minor,
  o.billing_state_code, o.billing_country, o.billing_company, o.billing_gstin
`

/** C4: the GST invoice and credit note issued for the order, read with every order. */
const ORDER_DOCUMENT_COLUMNS = `
  (select invoice.id from public.tax_invoices invoice where invoice.order_id = o.id) as invoice_id,
  (select invoice.invoice_number from public.tax_invoices invoice where invoice.order_id = o.id) as invoice_number,
  (select note.id from public.tax_credit_notes note join public.tax_invoices invoice on invoice.id = note.invoice_id where invoice.order_id = o.id) as credit_note_id,
  (select note.credit_note_number from public.tax_credit_notes note join public.tax_invoices invoice on invoice.id = note.invoice_id where invoice.order_id = o.id) as credit_note_number
`

const SUBJECT = 'course_payment_order'
const SYSTEM: CoursePaymentActor = { type: 'system' }
/** A refund request older than this is treated as abandoned and may be retried. */
const REFUND_REQUEST_STALE_MINUTES = 5

function iso(value: string | Date) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function nullableIso(value: string | Date | null) {
  return value === null ? null : iso(value)
}

export function mapCourseOrder(row: OrderRow): CoursePaymentOrder {
  return {
    id: row.id,
    courseId: row.course_id,
    profileId: row.profile_id,
    courseTitle: row.course_title,
    listPriceMinor: Number(row.list_price_minor),
    discountPriceMinor: row.discount_price_minor === null ? null : Number(row.discount_price_minor),
    amountMinor: Number(row.amount_minor),
    currency: row.currency,
    provider: row.provider,
    providerOrderId: row.provider_order_id,
    providerPaymentId: row.provider_payment_id,
    providerSessionId: row.provider_session_id ?? null,
    status: row.status,
    enrollmentId: row.enrollment_id ?? null,
    enrollmentConfirmedAt: nullableIso(row.enrollment_confirmed_at ?? null),
    refundDueReason: row.refund_due_reason ?? null,
    failureReason: row.failure_reason ?? null,
    paidAt: nullableIso(row.paid_at ?? null),
    refundedAt: nullableIso(row.refunded_at ?? null),
    refundStatus: row.refund_status ?? null,
    refundAttempts: Number(row.refund_attempts ?? 0),
    providerRefundId: row.provider_refund_id ?? null,
    createdAt: iso(row.created_at),
    planId: row.plan_id ?? null,
    planName: row.plan_name ?? null,
    accessMonths: row.access_months === 6 || row.access_months === 12 ? row.access_months : null,
    promoCode: row.promo_code ?? null,
    promoDiscountMinor: Number(row.promo_discount_minor ?? 0),
    billing: {
      stateCode: row.billing_state_code ?? null,
      country: row.billing_country ?? null,
      company: row.billing_company ?? null,
      gstin: row.billing_gstin ?? null,
    },
    invoiceId: row.invoice_id ?? null,
    invoiceNumber: row.invoice_number ?? null,
    creditNoteId: row.credit_note_id ?? null,
    creditNoteNumber: row.credit_note_number ?? null,
  }
}

function isUniqueViolation(error: unknown) {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === '23505')
}

async function audit(client: DatabaseQueryClient, order: CoursePaymentOrder, action: string, input: {
  actor?: CoursePaymentActor
  fromStatus?: string | null
  toStatus?: string | null
  providerReference?: string | null
  details?: Record<string, unknown>
} = {}) {
  const actor = input.actor ?? SYSTEM
  await recordPaymentAudit(client, {
    actorType: actor.type,
    actorProfileId: actor.profileId ?? null,
    subjectType: SUBJECT,
    subjectId: order.id,
    action,
    fromStatus: input.fromStatus ?? null,
    toStatus: input.toStatus ?? null,
    amountMinor: order.amountMinor,
    currency: order.currency,
    provider: order.provider,
    providerReference: input.providerReference ?? null,
    details: { courseId: order.courseId, ...input.details },
  })
}

/** Locks the course row and reads what a purchase needs; `profileId` decides isManager. */
export async function lockCourseForPurchase(client: DatabaseQueryClient, courseId: string, profileId: string): Promise<LockedCourse | null> {
  const result = await client.query<CourseRow>(`
    select course.id, course.title, course.access_type, course.price_minor, course.discount_price_minor, course.currency,
      course.company_id, course.mentor_id, coalesce(mentor.user_id, course.created_by_user_id) as seller_profile_id,
      course.batch_mode,
      (${courseOpenToNewLearnersSql()}) as visible,
      ${courseManagerAccessSql('course', '$2::uuid')} as is_manager
    from public.learning_courses course
    left join public.learning_mentors mentor on mentor.id = course.mentor_id
    left join public.learning_mentor_applications application
      on application.id = mentor.application_id and application.user_id = mentor.user_id
    left join public.companies company on company.id = course.company_id
    where course.id = $1::uuid
    for update of course
  `, [courseId, profileId])
  const row = result.rows[0]
  if (!row) return null
  const priceMinor = Number(row.price_minor)
  return {
    id: row.id,
    title: row.title,
    visible: Boolean(row.visible),
    isManager: Boolean(row.is_manager),
    accessType: row.access_type,
    price: coursePrice({
      accessType: row.access_type,
      priceMinor,
      discountPriceMinor: row.discount_price_minor === null ? null : Number(row.discount_price_minor),
      currency: row.currency,
    }),
    currency: row.currency,
    companyId: row.company_id ?? null,
    mentorId: row.mentor_id ?? null,
    sellerProfileId: row.seller_profile_id ?? null,
    batchMode: row.batch_mode === 'batches' ? 'batches' : 'self_paced',
  }
}

async function lockEnrollment(client: DatabaseQueryClient, courseId: string, profileId: string) {
  const result = await client.query<EnrollmentRow>(`
    select id, status, enrollment_source, access_expires_at
    from public.learning_enrollments
    where course_id = $1::uuid and learner_id = $2::uuid
    for update
  `, [courseId, profileId])
  return result.rows[0] ?? null
}

/** Enrollment rules shared by checkout and confirmation. Null = the learner may have it. */
function enrollmentBlocker(enrollment: EnrollmentRow | null): 'already_enrolled' | 'enrollment_revoked' | null {
  if (!enrollment) return null
  // Course team access is not a purchase: someone who left the team can buy the course.
  if (enrollment.enrollment_source === 'admin') return null
  if (enrollment.status === 'active' || enrollment.status === 'completed') {
    // Round C (C3): time-limited access can be renewed (or extended early); lifetime access cannot be bought twice.
    return enrollment.access_expires_at ? null : 'already_enrolled'
  }
  // A purchase that was refunded can be bought again; access removed for another reason cannot.
  return enrollment.enrollment_source === 'purchase' ? null : 'enrollment_revoked'
}

/** Can this learner start paying for this course? `currencies` = what the gateway can charge. */
export function checkoutBlocker(course: LockedCourse | null, enrollment: EnrollmentRow | null, currencies?: readonly PaymentCurrency[]): CoursePurchaseBlocker | null {
  if (!course || !course.visible) return 'course_not_found'
  if (course.accessType !== 'paid') return 'course_not_paid'
  if (course.isManager) return 'course_team_has_access'
  const blocked = enrollmentBlocker(enrollment)
  if (blocked) return blocked
  if (!course.price) return course.currency && !['INR', 'USD'].includes(course.currency) ? 'course_currency_unsupported' : 'course_price_missing'
  if (currencies && !currencies.includes(course.price.currency)) return 'course_currency_unsupported'
  return null
}

async function lockOrder(client: DatabaseQueryClient, orderId: string) {
  const locked = await client.query<OrderRow>(`
    select ${ORDER_COLUMNS}, ${ORDER_DOCUMENT_COLUMNS} from public.course_payment_orders o where o.id = $1::uuid for update
  `, [orderId])
  return locked.rows[0] ? mapCourseOrder(locked.rows[0]) : null
}

/** A promo code reservation outlives the gateway order it was made for by this much (late webhooks). */
const PROMO_RESERVATION_GRACE_MINUTES = 15

function clientRows(client: DatabaseQueryClient) {
  return async (text: string, values?: readonly unknown[]) => (await client.query(text, values ? [...values] : undefined)).rows
}

/**
 * The plan being bought: the one asked for, or the course's first plan. A course without plan rows yet (created
 * before round C and not saved since) sells its own price as one lifetime plan. Throws when the plan is not this
 * course's.
 */
async function resolvePlan(client: DatabaseQueryClient, course: LockedCourse, planId: string | null | undefined): Promise<CoursePlan> {
  const plans = await listStoredPlansWithQuery(clientRows(client), course.id)
  if (!plans.length) {
    if (planId) throw new CoursePurchaseError('plan_not_found')
    if (!course.price) throw new CoursePurchaseError('course_price_missing')
    return {
      id: null,
      name: DEFAULT_PLAN_NAME,
      priceMinor: course.price.listPriceMinor,
      discountPriceMinor: course.price.discountPriceMinor,
      currency: course.price.currency,
      accessMonths: null,
      position: 0,
    }
  }
  const plan = planId ? plans.find((candidate) => candidate.id === planId) : plans[0]
  if (!plan) throw new CoursePurchaseError('plan_not_found')
  return plan
}

export type CheckoutQuote = {
  plan: CoursePlan
  listPriceMinor: number
  discountPriceMinor: number | null
  /** What the buyer pays before any code (the sale price when set). */
  baseMinor: number
  promo: { codeId: string; code: string; discountMinor: number } | null
  amountMinor: number
  currency: PaymentCurrency
}

/**
 * Works out what a checkout costs on the server, with the course (and any code) locked: the plan's current price,
 * then the promo code. Never trusts a price or discount from the browser. Throws CoursePurchaseError with the
 * reason a purchase or a code is refused.
 */
async function quoteCheckout(client: DatabaseQueryClient, input: {
  profileId: string
  courseId: string
  planId?: string | null
  promoCode?: string | null
  currencies?: readonly PaymentCurrency[]
  now: Date
}): Promise<{ course: LockedCourse; quote: CheckoutQuote; code: LockedPromoCode | null }> {
  const course = await lockCourseForPurchase(client, input.courseId, input.profileId)
  const enrollment = course ? await lockEnrollment(client, course.id, input.profileId) : null
  const blocker = checkoutBlocker(course, enrollment, input.currencies)
  if (blocker) throw new CoursePurchaseError(blocker)
  const plan = await resolvePlan(client, course!, input.planId)
  const price = planPrice(plan)
  if (!price) throw new CoursePurchaseError('course_price_missing')
  if (input.currencies && !input.currencies.includes(price.currency)) throw new CoursePurchaseError('course_currency_unsupported')

  let promo: CheckoutQuote['promo'] = null
  let code: LockedPromoCode | null = null
  const typed = input.promoCode ? normalisePromoCode(input.promoCode) : ''
  if (typed) {
    code = await lockPromoCodeForCourse(client, { code: typed, course: { id: course!.id, mentorId: course!.mentorId, companyId: course!.companyId } })
    if (!code) throw new CoursePurchaseError('promo_not_found')
    const discount = lockedPromoDiscount(code, price.amountMinor, price.currency)
    if (!discount.ok) throw new CoursePurchaseError(discount.reason)
    promo = { codeId: code.id, code: code.code, discountMinor: discount.discountMinor }
  }
  return {
    course: course!,
    code,
    quote: {
      plan,
      listPriceMinor: price.listPriceMinor,
      discountPriceMinor: price.discountPriceMinor,
      baseMinor: price.amountMinor,
      promo,
      amountMinor: price.amountMinor - (promo?.discountMinor ?? 0),
      currency: price.currency,
    },
  }
}

/** The price a buyer would pay for a plan with a code, without starting a checkout (course page "Apply"). */
async function previewCheckout(input: {
  profileId: string
  courseId: string
  planId?: string | null
  promoCode?: string | null
  now?: Date
}): Promise<CheckoutQuote> {
  const now = input.now ?? new Date()
  return withTransaction(async (client) => {
    const { quote, code } = await quoteCheckout(client, { ...input, now })
    const refusal = code ? await promoUsageRefusal(client, code, { profileId: input.profileId, now }) : null
    if (refusal) throw new CoursePurchaseError(refusal)
    return quote
  })
}

/**
 * Checks every purchase rule with the course row (and any promo code) locked, then reuses the learner's open
 * checkout or records a new one with a snapshot of the plan, the price and the code's discount. A code's use is
 * reserved here, atomically, so two buyers can never both take its last use.
 */
/** Round D: the batch a checkout order is for (null for a self-paced course). */
async function orderBatchId(client: DatabaseQueryClient, orderId: string) {
  const rows = await client.query<{ batch_id: string | null } & QueryResultRow>(`select batch_id from public.course_payment_orders where id = $1::uuid`, [orderId])
  return rows.rows[0]?.batch_id ?? null
}

/**
 * Round D: the batch a new checkout on a batch course carries. A learner renewing access keeps their batch (no new
 * seat); otherwise the chosen batch is locked and must be open with a seat free.
 */
async function checkoutBatchId(client: DatabaseQueryClient, input: { courseId: string; profileId: string; batchId: string | null; excludeOrderId: string | null }) {
  const query = async (text: string, values?: readonly unknown[]) => (await client.query(text, values ? [...values] : undefined)).rows
  const current = await query(
    `select batch_id from public.learning_enrollments
     where course_id = $1::uuid and learner_id = $2::uuid and status <> 'revoked' and batch_id is not null`,
    [input.courseId, input.profileId],
  )
  if (current[0]?.batch_id) return String(current[0].batch_id)
  const batch = await resolveEnrolmentBatch(query, { courseId: input.courseId, batchId: input.batchId, excludeOrderId: input.excludeOrderId })
  return batch?.id ?? null
}

async function prepareCheckoutOrder(input: {
  profileId: string
  courseId: string
  provider: PaymentProviderName
  currencies?: readonly PaymentCurrency[]
  planId?: string | null
  promoCode?: string | null
  /** C4: billing state (INR) or country (USD), and an optional company + GSTIN. */
  billing?: BillingInput | null
  /** Round D: the batch chosen on a batch course (ignored on a self-paced course). */
  batchId?: string | null
  now?: Date
}): Promise<{ order: CoursePaymentOrder; reused: boolean }> {
  const now = input.now ?? new Date()
  const actor: CoursePaymentActor = { type: 'member', profileId: input.profileId }
  try {
    return await withTransaction(async (client) => {
      const { course, quote, code } = await quoteCheckout(client, { ...input, now })
      const resolved = resolveOrderBilling(input.billing, quote.currency)
      if (!resolved.ok) throw new CoursePurchaseError(resolved.reason)
      const billing = resolved.billing

      const open = await client.query<OrderRow>(`
        select ${ORDER_COLUMNS}, ${ORDER_DOCUMENT_COLUMNS}
        from public.course_payment_orders o
        where o.course_id = $1::uuid and o.profile_id = $2::uuid and o.status = 'created'
        for update
      `, [input.courseId, input.profileId])
      const existing = open.rows[0] ? mapCourseOrder(open.rows[0]) : null
      const batchId = course.batchMode === 'batches'
        ? await checkoutBatchId(client, { courseId: input.courseId, profileId: input.profileId, batchId: input.batchId ?? null, excludeOrderId: existing?.id ?? null })
        : null
      if (existing) {
        const ageMs = now.getTime() - Date.parse(existing.createdAt)
        const sameOrder = existing.amountMinor === quote.amountMinor
          && existing.currency === quote.currency
          && existing.planId === quote.plan.id
          && (existing.promoCode ?? null) === (quote.promo?.code ?? null)
          && sameBilling(existing.billing, billing)
          && (course.batchMode !== 'batches' || (await orderBatchId(client, existing.id)) === batchId)
        if (sameOrder && existing.provider === input.provider && existing.providerOrderId && ageMs < COURSE_CHECKOUT_REUSE_MINUTES * 60_000) {
          return { order: existing, reused: true }
        }
        if (!existing.providerOrderId && ageMs < 60_000) throw new CoursePurchaseError('checkout_in_progress')
        await client.query(`
          update public.course_payment_orders
          set status = 'cancelled', failure_reason = 'superseded', updated_at = now()
          where id = $1::uuid and status = 'created'
        `, [existing.id])
        // A superseded checkout gives its reserved code use back before this one is counted.
        await releasePromoUse(client, existing.id)
        await audit(client, existing, 'checkout_superseded', { actor, fromStatus: 'created', toStatus: 'cancelled' })
      }

      if (code) {
        // Counted with the code row locked (quoteCheckout), after any superseded checkout gave its use back.
        const refusal = await promoUsageRefusal(client, code, { profileId: input.profileId, now })
        if (refusal) throw new CoursePurchaseError(refusal)
      }

      const inserted = await client.query<OrderRow>(`
        insert into public.course_payment_orders as o (
          course_id, profile_id, course_title, list_price_minor, discount_price_minor, amount_minor, currency, provider,
          plan_id, plan_name, access_months, promo_code_id, promo_code, promo_discount_minor,
          billing_state_code, billing_country, billing_company, billing_gstin, batch_id
        )
        values ($1::uuid, $2::uuid, $3::text, $4::bigint, $5::bigint, $6::bigint, $7::text, $8::text,
                $9::uuid, $10::text, $11::integer, $12::uuid, $13::text, $14::bigint, $15::text, $16::text, $17::text, $18::text, $19::uuid)
        returning ${ORDER_COLUMNS}, ${ORDER_DOCUMENT_COLUMNS}
      `, [
        input.courseId, input.profileId, course.title, quote.listPriceMinor, quote.discountPriceMinor, quote.amountMinor, quote.currency, input.provider,
        quote.plan.id, quote.plan.name, quote.plan.accessMonths, quote.promo?.codeId ?? null, quote.promo?.code ?? null, quote.promo?.discountMinor ?? 0,
        billing.stateCode, billing.country, billing.company, billing.gstin, batchId,
      ])
      const row = inserted.rows[0]
      if (!row) throw new Error('course_payment_order_insert_failed')
      const order = mapCourseOrder(row)
      if (quote.promo) {
        await reservePromoUse(client, {
          codeId: quote.promo.codeId,
          orderId: order.id,
          profileId: input.profileId,
          courseId: input.courseId,
          discountMinor: quote.promo.discountMinor,
          currency: quote.currency,
          reservedUntil: new Date(now.getTime() + (GATEWAY_ORDER_LIFETIME_MINUTES + PROMO_RESERVATION_GRACE_MINUTES) * 60_000),
        })
      }
      await audit(client, order, 'checkout_started', {
        actor,
        toStatus: 'created',
        details: {
          listPriceMinor: quote.listPriceMinor,
          discountPriceMinor: quote.discountPriceMinor,
          planId: quote.plan.id,
          accessMonths: quote.plan.accessMonths,
          promoCode: quote.promo?.code ?? null,
          promoDiscountMinor: quote.promo?.discountMinor ?? 0,
        },
      })
      return { order, reused: false }
    })
  } catch (error) {
    if (isUniqueViolation(error)) throw new CoursePurchaseError('checkout_in_progress')
    throw error
  }
}

async function attachProviderOrder(orderId: string, providerOrderId: string, providerSessionId: string | null = null) {
  return withTransaction(async (client) => {
    const result = await client.query<OrderRow>(`
      update public.course_payment_orders o
      set provider_order_id = $2::text, provider_session_id = $3::text, updated_at = now()
      where o.id = $1::uuid and (o.provider_order_id is null or o.provider_order_id = $2::text)
      returning ${ORDER_COLUMNS}, ${ORDER_DOCUMENT_COLUMNS}
    `, [orderId, providerOrderId, providerSessionId])
    if (!result.rows[0]) throw new CoursePurchaseError('order_not_found')
    const order = mapCourseOrder(result.rows[0])
    await audit(client, order, 'gateway_order_created', { providerReference: providerOrderId, toStatus: 'created' })
    return order
  })
}

async function markOrderFailed(orderId: string, reason: string) {
  await withTransaction(async (client) => {
    const result = await client.query<OrderRow>(`
      update public.course_payment_orders o
      set status = 'failed', failure_reason = left($2::text, 500), updated_at = now()
      where o.id = $1::uuid and o.status = 'created'
      returning ${ORDER_COLUMNS}, ${ORDER_DOCUMENT_COLUMNS}
    `, [orderId, reason])
    if (result.rows[0]) {
      await releasePromoUse(client, orderId)
      await audit(client, mapCourseOrder(result.rows[0]), 'order_failed', { fromStatus: 'created', toStatus: 'failed', details: { reason } })
    }
  })
}

/**
 * A payment attempt failed or was abandoned, but the gateway order can still be paid
 * (Cashfree lets the learner retry in the same checkout). Notes the reason only.
 */
async function recordAttemptFailure(client: DatabaseQueryClient, input: {
  provider: PaymentProviderName
  providerOrderId: string
  providerPaymentId: string | null
  reason: string
  dropped: boolean
}) {
  const result = await client.query<OrderRow>(`
    update public.course_payment_orders o
    set failure_reason = left($3::text, 500), updated_at = now()
    where o.provider = $1::text and o.provider_order_id = $2::text and o.status = 'created'
    returning ${ORDER_COLUMNS}, ${ORDER_DOCUMENT_COLUMNS}
  `, [input.provider, input.providerOrderId, input.reason])
  if (!result.rows[0]) return null
  const order = mapCourseOrder(result.rows[0])
  await audit(client, order, input.dropped ? 'payment_abandoned' : 'payment_attempt_failed', {
    actor: { type: 'provider' },
    providerReference: input.providerPaymentId,
    details: { reason: input.reason },
  })
  return order
}

async function getOrderForProfile(orderId: string, profileId: string) {
  const rows = await query<OrderRow>(`
    select ${ORDER_COLUMNS}, ${ORDER_DOCUMENT_COLUMNS} from public.course_payment_orders o
    where o.id = $1::uuid and o.profile_id = $2::uuid
    limit 1
  `, [orderId, profileId])
  return rows[0] ? mapCourseOrder(rows[0]) : null
}

/** The learner's own order by its gateway order id (return page). */
async function getOrderForProfileByProviderOrderId(providerOrderId: string, profileId: string) {
  const rows = await query<OrderRow>(`
    select ${ORDER_COLUMNS}, ${ORDER_DOCUMENT_COLUMNS} from public.course_payment_orders o
    where o.provider_order_id = $1::text and o.profile_id = $2::uuid
    order by o.created_at desc
    limit 1
  `, [providerOrderId, profileId])
  if (rows[0]) return mapCourseOrder(rows[0])
  // The buyer can come back before the gateway id was saved (crs_<uuid> is our id).
  const orderUuid = providerOrderId.startsWith('crs_') ? orderUuidFromGatewayOrderId(providerOrderId) : null
  return orderUuid ? getOrderForProfile(orderUuid, profileId) : null
}

/** One order, only if `managerId` owns the course or manages it for its organization. */
async function getOrderForManager(orderId: string, managerId: string) {
  const rows = await query<OrderRow>(`
    select ${ORDER_COLUMNS}, ${ORDER_DOCUMENT_COLUMNS}
    from public.course_payment_orders o
    join public.learning_courses course on course.id = o.course_id
    where o.id = $2::uuid and ${courseManagerAccessSql('course', '$1::uuid')}
    limit 1
  `, [managerId, orderId])
  return rows[0] ? mapCourseOrder(rows[0]) : null
}

async function getOrderById(orderId: string) {
  const rows = await query<OrderRow>(`
    select ${ORDER_COLUMNS}, ${ORDER_DOCUMENT_COLUMNS} from public.course_payment_orders o where o.id = $1::uuid limit 1
  `, [orderId])
  return rows[0] ? mapCourseOrder(rows[0]) : null
}

async function findOrderByProviderOrderId(client: DatabaseQueryClient, provider: PaymentProviderName, providerOrderId: string) {
  const result = await client.query<OrderRow>(`
    select ${ORDER_COLUMNS}, ${ORDER_DOCUMENT_COLUMNS} from public.course_payment_orders o
    where o.provider = $1::text and o.provider_order_id = $2::text
    limit 1
  `, [provider, providerOrderId])
  if (result.rows[0]) return mapCourseOrder(result.rows[0])
  // The webhook can arrive a moment before the gateway id is saved; our id carries the order uuid.
  const orderUuid = providerOrderId.startsWith('crs_') ? orderUuidFromGatewayOrderId(providerOrderId) : null
  if (!orderUuid) return null
  const byId = await client.query<OrderRow>(`
    select ${ORDER_COLUMNS}, ${ORDER_DOCUMENT_COLUMNS} from public.course_payment_orders o
    where o.id = $1::uuid and o.provider = $2::text and (o.provider_order_id is null or o.provider_order_id = $3::text)
    limit 1
  `, [orderUuid, provider, providerOrderId])
  return byId.rows[0] ? mapCourseOrder(byId.rows[0]) : null
}

/**
 * Records a successful payment and enrolls the learner (source 'purchase') in the
 * same transaction, then records the seller's earning. Idempotent: an order that is
 * already paid or refunded returns its stored outcome without changing anything.
 */
async function confirmPaidOrder(client: DatabaseQueryClient, input: {
  orderId: string
  providerPaymentId: string
  providerOrderId?: string
  amountMinor?: number
  currency?: string
  actor?: CoursePaymentActor
  now?: Date
}): Promise<CourseConfirmOutcome> {
  const actor = input.actor ?? SYSTEM
  const now = input.now ?? new Date()
  const current = await lockOrder(client, input.orderId)
  if (!current) throw new CoursePurchaseError('order_not_found')
  if (current.status === 'refunded') return { state: 'refunded', order: current }
  if (current.status === 'paid') {
    return current.enrollmentConfirmedAt
      ? { state: 'enrolled', order: current }
      : { state: 'refund_due', order: current, reason: current.refundDueReason ?? 'unknown' }
  }

  const amountMatches = input.amountMinor === undefined
    || (input.amountMinor === current.amountMinor && input.currency === current.currency)

  await client.query(`
    update public.course_payment_orders
    set status = 'paid', provider_payment_id = $2::text, provider_order_id = coalesce(provider_order_id, $3::text),
      paid_at = coalesce(paid_at, $4::timestamptz), failure_reason = null, updated_at = now()
    where id = $1::uuid
  `, [current.id, input.providerPaymentId, input.providerOrderId ?? null, now.toISOString()])
  await audit(client, current, 'paid', {
    actor,
    fromStatus: current.status,
    toStatus: 'paid',
    providerReference: input.providerPaymentId,
    details: amountMatches ? {} : { receivedAmountMinor: input.amountMinor ?? null, receivedCurrency: input.currency ?? null },
  })

  let reason: CourseRefundDueReason | null = amountMatches ? null : 'amount_mismatch'
  const course = current.courseId && current.profileId ? await lockCourseForPurchase(client, current.courseId, current.profileId) : null
  const enrollment = course && current.profileId ? await lockEnrollment(client, course.id, current.profileId) : null
  if (!reason) reason = !course || !course.visible || !current.profileId ? 'course_not_found' : enrollmentBlocker(enrollment)

  if (reason) {
    const updated = await client.query<OrderRow>(`
      update public.course_payment_orders o
      set refund_due_reason = $2::text, updated_at = now()
      where o.id = $1::uuid
      returning ${ORDER_COLUMNS}, ${ORDER_DOCUMENT_COLUMNS}
    `, [current.id, reason])
    const order = mapCourseOrder(updated.rows[0]!)
    await audit(client, order, 'refund_due', { actor, toStatus: 'paid', details: { reason } })
    return { state: 'refund_due', order, reason }
  }

  // Round C (C3): the plan's access period. A renewal of time-limited access that is still running extends it
  // from its current end; otherwise it runs from now. A lifetime plan (or an order before plans) has no end.
  const accessExpiresSql = `case when $4::integer is null then null
      else greatest(coalesce(case when status <> 'revoked' then access_expires_at end, $3::timestamptz), $3::timestamptz)
           + make_interval(months => $4::integer) end`
  let enrollmentId: string
  if (enrollment) {
    // A refunded purchase bought again, former team access bought, or time-limited access renewed: the same
    // enrollment (and its progress) becomes this purchase.
    const reactivated = await client.query<{ id: string } & QueryResultRow>(`
      update public.learning_enrollments
      set access_expires_at = ${accessExpiresSql},
        status = case when completed_at is not null then 'completed' else 'active' end,
        enrollment_source = 'purchase', revoked_at = null, payment_order_id = $2::uuid, plan_id = $5::uuid,
        enrolled_at = case when status = 'revoked' then now() else enrolled_at end, updated_at = now()
      where id = $1::uuid
      returning id
    `, [enrollment.id, current.id, now.toISOString(), current.accessMonths, current.planId])
    enrollmentId = reactivated.rows[0]?.id ?? enrollment.id
  } else {
    const inserted = await client.query<{ id: string } & QueryResultRow>(`
      insert into public.learning_enrollments (course_id, learner_id, enrollment_source, status, payment_order_id, plan_id, access_expires_at, enrolled_at, created_at, updated_at)
      values ($1::uuid, $2::uuid, 'purchase', 'active', $3::uuid, $5::uuid,
              case when $6::integer is null then null else $4::timestamptz + make_interval(months => $6::integer) end,
              now(), now(), now())
      returning id
    `, [course!.id, current.profileId, current.id, now.toISOString(), current.planId, current.accessMonths])
    enrollmentId = inserted.rows[0]!.id
  }
  // Round D: the enrolment joins the order's batch, unless the learner already has one (a renewal keeps its batch). A
  // paid order always enrols, even when that goes over the seat limit.
  if (course!.batchMode === 'batches') await client.query(`
    update public.learning_enrollments enrollment
    set batch_id = paid_order.batch_id, updated_at = now()
    from public.course_payment_orders paid_order
    where enrollment.id = $1::uuid and paid_order.id = $2::uuid and paid_order.batch_id is not null
      and (enrollment.batch_id is null or $3::boolean)
  `, [enrollmentId, current.id, enrollment?.status === 'revoked'])
  // Round C (C2): the code's reserved use becomes a redemption.
  if (current.promoCode) await redeemPromoUse(client, current.id)

  const confirmed = await client.query<OrderRow>(`
    update public.course_payment_orders o
    set enrollment_id = $2::uuid, enrollment_confirmed_at = now(), refund_due_reason = null, updated_at = now()
    where o.id = $1::uuid
    returning ${ORDER_COLUMNS}, ${ORDER_DOCUMENT_COLUMNS}
  `, [current.id, enrollmentId])
  const order = mapCourseOrder(confirmed.rows[0]!)
  await audit(client, order, 'enrolled', { actor, toStatus: 'paid', details: { enrollmentId } })
  // C4: the GST tax invoice, numbered in this transaction. A failure here never undoes the purchase (savepoint).
  await withTaxSavepoint(client, 'invoice', () => issueInvoiceForOrder(client, order.id))
  // A repurchase after a refund is a new enrolment to tell the learner about: keyed by order.
  await notifyEnrolled(
    async (text, values) => (await client.query(text, values ? [...values] : undefined)).rows,
    { learnerId: current.profileId!, courseId: course!.id, enrollmentId, occasion: order.id },
    { inTransaction: true },
  )

  const seller = course!.companyId ? { companyId: course!.companyId } : course!.sellerProfileId ? { profileId: course!.sellerProfileId } : null
  if (seller) {
    await recordSaleEarning(client, {
      sourceType: 'course_purchase',
      sourceId: order.id,
      seller,
      grossMinor: order.amountMinor,
      currency: order.currency,
      availableAfter: order.paidAt ? new Date(order.paidAt) : now,
      actor,
    })
  }
  return { state: 'enrolled', order }
}

/**
 * Starts a refund: checks the order can be refunded and marks it 'requested' so a
 * double click cannot send two refunds. Returns the attempt number for the refund id.
 */
async function requestRefund(client: DatabaseQueryClient, input: { orderId: string; actor: CoursePaymentActor; reason: string }) {
  const current = await lockOrder(client, input.orderId)
  if (!current) throw new CoursePurchaseError('order_not_found')
  const retryAfterFailure = current.status === 'refunded' && current.refundStatus === 'failed'
  if ((current.status !== 'paid' && !retryAfterFailure) || !current.providerPaymentId || !current.providerOrderId) {
    throw new CoursePurchaseError('refund_not_allowed')
  }
  if (current.refundStatus === 'requested') {
    const stale = await client.query<QueryResultRow & { stale: boolean }>(`
      select refund_requested_at < now() - make_interval(mins => $2::integer) as stale
      from public.course_payment_orders where id = $1::uuid
    `, [current.id, REFUND_REQUEST_STALE_MINUTES])
    if (!stale.rows[0]?.stale) throw new CoursePurchaseError('refund_in_progress')
  }
  if (current.refundAttempts >= 20) throw new CoursePurchaseError('refund_not_allowed')

  const updated = await client.query<OrderRow>(`
    update public.course_payment_orders o
    set refund_status = 'requested', refund_attempts = refund_attempts + 1, refund_requested_at = now(),
      refund_requested_by = $2::uuid, refund_reason = left($3::text, 200), updated_at = now()
    where o.id = $1::uuid
    returning ${ORDER_COLUMNS}, ${ORDER_DOCUMENT_COLUMNS}
  `, [current.id, input.actor.profileId ?? null, input.reason])
  const order = mapCourseOrder(updated.rows[0]!)
  await audit(client, order, 'refund_requested', {
    actor: input.actor,
    fromStatus: current.status,
    toStatus: current.status,
    details: { reason: input.reason, attempt: order.refundAttempts },
  })
  return { order, attempt: order.refundAttempts }
}

/**
 * Marks a purchase refunded, ends the course access it paid for and reverses the
 * seller's earning, all in one transaction. Idempotent.
 */
async function markOrderRefunded(
  client: DatabaseQueryClient,
  orderId: string,
  refund: { providerRefundId?: string | null; refundStatus?: 'pending' | 'processed'; actor?: CoursePaymentActor; reason?: string } = {},
) {
  const actor = refund.actor ?? SYSTEM
  const before = await lockOrder(client, orderId)
  if (!before || (before.status !== 'paid' && before.status !== 'refunded')) return null
  const result = await client.query<OrderRow>(`
    update public.course_payment_orders o
    set status = 'refunded', refunded_at = coalesce(refunded_at, now()),
      refund_status = coalesce($2::text, case when o.refund_status = 'requested' then 'processed' else o.refund_status end, 'processed'),
      provider_refund_id = coalesce($3::text, o.provider_refund_id),
      updated_at = now()
    where o.id = $1::uuid
    returning ${ORDER_COLUMNS}, ${ORDER_DOCUMENT_COLUMNS}
  `, [orderId, refund.refundStatus ?? null, refund.providerRefundId ?? null])
  const order = result.rows[0] ? mapCourseOrder(result.rows[0]) : null
  if (order && before.status !== 'refunded') {
    const revoked = await client.query<{ id: string } & QueryResultRow>(`
      update public.learning_enrollments
      set status = 'revoked', revoked_at = now(), updated_at = now()
      where payment_order_id = $1::uuid and status <> 'revoked'
      returning id
    `, [orderId])
    await audit(client, order, 'refunded', {
      actor,
      fromStatus: before.status,
      toStatus: 'refunded',
      providerReference: order.providerRefundId,
      details: {
        refundStatus: order.refundStatus,
        reason: refund.reason ?? before.refundDueReason ?? null,
        enrollmentRevoked: revoked.rows.map((row) => row.id),
      },
    })
    await reverseSaleEarning(client, { sourceType: 'course_purchase', sourceId: orderId, reason: refund.reason ?? 'course_refunded', actor })
    // C4: a credit note against the invoice; the invoice itself is never changed.
    await withTaxSavepoint(client, 'credit_note', () => issueCreditNoteForOrder(client, orderId, { reason: 'Course purchase refunded' }))
  } else if (order && before.refundStatus !== order.refundStatus) {
    await audit(client, order, 'refund_status_changed', { actor, fromStatus: before.refundStatus, toStatus: order.refundStatus, providerReference: order.providerRefundId })
  }
  return order
}

/** The gateway did not refund. The order keeps its status; the refund can be retried. */
async function recordRefundFailure(client: DatabaseQueryClient, input: { orderId: string; reason: string; actor?: CoursePaymentActor; providerRefundId?: string | null }) {
  const result = await client.query<OrderRow>(`
    update public.course_payment_orders o
    set refund_status = 'failed', provider_refund_id = coalesce($2::text, o.provider_refund_id), updated_at = now()
    where o.id = $1::uuid and o.status in ('paid', 'refunded')
    returning ${ORDER_COLUMNS}, ${ORDER_DOCUMENT_COLUMNS}
  `, [input.orderId, input.providerRefundId ?? null])
  const order = result.rows[0] ? mapCourseOrder(result.rows[0]) : null
  if (order) await audit(client, order, 'refund_failed', { actor: input.actor, toStatus: order.status, providerReference: order.providerRefundId, details: { reason: input.reason } })
  return order
}

type PurchaseRow = OrderRow & { course_slug: string | null }
type SaleRow = PurchaseRow & { buyer_name: string | null; buyer_slug: string | null }

/** The learner's receipts: every completed or refunded purchase, newest first. */
async function listLearnerPurchases(profileId: string): Promise<LearnerCoursePurchase[]> {
  const rows = await query<PurchaseRow>(`
    select ${ORDER_COLUMNS}, ${ORDER_DOCUMENT_COLUMNS}, course.slug as course_slug
    from public.course_payment_orders o
    left join public.learning_courses course on course.id = o.course_id
    where o.profile_id = $1::uuid and o.status in ('paid', 'refunded')
    order by coalesce(o.paid_at, o.created_at) desc, o.id desc
    limit 200
  `, [profileId])
  return rows.map((row) => ({ ...mapCourseOrder(row), courseSlug: row.course_slug }))
}

/**
 * Paid and refunded purchases of the courses `managerId` owns or manages for an
 * organization; with `allCourses` (platform admins) every course.
 */
async function listCourseSales(input: { managerId: string; allCourses?: boolean }): Promise<CourseSaleRow[]> {
  const rows = await query<SaleRow>(`
    select ${ORDER_COLUMNS}, ${ORDER_DOCUMENT_COLUMNS}, course.slug as course_slug, buyer.full_name as buyer_name, buyer.slug as buyer_slug
    from public.course_payment_orders o
    left join public.learning_courses course on course.id = o.course_id
    left join public.profiles buyer on buyer.id = o.profile_id
    where o.status in ('paid', 'refunded')
      and ($2::boolean or (course.id is not null and ${courseManagerAccessSql('course', '$1::uuid')}))
    order by coalesce(o.paid_at, o.created_at) desc, o.id desc
    limit 500
  `, [input.managerId, Boolean(input.allCourses)])
  return rows.map((row) => ({
    ...mapCourseOrder(row),
    courseSlug: row.course_slug,
    buyerName: row.buyer_name,
    buyerSlug: row.buyer_slug,
  }))
}

/** A checkout the learner started recently and has not finished (course page "check payment"). */
async function getRecentOpenOrder(profileId: string, courseId: string) {
  const rows = await query<OrderRow>(`
    select ${ORDER_COLUMNS}, ${ORDER_DOCUMENT_COLUMNS} from public.course_payment_orders o
    where o.profile_id = $1::uuid and o.course_id = $2::uuid and o.status = 'created'
      and o.provider_order_id is not null
      and o.created_at > now() - make_interval(mins => $3::integer)
    order by o.created_at desc
    limit 1
  `, [profileId, courseId, COURSE_PENDING_CHECK_MINUTES])
  return rows[0] ? mapCourseOrder(rows[0]) : null
}

/** A paid purchase of this course that is waiting for its refund (course page notice). */
async function getRefundDueOrder(profileId: string, courseId: string) {
  const rows = await query<OrderRow>(`
    select ${ORDER_COLUMNS}, ${ORDER_DOCUMENT_COLUMNS} from public.course_payment_orders o
    where o.profile_id = $1::uuid and o.course_id = $2::uuid and o.status = 'paid' and o.enrollment_confirmed_at is null
    order by o.created_at desc
    limit 1
  `, [profileId, courseId])
  return rows[0] ? mapCourseOrder(rows[0]) : null
}

/** True when `profileId` owns this course or manages it for its organization. */
async function isCourseManager(profileId: string, courseId: string) {
  const rows = await query<QueryResultRow & { allowed: boolean }>(`
    select ${courseManagerAccessSql('course', '$1::uuid')} as allowed
    from public.learning_courses course
    where course.id = $2::uuid
  `, [profileId, courseId])
  return Boolean(rows[0]?.allowed)
}

async function getCourseSlug(courseId: string | null) {
  if (!courseId) return null
  const rows = await query<QueryResultRow & { slug: string }>('select slug from public.learning_courses where id = $1::uuid', [courseId])
  return rows[0]?.slug ?? null
}

export const coursePaymentRepository = {
  prepareCheckoutOrder,
  previewCheckout,
  attachProviderOrder,
  markOrderFailed,
  recordAttemptFailure,
  getOrderForProfile,
  getOrderForProfileByProviderOrderId,
  getOrderForManager,
  getOrderById,
  findOrderByProviderOrderId,
  confirmPaidOrder,
  requestRefund,
  markOrderRefunded,
  recordRefundFailure,
  listLearnerPurchases,
  listCourseSales,
  getRecentOpenOrder,
  getRefundDueOrder,
  isCourseManager,
  getCourseSlug,
}
