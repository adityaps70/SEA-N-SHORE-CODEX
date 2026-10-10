import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { QueryResultRow } from 'pg'
import { createTestDatabase, type TestDatabase } from '@/lib/db/test-database'

/**
 * D3 company seat packs against the real schema (PGlite), through the real checkout, payment, refund and tax code:
 * the volume discount, seats valid for 12 months, one B2B GST invoice per pack, refunds of unassigned seats within 30
 * days (a partial credit note and earning adjustment, or the whole order), and who may buy or download. Placeholder
 * data only.
 */

let db: TestDatabase

vi.mock('@/lib/db/client', () => ({
  query: (text: string, values?: readonly unknown[]) => db.query(text, values),
  withTransaction: <T,>(work: (client: { query: (text: string, values?: readonly unknown[]) => Promise<{ rows: QueryResultRow[] }> }) => Promise<T>) =>
    db.transaction((query) => work({ query: async (text, values) => ({ rows: await query(text, values) }) })),
}))

const { coursePaymentRepository, CoursePurchaseError } = await import('../course-payment-repository')
const { createCoursePaymentService } = await import('../course-payment-service')
const { SeatError } = await import('./seat-rules')
const { trainingRepository } = await import('./training-repository')
const { getInvoiceForViewer, getCreditNoteForViewer } = await import('@/features/tax/tax-document-queries')
const fixtures = await import('../learning-test-fixtures')

beforeAll(async () => {
  db = await createTestDatabase()
}, 120_000)

afterAll(async () => {
  await db?.close()
})

const GSTIN = '27AASFB2030K1ZE'
const BILLING = { stateCode: '27', company: 'Fixture Shipping LLP', gstin: GSTIN }
let sequence = 0

async function createCompany(options: { verified?: boolean; role?: string } = {}) {
  sequence += 1
  const owner = await fixtures.createProfile(db.query, `Fixture Company Admin ${sequence}`)
  const [company] = await db.query(
    `insert into public.companies (slug, name, created_by, is_verified) values ($1, $2, $3, $4) returning id`,
    [`fixture-shipping-${sequence}`, `Fixture Shipping ${sequence}`, owner, options.verified ?? true],
  )
  await db.query(
    `insert into public.company_members (company_id, user_id, role, approved_at) values ($1, $2, $3, now())`,
    [company!.id, owner, options.role ?? 'owner'],
  )
  return { companyId: String(company!.id), adminId: owner }
}

async function addMember(companyId: string, role: string, label: string) {
  const id = await fixtures.createProfile(db.query, label)
  await db.query(`insert into public.company_members (company_id, user_id, role, approved_at) values ($1, $2, $3, now())`, [companyId, id, role])
  return id
}

async function paidCourse(priceMinor: number, discountPriceMinor?: number) {
  const mentor = await fixtures.createActiveMentor(db.query)
  const course = await fixtures.createPublishedCourse(db.query, mentor, { priceMinor })
  if (discountPriceMinor) {
    await db.query(`update public.learning_courses set discount_price_minor = $2 where id = $1`, [course.courseId, discountPriceMinor])
    await db.query(`update public.learning_course_plans set discount_price_minor = $2 where course_id = $1`, [course.courseId, discountPriceMinor])
  }
  return { ...course, mentor }
}

function pgClient(query: (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>) {
  return {
    async query<T extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]) {
      return { rows: await query(text, values) as T[] }
    },
  }
}

async function buyPack(input: { companyId: string; adminId: string; courseId: string; quantity: number; paidAt?: Date }) {
  const { order, quote } = await coursePaymentRepository.prepareSeatCheckoutOrder({
    profileId: input.adminId, companyId: input.companyId, courseId: input.courseId, provider: 'cashfree', quantity: input.quantity, billing: BILLING,
  })
  await db.query(`update public.course_payment_orders set provider_order_id = $2 where id = $1`, [order.id, `crs_${order.id.replace(/-/g, '')}`])
  const outcome = await db.transaction((query) => coursePaymentRepository.confirmPaidOrder(pgClient(query), {
    orderId: order.id, providerPaymentId: `pay_${order.id.slice(0, 8)}`, amountMinor: order.amountMinor, currency: order.currency, now: input.paidAt,
  }))
  return { orderId: order.id, quote, outcome }
}

function code(error: unknown) {
  return error instanceof SeatError || error instanceof CoursePurchaseError ? error.code : String(error)
}

const refundCalls: Array<{ amountMinor: number; refundId: string }> = []
const gateway = {
  name: 'cashfree' as const,
  currencies: ['INR' as const],
  requiresCustomerPhone: false,
  async refund(input: { amountMinor: number; refundId: string }) {
    refundCalls.push({ amountMinor: input.amountMinor, refundId: input.refundId })
    return { status: 'processed' as const, providerRefundId: `cf_refund_${refundCalls.length}` }
  },
}
const { withTransaction } = await import('@/lib/db/client')
const service = createCoursePaymentService({
  getGateway: async () => gateway as never,
  getGatewayByName: async () => gateway as never,
  transaction: withTransaction,
  log: () => undefined,
})

