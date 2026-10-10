import type { QueryResultRow } from 'pg'
import { query as databaseQuery } from '@/lib/db/client'
import type { PaymentCurrency } from '@/features/payments/types'
import { mapPlan } from '../course-plan-repository'
import { DEFAULT_PLAN_NAME, type CoursePlan } from '../course-plans'
import { courseOpenToNewLearnersSql } from '../course-publication'
import { loadTrainingCompany, type Query, type TrainingActor, type TrainingCompany } from './company-access'
import { seatRefundableUntil } from './seat-rules'

/**
 * Company training read models (round D, part 3): the courses a company can buy seats of, its seat packs and how many
 * seats of each course it has left. Every read checks that the viewer runs the company's training (or is a platform
 * admin) first.
 */

export type BuyableCourse = {
  id: string
  title: string
  slug: string
  plans: CoursePlan[]
}

export type SeatPackRow = {
  orderId: string
  courseId: string | null
  courseTitle: string
  courseSlug: string | null
  planName: string | null
  quantity: number
  unitMinor: number
  volumeDiscountBasisPoints: number
  amountMinor: number
  currency: PaymentCurrency
  status: 'paid' | 'refunded'
  paidAt: string
  refundableUntil: string
  seats: { available: number; assigned: number; expired: number; refunded: number; held: number }
  validUntil: string | null
  invoiceId: string | null
  invoiceNumber: string | null
  creditNoteId: string | null
  creditNoteNumber: string | null
  seatRefund: { seatCount: number; amountMinor: number; status: string } | null
  boughtBy: string | null
}

export type SeatSummaryRow = {
  courseId: string
  courseTitle: string
  courseSlug: string | null
  available: number
  assigned: number
  expired: number
  /** When the next unassigned seat of this course stops being assignable. */
  nextExpiry: string | null
}

function iso(value: unknown) {
  if (value === null || value === undefined) return null
  return new Date(value instanceof Date ? value.getTime() : String(value)).toISOString()
}

function count(value: unknown) {
  return Number(value ?? 0)
}

