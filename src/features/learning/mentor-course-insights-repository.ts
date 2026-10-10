import type { QueryResultRow } from 'pg'
import { query as databaseQuery } from '@/lib/db/client'
import { isPaymentCurrency } from '@/features/payments/currency'
import type { PaymentCurrency } from '@/features/payments/types'
import { courseManagerAccessSql } from './course-access'
import { liveCourseSql } from './course-publication'

/**
 * Per-course insights for Learning Studio analytics (C8): lesson drop-off, quiz item difficulty and
 * monthly enrolments / revenue. Aggregate only: no learner name, email or id ever leaves these queries.
 * Every query is scoped to ONE live course the actor manages (courseManagerAccessSql + liveCourseSql),
 * so a course the actor does not manage, or a draft revision row, yields nothing.
 */

export type CourseInsightsQuery = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>

/** Month boundaries are Indian Standard Time, the platform's business time zone. */
export const INSIGHTS_TIME_ZONE = 'Asia/Kolkata'
export const INSIGHTS_MONTHS = 12

export type LessonFunnelStep = {
  lessonId: string
  title: string
  sectionTitle: string
  /** 1-based curriculum position across the whole course. */
  position: number
  reachedCount: number
  reachedPercent: number
  completedCount: number
  completedPercent: number
}

export type CourseLessonFunnel = {
  /** Non-revoked enrolments: the denominator for every percentage. */
  learnerCount: number
  lessons: LessonFunnelStep[]
}

export type QuizQuestionDifficulty = {
  questionId: string
  prompt: string
  questionType: string
  /** 1-based position within the quiz. */
  position: number
  /** Scored answers (auto-marked plus graded written answers). */
  answerCount: number
  /** Written answers still waiting for the trainer; not scored. */
  pendingCount: number
  /** Null until at least one scored answer exists. */
  correctPercent: number | null
  /** The lowest-scoring question of its quiz (only flagged when two or more questions have answers). */
  isHardest: boolean
}

export type QuizDifficulty = {
  quizId: string
  lessonId: string
  lessonTitle: string
  questions: QuizQuestionDifficulty[]
}

export type MonthlyEnrollmentBucket = {
  /** YYYY-MM in Asia/Kolkata. */
  month: string
  /** Every enrolment started that month, including ones revoked since. */
  enrollmentCount: number
  /** Of those, how many are revoked now. */
  revokedCount: number
}

export type MonthlyRevenueBucket = {
  month: string
  /** Confirmed sales paid this month (kept plus later refunded). */
  orderCount: number
  refundedOrderCount: number
  /** Everything charged for confirmed sales paid this month, refunds included. */
  grossMinor: number
  /** The part of grossMinor that has since been refunded. */
  refundedMinor: number
  /** Sea N Shore fee on the kept (not refunded) sales, from the seller earnings ledger. */
  platformFeeMinor: number
  /** Trainer / organization share of the kept sales, from the seller earnings ledger. */
  trainerNetMinor: number
}

export type CurrencyRevenue = {
  currency: PaymentCurrency
  months: MonthlyRevenueBucket[]
  totals: Omit<MonthlyRevenueBucket, 'month'>
}

export type CourseMonthlyTrend = {
  months: MonthlyEnrollmentBucket[]
  /** One entry per currency that sold in the window; INR and USD are never added together. */
  revenue: CurrencyRevenue[]
}

