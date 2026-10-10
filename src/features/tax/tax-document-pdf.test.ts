import { afterEach, describe, expect, it, vi } from 'vitest'
import { PDFDocument, PDFPage } from 'pdf-lib'
import {
  amountInWords,
  buildCreditNotePdf,
  buildTaxInvoicePdf,
  creditNoteContent,
  numberToIndianWords,
  numberToInternationalWords,
  safeText,
  taxDocumentDate,
  taxDocumentFileName,
  taxInvoiceContent,
  wrapText,
} from './tax-document-pdf'
import { FIXTURE_BUYER_GSTIN, sampleCreditNote, sampleInvoice } from './tax-test-fixtures'

afterEach(() => {
  vi.restoreAllMocks()
})

/** Every string drawn on the page, in order. */
async function drawnText(build: () => Promise<Uint8Array>) {
  const drawn: string[] = []
  const original = PDFPage.prototype.drawText
  vi.spyOn(PDFPage.prototype, 'drawText').mockImplementation(function (this: PDFPage, text, options) {
    drawn.push(text)
    return original.call(this, text, options)
  })
  const bytes = await build()
  return { bytes, drawn, all: drawn.join('\n') }
}

describe('numberToIndianWords', () => {
  it.each([
    [0, 'Zero'],
    [7, 'Seven'],
    [19, 'Nineteen'],
    [40, 'Forty'],
    [99, 'Ninety Nine'],
    [100, 'One Hundred'],
    [101, 'One Hundred One'],
    [1000, 'One Thousand'],
    [4999, 'Four Thousand Nine Hundred Ninety Nine'],
    [100_000, 'One Lakh'],
    [1_234_567, 'Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven'],
    [10_000_000, 'One Crore'],
    [987_654_321, 'Ninety Eight Crore Seventy Six Lakh Fifty Four Thousand Three Hundred Twenty One'],
    [12_345_678_901, 'One Thousand Two Hundred Thirty Four Crore Fifty Six Lakh Seventy Eight Thousand Nine Hundred One'],
  ])('%i → %s', (value, words) => {
    expect(numberToIndianWords(value)).toBe(words)
  })

  it('refuses negative, fractional and unsafe numbers', () => {
    expect(() => numberToIndianWords(-1)).toThrow('number_to_words_invalid')
    expect(() => numberToIndianWords(1.5)).toThrow('number_to_words_invalid')
    expect(() => numberToIndianWords(Number.MAX_SAFE_INTEGER + 2)).toThrow('number_to_words_invalid')
  })

  it('has an international form for USD documents', () => {
    expect(numberToInternationalWords(1_250_000)).toBe('One Million Two Hundred Fifty Thousand')
    expect(numberToInternationalWords(49)).toBe('Forty Nine')
  })
})

describe('amountInWords', () => {
  it('writes rupees and paise, leaving out a zero paise part', () => {
    expect(amountInWords(499_900, 'INR')).toBe('Indian Rupees Four Thousand Nine Hundred Ninety Nine Only')
    expect(amountInWords(423_644, 'INR')).toBe('Indian Rupees Four Thousand Two Hundred Thirty Six and Forty Four Paise Only')
    expect(amountInWords(5, 'INR')).toBe('Indian Rupees Zero and Five Paise Only')
    expect(amountInWords(4_950, 'USD')).toBe('US Dollars Forty Nine and Fifty Cents Only')
  })
})

