import type { QueryResultRow } from 'pg'
import { withTransaction as databaseTransaction, type DatabaseQueryClient } from '@/lib/db/client'
import { courseManagerAccessSql } from './course-access'
import { DEFAULT_PLAN_NAME, isPaymentCurrencyPlan, type AccessMonths, type CoursePlan, type CoursePlanInput } from './course-plans'
import { canMentorEditCourse, type CourseStatus } from './course-workflow'

/**
 * Pricing plans (learning round C, C3), public.learning_course_plans (0075). Plans are part of a course's content:
 * the trainer edits them on a draft (or a draft revision of a published course) and they go live through review,
 * like the price always has. The first plan's price IS the course's own price (learning_courses.price_minor), set
 * only in the course details form, so listings, the review diff and every place that already reads the course price
 * stay right. The plans panel names the first plan, sets its access period, and adds up to three more plans.
 */

type Query = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>
type Transaction = <T>(work: (query: Query) => Promise<T>) => Promise<T>

type PlanRow = QueryResultRow & {
  id: string
  course_id: string
  name: string
  price_minor: string | number
  discount_price_minor: string | number | null
  currency: string
  access_months: number | null
  position: number
}

function runtimeTransaction<T>(work: (query: Query) => Promise<T>) {
  return databaseTransaction(async (client: DatabaseQueryClient) => work(async (text, values) => {
    const result = await client.query(text, values)
    return result.rows
  }))
}

export function mapPlan(row: PlanRow): CoursePlan | null {
  if (!isPaymentCurrencyPlan(row.currency)) return null
  return {
    id: row.id,
    name: row.name,
    priceMinor: Number(row.price_minor),
    discountPriceMinor: row.discount_price_minor === null ? null : Number(row.discount_price_minor),
    currency: row.currency,
    accessMonths: (row.access_months === 6 || row.access_months === 12 ? row.access_months : null) as AccessMonths,
    position: Number(row.position),
  }
}

const PLAN_COLUMNS = 'plan.id, plan.course_id, plan.name, plan.price_minor, plan.discount_price_minor, plan.currency, plan.access_months, plan.position'

/** The plan rows a course has, in order (none for a course created before its first save in round C). */
export async function listStoredPlansWithQuery(query: Query, courseId: string): Promise<CoursePlan[]> {
  const rows = await query(
    `select ${PLAN_COLUMNS}
     from public.learning_course_plans plan
     where plan.course_id = $1 and plan.archived_at is null
     order by plan.position, plan.id`,
    [courseId],
  ) as PlanRow[]
  return rows.map(mapPlan).filter((plan): plan is CoursePlan => Boolean(plan))
}

/** A course's plans in order. A paid course with no plan row yet sells its own price as one lifetime plan. */
export async function listCoursePlansWithQuery(query: Query, courseId: string): Promise<CoursePlan[]> {
  const rows = await query(
    `select ${PLAN_COLUMNS}
     from public.learning_course_plans plan
     where plan.course_id = $1 and plan.archived_at is null
     order by plan.position, plan.id`,
    [courseId],
  ) as PlanRow[]
  const plans = rows.map(mapPlan).filter((plan): plan is CoursePlan => Boolean(plan))
  if (plans.length) return plans
  const course = await query(
    `select access_type, price_minor, discount_price_minor, currency from public.learning_courses where id = $1`,
    [courseId],
  )
  const row = course[0]
  if (!row || row.access_type !== 'paid' || !isPaymentCurrencyPlan(String(row.currency))) return []
  return [{
    id: null,
    name: DEFAULT_PLAN_NAME,
    priceMinor: Number(row.price_minor),
    discountPriceMinor: row.discount_price_minor === null ? null : Number(row.discount_price_minor),
    currency: String(row.currency) as CoursePlan['currency'],
    accessMonths: null,
    position: 0,
  }]
}

/**
 * Keeps the first plan in step with the course price after the course details are saved (inside that transaction).
 * A paid course always has a first plan; its name and access period stay as the trainer set them.
 */
