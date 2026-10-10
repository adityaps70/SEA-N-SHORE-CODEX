import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { QueryResultRow } from 'pg'
import { PDFDocument } from 'pdf-lib'
import { createTestDatabase, type TestDatabase } from '@/lib/db/test-database'

/**
 * C4 GST documents end to end against the real schema (PGlite), through the real checkout code: a paid course order
 * gets an intra-state invoice and a queued email, the worker sends that email with the PDF, a refund issues a credit
 * note and a second email, the buyer (only) can read both, and the month's export lists both.
 */

let db: TestDatabase

// The checkout, invoice and email code talks to '@/lib/db/client'; here it talks to the PGlite database.
vi.mock('@/lib/db/client', () => ({
  query: (text: string, values?: readonly unknown[]) => db.query(text, values),
  withTransaction: <T,>(work: (client: { query: (text: string, values?: readonly unknown[]) => Promise<{ rows: QueryResultRow[] }> }) => Promise<T>) =>
    db.transaction((query) => work({ query: async (text, values) => ({ rows: await query(text, values) }) })),
}))

const { coursePaymentRepository } = await import('@/features/learning/course-payment-repository')
const fixtures = await import('@/features/learning/learning-test-fixtures')
const { createTaxDocumentEmailWorker } = await import('./tax-document-email')
const { getCreditNoteForViewer, getInvoiceForViewer } = await import('./tax-document-queries')
const { listGstDocumentsForMonth } = await import('./gst-export')
const { indiaMonth } = await import('./gst')
const { FIXTURE_BUYER_GSTIN } = await import('./tax-test-fixtures')

beforeAll(async () => {
  db = await createTestDatabase()
}, 120_000)

afterAll(async () => {
  await db?.close()
})

function pgClient(query: (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>) {
  return {
    async query<T extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]) {
      return { rows: await query(text, values) as T[] }
    },
  }
}

type SentEmail = { to: string; subject: string; idempotencyKey?: string; attachments?: Array<{ filename: string; content: string }> }