describe('text helpers', () => {
  it('safeText keeps what the built-in fonts can draw and replaces the rest', () => {
    expect(safeText('₹4,999 course')).toBe('INR 4,999 course')
    expect(safeText('Café — “quoted” – ‘single’ • …')).toBe('Café — “quoted” – ‘single’ • …')
    expect(safeText('line\nbreak\ttab')).toBe('line break tab')
    expect(safeText('non‑breaking space​')).toBe('non-breaking space')
    expect(safeText('Tamil தமிழ் 🚢')).toBe('Tamil ????? ??')
  })

  it('formats dates as DD Mon YYYY and file names without slashes', () => {
    expect(taxDocumentDate('2026-10-05')).toBe('05 Oct 2026')
    expect(taxDocumentDate('2027-03-31')).toBe('31 Mar 2027')
    expect(taxDocumentFileName('SNS/26-27/000001')).toBe('SNS-26-27-000001.pdf')
    expect(taxDocumentFileName('SNC/26-27/000002')).toBe('SNC-26-27-000002.pdf')
  })

  it('wraps text to the width and breaks a word longer than a line', () => {
    const measure = (value: string) => value.length
    expect(wrapText('one two three four', measure, 9)).toEqual(['one two', 'three', 'four'])
    expect(wrapText('abcdefghijkl', measure, 5)).toEqual(['abcde', 'fghij', 'kl'])
  })
})

describe('tax invoice content', () => {
  it('has every part a GST invoice needs, for an intra-state B2B sale', () => {
    const invoice = sampleInvoice()
    const content = taxInvoiceContent(invoice)
    expect(content.title).toBe('TAX INVOICE')
    expect(content.supplier.lines).toEqual([
      'Beaufort Marine Services LLP',
      'Trade name: Sea N Shore',
      'GSTIN: 27AASFB2030K1ZE',
      'Registration: Regular',
      '0502, Hermes Hiranandani Fortune City',
      'Bhokarpada, Panvel, Raigad',
      'Maharashtra 410206',
      'State: Maharashtra (state code 27)',
    ])
    expect(content.details).toEqual([
      { label: 'Invoice number', value: 'SNS/26-27/000001' },
      { label: 'Invoice date', value: '05 Oct 2026' },
      { label: 'Order ID', value: 'crs_22222222222242228222222222222222' },
      { label: 'Nature of supply', value: 'Supply of services' },
      { label: 'Reverse charge', value: 'No' },
    ])
    expect(content.buyer.lines).toEqual(['Fixture Learner', 'Fixture Shipping Pvt Ltd', `GSTIN: ${FIXTURE_BUYER_GSTIN}`, 'Billing state: Maharashtra (state code 27)'])
    expect(content.supply).toContainEqual({ label: 'Place of supply', value: 'Maharashtra (state code 27)' })
    expect(content.supply).toContainEqual({ label: 'Buyer', value: 'Registered (B2B)' })
    expect(content.line).toEqual({ description: 'SIRE 2.0 Inspection Readiness: online course access', sac: '999293', taxable: 'INR 4,236.44' })
    expect(content.taxRows).toEqual([
      { label: 'Taxable value', value: 'INR 4,236.44' },
      { label: 'CGST 9%', value: 'INR 381.28' },
      { label: 'SGST 9%', value: 'INR 381.28' },
    ])
    expect(content.total).toEqual({ label: 'Total (invoice value)', value: 'INR 4,999.00' })
    expect(content.notes.join(' ')).toContain('Prices include GST')
    expect(content.amountInWords).toBe('Indian Rupees Four Thousand Nine Hundred Ninety Nine Only')
    expect(content.footer).toBe('This is a computer-generated invoice and needs no signature.')
  })

  it('shows IGST for an inter-state B2C sale and the LUT statement for an export', () => {
    const inter = taxInvoiceContent(sampleInvoice({ supplyType: 'inter_state', buyerCompany: null, buyerGstin: null }))
    expect(inter.taxRows.map((row) => row.label)).toEqual(['Taxable value', 'IGST 18%'])
    expect(inter.buyer.lines).toEqual(['Fixture Learner', 'Billing state: Karnataka (state code 29)'])
    expect(inter.supply).toContainEqual({ label: 'Buyer', value: 'Unregistered (B2C)' })

    const exported = taxInvoiceContent(sampleInvoice({ supplyType: 'export_lut', totalMinor: 4_950 }))
    expect(exported.supply).toContainEqual({ label: 'Place of supply', value: 'Outside India (export)' })
    expect(exported.buyer.lines).toEqual(['Fixture Learner', 'Billing address: Outside India'])
    expect(exported.taxRows).toEqual([
      { label: 'Taxable value', value: 'USD 49.50' },
      { label: 'IGST 0% (export under LUT)', value: 'USD 0.00' },
    ])
    expect(exported.notes[0]).toBe('IGST 0% — supply meant for export under LUT without payment of IGST (LUT ARN AD2703260000001).')
    expect(exported.amountInWords).toBe('US Dollars Forty Nine and Fifty Cents Only')
  })

  it('prints the stored amounts, never recomputed ones', () => {
    // A stored document whose split differs from today's maths still prints as stored.
    const content = taxInvoiceContent(sampleInvoice({ taxableMinor: 400_000, cgstMinor: 50_000, sgstMinor: 49_900, totalMinor: 499_900 }))
    expect(content.taxRows.map((row) => row.value)).toEqual(['INR 4,000.00', 'INR 500.00', 'INR 499.00'])
  })
})

