import type { QueryResultRow } from 'pg'
import { query as databaseQuery, withTransaction, type DatabaseQueryClient } from '@/lib/db/client'
import type { PaymentCurrency } from '@/features/payments/types'
import { courseManagerAccessSql } from './course-access'
import { liveCourseSql } from './course-publication'
import { promoDiscount, type PromoCodeInput, type PromoCodeRefusal, type PromoCodeTerms } from './promo-codes'

/**
 * Promo codes (learning round C, C2): public.learning_promo_codes and public.learning_promo_redemptions (0075).
 *
 * Usage is counted atomically: checkout locks the code row (FOR UPDATE) before counting its live uses, so two
 * buyers can never both take the last use. A checkout reserves one use until its gateway order can no longer be
 * paid; a paid order redeems it; a failed, cancelled or superseded checkout releases it.
 */

type Query = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>

type CodeRow = QueryResultRow & {
  id: string
  mentor_id: string | null
  company_id: string | null
  course_id: string | null
  code: string
  discount_type: 'percent' | 'fixed'
  percent_off: string | null
  amount_off_minor: string | number | null
  currency: PaymentCurrency | null
  max_discount_minor: string | number | null
  usage_limit: number | null
  per_member_limit: number | null
  used_count: number
  valid_from: string | Date | null
  valid_until: string | Date | null
  disabled_at: string | Date | null
}

export type LockedPromoCode = {
  id: string
  code: string
  terms: PromoCodeTerms
  usageLimit: number | null
  perMemberLimit: number | null
  validFrom: Date | null
  validUntil: Date | null
}

function nullableNumber(value: string | number | null) {
  return value === null ? null : Number(value)
}

function nullableDate(value: string | Date | null) {
  return value === null ? null : value instanceof Date ? value : new Date(value)
}

function termsFromRow(row: CodeRow): PromoCodeTerms {
  return {
    discountType: row.discount_type,
    percentOff: row.percent_off === null ? null : String(Number(row.percent_off)),
    amountOffMinor: nullableNumber(row.amount_off_minor),
    currency: row.currency,
    maxDiscountMinor: nullableNumber(row.max_discount_minor),
  }
}

const CODE_COLUMNS = `code.id, code.mentor_id, code.company_id, code.course_id, code.code, code.discount_type, code.percent_off,
  code.amount_off_minor, code.currency, code.max_discount_minor, code.usage_limit, code.per_member_limit, code.used_count,
  code.valid_from, code.valid_until, code.disabled_at`

function clientQuery(client: DatabaseQueryClient): Query {
  return async (text, values) => (await client.query(text, values ? [...values] : undefined)).rows
}

/**
 * Locks the code a buyer typed for this course (inside the checkout transaction). A code belongs to the course's
 * seller: the organisation for an organisation course, the trainer otherwise; it applies to one course or to all
 * of that seller's courses. Disabled codes are not found.
 */
export async function lockPromoCodeForCourse(
  client: DatabaseQueryClient,
  input: { code: string; course: { id: string; mentorId: string | null; companyId: string | null } },
): Promise<LockedPromoCode | null> {
  const result = await client.query<CodeRow>(`
    select ${CODE_COLUMNS}
    from public.learning_promo_codes code
    where code.code = $1
      and code.disabled_at is null
      and (code.course_id is null or code.course_id = $2::uuid)
      and (
        ($4::uuid is not null and code.company_id = $4::uuid)
        or ($4::uuid is null and $3::uuid is not null and code.mentor_id = $3::uuid)
      )
    order by (code.course_id is not null) desc
    limit 1
    for update of code
  `, [input.code, input.course.id, input.course.mentorId, input.course.companyId])
  const row = result.rows[0]
  if (!row) return null
  return {
    id: row.id,
    code: row.code,
    terms: termsFromRow(row),
    usageLimit: row.usage_limit === null ? null : Number(row.usage_limit),
    perMemberLimit: row.per_member_limit === null ? null : Number(row.per_member_limit),
    validFrom: nullableDate(row.valid_from),
    validUntil: nullableDate(row.valid_until),
  }
}

/**
 * Whether the locked code can still be used by this buyer now: its window, then its live uses (redeemed, plus
 * reservations that have not run out), in total and for this member. Call with the code row locked.
 */