export async function syncFirstPlanWithQuery(query: Query, courseId: string) {
  const course = (await query(
    `select access_type, price_minor, discount_price_minor, currency from public.learning_courses where id = $1`,
    [courseId],
  ))[0]
  if (!course || course.access_type !== 'paid' || Number(course.price_minor) <= 0 || !isPaymentCurrencyPlan(String(course.currency))) return
  const priceMinor = Number(course.price_minor)
  const discount = course.discount_price_minor === null ? null : Number(course.discount_price_minor)
  const discountPriceMinor = discount !== null && discount > 0 && discount < priceMinor ? discount : null
  const updated = await query(
    `update public.learning_course_plans plan
     set price_minor = $2, discount_price_minor = $3, currency = $4, updated_at = now()
     where plan.id = (
       select first.id from public.learning_course_plans first
       where first.course_id = $1 and first.archived_at is null
       order by first.position, first.id
       limit 1
     )
     returning plan.id`,
    [courseId, priceMinor, discountPriceMinor, course.currency],
  )
  if (updated.length) return
  await query(
    `insert into public.learning_course_plans (course_id, name, price_minor, discount_price_minor, currency, access_months, position)
     values ($1, $2, $3, $4, $5, null, 0)`,
    [courseId, DEFAULT_PLAN_NAME, priceMinor, discountPriceMinor, course.currency],
  )
}

/** Copies a live course's plans into its new draft revision (inside the revision's transaction). */
export async function clonePlansIntoRevisionWithQuery(query: Query, liveCourseId: string, revisionCourseId: string) {
  await query(
    `insert into public.learning_course_plans (course_id, name, price_minor, discount_price_minor, currency, access_months, position, source_plan_id)
     select $2, plan.name, plan.price_minor, plan.discount_price_minor, plan.currency, plan.access_months, plan.position, plan.id
     from public.learning_course_plans plan
     where plan.course_id = $1 and plan.archived_at is null
     order by plan.position, plan.id`,
    [liveCourseId, revisionCourseId],
  )
}

/**
 * Applies an approved revision's plans onto the live course: plans copied from a live plan update it in place (its
 * id, and the orders and enrolments that point at it, never change), new plans are added, and live plans the
 * revision dropped are archived (kept for the orders that bought them). New purchases only.
 */
export async function applyRevisionPlansWithQuery(query: Query, revisionCourseId: string, liveCourseId: string) {
  const revisionPlans = await query(
    `select plan.id, plan.name, plan.price_minor, plan.discount_price_minor, plan.currency, plan.access_months, plan.position,
            plan.source_plan_id
     from public.learning_course_plans plan
     where plan.course_id = $1 and plan.archived_at is null
     order by plan.position, plan.id`,
    [revisionCourseId],
  ) as Array<PlanRow & { source_plan_id: string | null }>
  // Names must stay unique among live plans while they are being renamed: move every live plan aside first.
  await query(
    `update public.learning_course_plans
     set name = left(name, 40) || ' ~' || substr(id::text, 1, 8), updated_at = now()
     where course_id = $1 and archived_at is null`,
    [liveCourseId],
  )
  const kept = new Set<string>()
  for (const plan of revisionPlans) {
    const values = [plan.name, plan.price_minor, plan.discount_price_minor, plan.currency, plan.access_months, plan.position]
    if (plan.source_plan_id) {
      const updated = await query(
        `update public.learning_course_plans
         set name = $3, price_minor = $4, discount_price_minor = $5, currency = $6, access_months = $7, position = $8, updated_at = now()
         where id = $1 and course_id = $2
         returning id`,
        [plan.source_plan_id, liveCourseId, ...values],
      )
      if (updated[0]) {
        kept.add(String(updated[0].id))
        continue
      }
    }
    const inserted = await query(
      `insert into public.learning_course_plans (course_id, name, price_minor, discount_price_minor, currency, access_months, position)
       values ($1, $2, $3, $4, $5, $6, $7)
       returning id`,
      [liveCourseId, ...values],
    )
    kept.add(String(inserted[0]!.id))
    // The revision row now points at the live plan it became, so the review snapshot maps it.
    await query(`update public.learning_course_plans set source_plan_id = $2 where id = $1`, [plan.id, inserted[0]!.id])
  }
  await query(
    `update public.learning_course_plans
     set archived_at = now(), updated_at = now()
     where course_id = $1 and archived_at is null and not (id = any($2::uuid[]))`,
    [liveCourseId, [...kept]],
  )
}

