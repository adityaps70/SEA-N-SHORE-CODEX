import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { QueryResultRow } from 'pg'
import { createTestDatabase, type TestDatabase } from '@/lib/db/test-database'

/**
 * C4 GST invoices against the real schema (PGlite), through the real checkout and payment code: the invoice is issued
 * when the learner is enrolled, numbered without gaps per financial year, split CGST/SGST or IGST from the billing
 * state, zero-rated for an export under LUT, never changed afterwards, and reversed by a credit note on refund.
 * Placeholder data only.
 */

let db: TestDatabase

vi.mock('@/lib/db/client', () => ({
  query: (text: string, values?: readonly unknown[]) => db.query(text, values),
  withTransaction: <T,>(work: (client: { query: (text: string, values?: readonly unknown[]) => Promise<{ rows: QueryResultRow[] }> }) => Promise<T>) =>
    db.transaction((query) => work({ query: async (text, values) => ({ rows: await query(text, values) }) })),
}))

const { coursePaymentRepository, CoursePurchaseError } = await import('@/features/learning/course-payment-repository')
const { issueInvoiceForOrder, issueMissingTaxDocuments } = await import('./tax-document-repository')
const { financialYearOf, shortFinancialYear } = await import('./gst')
const fixtures = await import('@/features/learning/learning-test-fixtures')

beforeAll(async () => {
  db = await createTestDatabase()
}, 120_000)

afterAll(async () => {
  await db?.close()
})

type Course = Awaited<ReturnType<typeof fixtures.createPublishedCourse>>
type Billing = { stateCode?: string; country?: string; company?: string; gstin?: string }

const year = shortFinancialYear(financialYearOf(new Date()))

function pgClient(query: (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>) {
  return {
    async query<T extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]) {
      return { rows: await query(text, values) as T[] }
    },
  }
}

async function buy(course: Course, billing: Billing, label = 'Fixture Buyer') {
  const profileId = await fixtures.createProfile(db.query, label)
  const { order } = await coursePaymentRepository.prepareCheckoutOrder({
    profileId, courseId: course.courseId, provider: 'cashfree', currencies: ['INR', 'USD'], billing,
  })
  await db.transaction((query) => coursePaymentRepository.confirmPaidOrder(pgClient(query), {
    orderId: order.id, providerPaymentId: `pay_${order.id.slice(0, 8)}`, amountMinor: order.amountMinor, currency: order.currency,
  }))
  return { profileId, orderId: order.id }
}

async function invoiceFor(orderId: string) {
  const rows = await db.query(
    `select invoice_number, supply_type, place_of_supply_code, place_of_supply_name, buyer_name, buyer_company, buyer_gstin,
            currency, gst_rate_basis_points, taxable_minor::int, cgst_minor::int, sgst_minor::int, igst_minor::int, total_minor::int, lut_arn, sac
     from public.tax_invoices where order_id = $1`,
    [orderId],
  )
  return rows[0] ?? null
}

async function paidCourse(priceMinor: number) {
  const mentor = await fixtures.createActiveMentor(db.query)
  return fixtures.createPublishedCourse(db.query, mentor, { priceMinor })
}

