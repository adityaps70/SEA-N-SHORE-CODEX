import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from 'pdf-lib'
import { taxMoney, type SupplyType } from './gst'
import type { TaxCreditNote, TaxInvoice } from './tax-document-repository'

/**
 * GST tax invoice and credit note PDFs (C4). One A4 page each, drawn with the built-in Helvetica fonts. Every amount
 * printed comes from the stored document: nothing is worked out again here. The built-in fonts have no "₹" glyph, so
 * amounts carry the currency code ("INR 4,999.00").
 *
 * The text of each document is built first (`taxInvoiceContent`, `creditNoteContent`) and then drawn, so the wording
 * can be checked without reading the PDF.
 */

// ---------------------------------------------------------------------------------------------------------------------
// Text helpers

/** Characters the built-in (WinAnsi) fonts can draw besides printable ASCII and Latin-1. */
const WIN_ANSI_EXTRAS = '–—‘’“”•…€™‚„†‡‰‹›ŒœŠšŽžŸƒˆ˜'

/** Makes any text drawable with the built-in fonts: "₹" becomes "INR", other unknown characters become "?". */
export function safeText(value: string) {
  return value
    .normalize('NFC')
    .replace(/\u20B9\s*/g, 'INR ')
    .replace(/[\u2010-\u2012\u2015\u2212]/g, '-')
    .replace(/[\u2032\u02BC]/g, "'")
    .replace(/\u2033/g, '"')
    .replace(/[\t\r\n\u2028\u2029]+/g, ' ')
    .replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, ' ')
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
    .replace(/[^\x20-\x7E\xA1-\xFF]/g, (character) => (WIN_ANSI_EXTRAS.includes(character) ? character : '?'))
}

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen',
  'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen',
]
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

function belowHundred(value: number) {
  if (value < 20) return ONES[value]!
  const ones = value % 10
  return `${TENS[Math.floor(value / 10)]}${ones ? ` ${ONES[ones]}` : ''}`
}

function belowThousand(value: number) {
  const hundreds = Math.floor(value / 100)
  const rest = value % 100
  return [hundreds ? `${ONES[hundreds]} Hundred` : '', rest ? belowHundred(rest) : ''].filter(Boolean).join(' ')
}

function assertWhole(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('number_to_words_invalid')
}

/** A whole number in words in the Indian system (thousand, lakh, crore): 1234567 → "Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven". */
export function numberToIndianWords(value: number): string {
  assertWhole(value)
  if (value === 0) return 'Zero'
  const crore = Math.floor(value / 10_000_000)
  const lakh = Math.floor((value % 10_000_000) / 100_000)
  const thousand = Math.floor((value % 100_000) / 1000)
  const rest = value % 1000
  return [
    crore ? `${numberToIndianWords(crore)} Crore` : '',
    lakh ? `${belowHundred(lakh)} Lakh` : '',
    thousand ? `${belowHundred(thousand)} Thousand` : '',
    rest ? belowThousand(rest) : '',
  ].filter(Boolean).join(' ')
}

/** A whole number in words in the international system (thousand, million, billion), for USD documents. */
export function numberToInternationalWords(value: number): string {
  assertWhole(value)
  if (value === 0) return 'Zero'
  const scales: Array<[number, string]> = [[1_000_000_000, 'Billion'], [1_000_000, 'Million'], [1000, 'Thousand']]
  const parts: string[] = []
  let rest = value
  for (const [size, name] of scales) {
    const count = Math.floor(rest / size)
    if (count) parts.push(`${count >= 1000 ? numberToInternationalWords(count) : belowThousand(count)} ${name}`)
    rest %= size
  }
  if (rest) parts.push(belowThousand(rest))
  return parts.join(' ')
}