describe('company seat packs (D3)', () => {
  it('prices a pack per seat with the volume discount and issues the seats, a B2B invoice and the earning on payment', async () => {
    const { companyId, adminId } = await createCompany()
    const course = await paidCourse(500_000, 450_000)

    const small = await coursePaymentRepository.previewSeatPack({ profileId: adminId, companyId, courseId: course.courseId, quantity: 9 })
    expect(small.quote).toMatchObject({ unitMinor: 450_000, volumeDiscountBasisPoints: 0, totalMinor: 4_050_000 })
    const ten = await coursePaymentRepository.previewSeatPack({ profileId: adminId, companyId, courseId: course.courseId, quantity: 10 })
    expect(ten.quote).toMatchObject({ unitMinor: 405_000, volumeDiscountBasisPoints: 1000, totalMinor: 4_050_000, listTotalMinor: 5_000_000 })
    const fifty = await coursePaymentRepository.previewSeatPack({ profileId: adminId, companyId, courseId: course.courseId, quantity: 50 })
    expect(fifty.quote).toMatchObject({ unitMinor: 360_000, volumeDiscountBasisPoints: 2000, totalMinor: 18_000_000 })

    const paidAt = new Date()
    const { orderId, outcome } = await buyPack({ companyId, adminId, courseId: course.courseId, quantity: 12, paidAt })
    expect(outcome.state).toBe('enrolled')
    const seats = await db.query(`select status, valid_until, learner_id from public.company_training_seats where order_id = $1`, [orderId])
    expect(seats).toHaveLength(12)
    expect(seats.every((seat) => seat.status === 'available' && seat.learner_id === null)).toBe(true)
    const validUntil = new Date(String(seats[0]!.valid_until))
    const expected = new Date(paidAt.getTime())
    expected.setUTCMonth(expected.getUTCMonth() + 12)
    expect(Math.abs(validUntil.getTime() - expected.getTime())).toBeLessThan(1000)

    const [invoice] = await db.query(
      `select buyer_company, buyer_gstin, supply_type, total_minor::int, description from public.tax_invoices where order_id = $1`,
      [orderId],
    )
    expect(invoice).toMatchObject({ buyer_company: 'Fixture Shipping LLP', buyer_gstin: GSTIN, supply_type: 'intra_state', total_minor: 4_860_000 })
    expect(String(invoice!.description)).toContain('12 seats at ₹4,050 each (10% volume discount)')
    // Nobody is enrolled by the purchase, and it is not a personal purchase of the admin.
    expect(await db.query(`select count(*)::int as count from public.learning_enrollments where course_id = $1`, [course.courseId])).toEqual([{ count: 0 }])
    expect(await coursePaymentRepository.listLearnerPurchases(adminId)).toEqual([])
    const [earning] = await db.query(`select gross_minor::int, status from public.seller_earnings where source_id = $1`, [orderId])
    expect(earning).toMatchObject({ gross_minor: 4_860_000, status: 'pending' })

    // Confirming again changes nothing.
    await db.transaction((query) => coursePaymentRepository.confirmPaidOrder(pgClient(query), { orderId, providerPaymentId: `pay_${orderId.slice(0, 8)}` }))
    expect(await db.query(`select count(*)::int as count from public.company_training_seats where order_id = $1`, [orderId])).toEqual([{ count: 12 }])

    const packs = await trainingRepository.seatPacks({ actorId: adminId }, companyId)
    expect(packs[0]).toMatchObject({ orderId, quantity: 12, unitMinor: 405_000, seats: { available: 12, assigned: 0 }, invoiceNumber: expect.stringMatching(/^SNS\//) })
    expect(await trainingRepository.seatSummary({ actorId: adminId }, companyId)).toEqual([expect.objectContaining({ courseId: course.courseId, available: 12, assigned: 0 })])
  }, 120_000)

  it('requires a GSTIN, a verified organization and a training role, and rupee pricing', async () => {
    const { companyId, adminId } = await createCompany()
    const course = await paidCourse(200_000)
    const start = (profileId: string, company: string, billing: Record<string, string> = BILLING, quantity = 3) => coursePaymentRepository
      .prepareSeatCheckoutOrder({ profileId, companyId: company, courseId: course.courseId, provider: 'cashfree', quantity, billing })
      .then(() => 'ok', code)

    expect(await start(adminId, companyId, { stateCode: '27' })).toBe('seat_pack_gstin_required')
    expect(await start(adminId, companyId, BILLING, 0)).toBe('seat_quantity_invalid')
    const recruiter = await addMember(companyId, 'recruiter', 'Fixture Recruiter')
    expect(await start(recruiter, companyId)).toBe('company_training_not_allowed')
    const learningManager = await addMember(companyId, 'lms_manager', 'Fixture Learning Manager')
    expect(await start(learningManager, companyId)).toBe('ok')
    const unverified = await createCompany({ verified: false })
    expect(await start(unverified.adminId, unverified.companyId)).toBe('company_not_verified')

    await db.query(`update public.learning_courses set currency = 'USD' where id = $1`, [course.courseId])
    await db.query(`update public.learning_course_plans set currency = 'USD' where course_id = $1`, [course.courseId])
    expect(await start(adminId, companyId)).toBe('seat_pack_currency_unsupported')
  }, 120_000)

  it('refunds some unassigned seats with a partial credit note and earning adjustment, once per pack', async () => {
    const { companyId, adminId } = await createCompany()
    const course = await paidCourse(100_000)
    const { orderId } = await buyPack({ companyId, adminId, courseId: course.courseId, quantity: 10 })
    // 10 seats at ₹900 (10% off ₹1,000) = ₹9,000.
    await expect(service.refundSeats({ orderId, companyId, seats: 11, actorProfileId: adminId })).rejects.toMatchObject({ code: 'seat_refund_too_many' })

    const result = await service.refundSeats({ orderId, companyId, seats: 4, actorProfileId: adminId })
    expect(result).toMatchObject({ state: 'seats_refunded', seats: 4, amountMinor: 360_000 })
    expect(refundCalls.at(-1)).toMatchObject({ amountMinor: 360_000 })
    expect(await db.query(`select status, count(*)::int as count from public.company_training_seats where order_id = $1 group by status order by status`, [orderId]))
      .toEqual([{ status: 'available', count: 6 }, { status: 'refunded', count: 4 }])
    const [order] = await db.query(`select status from public.course_payment_orders where id = $1`, [orderId])
    expect(order!.status).toBe('paid')
    const [note] = await db.query(
      `select note.total_minor::int, note.taxable_minor::int, note.cgst_minor::int, note.sgst_minor::int, note.reason
       from public.tax_credit_notes note join public.tax_invoices invoice on invoice.id = note.invoice_id where invoice.order_id = $1`,
      [orderId],
    )
    expect(note).toMatchObject({ total_minor: 360_000, reason: 'Refund of 4 unassigned seats' })
    expect(note!.taxable_minor + note!.cgst_minor + note!.sgst_minor).toBe(360_000)
    const earnings = await db.query(`select source_type, gross_minor::int from public.seller_earnings where seller_profile_id = $1 order by gross_minor desc`, [course.mentor.userId])
    expect(earnings).toEqual([{ source_type: 'course_purchase', gross_minor: 900_000 }, { source_type: 'adjustment', gross_minor: -360_000 }])

    await expect(service.refundSeats({ orderId, companyId, seats: 1, actorProfileId: adminId })).rejects.toMatchObject({ code: 'seat_refund_already_used' })
    // A whole-order refund is no longer possible either.
    await expect(service.refundOrder({ orderId, actor: { type: 'admin' }, reason: 'admin_refund' })).rejects.toMatchObject({ code: 'refund_not_allowed' })
  }, 120_000)

  it('refunds every seat of an untouched pack as the whole order, and closes refunds after 30 days', async () => {
    const { companyId, adminId } = await createCompany()
    const course = await paidCourse(100_000)
    const { orderId } = await buyPack({ companyId, adminId, courseId: course.courseId, quantity: 3 })
    const result = await service.refundSeats({ orderId, companyId, seats: 3, actorProfileId: adminId })
    expect(result).toMatchObject({ state: 'refunded' })
    expect(await db.query(`select status from public.course_payment_orders where id = $1`, [orderId])).toEqual([{ status: 'refunded' }])
    expect(await db.query(`select distinct status from public.company_training_seats where order_id = $1`, [orderId])).toEqual([{ status: 'refunded' }])
    const [note] = await db.query(`select note.total_minor::int from public.tax_credit_notes note join public.tax_invoices invoice on invoice.id = note.invoice_id where invoice.order_id = $1`, [orderId])
    expect(note!.total_minor).toBe(300_000)

    const old = await buyPack({ companyId, adminId, courseId: course.courseId, quantity: 2, paidAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) })
    await expect(service.refundSeats({ orderId: old.orderId, companyId, seats: 1, actorProfileId: adminId })).rejects.toMatchObject({ code: 'seat_refund_window_closed' })
  }, 120_000)

  it('gives held seats back when the gateway refuses the refund', async () => {
    const { companyId, adminId } = await createCompany()
    const course = await paidCourse(100_000)
    const { orderId } = await buyPack({ companyId, adminId, courseId: course.courseId, quantity: 5 })
    const refusing = createCoursePaymentService({
      getGateway: async () => gateway as never,
      getGatewayByName: async () => ({ ...gateway, refund: async () => ({ status: 'failed' as const, providerRefundId: null }) }) as never,
      transaction: withTransaction,
      log: () => undefined,
    })
    await expect(refusing.refundSeats({ orderId, companyId, seats: 2, actorProfileId: adminId })).rejects.toThrow()
    expect(await db.query(`select distinct status from public.company_training_seats where order_id = $1`, [orderId])).toEqual([{ status: 'available' }])
    expect(await db.query(`select status from public.company_training_seat_refunds where order_id = $1`, [orderId])).toEqual([{ status: 'failed' }])
    // The refused refund can be tried again.
    await expect(service.refundSeats({ orderId, companyId, seats: 2, actorProfileId: adminId })).resolves.toMatchObject({ state: 'seats_refunded', seats: 2 })
  }, 120_000)

  it('settles a pending seat refund from the gateway webhook without touching the rest of the pack', async () => {
    const { companyId, adminId } = await createCompany()
    const course = await paidCourse(100_000)
    const { orderId } = await buyPack({ companyId, adminId, courseId: course.courseId, quantity: 6 })
    const pending = createCoursePaymentService({
      getGateway: async () => gateway as never,
      getGatewayByName: async () => ({ ...gateway, refund: async () => ({ status: 'pending' as const, providerRefundId: 'cf_refund_pending_1' }) }) as never,
      transaction: withTransaction,
      log: () => undefined,
    })
    await expect(pending.refundSeats({ orderId, companyId, seats: 2, actorProfileId: adminId })).resolves.toMatchObject({ state: 'seats_refund_pending', seats: 2 })
    expect(await db.query(`select status from public.company_training_seat_refunds where order_id = $1`, [orderId])).toEqual([{ status: 'pending' }])

    const [order] = await db.query(`select provider_order_id from public.course_payment_orders where id = $1`, [orderId])
    const result = await db.transaction((query) => pending.applyGatewayEvent(pgClient(query) as never, {
      kind: 'refund_updated', provider: 'cashfree', providerOrderId: String(order!.provider_order_id), providerPaymentId: null,
      providerRefundId: 'cf_refund_pending_1', refundId: null, amountMinor: 200_000, status: 'processed',
    }))
    expect(result).toMatchObject({ handled: true })
    expect(await db.query(`select status from public.company_training_seat_refunds where order_id = $1`, [orderId])).toEqual([{ status: 'processed' }])
    expect(await db.query(`select status from public.course_payment_orders where id = $1`, [orderId])).toEqual([{ status: 'paid' }])
    expect(await db.query(`select status, count(*)::int as count from public.company_training_seats where order_id = $1 group by status order by status`, [orderId]))
      .toEqual([{ status: 'available', count: 4 }, { status: 'refunded', count: 2 }])
    // Only one credit note, issued when the gateway accepted the refund.
    expect(await db.query(`select count(*)::int as count from public.tax_credit_notes note join public.tax_invoices invoice on invoice.id = note.invoice_id where invoice.order_id = $1`, [orderId])).toEqual([{ count: 1 }])
  }, 120_000)

  it('lets every training admin of the company download the pack invoice and credit note, and nobody else', async () => {
    const { companyId, adminId } = await createCompany()
    const course = await paidCourse(100_000)
    const { orderId } = await buyPack({ companyId, adminId, courseId: course.courseId, quantity: 4 })
    await service.refundSeats({ orderId, companyId, seats: 1, actorProfileId: adminId })
    const [ids] = await db.query(`select invoice.id as invoice_id, note.id as note_id from public.tax_invoices invoice join public.tax_credit_notes note on note.invoice_id = invoice.id where invoice.order_id = $1`, [orderId])
    const colleague = await addMember(companyId, 'administrator', 'Fixture Colleague')
    const recruiter = await addMember(companyId, 'recruiter', 'Fixture Recruiter Two')
    const viewer = (profileId: string) => ({ profileId, canViewAll: async () => false })
    await expect(getInvoiceForViewer(String(ids!.invoice_id), viewer(colleague))).resolves.toMatchObject({ id: ids!.invoice_id })
    await expect(getCreditNoteForViewer(String(ids!.note_id), viewer(colleague))).resolves.toMatchObject({ note: { id: ids!.note_id } })
    await expect(getInvoiceForViewer(String(ids!.invoice_id), viewer(recruiter))).resolves.toBeNull()
    await expect(trainingRepository.seatPacks({ actorId: recruiter }, companyId)).rejects.toMatchObject({ code: 'company_training_not_allowed' })
  }, 120_000)
})