describe('GST tax invoices for course purchases (C4)', () => {
  it('invoices a Maharashtra buyer with CGST + SGST and another state with IGST, numbered one after the other', async () => {
    const course = await paidCourse(499_900)
    const first = await buy(course, { stateCode: '27' }, 'Fixture Buyer A')
    const second = await buy(course, { stateCode: '29' }, 'Fixture Buyer B')

    expect(await invoiceFor(first.orderId)).toMatchObject({
      invoice_number: `SNS/${year}/000001`, supply_type: 'intra_state', place_of_supply_code: '27', place_of_supply_name: 'Maharashtra',
      buyer_name: 'Fixture Buyer A', sac: '999293', gst_rate_basis_points: 1800,
      taxable_minor: 423_644, cgst_minor: 38_128, sgst_minor: 38_128, igst_minor: 0, total_minor: 499_900,
    })
    expect(await invoiceFor(second.orderId)).toMatchObject({
      invoice_number: `SNS/${year}/000002`, supply_type: 'inter_state', place_of_supply_name: 'Karnataka',
      taxable_minor: 423_644, cgst_minor: 0, sgst_minor: 0, igst_minor: 76_256, total_minor: 499_900,
    })
    // The order shows its invoice; the email to the buyer is queued.
    expect(await coursePaymentRepository.getOrderById(first.orderId)).toMatchObject({ invoiceNumber: `SNS/${year}/000001`, billing: { stateCode: '27' } })
    expect(await db.query(`select count(*)::int as count from public.tax_document_emails where document_type = 'invoice' and status = 'pending'`)).toEqual([{ count: 2 }])
  }, 120_000)

  it('puts the company and GSTIN on a business invoice, and refuses a GSTIN from another state or with a wrong check character', async () => {
    const course = await paidCourse(100_000)
    const business = await buy(course, { stateCode: '27', company: 'Fixture Shipping LLP', gstin: '27aasfb2030k1ze' })
    expect(await invoiceFor(business.orderId)).toMatchObject({ buyer_company: 'Fixture Shipping LLP', buyer_gstin: '27AASFB2030K1ZE', supply_type: 'intra_state' })

    const profileId = await fixtures.createProfile(db.query, 'Fixture Buyer C')
    const start = (billing: Billing) => coursePaymentRepository.prepareCheckoutOrder({ profileId, courseId: course.courseId, provider: 'cashfree', billing })
      .then(() => 'ok', (error: unknown) => (error instanceof CoursePurchaseError ? error.code : String(error)))
    expect(await start({})).toBe('billing_state_required')
    expect(await start({ stateCode: '29', company: 'Fixture Shipping LLP', gstin: '27AASFB2030K1ZE' })).toBe('billing_gstin_state_mismatch')
    expect(await start({ stateCode: '27', company: 'Fixture Shipping LLP', gstin: '27AASFB2030K1ZF' })).toBe('billing_gstin_invalid')
    expect(await start({ stateCode: '27', gstin: '27AASFB2030K1ZE' })).toBe('billing_gstin_company_required')
    expect(await db.query(`select count(*)::int as count from public.course_payment_orders where profile_id = $1`, [profileId])).toEqual([{ count: 0 }])
  }, 120_000)

  it('never changes or deletes an issued invoice, and a refund issues a credit note against it', async () => {
    const course = await paidCourse(250_000)
    const { orderId } = await buy(course, { stateCode: '07' })
    const before = await invoiceFor(orderId)
    await expect(db.query(`update public.tax_invoices set total_minor = 1 where order_id = $1`, [orderId])).rejects.toThrow(/cannot be changed or deleted/)
    await expect(db.query(`delete from public.tax_invoices where order_id = $1`, [orderId])).rejects.toThrow(/cannot be changed or deleted/)

    await db.transaction((query) => coursePaymentRepository.markOrderRefunded(pgClient(query), orderId, { refundStatus: 'processed', reason: 'admin_refund' }))
    const notes = await db.query(
      `select note.credit_note_number, note.taxable_minor::int, note.igst_minor::int, note.total_minor::int, invoice.invoice_number
       from public.tax_credit_notes note join public.tax_invoices invoice on invoice.id = note.invoice_id where invoice.order_id = $1`,
      [orderId],
    )
    expect(notes).toEqual([{ credit_note_number: `SNC/${year}/000001`, taxable_minor: before!.taxable_minor, igst_minor: before!.igst_minor, total_minor: 250_000, invoice_number: before!.invoice_number }])
    expect(await invoiceFor(orderId)).toEqual(before)
    // A second refund event changes nothing.
    await db.transaction((query) => coursePaymentRepository.markOrderRefunded(pgClient(query), orderId, { refundStatus: 'processed' }))
    expect(await db.query(`select count(*)::int as count from public.tax_credit_notes`)).toEqual([{ count: 1 }])
    await expect(db.query(`update public.tax_credit_notes set reason = 'x'`)).rejects.toThrow(/cannot be changed or deleted/)
  }, 120_000)

  it('leaves no gap in the numbers when a purchase is rolled back, and gives two purchases at once different numbers', async () => {
    const course = await paidCourse(80_000)
    const [{ last_number: before }] = await db.query(`select last_number from public.tax_document_sequences where series = $1`, [`invoice:${financialYearOf(new Date())}`]) as Array<{ last_number: number }>

    // An invoice issued inside a transaction that then fails takes no number.
    const profileId = await fixtures.createProfile(db.query, 'Fixture Buyer D')
    const { order } = await coursePaymentRepository.prepareCheckoutOrder({ profileId, courseId: course.courseId, provider: 'cashfree', billing: { stateCode: '27' } })
    await expect(db.transaction(async (query) => {
      await coursePaymentRepository.confirmPaidOrder(pgClient(query), { orderId: order.id, providerPaymentId: 'pay_rolled', amountMinor: order.amountMinor, currency: 'INR' })
      throw new Error('fixture_rollback')
    })).rejects.toThrow('fixture_rollback')
    expect(await invoiceFor(order.id)).toBeNull()

    const [a, b] = await Promise.all([buy(course, { stateCode: '27' }, 'Fixture Buyer E'), buy(course, { stateCode: '33' }, 'Fixture Buyer F')])
    const numbers = [(await invoiceFor(a.orderId))!.invoice_number, (await invoiceFor(b.orderId))!.invoice_number].sort()
    expect(numbers).toEqual([`SNS/${year}/${String(before + 1).padStart(6, '0')}`, `SNS/${year}/${String(before + 2).padStart(6, '0')}`])
  }, 120_000)

  it('invoices a USD buyer abroad as a zero-rated export under the LUT saved for the year', async () => {
    const course = await paidCourse(10_000)
    await db.query(`update public.learning_courses set currency = 'USD', price_minor = 4900 where id = $1`, [course.courseId])
    await db.query(`update public.learning_course_plans set currency = 'USD', price_minor = 4900 where course_id = $1`, [course.courseId])
    await db.query(`insert into public.gst_lut_registrations (financial_year, arn) values ($1, 'AD2704260012345')`, [financialYearOf(new Date())])

    const { orderId } = await buy(course, { country: 'AE' })
    expect(await invoiceFor(orderId)).toMatchObject({
      supply_type: 'export_lut', place_of_supply_code: '96', currency: 'USD', gst_rate_basis_points: 0,
      taxable_minor: 4_900, cgst_minor: 0, sgst_minor: 0, igst_minor: 0, total_minor: 4_900, lut_arn: 'AD2704260012345',
    })
    const profileId = await fixtures.createProfile(db.query, 'Fixture Buyer G')
    await expect(coursePaymentRepository.prepareCheckoutOrder({ profileId, courseId: course.courseId, provider: 'cashfree', currencies: ['INR', 'USD'], billing: { stateCode: '27' } }))
      .rejects.toMatchObject({ code: 'billing_country_required' })
  }, 120_000)

  it('does not invoice orders from before GST invoices (no billing state), not even in the catch-up sweep', async () => {
    const course = await paidCourse(60_000)
    const profileId = await fixtures.createProfile(db.query, 'Fixture Buyer H')
    const [order] = await db.query(
      `insert into public.course_payment_orders (course_id, profile_id, course_title, list_price_minor, amount_minor, currency, provider, provider_order_id)
       values ($1, $2, 'Fixture SIRE Readiness', 60000, 60000, 'INR', 'cashfree', 'crs_fixture_before_c4') returning id`,
      [course.courseId, profileId],
    )
    await db.transaction((query) => coursePaymentRepository.confirmPaidOrder(pgClient(query), { orderId: String(order!.id), providerPaymentId: 'pay_before_c4', amountMinor: 60_000, currency: 'INR' }))
    expect(await invoiceFor(String(order!.id))).toBeNull()
    await expect(db.transaction((query) => issueInvoiceForOrder(pgClient(query), String(order!.id)))).resolves.toEqual({ issued: false, reason: 'billing_details_missing' })
    await expect(issueMissingTaxDocuments((work) => db.transaction((query) => work(pgClient(query))))).resolves.toMatchObject({ invoices: 0 })
    expect(await invoiceFor(String(order!.id))).toBeNull()
  }, 120_000)
})