/** "Indian Rupees Four Thousand Nine Hundred Ninety Nine and Fifty Paise Only" (the paise part only when there are paise). */
export function amountInWords(minor: number, currency: 'INR' | 'USD') {
  assertWhole(minor)
  const major = Math.floor(minor / 100)
  const fraction = minor % 100
  if (currency === 'USD') {
    return `US Dollars ${numberToInternationalWords(major)}${fraction ? ` and ${numberToInternationalWords(fraction)} Cents` : ''} Only`
  }
  return `Indian Rupees ${numberToIndianWords(major)}${fraction ? ` and ${numberToIndianWords(fraction)} Paise` : ''} Only`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "2026-10-05" → "05 Oct 2026". */
export function taxDocumentDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  const month = match ? MONTHS[Number(match[2]) - 1] : undefined
  if (!match || !month) return value
  return `${match[3]} ${month} ${match[1]}`
}

/** "SNS/26-27/000001" → "SNS-26-27-000001.pdf". */
export function taxDocumentFileName(number: string) {
  const base = number.replace(/[\\/]+/g, '-').replace(/[^A-Za-z0-9._-]/g, '')
  return `${base || 'tax-document'}.pdf`
}

// ---------------------------------------------------------------------------------------------------------------------
// Content

export type LabelledValue = { label: string; value: string }

export type TaxDocumentContent = {
  title: string
  /** PDF title metadata. */
  documentTitle: string
  number: string
  issuer: { tradeName: string; legalName: string; gstin: string }
  supplier: { heading: string; lines: string[] }
  details: LabelledValue[]
  buyer: { heading: string; lines: string[] }
  supply: LabelledValue[]
  line: { description: string; sac: string; taxable: string }
  /** Taxable value, then each tax. */
  taxRows: LabelledValue[]
  total: LabelledValue
  notes: string[]
  amountInWords: string
  footer: string
}

type Amounts = Pick<TaxInvoice, 'taxableMinor' | 'cgstMinor' | 'sgstMinor' | 'igstMinor' | 'totalMinor'>

function percent(basisPoints: number) {
  const value = basisPoints / 100
  return `${Number.isInteger(value) ? value : value.toFixed(2).replace(/0+$/, '')}%`
}

const SUPPLY_LABELS: Record<SupplyType, string> = {
  intra_state: 'Intra-state (CGST + SGST)',
  inter_state: 'Inter-state (IGST)',
  export_lut: 'Export of services under LUT (zero-rated)',
}

function issuer(invoice: TaxInvoice) {
  return { tradeName: invoice.supplier.tradeName, legalName: invoice.supplier.legalName, gstin: invoice.supplier.gstin }
}

function supplierBlock(invoice: TaxInvoice) {
  const supplier = invoice.supplier
  const address = Array.isArray(supplier.address) ? supplier.address : []
  return {
    heading: 'Supplier',
    lines: [
      supplier.legalName,
      `Trade name: ${supplier.tradeName}`,
      `GSTIN: ${supplier.gstin}`,
      `Registration: ${supplier.registration}`,
      ...address,
      `State: ${supplier.stateName} (state code ${supplier.stateCode})`,
    ],
  }
}

function buyerBlock(invoice: TaxInvoice, heading: string) {
  const exported = invoice.supplyType === 'export_lut'
  return {
    heading,
    lines: [
      invoice.buyerName,
      ...(invoice.buyerCompany ? [invoice.buyerCompany] : []),
      ...(invoice.buyerGstin ? [`GSTIN: ${invoice.buyerGstin}`] : []),
      exported ? 'Billing address: Outside India' : `Billing state: ${invoice.placeOfSupplyName} (state code ${invoice.placeOfSupplyCode})`,
    ],
  }
}

