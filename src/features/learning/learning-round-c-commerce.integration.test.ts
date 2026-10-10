import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { QueryResultRow } from 'pg'
import { createTestDatabase, type TestDatabase } from '@/lib/db/test-database'

/**
 * Learning round C (C2 promo codes, C3 pricing plans and access expiry) against the real schema (PGlite), through the
 * real checkout code: the amount is worked out on the server, a code's use is reserved atomically, the platform
 * fee is charged on the discounted price, and time-limited access ends, stays read-only, and renews.
 */

let db: TestDatabase

// The checkout code talks to '@/lib/db/client'; here it talks to the PGlite database.
vi.mock('@/lib/db/client', () => ({
  query: (text: string, values?: readonly unknown[]) => db.query(text, values),
  withTransaction: <T,>(work: (client: { query: (text: string, values?: readonly unknown[]) => Promise<{ rows: QueryResultRow[] }> }) => Promise<T>) =>
    db.transaction((query) => work({ query: async (text, values) => ({ rows: await query(text, values) }) })),
}))

const { coursePaymentRepository, CoursePurchaseError } = await import('./course-payment-repository')
const { createLearnerCourseRepository } = await import('./learner-course-repository')
const fixtures = await import('./learning-test-fixtures')

beforeAll(async () => {
  db = await createTestDatabase()
}, 120_000)

afterAll(async () => {
  await db?.close()
})

type Course = Awaited<ReturnType<typeof fixtures.createPublishedCourse>>

async function buyer(label: string) {
  return fixtures.createProfile(db.query, label)
}

async function code(mentorId: string, values: Record<string, unknown>) {
  const record = { mentor_id: mentorId, discount_type: 'percent', percent_off: 20, ...values }
  const columns = Object.keys(record)
  const rows = await db.query(
    `insert into public.learning_promo_codes (${columns.join(', ')}) values (${columns.map((_, index) => `$${index + 1}`).join(', ')}) returning id`,
    Object.values(record),
  )
  return rows[0]!.id as string
}

async function checkout(profileId: string, course: Course, options: { promoCode?: string; planId?: string | null; now?: Date } = {}) {
  return coursePaymentRepository.prepareCheckoutOrder({ profileId, courseId: course.courseId, provider: 'cashfree', currencies: ['INR', 'USD'], billing: { stateCode: '27', country: 'US' }, ...options })
}

/** A pg-shaped client over one PGlite transaction (what confirmPaidOrder runs in). */
function pgClient(query: (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>) {
  return {
    async query<T extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]) {
      return { rows: await query(text, values) as T[] }
    },
  }
}

async function pay(orderId: string, amountMinor: number, now = new Date()) {
  return db.transaction((query) => coursePaymentRepository.confirmPaidOrder(
    pgClient(query),
    { orderId, providerPaymentId: `pay_${orderId.slice(0, 8)}`, amountMinor, currency: 'INR', now },
  ))
}

function refusal(promise: Promise<unknown>) {
  return promise.then(() => 'ok', (error: unknown) => (error instanceof CoursePurchaseError ? error.code : String(error)))
}

