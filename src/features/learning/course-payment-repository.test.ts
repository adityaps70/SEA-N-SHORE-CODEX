import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  query: vi.fn(),
  txQuery: vi.fn(),
}))

vi.mock('@/lib/db/client', () => ({
  query: db.query,
  withTransaction: async (callback: (client: { query: typeof db.txQuery }) => unknown) => callback({ query: db.txQuery }),
}))

import { checkoutBlocker, coursePaymentRepository, type LockedCourse } from './course-payment-repository'

const profileId = '11111111-1111-4111-8111-111111111111'
const courseId = '22222222-2222-4222-8222-222222222222'
const orderId = '33333333-3333-4333-8333-333333333333'
const enrollmentId = '44444444-4444-4444-8444-444444444444'
const mentorProfileId = '55555555-5555-4555-8555-555555555555'
const companyId = '66666666-6666-4666-8666-666666666666'
const now = new Date('2030-01-01T10:00:00.000Z')

const courseRow = {
  id: courseId,
  title: 'SIRE 2.0 Masterclass',
  access_type: 'paid',
  price_minor: '500000',
  discount_price_minor: '400000',
  currency: 'INR',
  company_id: null,
  seller_profile_id: mentorProfileId,
  visible: true,
  is_manager: false,
}

function orderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: orderId,
    course_id: courseId,
    profile_id: profileId,
    course_title: 'SIRE 2.0 Masterclass',
    list_price_minor: '500000',
    discount_price_minor: '400000',
    amount_minor: '400000',
    currency: 'INR',
    provider: 'cashfree',
    provider_order_id: 'crs_33333333333343338333333333333333',
    provider_payment_id: null,
    provider_session_id: 'session_1',
    status: 'created',
    enrollment_id: null,
    enrollment_confirmed_at: null,
    refund_due_reason: null,
    failure_reason: null,
    paid_at: null,
    refunded_at: null,
    refund_status: null,
    refund_attempts: 0,
    provider_refund_id: null,
    created_at: '2030-01-01T09:55:00.000Z',
    ...overrides,
  }
}

function earningRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '77777777-7777-4777-8777-777777777777',
    seller_profile_id: mentorProfileId,
    seller_company_id: null,
    source_type: 'course_purchase',
    source_id: orderId,
    adjusts_earning_id: null,
    currency: 'INR',
    gross_minor: '400000',
    platform_fee_percent: '10.00',
    platform_fee_minor: '40000',
    net_minor: '360000',
    status: 'pending',
    available_at: '2030-01-08T10:00:00.000Z',
    payout_id: null,
    reversed_reason: null,
    created_at: now.toISOString(),
    ...overrides,
  }
}

type Scenario = {
  course?: Record<string, unknown> | null
  enrollment?: Record<string, unknown> | null
  openOrder?: Record<string, unknown> | null
  lockedOrder?: Record<string, unknown> | null
  earning?: Record<string, unknown> | null
  refundRequestStale?: boolean
}