function supplyBlock(invoice: TaxInvoice): LabelledValue[] {
  const exported = invoice.supplyType === 'export_lut'
  return [
    { label: 'Place of supply', value: exported ? 'Outside India (export)' : `${invoice.placeOfSupplyName} (state code ${invoice.placeOfSupplyCode})` },
    { label: 'Supply type', value: SUPPLY_LABELS[invoice.supplyType] },
    { label: 'Buyer', value: exported ? 'Overseas' : invoice.buyerGstin ? 'Registered (B2B)' : 'Unregistered (B2C)' },
    { label: 'Currency', value: invoice.currency === 'INR' ? 'INR (Indian Rupee)' : 'USD (US Dollar)' },
  ]
}

function taxRows(invoice: TaxInvoice, amounts: Amounts): LabelledValue[] {
  const money = (minor: number) => taxMoney(minor, invoice.currency)
  const rows: LabelledValue[] = [{ label: 'Taxable value', value: money(amounts.taxableMinor) }]
  if (invoice.supplyType === 'intra_state') {
    const half = percent(invoice.gstRateBasisPoints / 2)
    rows.push({ label: `CGST ${half}`, value: money(amounts.cgstMinor) })
    rows.push({ label: `SGST ${half}`, value: money(amounts.sgstMinor) })
  } else if (invoice.supplyType === 'inter_state') {
    rows.push({ label: `IGST ${percent(invoice.gstRateBasisPoints)}`, value: money(amounts.igstMinor) })
  } else {
    rows.push({ label: 'IGST 0% (export under LUT)', value: money(amounts.igstMinor) })
  }
  return rows
}

function lutNote(invoice: TaxInvoice) {
  return invoice.supplyType === 'export_lut'
    ? [`IGST 0% — supply meant for export under LUT without payment of IGST (LUT ARN ${invoice.lutArn ?? 'not recorded'}).`]
    : []
}

const PRICES_INCLUDE_GST = 'Prices include GST. The tax shown is part of the price paid, not added to it.'

export function taxInvoiceContent(invoice: TaxInvoice): TaxDocumentContent {
  return {
    title: 'TAX INVOICE',
    documentTitle: `Tax invoice ${invoice.invoiceNumber}`,
    number: invoice.invoiceNumber,
    issuer: issuer(invoice),
    supplier: supplierBlock(invoice),
    details: [
      { label: 'Invoice number', value: invoice.invoiceNumber },
      { label: 'Invoice date', value: taxDocumentDate(invoice.invoiceDate) },
      { label: 'Order ID', value: invoice.orderReference },
      { label: 'Nature of supply', value: 'Supply of services' },
      { label: 'Reverse charge', value: 'No' },
    ],
    buyer: buyerBlock(invoice, 'Bill to'),
    supply: supplyBlock(invoice),
    line: { description: invoice.description, sac: invoice.sac, taxable: taxMoney(invoice.taxableMinor, invoice.currency) },
    taxRows: taxRows(invoice, invoice),
    total: { label: 'Total (invoice value)', value: taxMoney(invoice.totalMinor, invoice.currency) },
    notes: [...lutNote(invoice), PRICES_INCLUDE_GST],
    amountInWords: amountInWords(invoice.totalMinor, invoice.currency),
    footer: 'This is a computer-generated invoice and needs no signature.',
  }
}

