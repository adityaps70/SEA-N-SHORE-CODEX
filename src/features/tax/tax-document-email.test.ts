import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PDFDocument } from 'pdf-lib'

vi.mock('@/lib/db/client', () => ({ query: vi.fn(), withTransaction: vi.fn() }))

import { ResendApiError, type ResendEmailInput } from '@/lib/email/resend'
import { createTaxDocumentEmailWorker, TAX_DOCUMENT_EMAIL_FROM, taxDocumentEmail, type TaxDocumentDelivery } from './tax-document-email'
import { sampleCreditNote, sampleInvoice } from './tax-test-fixtures'

const invoice = sampleInvoice()
const note = sampleCreditNote(invoice)

const invoiceDelivery: TaxDocumentDelivery = { id: 'a0000000-0000-4000-8000-000000000001', documentType: 'invoice', documentId: invoice.id }
const noteDelivery: TaxDocumentDelivery = { id: 'a0000000-0000-4000-8000-000000000002', documentType: 'credit_note', documentId: note.id }

function fakeRepository(deliveries: TaxDocumentDelivery[], documents: Record<string, { email: string | null } | null> = {}) {
  return {
    claimBatch: vi.fn(async () => deliveries),
    loadDocument: vi.fn(async (delivery: TaxDocumentDelivery) => {
      const override = documents[delivery.id]
      if (override === null) return null
      return {
        invoice,
        note: delivery.documentType === 'credit_note' ? note : null,
        courseTitle: 'SIRE 2.0 Inspection Readiness',
        email: override ? override.email : 'learner@example.test',
      }
    }),
    markSent: vi.fn(async () => {}),
    markSkipped: vi.fn(async () => {}),
    markFailed: vi.fn(async () => {}),
  }
}

type SendEmail = (input: ResendEmailInput) => Promise<{ messageId: string }>

function fakeResend(implementation?: SendEmail) {
  const fallback: SendEmail = async () => ({ messageId: 'email_fixture_1' })
  return { sendEmail: vi.fn<SendEmail>(implementation ?? fallback) }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('taxDocumentEmail', () => {
  it('names the document, the course and the amount, and links to My Learning purchases', () => {
    const email = taxDocumentEmail({ invoice, courseTitle: 'SIRE 2.0 <Inspection>', siteUrl: 'https://seanshore.example/' })
    expect(email.subject).toBe('Your Sea N Shore tax invoice SNS/26-27/000001')
    expect(email.text).toContain('"SIRE 2.0 <Inspection>"')
    expect(email.text).toContain('INR 4,999.00')
    expect(email.text).toContain('https://seanshore.example/learn/my-learning?tab=purchases')
    expect(email.html).toContain('SIRE 2.0 &lt;Inspection&gt;')
    expect(email.html).not.toContain('<Inspection>')
    expect(email.text).not.toContain('Fixture Learner')

    const credit = taxDocumentEmail({ invoice, note, courseTitle: 'SIRE 2.0 Inspection Readiness' })
    expect(credit.subject).toBe('Credit note SNC/26-27/000001')
    expect(credit.text).toContain('against invoice SNS/26-27/000001 dated 05 Oct 2026')
  })
})

describe('createTaxDocumentEmailWorker', () => {
  it('sends each document with its PDF attached, from the billing address, once per document', async () => {
    const repository = fakeRepository([invoiceDelivery, noteDelivery])
    const resend = fakeResend()
    const worker = createTaxDocumentEmailWorker({ repository, resend })

    await expect(worker.runSweep()).resolves.toEqual({ claimed: 2, sent: 2, failed: 0, skipped: 0, retrying: 0, disabled: false })
    expect(resend.sendEmail).toHaveBeenCalledTimes(2)
    const first = resend.sendEmail.mock.calls[0]![0]
    expect(first).toMatchObject({
      from: TAX_DOCUMENT_EMAIL_FROM,
      to: 'learner@example.test',
      subject: 'Your Sea N Shore tax invoice SNS/26-27/000001',
      idempotencyKey: `tax-document/invoice/${invoice.id}`,
      tags: [{ name: 'category', value: 'tax_invoice' }],
    })
    expect(TAX_DOCUMENT_EMAIL_FROM).toBe('Sea N Shore <billing@mail.seanshore.in>')
    expect(first.attachments).toHaveLength(1)
    expect(first.attachments![0]!.filename).toBe('SNS-26-27-000001.pdf')
    const pdf = await PDFDocument.load(Buffer.from(first.attachments![0]!.content, 'base64'))
    expect(pdf.getPageCount()).toBe(1)

    const second = resend.sendEmail.mock.calls[1]![0]
    expect(second).toMatchObject({ subject: 'Credit note SNC/26-27/000001', idempotencyKey: `tax-document/credit_note/${note.id}` })
    expect(second.attachments![0]!.filename).toBe('SNC-26-27-000001.pdf')
    expect(repository.markSent).toHaveBeenCalledWith(invoiceDelivery.id, 'email_fixture_1')
    expect(repository.markSent).toHaveBeenCalledWith(noteDelivery.id, 'email_fixture_1')
  })

  it('skips a buyer with no verified email and fails a missing document without sending', async () => {
    const repository = fakeRepository([invoiceDelivery, noteDelivery], { [invoiceDelivery.id]: { email: null }, [noteDelivery.id]: null })
    const resend = fakeResend()
    const worker = createTaxDocumentEmailWorker({ repository, resend })

    await expect(worker.runSweep()).resolves.toMatchObject({ claimed: 2, sent: 0, skipped: 1, failed: 1 })
    expect(resend.sendEmail).not.toHaveBeenCalled()
    expect(repository.markSkipped).toHaveBeenCalledWith(invoiceDelivery.id, 'no_verified_email')
    expect(repository.markFailed).toHaveBeenCalledWith(noteDelivery.id, 'document_missing', false)
  })

  it('retries a rate-limited send later and stops the batch; a permanent refusal fails without the address in the error', async () => {
    const limited = fakeRepository([invoiceDelivery, noteDelivery])
    const limitedResend = fakeResend(async () => { throw new ResendApiError('rate_limit_exceeded', 429, 'Too many requests') })
    await expect(createTaxDocumentEmailWorker({ repository: limited, resend: limitedResend }).runSweep()).resolves.toMatchObject({ sent: 0, retrying: 1 })
    expect(limitedResend.sendEmail).toHaveBeenCalledTimes(1)
    expect(limited.markFailed).toHaveBeenCalledWith(invoiceDelivery.id, 'rate_limit_exceeded: Too many requests', true)

    const refused = fakeRepository([invoiceDelivery])
    const refusedResend = fakeResend(async () => { throw new ResendApiError('validation_error', 422, 'Invalid `to` field: learner@example.test') })
    await expect(createTaxDocumentEmailWorker({ repository: refused, resend: refusedResend }).runSweep()).resolves.toMatchObject({ failed: 1, retrying: 0 })
    const [, error, retryable] = refused.markFailed.mock.calls[0] as unknown as [string, string, boolean]
    expect(retryable).toBe(false)
    expect(error).toBe('validation_error: Invalid `to` field: [email]')
  })

  it('does nothing while Resend is not configured', async () => {
    const repository = fakeRepository([invoiceDelivery])
    const worker = createTaxDocumentEmailWorker({ repository, loadApiKey: async () => null })
    await expect(worker.runSweep()).resolves.toMatchObject({ claimed: 0, disabled: true })
    expect(repository.claimBatch).not.toHaveBeenCalled()
  })
})
