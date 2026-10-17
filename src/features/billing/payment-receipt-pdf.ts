import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import { GST_SUPPLIER, indiaDate, taxMoney } from '@/features/tax/gst'
import { amountInWords, safeText, taxDocumentDate, taxDocumentFileName, wrapText } from '@/features/tax/tax-document-pdf'
import type { PaymentReceiptRecord } from './payment-history'

/**
 * Round H (H7): a "Payment receipt" PDF for subscription payments and event tickets. It is deliberately NOT a GST tax
 * invoice: these payments carry no invoice number from a sequential series and no GST breakdown, so the receipt says
 * so in its title and its notes. One A4 page, built-in Helvetica (amounts print the currency code, not "₹").
 */

export const RECEIPT_TITLE = 'PAYMENT RECEIPT'
export const NOT_A_TAX_INVOICE = 'This is a payment receipt, not a tax invoice.'

export type PaymentReceiptContent = {
  title: string
  number: string
  seller: string[]
  details: { label: string; value: string }[]
  receivedFrom: string[]
  item: string
  amount: string
  amountInWords: string
  notes: string[]
}

/** "SNS-R-1A2B3C4D", from the payment's id: a stable reference, not a tax-invoice number. */
export function receiptNumber(id: string) {
  return `SNS-R-${id.replace(/-/g, '').slice(0, 8).toUpperCase()}`
}

function receiptCurrency(currency: string): 'INR' | 'USD' {
  return currency === 'USD' ? 'USD' : 'INR'
}

export function paymentReceiptContent(receipt: PaymentReceiptRecord): PaymentReceiptContent {
  const currency = receiptCurrency(receipt.currency)
  const number = receiptNumber(receipt.id)
  const receivedFrom = [
    ...(receipt.organizationName ? [receipt.organizationName] : []),
    ...(receipt.payerName ? [receipt.organizationName ? `Paid by ${receipt.payerName}` : receipt.payerName] : []),
  ]
  return {
    title: RECEIPT_TITLE,
    number,
    seller: [GST_SUPPLIER.legalName, `Trade name: ${GST_SUPPLIER.tradeName}`, ...GST_SUPPLIER.address, `GSTIN: ${GST_SUPPLIER.gstin}`],
    details: [
      { label: 'Receipt number', value: number },
      { label: 'Payment date', value: taxDocumentDate(indiaDate(new Date(receipt.paidAt))) },
      { label: 'Payment reference', value: receipt.reference },
      ...(receipt.refunded ? [{ label: 'Status', value: 'Refunded after payment' }] : []),
    ],
    receivedFrom: receivedFrom.length ? receivedFrom : ['Sea N Shore member'],
    item: receipt.item,
    amount: taxMoney(receipt.amountMinor, currency),
    amountInWords: amountInWords(receipt.amountMinor, currency),
    notes: [
      NOT_A_TAX_INVOICE,
      'It confirms that the amount above was received through our payment provider. It carries no GST breakdown and cannot be used to claim input tax credit.',
    ],
  }
}

const A4: [number, number] = [595.28, 841.89]
const MARGIN = 48
const NAVY = rgb(0.04, 0.15, 0.22)
const OCEAN = rgb(0.03, 0.37, 0.51)
const MUTED = rgb(0.36, 0.42, 0.46)
const RULE = rgb(0.82, 0.86, 0.88)

type Canvas = { page: PDFPage; regular: PDFFont; bold: PDFFont }

function text(canvas: Canvas, value: string, x: number, y: number, size = 9, bold = false, color = NAVY) {
  canvas.page.drawText(safeText(value), { x, y, size, font: bold ? canvas.bold : canvas.regular, color })
}

function width(canvas: Canvas, value: string, size = 9, bold = false) {
  return (bold ? canvas.bold : canvas.regular).widthOfTextAtSize(safeText(value), size)
}

function lines(canvas: Canvas, values: string[], x: number, y: number, maxWidth: number, size = 9) {
  let baseline = y
  values.forEach((value, index) => {
    for (const line of wrapText(value, (part) => width(canvas, part, size, index === 0), maxWidth)) {
      text(canvas, line, x, baseline, size, index === 0)
      baseline -= size * 1.4
    }
  })
  return baseline
}