export function creditNoteContent(note: TaxCreditNote, invoice: TaxInvoice): TaxDocumentContent {
  return {
    title: 'CREDIT NOTE',
    documentTitle: `Credit note ${note.creditNoteNumber}`,
    number: note.creditNoteNumber,
    issuer: issuer(invoice),
    supplier: supplierBlock(invoice),
    details: [
      { label: 'Credit note number', value: note.creditNoteNumber },
      { label: 'Credit note date', value: taxDocumentDate(note.noteDate) },
      { label: 'Against invoice', value: `${invoice.invoiceNumber} dated ${taxDocumentDate(invoice.invoiceDate)}` },
      { label: 'Order ID', value: invoice.orderReference },
      { label: 'Reason', value: note.reason },
      { label: 'Reverse charge', value: 'No' },
    ],
    buyer: buyerBlock(invoice, 'Issued to'),
    supply: supplyBlock(invoice),
    line: { description: invoice.description, sac: invoice.sac, taxable: taxMoney(note.taxableMinor, invoice.currency) },
    taxRows: taxRows(invoice, note),
    total: { label: 'Total (credit note value)', value: taxMoney(note.totalMinor, invoice.currency) },
    notes: [
      ...lutNote(invoice),
      `This credit note reduces the value of invoice ${invoice.invoiceNumber}, including the GST charged on it.`,
    ],
    amountInWords: amountInWords(note.totalMinor, invoice.currency),
    footer: 'This is a computer-generated credit note and needs no signature.',
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Drawing

const A4: [number, number] = [595.28, 841.89]
const MARGIN = 48
const NAVY = rgb(0.04, 0.15, 0.22)
const OCEAN = rgb(0.03, 0.37, 0.51)
const MUTED = rgb(0.36, 0.42, 0.46)
const RULE = rgb(0.82, 0.86, 0.88)
const SHADE = rgb(0.94, 0.96, 0.97)

type Canvas = { page: PDFPage; regular: PDFFont; bold: PDFFont; width: number; height: number }
type TextStyle = { size?: number; bold?: boolean; color?: RGB }

function fontOf(canvas: Canvas, style: TextStyle) {
  return style.bold ? canvas.bold : canvas.regular
}

function widthOf(canvas: Canvas, text: string, style: TextStyle = {}) {
  return fontOf(canvas, style).widthOfTextAtSize(safeText(text), style.size ?? 9)
}

function draw(canvas: Canvas, text: string, x: number, y: number, style: TextStyle = {}) {
  canvas.page.drawText(safeText(text), { x, y, size: style.size ?? 9, font: fontOf(canvas, style), color: style.color ?? NAVY })
}

function drawRight(canvas: Canvas, text: string, right: number, y: number, style: TextStyle = {}) {
  draw(canvas, text, right - widthOf(canvas, text, style), y, style)
}

/** Splits text into lines no wider than `maxWidth`; a word longer than a line is broken between characters. */
export function wrapText(text: string, measure: (value: string) => number, maxWidth: number) {
  const words = safeText(text).split(' ').filter(Boolean)
  const lines: string[] = []
  let current = ''
  const pushWord = (word: string) => {
    let rest = word
    while (measure(rest) > maxWidth && rest.length > 1) {
      let cut = rest.length - 1
      while (cut > 1 && measure(rest.slice(0, cut)) > maxWidth) cut -= 1
      lines.push(rest.slice(0, cut))
      rest = rest.slice(cut)
    }
    current = rest
  }
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (measure(candidate) <= maxWidth) {
      current = candidate
      continue
    }
    if (current) lines.push(current)
    pushWord(word)
  }
  if (current) lines.push(current)
  return lines.length ? lines : ['']
}

function wrapped(canvas: Canvas, text: string, maxWidth: number, style: TextStyle = {}) {
  return wrapText(text, (value) => widthOf(canvas, value, style), maxWidth)
}

/** Draws wrapped text from a baseline downwards; returns the baseline below the last line. */
function paragraph(canvas: Canvas, text: string, x: number, y: number, maxWidth: number, style: TextStyle = {}, leading = 1.38) {
  const size = style.size ?? 9
  let baseline = y
  for (const line of wrapped(canvas, text, maxWidth, style)) {
    draw(canvas, line, x, baseline, style)
    baseline -= size * leading
  }
  return baseline
}

function heading(canvas: Canvas, text: string, x: number, y: number) {
  draw(canvas, text.toUpperCase(), x, y, { size: 7.5, bold: true, color: OCEAN })
}

function rule(canvas: Canvas, y: number, x1 = MARGIN, x2 = canvas.width - MARGIN, color: RGB = RULE, thickness = 0.7) {
  canvas.page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness, color })
}