export type CourseInsights = {
  course: { id: string; title: string; slug: string }
  lessonFunnel: CourseLessonFunnel
  quizDifficulty: QuizDifficulty[]
  monthlyTrend: CourseMonthlyTrend
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function count(value: unknown) {
  const numeric = Number(value ?? 0)
  if (!Number.isFinite(numeric) || numeric <= 0) return 0
  return Math.round(numeric)
}

/** Money sums can be negative only through ledger adjustments; keep the sign, round to minor units. */
function minor(value: unknown) {
  const numeric = Number(value ?? 0)
  return Number.isFinite(numeric) ? Math.round(numeric) : 0
}

function percent(numerator: number, denominator: number) {
  if (denominator <= 0) return 0
  return Math.round((numerator / denominator) * 100)
}

function managedCourseSql(actorParam: string, courseParam: string) {
  return `select course.id, course.title, course.slug
    from public.learning_courses course
    where course.id = ${courseParam}::uuid
      and ${liveCourseSql('course')}
      and ${courseManagerAccessSql('course', actorParam)}`
}

const COURSE_LESSONS_SQL = `
  select
    lesson.id as lesson_id,
    lesson.title as lesson_title,
    section.title as section_title,
    section.position as section_position,
    lesson.position as lesson_position
  from managed_course course
  inner join public.learning_course_sections section
    on section.course_id = course.id
   and section.removed_at is null
  inner join public.learning_lessons lesson
    on lesson.section_id = section.id
   and lesson.is_published = true
   and lesson.removed_at is null`

function lessonFunnelSql() {
  return `with managed_course as (${managedCourseSql('$1', '$2')}),
    learners as (
      select enrollment.id
      from public.learning_enrollments enrollment
      inner join managed_course course on course.id = enrollment.course_id
      where enrollment.status <> 'revoked'
    ),
    course_lessons as (${COURSE_LESSONS_SQL}),
    lesson_progress as (
      select
        progress.lesson_id,
        count(*) filter (
          where progress.completed = true
             or progress.completed_at is not null
             or progress.viewed_at is not null
             or progress.first_started_at is not null
        )::bigint as reached_count,
        count(*) filter (where progress.completed = true)::bigint as completed_count
      from public.learning_progress progress
      inner join learners on learners.id = progress.enrollment_id
      inner join course_lessons lesson on lesson.lesson_id = progress.lesson_id
      group by progress.lesson_id
    )
    select
      (select count(*) from learners)::bigint as learner_count,
      lesson.lesson_id,
      lesson.lesson_title,
      lesson.section_title,
      coalesce(lesson_progress.reached_count, 0)::bigint as reached_count,
      coalesce(lesson_progress.completed_count, 0)::bigint as completed_count
    from course_lessons lesson
    left join lesson_progress on lesson_progress.lesson_id = lesson.lesson_id
    order by lesson.section_position asc, lesson.lesson_position asc, lesson.lesson_id asc`
}

function quizDifficultySql() {
  return `with managed_course as (${managedCourseSql('$1', '$2')}),
    course_lessons as (${COURSE_LESSONS_SQL}),
    course_quizzes as (
      select quiz.id as quiz_id, lesson.*
      from course_lessons lesson
      inner join public.learning_quizzes quiz on quiz.lesson_id = lesson.lesson_id
    ),
    live_questions as (
      select question.id, question.quiz_id, question.prompt, question.question_type, question.position, question.marks
      from public.learning_quiz_questions question
      inner join course_quizzes quiz on quiz.quiz_id = question.quiz_id
      where question.removed_at is null
    ),
    scored_answers as (
      select
        answer.question_id,
        answer.grading_status = 'pending' as is_pending,
        case
          when answer.grading_status = 'pending' then null
          when question.question_type = 'subjective' or answer.grading_status = 'graded' then
            least(1, greatest(0,
              coalesce(answer.points_awarded, 0)
              / nullif(coalesce(answer.max_points, question.marks), 0)
            ))
          when answer.is_correct then 1
          else 0
        end as score
      from public.learning_quiz_attempt_answers answer
      inner join live_questions question on question.id = answer.question_id
      inner join public.learning_quiz_attempts attempt
        on attempt.id = answer.attempt_id
       and attempt.quiz_id = question.quiz_id
      inner join public.learning_enrollments enrollment
        on enrollment.id = attempt.enrollment_id
       and enrollment.status <> 'revoked'
      inner join managed_course course on course.id = enrollment.course_id
    )
    select
      quiz.quiz_id,
      quiz.lesson_id,
      quiz.lesson_title,
      question.id as question_id,
      question.prompt,
      question.question_type,
      count(answer.score)::bigint as answer_count,
      count(*) filter (where answer.is_pending)::bigint as pending_count,
      avg(answer.score) as correct_ratio
    from course_quizzes quiz
    inner join live_questions question on question.quiz_id = quiz.quiz_id
    left join scored_answers answer on answer.question_id = question.id
    group by
      quiz.quiz_id, quiz.lesson_id, quiz.lesson_title, quiz.section_position, quiz.lesson_position,
      question.id, question.prompt, question.question_type, question.position
    order by quiz.section_position asc, quiz.lesson_position asc, quiz.quiz_id asc, question.position asc, question.id asc`
}

/** $3 = the reference instant; the window is its IST month and the 11 before it. */
const MONTH_WINDOW_SQL = `
  window_bounds as (
    select
      date_trunc('month', $3::timestamptz at time zone '${INSIGHTS_TIME_ZONE}') - interval '${INSIGHTS_MONTHS - 1} months' as first_month,
      date_trunc('month', $3::timestamptz at time zone '${INSIGHTS_TIME_ZONE}') + interval '1 month' as end_month
  ),
  window_range as (
    select
      first_month,
      end_month,
      first_month at time zone '${INSIGHTS_TIME_ZONE}' as starts_at,
      end_month at time zone '${INSIGHTS_TIME_ZONE}' as ends_at
    from window_bounds
  )`

function monthlyEnrollmentSql() {
  return `with managed_course as (${managedCourseSql('$1', '$2')}),
    ${MONTH_WINDOW_SQL},
    months as (
      select generate_series(first_month, end_month - interval '1 month', interval '1 month') as month_start
      from window_range
    ),
    enrolments as (
      select
        date_trunc('month', enrollment.enrolled_at at time zone '${INSIGHTS_TIME_ZONE}') as month_start,
        count(*)::bigint as enrollment_count,
        count(*) filter (where enrollment.status = 'revoked')::bigint as revoked_count
      from public.learning_enrollments enrollment
      inner join managed_course course on course.id = enrollment.course_id
      cross join window_range
      where enrollment.enrolled_at >= window_range.starts_at
        and enrollment.enrolled_at < window_range.ends_at
      group by 1
    )
    select
      to_char(months.month_start, 'YYYY-MM') as month,
      coalesce(enrolments.enrollment_count, 0)::bigint as enrollment_count,
      coalesce(enrolments.revoked_count, 0)::bigint as revoked_count
    from months
    cross join managed_course
    left join enrolments on enrolments.month_start = months.month_start
    order by months.month_start asc`
}

function monthlyRevenueSql() {
  return `with managed_course as (${managedCourseSql('$1', '$2')}),
    ${MONTH_WINDOW_SQL},
    sales as (
      select
        sale.id,
        sale.currency,
        sale.status,
        sale.amount_minor,
        date_trunc('month', sale.paid_at at time zone '${INSIGHTS_TIME_ZONE}') as month_start
      from public.course_payment_orders sale
      inner join managed_course course on course.id = sale.course_id
      cross join window_range
      where sale.status in ('paid', 'refunded')
        and sale.enrollment_confirmed_at is not null
        and sale.paid_at >= window_range.starts_at
        and sale.paid_at < window_range.ends_at
    )
    select
      to_char(sales.month_start, 'YYYY-MM') as month,
      sales.currency,
      count(*)::bigint as order_count,
      count(*) filter (where sales.status = 'refunded')::bigint as refunded_order_count,
      coalesce(sum(sales.amount_minor), 0)::bigint as gross_minor,
      coalesce(sum(sales.amount_minor) filter (where sales.status = 'refunded'), 0)::bigint as refunded_minor,
      coalesce(sum(earning.platform_fee_minor) filter (where sales.status = 'paid'), 0)::bigint as platform_fee_minor,
      coalesce(sum(earning.net_minor) filter (where sales.status = 'paid'), 0)::bigint as trainer_net_minor
    from sales
    left join public.seller_earnings earning
      on earning.source_type = 'course_purchase'
     and earning.source_id = sales.id::text
     and earning.status <> 'reversed'
    group by sales.month_start, sales.currency
    order by sales.currency asc, sales.month_start asc`
}

function mapFunnel(rows: QueryResultRow[]): CourseLessonFunnel {
  const learnerCount = count(rows[0]?.learner_count)
  return {
    learnerCount,
    lessons: rows.map((row, index) => {
      const reachedCount = count(row.reached_count)
      const completedCount = count(row.completed_count)
      return {
        lessonId: String(row.lesson_id),
        title: String(row.lesson_title),
        sectionTitle: String(row.section_title),
        position: index + 1,
        reachedCount,
        reachedPercent: percent(reachedCount, learnerCount),
        completedCount,
        completedPercent: percent(completedCount, learnerCount),
      }
    }),
  }
}

function mapQuizzes(rows: QueryResultRow[]): QuizDifficulty[] {
  const quizzes = new Map<string, QuizDifficulty>()
  for (const row of rows) {
    const quizId = String(row.quiz_id)
    let quiz = quizzes.get(quizId)
    if (!quiz) {
      quiz = { quizId, lessonId: String(row.lesson_id), lessonTitle: String(row.lesson_title), questions: [] }
      quizzes.set(quizId, quiz)
    }
    const answerCount = count(row.answer_count)
    const ratio = Number(row.correct_ratio)
    quiz.questions.push({
      questionId: String(row.question_id),
      prompt: String(row.prompt),
      questionType: String(row.question_type),
      position: quiz.questions.length + 1,
      answerCount,
      pendingCount: count(row.pending_count),
      correctPercent: answerCount > 0 && Number.isFinite(ratio) ? Math.round(ratio * 100) : null,
      isHardest: false,
    })
  }
  for (const quiz of quizzes.values()) {
    const answered = quiz.questions.filter((question) => question.correctPercent !== null)
    if (answered.length < 2) continue
    const lowest = Math.min(...answered.map((question) => question.correctPercent!))
    if (answered.every((question) => question.correctPercent === lowest)) continue
    for (const question of answered) question.isHardest = question.correctPercent === lowest
  }
  return [...quizzes.values()]
}

function emptyRevenueTotals(): Omit<MonthlyRevenueBucket, 'month'> {
  return { orderCount: 0, refundedOrderCount: 0, grossMinor: 0, refundedMinor: 0, platformFeeMinor: 0, trainerNetMinor: 0 }
}

function mapTrend(enrollmentRows: QueryResultRow[], revenueRows: QueryResultRow[]): CourseMonthlyTrend {
  const months: MonthlyEnrollmentBucket[] = enrollmentRows.map((row) => ({
    month: String(row.month),
    enrollmentCount: count(row.enrollment_count),
    revokedCount: count(row.revoked_count),
  }))
  const byCurrency = new Map<PaymentCurrency, Map<string, MonthlyRevenueBucket>>()
  for (const row of revenueRows) {
    const currency = String(row.currency)
    if (!isPaymentCurrency(currency)) continue
    const buckets = byCurrency.get(currency) ?? new Map<string, MonthlyRevenueBucket>()
    buckets.set(String(row.month), {
      month: String(row.month),
      orderCount: count(row.order_count),
      refundedOrderCount: count(row.refunded_order_count),
      grossMinor: minor(row.gross_minor),
      refundedMinor: minor(row.refunded_minor),
      platformFeeMinor: minor(row.platform_fee_minor),
      trainerNetMinor: minor(row.trainer_net_minor),
    })
    byCurrency.set(currency, buckets)
  }
  const revenue: CurrencyRevenue[] = [...byCurrency.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, buckets]) => {
      const filled = months.map(({ month }) => buckets.get(month) ?? { month, ...emptyRevenueTotals() })
      const totals = filled.reduce((sum, bucket) => ({
        orderCount: sum.orderCount + bucket.orderCount,
        refundedOrderCount: sum.refundedOrderCount + bucket.refundedOrderCount,
        grossMinor: sum.grossMinor + bucket.grossMinor,
        refundedMinor: sum.refundedMinor + bucket.refundedMinor,
        platformFeeMinor: sum.platformFeeMinor + bucket.platformFeeMinor,
        trainerNetMinor: sum.trainerNetMinor + bucket.trainerNetMinor,
      }), emptyRevenueTotals())
      return { currency, months: filled, totals }
    })
  return { months, revenue }
}