export async function buildPaymentReceiptPdf(receipt: PaymentReceiptRecord): Promise<Uint8Array> {
  const content = paymentReceiptContent(receipt)
  const pdf = await PDFDocument.create()
  pdf.setTitle(safeText(`Payment receipt ${content.number}`))
  pdf.setSubject('Payment receipt (not a tax invoice)')
  pdf.setAuthor('Beaufort Marine Services LLP (Sea N Shore)')
  pdf.setCreator('Sea N Shore')
  pdf.setProducer('Sea N Shore')
  const page = pdf.addPage(A4)
  const [regular, bold] = await Promise.all([pdf.embedFont(StandardFonts.Helvetica), pdf.embedFont(StandardFonts.HelveticaBold)])
  const canvas: Canvas = { page, regular, bold }
  const { width: pageWidth, height } = page.getSize()
  const right = pageWidth - MARGIN

  page.drawRectangle({ x: 0, y: height - 8, width: pageWidth, height: 8, color: OCEAN })
  let y = height - 58
  text(canvas, GST_SUPPLIER.tradeName, MARGIN, y, 20, true, OCEAN)
  text(canvas, content.title, right - width(canvas, content.title, 20, true), y, 20, true)
  y -= 16
  text(canvas, GST_SUPPLIER.legalName, MARGIN, y, 9, false, MUTED)
  text(canvas, content.number, right - width(canvas, content.number, 10, true), y, 10, true, OCEAN)
  y -= 18
  page.drawLine({ start: { x: MARGIN, y }, end: { x: right, y }, thickness: 1, color: NAVY })

  y -= 24
  text(canvas, 'RECEIVED BY', MARGIN, y, 7.5, true, OCEAN)
  text(canvas, 'RECEIPT DETAILS', 300, y, 7.5, true, OCEAN)
  const afterSeller = lines(canvas, content.seller, MARGIN, y - 16, 220)
  let detailsY = y - 16
  for (const row of content.details) {
    text(canvas, row.label, 300, detailsY, 8.5, false, MUTED)
    for (const line of wrapText(row.value, (part) => width(canvas, part, 9), right - 400)) {
      text(canvas, line, 400, detailsY, 9, row.label === 'Receipt number')
      detailsY -= 12.6
    }
    detailsY -= 2
  }
  y = Math.min(afterSeller, detailsY) - 12
  page.drawLine({ start: { x: MARGIN, y }, end: { x: right, y }, thickness: 0.7, color: RULE })

  y -= 22
  text(canvas, 'RECEIVED FROM', MARGIN, y, 7.5, true, OCEAN)
  y = lines(canvas, content.receivedFrom, MARGIN, y - 16, right - MARGIN) - 14

  page.drawRectangle({ x: MARGIN, y: y - 22, width: right - MARGIN, height: 22, color: NAVY })
  text(canvas, 'Description', MARGIN + 10, y - 14.5, 8, true, rgb(1, 1, 1))
  text(canvas, 'Amount received', right - 10 - width(canvas, 'Amount received', 8, true), y - 14.5, 8, true, rgb(1, 1, 1))
  y -= 38
  text(canvas, content.amount, right - 10 - width(canvas, content.amount, 10, true), y, 10, true)
  for (const line of wrapText(content.item, (part) => width(canvas, part, 9.5), right - MARGIN - 160)) {
    text(canvas, line, MARGIN + 10, y, 9.5)
    y -= 13.3
  }
  y -= 4
  page.drawLine({ start: { x: MARGIN, y }, end: { x: right, y }, thickness: 0.7, color: RULE })

  y -= 20
  text(canvas, 'AMOUNT IN WORDS', MARGIN, y, 7.5, true, OCEAN)
  y = lines(canvas, [content.amountInWords], MARGIN, y - 15, right - MARGIN, 9.5) - 12
  for (const note of content.notes) {
    for (const line of wrapText(note, (part) => width(canvas, part, 8.5), right - MARGIN)) {
      text(canvas, line, MARGIN, y, 8.5, note === NOT_A_TAX_INVOICE, note === NOT_A_TAX_INVOICE ? NAVY : MUTED)
      y -= 12
    }
    y -= 4
  }

  const footer = 'This is a computer-generated receipt and needs no signature.'
  page.drawLine({ start: { x: MARGIN, y: MARGIN + 34 }, end: { x: right, y: MARGIN + 34 }, thickness: 0.7, color: RULE })
  text(canvas, footer, (pageWidth - width(canvas, footer, 8.5)) / 2, MARGIN + 18, 8.5, false, MUTED)
  return pdf.save()
}

/** "SNS-R-1A2B3C4D.pdf". */
export function paymentReceiptFileName(id: string) {
  return taxDocumentFileName(receiptNumber(id))
}