/** A party block (supplier or buyer): heading, the first line in bold, then the rest. */
function party(canvas: Canvas, block: { heading: string; lines: string[] }, x: number, y: number, maxWidth: number) {
  heading(canvas, block.heading, x, y)
  let baseline = y - 16
  block.lines.forEach((line, index) => {
    baseline = paragraph(canvas, line, x, baseline, maxWidth, index === 0 ? { size: 10, bold: true } : { size: 9 })
    if (index === 0) baseline -= 1
  })
  return baseline
}

/** Label / value rows. Long values wrap under themselves; one long word (an order ID) is made smaller to fit one line. */
function labelled(canvas: Canvas, title: string, rows: LabelledValue[], x: number, y: number, width: number, labelWidth = 96) {
  heading(canvas, title, x, y)
  let baseline = y - 16
  const valueWidth = width - labelWidth
  for (const row of rows) {
    draw(canvas, row.label, x, baseline, { size: 8.5, color: MUTED })
    const style: TextStyle = { size: 9, bold: row.label.endsWith('number') }
    if (!/\s/.test(row.value.trim())) {
      while ((style.size ?? 9) > 7 && widthOf(canvas, row.value, style) > valueWidth) style.size = (style.size ?? 9) - 0.25
    }
    baseline = paragraph(canvas, row.value, x + labelWidth, baseline, valueWidth, style, 9 * 1.38 / (style.size ?? 9)) - 2
  }
  return baseline
}