export function createMentorCourseInsightsRepository(input: { query?: CourseInsightsQuery } = {}) {
  const queryRows: CourseInsightsQuery = input.query ?? ((text, values) => databaseQuery<QueryResultRow>(text, values))

  /**
   * Insights for one live course the actor manages, or null when the course is not theirs (or not live).
   * `now` fixes the 12-month window (its Asia/Kolkata month and the 11 before it).
   */
  async function getCourseInsights(
    actorUserId: string,
    courseId: string,
    options: { now?: Date } = {},
  ): Promise<CourseInsights | null> {
    if (!UUID_PATTERN.test(courseId)) return null
    const now = (options.now ?? new Date()).toISOString()
    const [courseRows, funnelRows, quizRows, enrollmentRows, revenueRows] = await Promise.all([
      queryRows(managedCourseSql('$1', '$2'), [actorUserId, courseId]),
      queryRows(lessonFunnelSql(), [actorUserId, courseId]),
      queryRows(quizDifficultySql(), [actorUserId, courseId]),
      queryRows(monthlyEnrollmentSql(), [actorUserId, courseId, now]),
      queryRows(monthlyRevenueSql(), [actorUserId, courseId, now]),
    ])
    const course = courseRows[0]
    if (!course) return null
    return {
      course: { id: String(course.id), title: String(course.title), slug: String(course.slug) },
      lessonFunnel: mapFunnel(funnelRows),
      quizDifficulty: mapQuizzes(quizRows),
      monthlyTrend: mapTrend(enrollmentRows, revenueRows),
    }
  }

  return { getCourseInsights }
}

export const mentorCourseInsightsRepository = createMentorCourseInsightsRepository()