/** Answers each SQL statement by what it does, so the tests do not depend on call order. */
function scenario(input: Scenario) {
  db.txQuery.mockImplementation(async (sql: string, values: unknown[]) => {
    const text = sql.replace(/\s+/g, ' ')
    if (text.includes('from public.learning_courses course') && text.includes('for update of course')) return { rows: input.course === null ? [] : [input.course ?? courseRow] }
    if (text.includes('from public.learning_enrollments where course_id = $1::uuid and learner_id = $2::uuid for update')) return { rows: input.enrollment ? [input.enrollment] : [] }
    if (text.includes("o.status = 'created' for update")) return { rows: input.openOrder ? [input.openOrder] : [] }
    if (text.includes('where o.id = $1::uuid for update')) return { rows: input.lockedOrder ? [input.lockedOrder] : [] }
    if (text.includes('from public.platform_fee_settings')) return { rows: [{ default_percent: '10.00', hold_days: 7 }] }
    if (text.includes('from public.seller_fee_overrides')) return { rows: [] }
    if (text.includes('insert into public.seller_earnings')) {
      return { rows: [earningRow({ seller_profile_id: values[0], seller_company_id: values[1], gross_minor: values[5], platform_fee_minor: values[7], net_minor: values[8], available_at: values[9] })] }
    }
    if (text.includes('from public.seller_earnings where source_type = $1::text and source_id = $2::text for update')) return { rows: input.earning ? [input.earning] : [] }
    if (text.includes("set status = 'reversed'")) return { rows: [{ ...input.earning, status: 'reversed' }] }
    if (text.includes('refund_requested_at < now()')) return { rows: [{ stale: Boolean(input.refundRequestStale) }] }
    if (text.includes("set refund_status = 'requested'")) return { rows: [orderRow({ ...input.lockedOrder, refund_status: 'requested', refund_attempts: Number(input.lockedOrder?.refund_attempts ?? 0) + 1 })] }
    if (text.includes("update public.course_payment_orders o set status = 'refunded'")) return { rows: [orderRow({ ...input.lockedOrder, status: 'refunded', refund_status: values[1] ?? 'processed', provider_refund_id: values[2] })] }
    if (text.includes("set status = 'revoked'")) return { rows: input.enrollment ? [{ id: input.enrollment.id }] : [] }
    if (text.includes('insert into public.course_payment_orders')) {
      return { rows: [orderRow({ provider_order_id: null, list_price_minor: values[3], discount_price_minor: values[4], amount_minor: values[5], currency: values[6], provider: values[7], created_at: now.toISOString() })] }
    }
    if (text.includes('set refund_due_reason')) return { rows: [orderRow({ status: 'paid', provider_payment_id: 'cf_pay_1', paid_at: now.toISOString(), refund_due_reason: values[1] })] }
    if (text.includes('insert into public.learning_enrollments')) return { rows: [{ id: enrollmentId }] }
    if (text.includes("enrollment_source = 'purchase', revoked_at = null")) return { rows: [{ id: values[0] }] }
    if (text.includes('set enrollment_id = $2::uuid, enrollment_confirmed_at = now()')) {
      return { rows: [orderRow({ status: 'paid', provider_payment_id: 'cf_pay_1', paid_at: now.toISOString(), enrollment_id: values[1], enrollment_confirmed_at: now.toISOString() })] }
    }
    return { rows: [] }
  })
}

function auditActions() {
  return db.txQuery.mock.calls
    .filter((call) => String(call[0]).includes('insert into public.payment_audit_events'))
    .map((call) => (call[1] as unknown[])[4])
}

function sqlCalls() {
  return db.txQuery.mock.calls.map((call) => String(call[0]).replace(/\s+/g, ' '))
}

function callWith(fragment: string) {
  return db.txQuery.mock.calls.find((call) => String(call[0]).replace(/\s+/g, ' ').includes(fragment))
}

beforeEach(() => {
  db.query.mockReset()
  db.txQuery.mockReset()
})

describe('course payment repository: purchase rules', () => {
  const locked: LockedCourse = {
    id: courseId,
    title: 'SIRE 2.0 Masterclass',
    visible: true,
    isManager: false,
    accessType: 'paid',
    price: { amountMinor: 400000, listPriceMinor: 500000, discountPriceMinor: 400000, currency: 'INR' },
    currency: 'INR',
    companyId: null,
    sellerProfileId: mentorProfileId,
  }

  it('lets a learner buy a published paid course and explains every refusal', () => {
    expect(checkoutBlocker(locked, null, ['INR'])).toBeNull()
    expect(checkoutBlocker(null, null)).toBe('course_not_found')
    expect(checkoutBlocker({ ...locked, visible: false }, null)).toBe('course_not_found')
    expect(checkoutBlocker({ ...locked, accessType: 'free' }, null)).toBe('course_not_paid')
    expect(checkoutBlocker({ ...locked, isManager: true }, null)).toBe('course_team_has_access')
    expect(checkoutBlocker(locked, { id: enrollmentId, status: 'active', enrollment_source: 'free' })).toBe('already_enrolled')
    expect(checkoutBlocker(locked, { id: enrollmentId, status: 'revoked', enrollment_source: 'free' })).toBe('enrollment_revoked')
    expect(checkoutBlocker({ ...locked, price: null, currency: 'EUR' }, null)).toBe('course_currency_unsupported')
    expect(checkoutBlocker({ ...locked, price: null }, null)).toBe('course_price_missing')
    expect(checkoutBlocker({ ...locked, price: { ...locked.price!, currency: 'USD' } }, null, ['INR'])).toBe('course_currency_unsupported')
  })

  it('allows buying again after a refund, and former team access does not count as owning the course', () => {
    expect(checkoutBlocker(locked, { id: enrollmentId, status: 'revoked', enrollment_source: 'purchase' })).toBeNull()
    expect(checkoutBlocker(locked, { id: enrollmentId, status: 'active', enrollment_source: 'admin' })).toBeNull()
  })
})