describe('buildTaxInvoicePdf', () => {
  it('builds a one-page A4 PDF that draws the invoice text', async () => {
    const invoice = sampleInvoice()
    const { bytes, all } = await drawnText(() => buildTaxInvoicePdf(invoice))
    const document = await PDFDocument.load(bytes)
    expect(document.getPageCount()).toBe(1)
    const [page] = document.getPages()
    expect(Math.round(page!.getWidth())).toBe(595)
    expect(Math.round(page!.getHeight())).toBe(842)
    expect(document.getTitle()).toBe('Tax invoice SNS/26-27/000001')
    for (const text of ['TAX INVOICE', 'SNS/26-27/000001', '05 Oct 2026', '27AASFB2030K1ZE', FIXTURE_BUYER_GSTIN, 'Fixture Shipping Pvt Ltd', '999293', 'CGST 9%', 'SGST 9%', 'INR 381.28', 'INR 4,999.00', 'Supply of services', 'Reverse charge', 'Indian Rupees Four Thousand Nine Hundred Ninety Nine Only', 'This is a computer-generated invoice and needs no signature.']) {
      expect(all).toContain(text)
    }
    expect(all).not.toContain('₹')
  })

  it('stays on one page with a long description, a long name and an export', async () => {
    const invoice = sampleInvoice({
      supplyType: 'export_lut',
      totalMinor: 12_345_678,
      buyerName: 'Fixture Learner With A Very Long Name That Needs More Than One Line To Print',
      description: `${'Advanced Fixture Course With A Long Title '.repeat(6).trim()}: online course access`,
    })
    const document = await PDFDocument.load(await buildTaxInvoicePdf(invoice))
    expect(document.getPageCount()).toBe(1)
  })
})

describe('credit note', () => {
  it('names the invoice it reduces, its reason and the stored amounts', async () => {
    const invoice = sampleInvoice()
    const note = sampleCreditNote(invoice)
    const content = creditNoteContent(note, invoice)
    expect(content.title).toBe('CREDIT NOTE')
    expect(content.details).toContainEqual({ label: 'Credit note number', value: 'SNC/26-27/000001' })
    expect(content.details).toContainEqual({ label: 'Credit note date', value: '09 Oct 2026' })
    expect(content.details).toContainEqual({ label: 'Against invoice', value: 'SNS/26-27/000001 dated 05 Oct 2026' })
    expect(content.details).toContainEqual({ label: 'Reason', value: 'Course purchase refunded' })
    expect(content.buyer.lines[0]).toBe('Fixture Learner')
    expect(content.total).toEqual({ label: 'Total (credit note value)', value: 'INR 4,999.00' })
    expect(content.footer).toBe('This is a computer-generated credit note and needs no signature.')

    const { bytes, all } = await drawnText(() => buildCreditNotePdf(note, invoice))
    const document = await PDFDocument.load(bytes)
    expect(document.getPageCount()).toBe(1)
    expect(document.getTitle()).toBe('Credit note SNC/26-27/000001')
    for (const text of ['CREDIT NOTE', 'SNC/26-27/000001', 'SNS/26-27/000001 dated 05 Oct 2026', 'Course purchase refunded', 'INR 4,999.00']) {
      expect(all).toContain(text)
    }
  })
})