function drawDocument(canvas: Canvas, content: TaxDocumentContent) {
  const { page, width, height } = canvas
  const left = MARGIN
  const right = width - MARGIN
  const columnGap = 24
  // The supplier and buyer blocks need less room than the labelled details beside them.
  const columnWidth = 205
  const rightColumn = left + columnWidth + columnGap
  const rightWidth = right - rightColumn

  // Header band
  page.drawRectangle({ x: 0, y: height - 8, width, height: 8, color: OCEAN })
  let y = height - 58
  draw(canvas, content.issuer.tradeName, left, y, { size: 20, bold: true, color: OCEAN })
  drawRight(canvas, content.title, right, y, { size: 20, bold: true })
  y -= 16
  draw(canvas, content.issuer.legalName, left, y, { size: 9, color: MUTED })
  drawRight(canvas, content.number, right, y, { size: 10, bold: true, color: OCEAN })
  y -= 18
  rule(canvas, y, left, right, NAVY, 1)

  // Supplier | document details
  y -= 22
  const afterSupplier = party(canvas, content.supplier, left, y, columnWidth)
  const afterDetails = labelled(canvas, content.title === 'TAX INVOICE' ? 'Invoice details' : 'Credit note details', content.details, rightColumn, y, rightWidth)
  y = Math.min(afterSupplier, afterDetails) - 10
  rule(canvas, y, left, right)

  // Buyer | place of supply
  y -= 22
  const afterBuyer = party(canvas, content.buyer, left, y, columnWidth)
  const afterSupply = labelled(canvas, 'Supply', content.supply, rightColumn, y, rightWidth)
  y = Math.min(afterBuyer, afterSupply) - 16

  // Line table
  const columns = { index: left + 10, description: left + 34, sac: left + 330, amount: right - 10 }
  const headerHeight = 22
  page.drawRectangle({ x: left, y: y - headerHeight, width: right - left, height: headerHeight, color: NAVY })
  const headerBaseline = y - 14.5
  const headerStyle = { size: 8, bold: true, color: rgb(1, 1, 1) }
  draw(canvas, '#', columns.index, headerBaseline, headerStyle)
  draw(canvas, 'Description of service', columns.description, headerBaseline, headerStyle)
  draw(canvas, 'SAC', columns.sac, headerBaseline, headerStyle)
  drawRight(canvas, 'Taxable value', columns.amount, headerBaseline, headerStyle)
  y -= headerHeight + 16
  draw(canvas, '1', columns.index, y, { size: 9.5 })
  draw(canvas, content.line.sac, columns.sac, y, { size: 9.5 })
  drawRight(canvas, content.line.taxable, columns.amount, y, { size: 9.5 })
  y = paragraph(canvas, content.line.description, columns.description, y, columns.sac - columns.description - 16, { size: 9.5 })
  y -= 2
  rule(canvas, y, left, right)

  // Totals (right) and notes (left)
  const totalsLeft = left + (right - left) * 0.5
  let totalsY = y - 18
  for (const row of content.taxRows) {
    draw(canvas, row.label, totalsLeft + 10, totalsY, { size: 9.5 })
    drawRight(canvas, row.value, right - 10, totalsY, { size: 9.5 })
    totalsY -= 17
  }
  const totalHeight = 26
  page.drawRectangle({ x: totalsLeft, y: totalsY - totalHeight + 12, width: right - totalsLeft, height: totalHeight, color: SHADE })
  rule(canvas, totalsY + 12, totalsLeft, right, NAVY, 1)
  const totalBaseline = totalsY - 4.5
  draw(canvas, content.total.label, totalsLeft + 10, totalBaseline, { size: 10, bold: true })
  drawRight(canvas, content.total.value, right - 10, totalBaseline, { size: 11, bold: true })
  totalsY -= totalHeight

  let notesY = y - 18
  for (const note of content.notes) {
    notesY = paragraph(canvas, note, left, notesY, totalsLeft - left - 24, { size: 8.5, color: MUTED }) - 5
  }
  y = Math.min(totalsY, notesY) - 14

  // Amount in words
  const wordsLines = wrapped(canvas, content.amountInWords, right - left - 24, { size: 9.5, bold: true })
  const wordsHeight = 30 + wordsLines.length * 13
  page.drawRectangle({ x: left, y: y - wordsHeight, width: right - left, height: wordsHeight, borderColor: RULE, borderWidth: 0.8 })
  heading(canvas, 'Amount in words', left + 12, y - 15)
  let wordsY = y - 30
  for (const line of wordsLines) {
    draw(canvas, line, left + 12, wordsY, { size: 9.5, bold: true })
    wordsY -= 13
  }

  // Footer
  const footerY = MARGIN + 18
  rule(canvas, footerY + 16, left, right)
  const footer = content.footer
  draw(canvas, footer, (width - widthOf(canvas, footer, { size: 8.5 })) / 2, footerY, { size: 8.5, color: MUTED })
  const imprint = `${content.issuer.legalName} · GSTIN ${content.issuer.gstin}`
  draw(canvas, imprint, (width - widthOf(canvas, imprint, { size: 7.5 })) / 2, footerY - 13, { size: 7.5, color: MUTED })
}

async function renderPdf(content: TaxDocumentContent, subject: string) {
  const pdf = await PDFDocument.create()
  pdf.setTitle(safeText(content.documentTitle))
  pdf.setSubject(subject)
  pdf.setAuthor('Beaufort Marine Services LLP (Sea N Shore)')
  pdf.setCreator('Sea N Shore')
  pdf.setProducer('Sea N Shore')
  const page = pdf.addPage(A4)
  const [regular, bold] = await Promise.all([pdf.embedFont(StandardFonts.Helvetica), pdf.embedFont(StandardFonts.HelveticaBold)])
  drawDocument({ page, regular, bold, width: page.getWidth(), height: page.getHeight() }, content)
  return pdf.save()
}

export async function buildTaxInvoicePdf(invoice: TaxInvoice): Promise<Uint8Array> {
  return renderPdf(taxInvoiceContent(invoice), 'GST tax invoice')
}

export async function buildCreditNotePdf(note: TaxCreditNote, invoice: TaxInvoice): Promise<Uint8Array> {
  return renderPdf(creditNoteContent(note, invoice), 'GST credit note')
}