describe('course payment repository: starting checkout', () => {
  it('records a new order with a snapshot of the list and discount price, charging the discount', async () => {
    scenario({})
    const result = await coursePaymentRepository.prepareCheckoutOrder({ profileId, courseId, provider: 'cashfree', currencies: ['INR'], now })
    expect(result.reused).toBe(false)
    expect(result.order).toMatchObject({ amountMinor: 400000, listPriceMinor: 500000, discountPriceMinor: 400000, currency: 'INR', status: 'created' })
    expect(callWith('insert into public.course_payment_orders')?.[1]).toEqual([courseId, profileId, 'SIRE 2.0 Masterclass', 500000, 400000, 400000, 'INR', 'cashfree'])
    expect(sqlCalls()[0]).toContain('for update of course')
    expect(auditActions()).toEqual(['checkout_started'])
  })

  it('charges the list price when the discount is not lower than it', async () => {
    scenario({ course: { ...courseRow, discount_price_minor: '500000' } })
    const result = await coursePaymentRepository.prepareCheckoutOrder({ profileId, courseId, provider: 'cashfree', now })
    expect(result.order).toMatchObject({ amountMinor: 500000, discountPriceMinor: null })
  })

  it('refuses a learner who already has the course, without creating an order', async () => {
    scenario({ enrollment: { id: enrollmentId, status: 'active', enrollment_source: 'purchase' } })
    await expect(coursePaymentRepository.prepareCheckoutOrder({ profileId, courseId, provider: 'cashfree', now }))
      .rejects.toMatchObject({ code: 'already_enrolled' })
    expect(sqlCalls().some((sql) => sql.includes('insert into public.course_payment_orders'))).toBe(false)
  })

  it('refuses the course team and courses that are not on sale', async () => {
    scenario({ course: { ...courseRow, is_manager: true } })
    await expect(coursePaymentRepository.prepareCheckoutOrder({ profileId, courseId, provider: 'cashfree', now })).rejects.toMatchObject({ code: 'course_team_has_access' })
    scenario({ course: { ...courseRow, visible: false } })
    await expect(coursePaymentRepository.prepareCheckoutOrder({ profileId, courseId, provider: 'cashfree', now })).rejects.toMatchObject({ code: 'course_not_found' })
    scenario({ course: { ...courseRow, access_type: 'free', price_minor: '0', discount_price_minor: null } })
    await expect(coursePaymentRepository.prepareCheckoutOrder({ profileId, courseId, provider: 'cashfree', now })).rejects.toMatchObject({ code: 'course_not_paid' })
  })

  it('reuses a recent open checkout at the same price (double click)', async () => {
    scenario({ openOrder: orderRow() })
    const result = await coursePaymentRepository.prepareCheckoutOrder({ profileId, courseId, provider: 'cashfree', now })
    expect(result).toMatchObject({ reused: true, order: { id: orderId, providerOrderId: 'crs_33333333333343338333333333333333' } })
    expect(sqlCalls().some((sql) => sql.includes('insert into'))).toBe(false)
  })

  it('replaces an open checkout when the trainer changed the price', async () => {
    scenario({ openOrder: orderRow({ amount_minor: '450000', discount_price_minor: '450000' }) })
    const result = await coursePaymentRepository.prepareCheckoutOrder({ profileId, courseId, provider: 'cashfree', now })
    expect(result.reused).toBe(false)
    expect(sqlCalls().some((sql) => sql.includes("set status = 'cancelled', failure_reason = 'superseded'"))).toBe(true)
    expect(auditActions()).toEqual(['checkout_superseded', 'checkout_started'])
  })

  it('turns a concurrent duplicate checkout into a clear retry message', async () => {
    db.txQuery.mockImplementation(async (sql: string) => {
      const text = String(sql).replace(/\s+/g, ' ')
      if (text.includes('insert into public.course_payment_orders')) throw Object.assign(new Error('duplicate key'), { code: '23505' })
      if (text.includes('for update of course')) return { rows: [courseRow] }
      return { rows: [] }
    })
    await expect(coursePaymentRepository.prepareCheckoutOrder({ profileId, courseId, provider: 'cashfree', now }))
      .rejects.toMatchObject({ code: 'checkout_in_progress' })
  })
})

