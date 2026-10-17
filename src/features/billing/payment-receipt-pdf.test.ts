import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { GST_SUPPLIER } from '@/features/tax/gst'
import { NOT_A_TAX_INVOICE, RECEIPT_TITLE, buildPaymentReceiptPdf, paymentReceiptContent, paymentReceiptFileName, receiptNumber } from './payment-receipt-pdf'

const receipt = {
  id: '22222222-2222-4222-8222-222222222222',
  reference: 'cf_123',
  paidAt: '2026-10-01T20:30:00.000Z',
  amountMinor: 118000,
  currency: 'INR',
  item: 'Organization Pro · monthly',
  payerName: 'Placeholder Member',
  organizationName: 'Placeholder Shipping',
  refunded: false as const,
}

describe('payment receipt PDF (Round H, H7)', () => {
  it('is titled a payment receipt and says it is not a tax invoice', () => {
    const content = paymentReceiptContent(receipt)
    expect(content.title).toBe(RECEIPT_TITLE)
    expect(content.title).not.toMatch(/invoice/i)
    expect(content.notes[0]).toBe(NOT_A_TAX_INVOICE)
    expect(content.seller).toEqual(expect.arrayContaining([GST_SUPPLIER.legalName, `GSTIN: ${GST_SUPPLIER.gstin}`]))
    expect(content.receivedFrom).toEqual(['Placeholder Shipping', 'Paid by Placeholder Member'])
    expect(content.amount).toBe('INR 1,180.00')
    expect(content.amountInWords).toBe('Indian Rupees One Thousand One Hundred Eighty Only')
    // The payment date is the date in India (20:30 UTC is the next morning in India).
    expect(content.details).toContainEqual({ label: 'Payment date', value: '02 Oct 2026' })
  })

  it('numbers receipts from the payment id, never from the tax-invoice series', () => {
    expect(receiptNumber(receipt.id)).toBe('SNS-R-22222222')
    expect(paymentReceiptFileName(receipt.id)).toBe('SNS-R-22222222.pdf')
  })

  it('builds a one-page PDF', async () => {
    const bytes = await buildPaymentReceiptPdf({ ...receipt, refunded: false })
    const pdf = await PDFDocument.load(bytes)
    expect(pdf.getPageCount()).toBe(1)
    expect(pdf.getTitle()).toBe('Payment receipt SNS-R-22222222')
  })
})