export function createTrainingRepository(input: { query?: Query } = {}) {
  const query: Query = input.query ?? ((text, values) => databaseQuery<QueryResultRow>(text, values))

  async function company(actor: TrainingActor, companyId: string): Promise<TrainingCompany> {
    return loadTrainingCompany(query, actor, companyId)
  }

  /** Paid courses on sale in rupees that the company could buy seats of (not its own courses), with their plans. */
  async function buyableCourses(actor: TrainingActor, companyId: string): Promise<BuyableCourse[]> {
    await loadTrainingCompany(query, actor, companyId)
    const courses = await query(
      `select course.id, course.title, course.slug, course.price_minor, course.discount_price_minor, course.currency
       from public.learning_courses course
       left join public.learning_mentors mentor on mentor.id = course.mentor_id
       left join public.learning_mentor_applications application
         on application.id = mentor.application_id and application.user_id = mentor.user_id
       left join public.companies company on company.id = course.company_id
       where course.access_type = 'paid'
         and (course.company_id is null or course.company_id <> $1::uuid)
         and ${courseOpenToNewLearnersSql()}
       order by lower(course.title), course.id
       limit 200`,
      [companyId],
    )
    if (!courses.length) return []
    const planRows = await query(
      `select plan.id, plan.course_id, plan.name, plan.price_minor, plan.discount_price_minor, plan.currency, plan.access_months, plan.position
       from public.learning_course_plans plan
       where plan.course_id = any($1::uuid[]) and plan.archived_at is null
       order by plan.course_id, plan.position, plan.id`,
      [courses.map((course) => String(course.id))],
    )
    const plansByCourse = new Map<string, CoursePlan[]>()
    for (const row of planRows) {
      const plan = mapPlan(row as Parameters<typeof mapPlan>[0])
      if (!plan || plan.currency !== 'INR') continue
      const list = plansByCourse.get(String(row.course_id)) ?? []
      list.push(plan)
      plansByCourse.set(String(row.course_id), list)
    }
    return courses.flatMap((row) => {
      const id = String(row.id)
      const stored = plansByCourse.get(id)
      const plans: CoursePlan[] = stored?.length
        ? stored
        : String(row.currency) === 'INR' && Number(row.price_minor) > 0
          ? [{ id: null, name: DEFAULT_PLAN_NAME, priceMinor: Number(row.price_minor), discountPriceMinor: row.discount_price_minor === null ? null : Number(row.discount_price_minor), currency: 'INR', accessMonths: null, position: 0 }]
          : []
      return plans.length ? [{ id, title: String(row.title), slug: String(row.slug), plans }] : []
    })
  }

  /** Every seat pack the company paid for, newest first, with its seats and GST documents. */
  async function seatPacks(actor: TrainingActor, companyId: string, now = new Date()): Promise<SeatPackRow[]> {
    await loadTrainingCompany(query, actor, companyId)
    const rows = await query(
      `select o.id, o.course_id, o.course_title, course.slug as course_slug, o.plan_name, o.seat_quantity, o.seat_unit_price_minor,
              o.seat_volume_discount_basis_points, o.amount_minor, o.currency, o.status, o.paid_at,
              buyer.full_name as bought_by,
              invoice.id as invoice_id, invoice.invoice_number,
              note.id as credit_note_id, note.credit_note_number,
              refund.seat_count as refund_seat_count, refund.amount_minor as refund_amount_minor, refund.status as refund_status,
              (select min(seat.valid_until) from public.company_training_seats seat where seat.order_id = o.id) as valid_until,
              (select count(*) from public.company_training_seats seat where seat.order_id = o.id and seat.status = 'available' and seat.valid_until > $2::timestamptz) as available,
              (select count(*) from public.company_training_seats seat where seat.order_id = o.id and seat.status = 'available' and seat.valid_until <= $2::timestamptz) as expired,
              (select count(*) from public.company_training_seats seat where seat.order_id = o.id and seat.status = 'assigned') as assigned,
              (select count(*) from public.company_training_seats seat where seat.order_id = o.id and seat.status = 'refunded') as refunded,
              (select count(*) from public.company_training_seats seat where seat.order_id = o.id and seat.status = 'refund_pending') as held
       from public.course_payment_orders o
       left join public.learning_courses course on course.id = o.course_id
       left join public.profiles buyer on buyer.id = o.profile_id
       left join public.tax_invoices invoice on invoice.order_id = o.id
       left join public.tax_credit_notes note on note.invoice_id = invoice.id
       left join public.company_training_seat_refunds refund on refund.order_id = o.id
       where o.seat_company_id = $1::uuid and o.status in ('paid', 'refunded') and o.enrollment_confirmed_at is not null
       order by o.paid_at desc nulls last, o.id desc
       limit 200`,
      [companyId, now.toISOString()],
    )
    return rows.map((row) => {
      const paidAt = iso(row.paid_at) ?? new Date(0).toISOString()
      return {
        orderId: String(row.id),
        courseId: row.course_id ? String(row.course_id) : null,
        courseTitle: String(row.course_title ?? ''),
        courseSlug: row.course_slug ? String(row.course_slug) : null,
        planName: row.plan_name ? String(row.plan_name) : null,
        quantity: count(row.seat_quantity),
        unitMinor: count(row.seat_unit_price_minor),
        volumeDiscountBasisPoints: count(row.seat_volume_discount_basis_points),
        amountMinor: count(row.amount_minor),
        currency: row.currency === 'USD' ? 'USD' : 'INR',
        status: row.status === 'refunded' ? 'refunded' : 'paid',
        paidAt,
        refundableUntil: seatRefundableUntil(new Date(paidAt)).toISOString(),
        seats: { available: count(row.available), assigned: count(row.assigned), expired: count(row.expired), refunded: count(row.refunded), held: count(row.held) },
        validUntil: iso(row.valid_until),
        invoiceId: row.invoice_id ? String(row.invoice_id) : null,
        invoiceNumber: row.invoice_number ? String(row.invoice_number) : null,
        creditNoteId: row.credit_note_id ? String(row.credit_note_id) : null,
        creditNoteNumber: row.credit_note_number ? String(row.credit_note_number) : null,
        seatRefund: row.refund_seat_count === null || row.refund_seat_count === undefined
          ? null
          : { seatCount: count(row.refund_seat_count), amountMinor: count(row.refund_amount_minor), status: String(row.refund_status) },
        boughtBy: row.bought_by ? String(row.bought_by).trim() || null : null,
      } satisfies SeatPackRow
    })
  }

  /** Seats per course: how many can still be given out, are in use, or ran out unassigned. */
  async function seatSummary(actor: TrainingActor, companyId: string, now = new Date()): Promise<SeatSummaryRow[]> {
    await loadTrainingCompany(query, actor, companyId)
    const rows = await query(
      `select seat.course_id, course.title as course_title, course.slug as course_slug,
              count(*) filter (where seat.status = 'available' and seat.valid_until > $2::timestamptz) as available,
              count(*) filter (where seat.status = 'assigned') as assigned,
              count(*) filter (where seat.status = 'available' and seat.valid_until <= $2::timestamptz) as expired,
              min(seat.valid_until) filter (where seat.status = 'available' and seat.valid_until > $2::timestamptz) as next_expiry
       from public.company_training_seats seat
       inner join public.learning_courses course on course.id = seat.course_id
       where seat.company_id = $1::uuid and seat.status in ('available', 'assigned')
       group by seat.course_id, course.title, course.slug
       order by lower(course.title)`,
      [companyId, now.toISOString()],
    )
    return rows.map((row) => ({
      courseId: String(row.course_id),
      courseTitle: String(row.course_title ?? ''),
      courseSlug: row.course_slug ? String(row.course_slug) : null,
      available: count(row.available),
      assigned: count(row.assigned),
      expired: count(row.expired),
      nextExpiry: iso(row.next_expiry),
    }))
  }

  /** The organization's page slug (payment return page). */
  async function companySlug(companyId: string) {
    const rows = await query('select slug from public.companies where id = $1::uuid', [companyId])
    return rows[0]?.slug ? String(rows[0].slug) : null
  }

  return { company, buyableCourses, seatPacks, seatSummary, companySlug }
}

export const trainingRepository = createTrainingRepository()