describe('course payment repository: confirming payment', () => {
  const client = { query: db.txQuery }

  it('marks the order paid, enrolls the learner as a purchase and records the trainer’s earning in the same transaction', async () => {
    scenario({ lockedOrder: orderRow() })
    const outcome = await coursePaymentRepository.confirmPaidOrder(client, { orderId, providerPaymentId: 'cf_pay_1', amountMinor: 400000, currency: 'INR', now })
    expect(outcome.state).toBe('enrolled')
    expect(outcome.order).toMatchObject({ enrollmentId, status: 'paid' })
    const enroll = callWith('insert into public.learning_enrollments')
    expect(String(enroll?.[0])).toContain("'purchase', 'active'")
    expect(enroll?.[1]).toEqual([courseId, profileId, orderId])
    const earning = callWith('insert into public.seller_earnings')
    // seller = the mentor's profile, gross ₹4,000, fee 10% = ₹400, available 7 days after the payment.
    expect(earning?.[1]).toEqual(expect.arrayContaining([mentorProfileId, null, 'course_purchase', orderId, 'INR', 400000, 40000, 360000]))
    expect(auditActions()).toEqual(['paid', 'enrolled', 'earning_recorded'])
  })

  it('pays an organization course to the organization', async () => {
    scenario({ lockedOrder: orderRow(), course: { ...courseRow, company_id: companyId } })
    await coursePaymentRepository.confirmPaidOrder(client, { orderId, providerPaymentId: 'cf_pay_1', now })
    expect(callWith('insert into public.seller_earnings')?.[1]).toEqual(expect.arrayContaining([null, companyId, 'course_purchase']))
  })

  it('is idempotent: an order that is already paid is not changed again (webhook retry, double confirm)', async () => {
    scenario({ lockedOrder: orderRow({ status: 'paid', provider_payment_id: 'cf_pay_1', enrollment_confirmed_at: now.toISOString(), enrollment_id: enrollmentId }) })
    const outcome = await coursePaymentRepository.confirmPaidOrder(client, { orderId, providerPaymentId: 'cf_pay_1', now })
    expect(outcome.state).toBe('enrolled')
    expect(sqlCalls().filter((sql) => sql.startsWith(' update') || sql.startsWith('update') || sql.includes('insert into'))).toEqual([])
  })

  it('returns refunded for an order that was refunded, without enrolling', async () => {
    scenario({ lockedOrder: orderRow({ status: 'refunded' }) })
    await expect(coursePaymentRepository.confirmPaidOrder(client, { orderId, providerPaymentId: 'cf_pay_1' })).resolves.toMatchObject({ state: 'refunded' })
    expect(callWith('insert into public.learning_enrollments')).toBeUndefined()
  })

  it('keeps the money as refund due when the amount does not match the price', async () => {
    scenario({ lockedOrder: orderRow() })
    const outcome = await coursePaymentRepository.confirmPaidOrder(client, { orderId, providerPaymentId: 'cf_pay_1', amountMinor: 100, currency: 'INR', now })
    expect(outcome).toMatchObject({ state: 'refund_due', reason: 'amount_mismatch' })
    expect(callWith('insert into public.learning_enrollments')).toBeUndefined()
    expect(callWith('insert into public.seller_earnings')).toBeUndefined()
  })

  it('marks a duplicate payment refund due when the learner already has the course', async () => {
    scenario({ lockedOrder: orderRow(), enrollment: { id: enrollmentId, status: 'active', enrollment_source: 'purchase' } })
    const outcome = await coursePaymentRepository.confirmPaidOrder(client, { orderId, providerPaymentId: 'cf_pay_1', now })
    expect(outcome).toMatchObject({ state: 'refund_due', reason: 'already_enrolled' })
    expect(auditActions()).toEqual(['paid', 'refund_due'])
  })

  it('reopens the same enrollment (and its progress) when a refunded learner buys again', async () => {
    scenario({ lockedOrder: orderRow(), enrollment: { id: enrollmentId, status: 'revoked', enrollment_source: 'purchase' } })
    const outcome = await coursePaymentRepository.confirmPaidOrder(client, { orderId, providerPaymentId: 'cf_pay_1', now })
    expect(outcome.state).toBe('enrolled')
    expect(callWith('insert into public.learning_enrollments')).toBeUndefined()
    expect(callWith("enrollment_source = 'purchase', revoked_at = null")?.[1]).toEqual([enrollmentId, orderId])
  })
})