describe('promo codes at checkout (C2)', () => {
  it('takes 20% off on the server, charges the fee on the discounted price, and counts one use when paid', async () => {
    const mentor = await fixtures.createActiveMentor(db.query)
    const course = await fixtures.createPublishedCourse(db.query, mentor, { priceMinor: 100_000 })
    const codeId = await code(mentor.mentorId, { course_id: course.courseId, code: 'SIRE20' })
    const learner = await buyer('Fixture Buyer A')

    const { order } = await checkout(learner, course, { promoCode: ' sire20 ' })
    expect(order).toMatchObject({ listPriceMinor: 100_000, amountMinor: 80_000, promoCode: 'SIRE20', promoDiscountMinor: 20_000 })
    expect(await db.query(`select status from public.learning_promo_redemptions where order_id = $1`, [order.id])).toEqual([{ status: 'reserved' }])

    const outcome = await pay(order.id, 80_000)
    expect(outcome.state).toBe('enrolled')
    expect(await db.query(`select status from public.learning_promo_redemptions where order_id = $1`, [order.id])).toEqual([{ status: 'redeemed' }])
    expect(await db.query(`select used_count from public.learning_promo_codes where id = $1`, [codeId])).toEqual([{ used_count: 1 }])
    const earning = await db.query(
      `select gross_minor::int, platform_fee_minor::int, net_minor::int from public.seller_earnings where source_type = 'course_purchase' and source_id = $1`,
      [order.id],
    )
    expect(earning).toEqual([{ gross_minor: 80_000, platform_fee_minor: 8_000, net_minor: 72_000 }])
  }, 120_000)

  it('refuses an expired code, a code that has not started, a code for another course and an unknown code', async () => {
    const mentor = await fixtures.createActiveMentor(db.query)
    const course = await fixtures.createPublishedCourse(db.query, mentor, { priceMinor: 50_000 })
    const other = await fixtures.createPublishedCourse(db.query, mentor, { priceMinor: 50_000 })
    await code(mentor.mentorId, { course_id: course.courseId, code: 'OLD10', valid_until: new Date(Date.now() - 60_000).toISOString() })
    await code(mentor.mentorId, { course_id: course.courseId, code: 'SOON10', valid_from: new Date(Date.now() + 86_400_000).toISOString() })
    await code(mentor.mentorId, { course_id: other.courseId, code: 'OTHER10' })
    const learner = await buyer('Fixture Buyer B')

    expect(await refusal(checkout(learner, course, { promoCode: 'OLD10' }))).toBe('promo_expired')
    expect(await refusal(checkout(learner, course, { promoCode: 'SOON10' }))).toBe('promo_not_started')
    expect(await refusal(checkout(learner, course, { promoCode: 'OTHER10' }))).toBe('promo_not_found')
    expect(await refusal(checkout(learner, course, { promoCode: 'NOPE' }))).toBe('promo_not_found')
    // Another trainer's code with the same text is not this course's code.
    const stranger = await fixtures.createActiveMentor(db.query)
    await code(stranger.mentorId, { code: 'EVERY50', percent_off: 50 })
    expect(await refusal(checkout(learner, course, { promoCode: 'EVERY50' }))).toBe('promo_not_found')
    expect(await db.query(`select count(*)::int as count from public.course_payment_orders where profile_id = $1`, [learner])).toEqual([{ count: 0 }])
  }, 120_000)

  it('refuses an exhausted code and a member reusing a code beyond their limit', async () => {
    const mentor = await fixtures.createActiveMentor(db.query)
    const first = await fixtures.createPublishedCourse(db.query, mentor, { priceMinor: 60_000 })
    const second = await fixtures.createPublishedCourse(db.query, mentor, { priceMinor: 60_000 })
    await code(mentor.mentorId, { course_id: first.courseId, code: 'ONCE', usage_limit: 1 })
    await code(mentor.mentorId, { code: 'EVERY10', percent_off: 10, per_member_limit: 1 })
    const a = await buyer('Fixture Buyer C')
    const b = await buyer('Fixture Buyer D')

    const paid = await checkout(a, first, { promoCode: 'ONCE' })
    await pay(paid.order.id, paid.order.amountMinor)
    expect(await refusal(checkout(b, first, { promoCode: 'ONCE' }))).toBe('promo_exhausted')

    // All of this trainer's courses, once per member: the second course with the same code is refused.
    const reuseFirst = await checkout(b, first, { promoCode: 'EVERY10' })
    await pay(reuseFirst.order.id, reuseFirst.order.amountMinor)
    expect(await refusal(checkout(b, second, { promoCode: 'EVERY10' }))).toBe('promo_member_limit')
    // The same member can still buy without the code.
    await expect(checkout(b, second)).resolves.toMatchObject({ order: { amountMinor: 60_000, promoCode: null } })
  }, 120_000)

  it('gives the last use to exactly one of two buyers checking out at the same time, and frees it if that checkout fails', async () => {
    const mentor = await fixtures.createActiveMentor(db.query)
    const course = await fixtures.createPublishedCourse(db.query, mentor, { priceMinor: 40_000 })
    await code(mentor.mentorId, { course_id: course.courseId, code: 'LAST1', usage_limit: 1 })
    const a = await buyer('Fixture Buyer E')
    const b = await buyer('Fixture Buyer F')

    const results = await Promise.allSettled([checkout(a, course, { promoCode: 'LAST1' }), checkout(b, course, { promoCode: 'LAST1' })])
    const won = results.filter((result) => result.status === 'fulfilled')
    const lost = results.filter((result) => result.status === 'rejected') as PromiseRejectedResult[]
    expect(won).toHaveLength(1)
    expect(lost).toHaveLength(1)
    expect((lost[0]!.reason as InstanceType<typeof CoursePurchaseError>).code).toBe('promo_exhausted')
    expect(await db.query(`select count(*)::int as count from public.learning_promo_redemptions redemption join public.learning_promo_codes code on code.id = redemption.code_id where code.code = 'LAST1' and redemption.status <> 'released'`)).toEqual([{ count: 1 }])

    // The winner's payment fails: the use comes back and the other buyer can take it.
    const winner = (won[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof checkout>>>).value.order
    await coursePaymentRepository.markOrderFailed(winner.id, 'provider_order_failed')
    const loser = winner.profileId === a ? b : a
    await expect(checkout(loser, course, { promoCode: 'LAST1' })).resolves.toMatchObject({ order: { promoCode: 'LAST1', amountMinor: 32_000 } })
  }, 120_000)

  it('never brings the price below ₹1, caps at the maximum discount, and refuses a fixed code in another currency', async () => {
    const mentor = await fixtures.createActiveMentor(db.query)
    const course = await fixtures.createPublishedCourse(db.query, mentor, { priceMinor: 50_000 })
    await code(mentor.mentorId, { course_id: course.courseId, code: 'FREE100', percent_off: 100 })
    await code(mentor.mentorId, { course_id: course.courseId, code: 'HALFMAX', percent_off: 50, max_discount_minor: 10_000, currency: 'INR' })
    await code(mentor.mentorId, { course_id: course.courseId, code: 'USD5', discount_type: 'fixed', percent_off: null, amount_off_minor: 500, currency: 'USD' })
    // One buyer per checkout: a second checkout within a minute of an unfinished one is refused as "in progress".
    await expect(checkout(await buyer('Fixture Buyer G1'), course, { promoCode: 'FREE100' })).resolves.toMatchObject({ order: { amountMinor: 100, promoDiscountMinor: 49_900 } })
    await expect(checkout(await buyer('Fixture Buyer G2'), course, { promoCode: 'HALFMAX' })).resolves.toMatchObject({ order: { amountMinor: 40_000, promoDiscountMinor: 10_000 } })
    const learner = await buyer('Fixture Buyer G3')
    expect(await refusal(checkout(learner, course, { promoCode: 'USD5' }))).toBe('promo_currency')
    // A preview applies the same rules without reserving anything.
    await expect(coursePaymentRepository.previewCheckout({ profileId: learner, courseId: course.courseId, promoCode: 'halfmax' })).resolves.toMatchObject({ amountMinor: 40_000 })
    expect(await db.query(`select count(*)::int as count from public.learning_promo_redemptions where profile_id = $1`, [learner])).toEqual([{ count: 0 }])
  }, 120_000)
})

describe('pricing plans and access expiry (C3)', () => {
  async function planCourse() {
    const mentor = await fixtures.createActiveMentor(db.query)
    const course = await fixtures.createPublishedCourse(db.query, mentor, { priceMinor: 90_000 })
    const standard = await db.query(
      `insert into public.learning_course_plans (course_id, name, price_minor, currency, access_months, position) values ($1, 'Standard', 90000, 'INR', null, 0) returning id`,
      [course.courseId],
    )
    const sixMonths = await db.query(
      `insert into public.learning_course_plans (course_id, name, price_minor, discount_price_minor, currency, access_months, position) values ($1, 'Self-paced', 30000, 25000, 'INR', 6, 1) returning id`,
      [course.courseId],
    )
    return { mentor, course, standardId: standard[0]!.id as string, sixMonthsId: sixMonths[0]!.id as string }
  }

  it('sells a plan at its own price and access period, ends access read-only, and renews from the end or from now', async () => {
    const { course, sixMonthsId } = await planCourse()
    const learner = await buyer('Fixture Buyer H')
    const start = new Date()
    const { order } = await checkout(learner, course, { planId: sixMonthsId, now: start })
    expect(order).toMatchObject({ planId: sixMonthsId, planName: 'Self-paced', accessMonths: 6, listPriceMinor: 30_000, amountMinor: 25_000 })
    await pay(order.id, 25_000, start)
    const enrolled = await db.query(`select id, plan_id, access_expires_at from public.learning_enrollments where learner_id = $1 and course_id = $2`, [learner, course.courseId])
    expect(enrolled[0]).toMatchObject({ plan_id: sixMonthsId })
    const expiresAt = new Date(enrolled[0]!.access_expires_at as string)
    const expected = new Date(start)
    expected.setUTCMonth(expected.getUTCMonth() + 6)
    expect(Math.abs(expiresAt.getTime() - expected.getTime())).toBeLessThan(60_000)

    // Renewing early extends from the current end (no days lost).
    const early = await checkout(learner, course, { planId: sixMonthsId })
    await pay(early.order.id, 25_000)
    const extended = new Date((await db.query(`select access_expires_at from public.learning_enrollments where id = $1`, [enrolled[0]!.id]))[0]!.access_expires_at as string)
    expect(Math.round((extended.getTime() - expiresAt.getTime()) / 86_400_000)).toBeGreaterThanOrEqual(181)

    // Access ends: the outline, progress and results stay; every material is closed and nothing new is recorded.
    await fixtures.completeLessons(db.query, String(enrolled[0]!.id), [course.lessons.intro!])
    await db.query(`update public.learning_enrollments set access_expires_at = now() - interval '1 day' where id = $1`, [enrolled[0]!.id])
    const player = await createLearnerCourseRepository({ query: db.query }).getLearnerCourse(learner, course.slug)
    expect(player).toMatchObject({ accessExpired: true, completedLessons: 1 })
    expect(player!.sections.flatMap((section) => section.lessons).every((lesson) => !lesson.isAvailable && lesson.lockReason === 'access_expired' && lesson.articleBody === null)).toBe(true)
    const { createLearnerProgressRepository } = await import('./learner-progress-repository')
    await createLearnerProgressRepository({ transaction: db.transaction }).completeLesson(learner, course.slug, course.lessons.checklist!).catch(() => null)
    expect(await db.query(`select 1 from public.learning_progress where enrollment_id = $1 and lesson_id = $2 and completed`, [enrolled[0]!.id, course.lessons.checklist])).toEqual([])

    // Renewing after the end runs from now.
    const renewal = await checkout(learner, course, { planId: sixMonthsId })
    await pay(renewal.order.id, 25_000)
    const renewedTo = new Date((await db.query(`select access_expires_at from public.learning_enrollments where id = $1`, [enrolled[0]!.id]))[0]!.access_expires_at as string)
    const fromNow = new Date()
    fromNow.setUTCMonth(fromNow.getUTCMonth() + 6)
    expect(Math.abs(renewedTo.getTime() - fromNow.getTime())).toBeLessThan(120_000)
    expect((await createLearnerCourseRepository({ query: db.query }).getLearnerCourse(learner, course.slug))?.accessExpired).toBe(false)
  }, 120_000)

  it('keeps lifetime access exactly as before: a lifetime buyer cannot buy again, and a plan from another course is refused', async () => {
    const { course, standardId } = await planCourse()
    const other = await planCourse()
    const learner = await buyer('Fixture Buyer I')
    const { order } = await checkout(learner, course, { planId: standardId })
    await pay(order.id, 90_000)
    expect(await db.query(`select access_expires_at from public.learning_enrollments where learner_id = $1 and course_id = $2`, [learner, course.courseId])).toEqual([{ access_expires_at: null }])
    expect(await refusal(checkout(learner, course, { planId: standardId }))).toBe('already_enrolled')
    const someoneElse = await buyer('Fixture Buyer J')
    expect(await refusal(checkout(someoneElse, course, { planId: other.sixMonthsId }))).toBe('plan_not_found')
  }, 120_000)

  it('gives existing paid courses one Standard lifetime plan at their price (backfill), and existing buyers stay lifetime', async () => {
    const mentor = await fixtures.createActiveMentor(db.query)
    const course = await fixtures.createPublishedCourse(db.query, mentor, { priceMinor: 70_000 })
    const before = await fixtures.enrollLearner(db.query, course.courseId, 'Fixture Buyer K')
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const statements = readFileSync(join(process.cwd(), 'infra/aws/database/migrations/0075_learning_round_c.sql'), 'utf8')
      .split('-- statement-breakpoint')
      .filter((statement) => /insert into public\.learning_course_plans/.test(statement))
    expect(statements).toHaveLength(2)
    for (const statement of statements) await db.query(statement)
    for (const statement of statements) await db.query(statement)
    expect(await db.query(`select name, price_minor::int, access_months, position from public.learning_course_plans where course_id = $1`, [course.courseId]))
      .toEqual([{ name: 'Standard', price_minor: 70_000, access_months: null, position: 0 }])
    expect(await db.query(`select plan_id, access_expires_at from public.learning_enrollments where id = $1`, [before.enrollmentId]))
      .toEqual([{ plan_id: null, access_expires_at: null }])
  }, 120_000)
})