export function createCoursePlanRepository(input: { query?: Query; transaction?: Transaction } = {}) {
  const transaction = input.transaction ?? runtimeTransaction

  async function list(courseId: string) {
    return transaction((query) => listCoursePlansWithQuery(query, courseId))
  }

  /**
   * Replaces a paid course's plans (draft courses and draft revisions only). The first plan always sells the course
   * price from the course details (whatever price the input carries for it). Plans that disappear are archived,
   * never deleted: orders keep pointing at what they bought.
   */
  async function save(actorId: string, courseId: string, plans: CoursePlanInput[]) {
    return transaction(async (query) => {
      const rows = await query(
        `select course.id, course.status, course.revision_closed_at, course.access_type, course.price_minor,
                course.discount_price_minor, course.currency
         from public.learning_courses course
         where course.id = $1 and ${courseManagerAccessSql('course', '$2')}
         for update`,
        [courseId, actorId],
      )
      const course = rows[0]
      if (!course) throw new Error('course_not_found')
      if (!canMentorEditCourse(course.status as CourseStatus) || course.revision_closed_at) throw new Error('course_edit_forbidden')
      if (course.access_type !== 'paid' || !isPaymentCurrencyPlan(String(course.currency)) || Number(course.price_minor) <= 0) {
        throw new Error('course_not_paid')
      }
      const coursePriceMinor = Number(course.price_minor)
      const courseDiscount = course.discount_price_minor === null ? null : Number(course.discount_price_minor)
      const firstPrice = {
        priceMinor: coursePriceMinor,
        discountPriceMinor: courseDiscount !== null && courseDiscount > 0 && courseDiscount < coursePriceMinor ? courseDiscount : null,
        currency: String(course.currency) as CoursePlanInput['currency'],
      }

      const existing = await query(
        `select id from public.learning_course_plans where course_id = $1 and archived_at is null for update`,
        [courseId],
      )
      const existingIds = new Set(existing.map((row) => String(row.id)))
      for (const plan of plans) {
        if (plan.id && !existingIds.has(plan.id)) throw new Error('course_plan_not_found')
      }
      // Free every name and position first, so plans can swap names or order in one save.
      await query(
        `update public.learning_course_plans
         set name = left(name, 40) || ' ~' || substr(id::text, 1, 8), position = position + 10, updated_at = now()
         where course_id = $1 and archived_at is null`,
        [courseId],
      )
      const kept = new Set<string>()
      for (const [position, input] of plans.entries()) {
        const plan = position === 0 ? { ...input, ...firstPrice } : input
        const values = [plan.name.trim(), plan.priceMinor, plan.discountPriceMinor, plan.currency, plan.accessMonths, position]
        if (plan.id) {
          await query(
            `update public.learning_course_plans
             set name = $3, price_minor = $4, discount_price_minor = $5, currency = $6, access_months = $7, position = $8, updated_at = now()
             where id = $1 and course_id = $2`,
            [plan.id, courseId, ...values],
          )
          kept.add(plan.id)
        } else {
          const inserted = await query(
            `insert into public.learning_course_plans (course_id, name, price_minor, discount_price_minor, currency, access_months, position)
             values ($1, $2, $3, $4, $5, $6, $7)
             returning id`,
            [courseId, ...values],
          )
          kept.add(String(inserted[0]!.id))
        }
      }
      await query(
        `update public.learning_course_plans
         set archived_at = now(), updated_at = now()
         where course_id = $1 and archived_at is null and not (id = any($2::uuid[]))`,
        [courseId, [...kept]],
      )
      await query(`update public.learning_courses set updated_at = now() where id = $1`, [courseId])
      return listCoursePlansWithQuery(query, courseId)
    })
  }

  return { list, save }
}

export const coursePlanRepository = createCoursePlanRepository()