describe('GST invoice, email and credit note (C4)', () => {
  it('invoices a paid order, emails the PDF, and issues a credit note and a second email on refund', async () => {
    const mentor = await fixtures.createActiveMentor(db.query)
    const course = await fixtures.createPublishedCourse(db.query, mentor, { priceMinor: 499_900 })
    const buyerId = await fixtures.createProfile(db.query, 'Fixture Learner')
    await db.query(
      `insert into public.identity_accounts (profile_id, provider, provider_subject, email, email_verified) values ($1, 'cognito', 'fixture-tax-sub-1', 'fixture-tax-buyer@example.test', true)`,
      [buyerId],
    )
    // Learning emails off: a tax document is transactional and is still sent.
    await db.query(`insert into public.notification_email_preferences (profile_id, category, email_enabled) values ($1, 'learning', false)`, [buyerId])

    const { order } = await coursePaymentRepository.prepareCheckoutOrder({
      profileId: buyerId,
      courseId: course.courseId,
      provider: 'cashfree',
      currencies: ['INR'],
      billing: { stateCode: '27', company: 'Fixture Shipping Pvt Ltd', gstin: FIXTURE_BUYER_GSTIN },
    })
    expect(order.amountMinor).toBe(499_900)
    const paidAt = new Date()
    const outcome = await db.transaction((query) => coursePaymentRepository.confirmPaidOrder(
      pgClient(query),
      { orderId: order.id, providerPaymentId: 'pay_fixture_tax_1', amountMinor: 499_900, currency: 'INR', now: paidAt },
    ))
    expect(outcome.state).toBe('enrolled')

    const invoices = await db.query(
      `select id, invoice_number, supply_type, place_of_supply_code, buyer_gstin, buyer_company, taxable_minor::int, cgst_minor::int, sgst_minor::int, igst_minor::int, total_minor::int
       from public.tax_invoices where order_id = $1`,
      [order.id],
    )
    expect(invoices).toHaveLength(1)
    expect(invoices[0]).toMatchObject({
      supply_type: 'intra_state', place_of_supply_code: '27', buyer_gstin: FIXTURE_BUYER_GSTIN, buyer_company: 'Fixture Shipping Pvt Ltd',
      taxable_minor: 423_644, cgst_minor: 38_128, sgst_minor: 38_128, igst_minor: 0, total_minor: 499_900,
    })
    expect(String(invoices[0]!.invoice_number)).toMatch(/^SNS\/\d{2}-\d{2}\/\d{6}$/)
    const invoiceId = String(invoices[0]!.id)
    expect(await db.query(`select status, attempts from public.tax_document_emails where document_type = 'invoice' and document_id = $1`, [invoiceId]))
      .toEqual([{ status: 'pending', attempts: 0 }])

    const sent: SentEmail[] = []
    const resend = { sendEmail: vi.fn(async (input: SentEmail) => { sent.push(input); return { messageId: `email_fixture_${sent.length}` } }) }
    const worker = createTaxDocumentEmailWorker({ resend })

    await expect(worker.runSweep()).resolves.toMatchObject({ claimed: 1, sent: 1, skipped: 0, failed: 0 })
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({
      to: 'fixture-tax-buyer@example.test',
      subject: `Your Sea N Shore tax invoice ${invoices[0]!.invoice_number}`,
      idempotencyKey: `tax-document/invoice/${invoiceId}`,
    })
    expect(sent[0]!.attachments).toHaveLength(1)
    expect(sent[0]!.attachments![0]!.filename).toBe(`${String(invoices[0]!.invoice_number).replaceAll('/', '-')}.pdf`)
    expect((await PDFDocument.load(Buffer.from(sent[0]!.attachments![0]!.content, 'base64'))).getPageCount()).toBe(1)
    expect(await db.query(`select status, resend_message_id, sent_at is not null as sent from public.tax_document_emails where document_id = $1`, [invoiceId]))
      .toEqual([{ status: 'sent', resend_message_id: 'email_fixture_1', sent: true }])

    // Nothing more to send: a sent row is never claimed again.
    await expect(worker.runSweep()).resolves.toMatchObject({ claimed: 0 })

    // The order shows the invoice to the learner (My Learning → Purchases).
    const purchases = await coursePaymentRepository.listLearnerPurchases(buyerId)
    expect(purchases.find((purchase) => purchase.id === order.id)).toMatchObject({ invoiceId, invoiceNumber: invoices[0]!.invoice_number, creditNoteId: null })

    // Refund: a credit note against the invoice and a second email.
    await db.transaction((query) => coursePaymentRepository.markOrderRefunded(pgClient(query), order.id, { providerRefundId: 'rfnd_fixture_1', refundStatus: 'processed' }))
    const notes = await db.query(
      `select id, credit_note_number, invoice_id, taxable_minor::int, cgst_minor::int, sgst_minor::int, igst_minor::int, total_minor::int from public.tax_credit_notes where invoice_id = $1`,
      [invoiceId],
    )
    expect(notes).toHaveLength(1)
    expect(notes[0]).toMatchObject({ taxable_minor: 423_644, cgst_minor: 38_128, sgst_minor: 38_128, igst_minor: 0, total_minor: 499_900 })
    const noteId = String(notes[0]!.id)

    await expect(worker.runSweep()).resolves.toMatchObject({ claimed: 1, sent: 1 })
    expect(sent).toHaveLength(2)
    expect(sent[1]).toMatchObject({
      to: 'fixture-tax-buyer@example.test',
      subject: `Credit note ${notes[0]!.credit_note_number}`,
      idempotencyKey: `tax-document/credit_note/${noteId}`,
    })
    expect(sent[1]!.attachments![0]!.filename).toBe(`${String(notes[0]!.credit_note_number).replaceAll('/', '-')}.pdf`)
    expect(await db.query(`select document_type, status from public.tax_document_emails where document_id in ($1, $2) order by document_type`, [invoiceId, noteId]))
      .toEqual([{ document_type: 'credit_note', status: 'sent' }, { document_type: 'invoice', status: 'sent' }])

    // Only the buyer (or a platform administrator) can read the documents.
    const buyer = { profileId: buyerId, canViewAll: async () => false }
    const stranger = { profileId: await fixtures.createProfile(db.query, 'Fixture Stranger'), canViewAll: async () => false }
    const admin = { profileId: stranger.profileId, canViewAll: async () => true }
    await expect(getInvoiceForViewer(invoiceId, buyer)).resolves.toMatchObject({ id: invoiceId, totalMinor: 499_900, orderReference: expect.any(String) })
    await expect(getInvoiceForViewer(invoiceId, stranger)).resolves.toBeNull()
    await expect(getInvoiceForViewer(invoiceId, admin)).resolves.toMatchObject({ id: invoiceId })
    await expect(getCreditNoteForViewer(noteId, buyer)).resolves.toMatchObject({ note: { id: noteId }, invoice: { id: invoiceId } })
    await expect(getCreditNoteForViewer(noteId, stranger)).resolves.toBeNull()

    // The month's GST export lists the invoice and the credit note with the stored amounts.
    const month = indiaMonth(paidAt)
    const exported = await listGstDocumentsForMonth(db.client, month)
    const mine = exported.filter((row) => row.number === invoices[0]!.invoice_number || row.number === notes[0]!.credit_note_number)
    expect(mine).toEqual([
      expect.objectContaining({ documentType: 'Invoice', supplyType: 'B2B', placeOfSupplyCode: '27', taxableMinor: 423_644, cgstMinor: 38_128, totalMinor: 499_900, againstInvoice: null }),
      expect.objectContaining({ documentType: 'Credit note', supplyType: 'B2B', totalMinor: 499_900, againstInvoice: invoices[0]!.invoice_number }),
    ])
  }, 120_000)

  it('skips the email of a buyer with no verified address', async () => {
    const mentor = await fixtures.createActiveMentor(db.query)
    const course = await fixtures.createPublishedCourse(db.query, mentor, { priceMinor: 249_950 })
    const buyerId = await fixtures.createProfile(db.query, 'Fixture Buyer')
    await db.query(
      `insert into public.identity_accounts (profile_id, provider, provider_subject, email, email_verified) values ($1, 'cognito', 'fixture-tax-sub-2', 'fixture-unverified@example.test', false)`,
      [buyerId],
    )
    const { order } = await coursePaymentRepository.prepareCheckoutOrder({ profileId: buyerId, courseId: course.courseId, provider: 'cashfree', currencies: ['INR'], billing: { stateCode: '29' } })
    await db.transaction((query) => coursePaymentRepository.confirmPaidOrder(
      pgClient(query),
      { orderId: order.id, providerPaymentId: 'pay_fixture_tax_2', amountMinor: 249_950, currency: 'INR', now: new Date() },
    ))
    const [invoice] = await db.query(`select id, supply_type, igst_minor::int, cgst_minor::int from public.tax_invoices where order_id = $1`, [order.id])
    expect(invoice).toMatchObject({ supply_type: 'inter_state', igst_minor: 38_128, cgst_minor: 0 })

    const resend = { sendEmail: vi.fn(async () => ({ messageId: 'email_unused' })) }
    await expect(createTaxDocumentEmailWorker({ resend }).runSweep()).resolves.toMatchObject({ claimed: 1, skipped: 1, sent: 0 })
    expect(resend.sendEmail).not.toHaveBeenCalled()
    expect(await db.query(`select status, last_error from public.tax_document_emails where document_id = $1`, [invoice!.id]))
      .toEqual([{ status: 'skipped', last_error: 'no_verified_email' }])
  }, 120_000)
})