export async function promoUsageRefusal(
  client: DatabaseQueryClient,
  code: LockedPromoCode,
  input: { profileId: string; now: Date },
): Promise<PromoCodeRefusal | null> {
  if (code.validFrom && code.validFrom.getTime() > input.now.getTime()) return 'promo_not_started'
  if (code.validUntil && code.validUntil.getTime() <= input.now.getTime()) return 'promo_expired'
  const counts = await client.query<QueryResultRow & { total: string | number; mine: string | number }>(`
    select
      count(*) filter (where redemption.status = 'redeemed' or (redemption.status = 'reserved' and redemption.reserved_until > $3::timestamptz)) as total,
      count(*) filter (where redemption.profile_id = $2::uuid and (redemption.status = 'redeemed' or (redemption.status = 'reserved' and redemption.reserved_until > $3::timestamptz))) as mine
    from public.learning_promo_redemptions redemption
    where redemption.code_id = $1::uuid
  `, [code.id, input.profileId, input.now.toISOString()])
  const total = Number(counts.rows[0]?.total ?? 0)
  const mine = Number(counts.rows[0]?.mine ?? 0)
  if (code.usageLimit !== null && total >= code.usageLimit) return 'promo_exhausted'
  if (code.perMemberLimit !== null && mine >= code.perMemberLimit) return 'promo_member_limit'
  return null
}

/** The code's discount on this price, or why it cannot apply (window and usage are checked separately). */
export function lockedPromoDiscount(code: LockedPromoCode, baseMinor: number, currency: PaymentCurrency) {
  return promoDiscount(code.terms, baseMinor, currency)
}

export async function reservePromoUse(client: DatabaseQueryClient, input: {
  codeId: string
  orderId: string
  profileId: string
  courseId: string
  discountMinor: number
  currency: PaymentCurrency
  reservedUntil: Date
}) {
  await client.query(`
    insert into public.learning_promo_redemptions (code_id, order_id, profile_id, course_id, discount_minor, currency, status, reserved_until)
    values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::bigint, $6::text, 'reserved', $7::timestamptz)
    on conflict (order_id) do nothing
  `, [input.codeId, input.orderId, input.profileId, input.courseId, input.discountMinor, input.currency, input.reservedUntil.toISOString()])
}

/** A checkout that will not be paid gives its reserved use back. */
export async function releasePromoUse(client: DatabaseQueryClient, orderId: string) {
  await client.query(`
    update public.learning_promo_redemptions
    set status = 'released', released_at = now(), updated_at = now()
    where order_id = $1::uuid and status = 'reserved'
  `, [orderId])
}

/** A paid order redeems its use (once) and counts it on the code. */
export async function redeemPromoUse(client: DatabaseQueryClient, orderId: string) {
  const redeemed = await client.query<QueryResultRow & { code_id: string }>(`
    update public.learning_promo_redemptions
    set status = 'redeemed', redeemed_at = now(), released_at = null, updated_at = now()
    where order_id = $1::uuid and status <> 'redeemed'
    returning code_id
  `, [orderId])
  const codeId = redeemed.rows[0]?.code_id
  if (codeId) {
    await client.query(`update public.learning_promo_codes set used_count = used_count + 1, updated_at = now() where id = $1::uuid`, [codeId])
  }
  return Boolean(codeId)
}

export type PromoCodeSummary = {
  id: string
  code: string
  courseId: string | null
  courseTitle: string | null
  terms: PromoCodeTerms
  usageLimit: number | null
  perMemberLimit: number | null
  validFrom: string | null
  validUntil: string | null
  disabled: boolean
  redemptions: number
  /** What buyers paid with this code, per currency (refunds not subtracted; see refunds). */
  revenue: Array<{ currency: PaymentCurrency; grossMinor: number; discountMinor: number; refunds: number }>
}

type Owner = { mentorId: string | null; companyId: string | null }

/**
 * Who a new code belongs to. A code for one course belongs to that course's seller and needs course-manager access.
 * "All my courses" codes belong to the actor's own trainer account (their personal courses).
 */
async function resolveOwner(query: Query, actorId: string, courseId: string | null): Promise<Owner & { courseId: string | null }> {
  if (courseId) {
    const rows = await query(
      `select course.id, course.mentor_id, course.company_id
       from public.learning_courses course
       where course.id = $1 and ${liveCourseSql('course')} and ${courseManagerAccessSql('course', '$2')}`,
      [courseId, actorId],
    )
    const course = rows[0]
    if (!course) throw new Error('promo_course_forbidden')
    return { courseId, mentorId: course.company_id ? null : course.mentor_id, companyId: course.company_id ?? null }
  }
  const mentor = await query(`select id from public.learning_mentors where user_id = $1 and status = 'active' limit 1`, [actorId])
  if (!mentor[0]) throw new Error('promo_course_forbidden')
  return { courseId: null, mentorId: String(mentor[0].id), companyId: null }
}

/** Codes the actor may see: their trainer account's codes and the codes of courses they manage. */
const MANAGED_CODE_SQL = `(
  (code.mentor_id is not null and exists (
     select 1 from public.learning_mentors mentor where mentor.id = code.mentor_id and mentor.user_id = $1 and mentor.status = 'active'))
  or (code.company_id is not null and exists (
     select 1 from public.company_members member
     where member.company_id = code.company_id and member.user_id = $1 and member.approved_at is not null
       and member.role::text in ('owner', 'administrator', 'lms_manager')))
)`