describe('course payment repository: refunds', () => {
  const client = { query: db.txQuery }
  const paidOrder = orderRow({ status: 'paid', provider_payment_id: 'cf_pay_1', enrollment_id: enrollmentId, enrollment_confirmed_at: now.toISOString() })

  it('marks the refund requested first so a double click cannot refund twice', async () => {
    scenario({ lockedOrder: paidOrder })
    await expect(coursePaymentRepository.requestRefund(client, { orderId, actor: { type: 'admin', profileId }, reason: 'admin_refund' }))
      .resolves.toMatchObject({ attempt: 1, order: { refundStatus: 'requested' } })

    scenario({ lockedOrder: { ...paidOrder, refund_status: 'requested', refund_attempts: 1 }, refundRequestStale: false })
    await expect(coursePaymentRepository.requestRefund(client, { orderId, actor: { type: 'admin', profileId }, reason: 'admin_refund' }))
      .rejects.toMatchObject({ code: 'refund_in_progress' })
  })

  it('refuses to refund an order that was never paid', async () => {
    scenario({ lockedOrder: orderRow() })
    await expect(coursePaymentRepository.requestRefund(client, { orderId, actor: { type: 'admin', profileId }, reason: 'x' }))
      .rejects.toMatchObject({ code: 'refund_not_allowed' })
  })

  it('ends the learner’s access and reverses the earning in the same transaction', async () => {
    scenario({ lockedOrder: paidOrder, enrollment: { id: enrollmentId }, earning: earningRow() })
    const order = await coursePaymentRepository.markOrderRefunded(client, orderId, { providerRefundId: 'cf_refund_1', refundStatus: 'processed', reason: 'admin_refund' })
    expect(order).toMatchObject({ status: 'refunded', refundStatus: 'processed', providerRefundId: 'cf_refund_1' })
    expect(callWith("set status = 'revoked'")?.[1]).toEqual([orderId])
    expect(sqlCalls().some((sql) => sql.includes("set status = 'reversed'"))).toBe(true)
    expect(auditActions()).toEqual(['refunded', 'earning_reversed'])
  })

  it('is idempotent: a second refund webhook only updates the refund status', async () => {
    scenario({ lockedOrder: { ...paidOrder, status: 'refunded', refund_status: 'pending' }, earning: earningRow({ status: 'reversed' }) })
    await coursePaymentRepository.markOrderRefunded(client, orderId, { refundStatus: 'processed' })
    expect(callWith("set status = 'revoked'")).toBeUndefined()
    expect(auditActions()).toEqual(['refund_status_changed'])
  })
})

describe('course payment repository: reads', () => {
  it('lists the learner’s paid and refunded purchases only', async () => {
    db.query.mockResolvedValueOnce([{ ...orderRow({ status: 'paid', paid_at: now.toISOString(), enrollment_confirmed_at: now.toISOString() }), course_slug: 'sire-2-masterclass' }])
    const purchases = await coursePaymentRepository.listLearnerPurchases(profileId)
    expect(purchases).toEqual([expect.objectContaining({ courseSlug: 'sire-2-masterclass', amountMinor: 400000, status: 'paid' })])
    const [sql, values] = db.query.mock.calls[0]!
    expect(String(sql)).toContain("o.status in ('paid', 'refunded')")
    expect(values).toEqual([profileId])
  })

  it('limits course sales to courses the viewer manages unless they are a platform admin', async () => {
    db.query.mockResolvedValue([])
    await coursePaymentRepository.listCourseSales({ managerId: profileId })
    await coursePaymentRepository.listCourseSales({ managerId: profileId, allCourses: true })
    expect(String(db.query.mock.calls[0]![0])).toContain('access_mentor.user_id = $1::uuid')
    expect(String(db.query.mock.calls[0]![0])).toContain("access_cm.role::text in ('owner', 'administrator', 'lms_manager')")
    expect(db.query.mock.calls[0]![1]).toEqual([profileId, false])
    expect(db.query.mock.calls[1]![1]).toEqual([profileId, true])
  })

  it('finds a webhook order by our crs_ id even before the gateway id was saved', async () => {
    db.txQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [orderRow({ provider_order_id: null })] })
    const order = await coursePaymentRepository.findOrderByProviderOrderId({ query: db.txQuery }, 'cashfree', 'crs_33333333333343338333333333333333')
    expect(order?.id).toBe(orderId)
    expect(db.txQuery.mock.calls[1]![1]).toEqual([orderId, 'cashfree', 'crs_33333333333343338333333333333333'])
  })
})