export function createPromoCodeRepository(input: { query?: Query; transaction?: <T>(work: (query: Query) => Promise<T>) => Promise<T> } = {}) {
  const query: Query = input.query ?? ((text, values) => databaseQuery<QueryResultRow>(text, values))
  const transaction = input.transaction ?? (<T>(work: (query: Query) => Promise<T>) => withTransaction((client) => work(clientQuery(client))))

  async function create(actorId: string, code: PromoCodeInput) {
    return transaction(async (tx) => {
      const owner = await resolveOwner(tx, actorId, code.courseId)
      try {
        const rows = await tx(
          `insert into public.learning_promo_codes (
             mentor_id, company_id, course_id, code, discount_type, percent_off, amount_off_minor, currency,
             max_discount_minor, usage_limit, per_member_limit, valid_from, valid_until, created_by
           )
           values ($1, $2, $3, $4, $5, $6::numeric, $7, $8, $9, $10, $11, $12, $13, $14)
           returning id`,
          [
            owner.mentorId, owner.companyId, owner.courseId, code.code, code.discountType,
            code.discountType === 'percent' ? code.percentOff : null,
            code.discountType === 'fixed' ? code.amountOffMinor : null,
            code.currency, code.maxDiscountMinor, code.usageLimit, code.perMemberLimit, code.validFrom, code.validUntil, actorId,
          ],
        )
        return String(rows[0]!.id)
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === '23505') throw new Error('promo_code_taken')
        throw error
      }
    })
  }

  async function setDisabled(actorId: string, codeId: string, disabled: boolean) {
    const rows = await query(
      `update public.learning_promo_codes code
       set disabled_at = case when $3::boolean then coalesce(code.disabled_at, now()) else null end, updated_at = now()
       where code.id = $2 and ${MANAGED_CODE_SQL}
       returning code.id`,
      [actorId, codeId, disabled],
    )
    if (!rows[0]) throw new Error('promo_code_not_found')
  }

  /** The actor's codes with their redemptions and the revenue taken through each (per currency). */
  async function listForManager(actorId: string): Promise<PromoCodeSummary[]> {
    const rows = await query(
      `select ${CODE_COLUMNS}, course.title as course_title,
              (select count(*) from public.learning_promo_redemptions redemption
               where redemption.code_id = code.id and redemption.status = 'redeemed')::int as redemptions,
              coalesce((
                select jsonb_agg(jsonb_build_object('currency', totals.currency, 'grossMinor', totals.gross, 'discountMinor', totals.discount, 'refunds', totals.refunds))
                from (
                  select o.currency, sum(o.amount_minor) as gross, sum(o.promo_discount_minor) as discount,
                         count(*) filter (where o.status = 'refunded') as refunds
                  from public.course_payment_orders o
                  where o.promo_code_id = code.id and o.status in ('paid', 'refunded') and o.enrollment_confirmed_at is not null
                  group by o.currency
                ) totals
              ), '[]'::jsonb) as revenue
       from public.learning_promo_codes code
       left join public.learning_courses course on course.id = code.course_id
       where ${MANAGED_CODE_SQL}
       order by code.disabled_at is not null, code.created_at desc, code.id
       limit 200`,
      [actorId],
    ) as Array<CodeRow & { course_title: string | null; redemptions: number; revenue: unknown }>
    return rows.map((row) => {
      const revenue = (typeof row.revenue === 'string' ? JSON.parse(row.revenue) : row.revenue) as Array<Record<string, unknown>>
      return {
        id: row.id,
        code: row.code,
        courseId: row.course_id,
        courseTitle: row.course_title,
        terms: termsFromRow(row),
        usageLimit: row.usage_limit === null ? null : Number(row.usage_limit),
        perMemberLimit: row.per_member_limit === null ? null : Number(row.per_member_limit),
        validFrom: row.valid_from ? nullableDate(row.valid_from)!.toISOString() : null,
        validUntil: row.valid_until ? nullableDate(row.valid_until)!.toISOString() : null,
        disabled: row.disabled_at !== null,
        redemptions: Number(row.redemptions ?? 0),
        revenue: (revenue ?? []).map((entry) => ({
          currency: String(entry.currency) as PaymentCurrency,
          grossMinor: Number(entry.grossMinor ?? 0),
          discountMinor: Number(entry.discountMinor ?? 0),
          refunds: Number(entry.refunds ?? 0),
        })),
      }
    })
  }

  /** Courses the actor can make a single-course code for (live courses they manage). */
  async function listCodeCourses(actorId: string) {
    const rows = await query(
      `select course.id, course.title
       from public.learning_courses course
       where ${liveCourseSql('course')} and course.access_type = 'paid' and ${courseManagerAccessSql('course', '$1')}
       order by course.title, course.id
       limit 200`,
      [actorId],
    )
    return rows.map((row) => ({ id: String(row.id), title: String(row.title) }))
  }

  return { create, setDisabled, listForManager, listCodeCourses }
}

export const promoCodeRepository = createPromoCodeRepository()
