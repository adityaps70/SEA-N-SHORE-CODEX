import { describe, expect, it, vi } from 'vitest'
import { decimalAmount, gstDocumentsToCsv, isExportMonth, listGstDocumentsForMonth, type GstExportRow } from './gst-export'
import { FIXTURE_BUYER_GSTIN } from './tax-test-fixtures'

const invoiceRow: GstExportRow = {
  documentType: 'Invoice',
  number: 'SNS/26-27/000001',
  date: '2026-10-05',
  againstInvoice: null,
  buyerName: 'Fixture Learner',
  buyerCompany: 'Fixture Shipping Pvt Ltd',
  buyerGstin: FIXTURE_BUYER_GSTIN,
  placeOfSupplyCode: '27',
  placeOfSupplyName: 'Maharashtra',
  supplyType: 'B2B',
  sac: '999293',
  currency: 'INR',
  taxableMinor: 423_644,
  cgstMinor: 38_128,
  sgstMinor: 38_128,
  igstMinor: 0,
  totalMinor: 499_900,
  orderReference: 'crs_fixture_1',
}

describe('GST export helpers', () => {
  it('accepts only YYYY-MM months', () => {
    expect(isExportMonth('2026-10')).toBe(true)
    expect(isExportMonth('2026-13')).toBe(false)
    expect(isExportMonth('2026-1')).toBe(false)
    expect(isExportMonth('1999-12')).toBe(false)
    expect(isExportMonth(null)).toBe(false)
  })

  it('writes paise as decimal rupees without rounding errors', () => {
    expect(decimalAmount(423_644)).toBe('4236.44')
    expect(decimalAmount(5)).toBe('0.05')
    expect(decimalAmount(0)).toBe('0.00')
    expect(decimalAmount(100)).toBe('1.00')
  })
})

describe('gstDocumentsToCsv', () => {
  it('writes a BOM, the header and CRLF rows with credit notes as positive amounts', () => {
    const csv = gstDocumentsToCsv([
      invoiceRow,
      { ...invoiceRow, documentType: 'Credit note', number: 'SNC/26-27/000001', date: '2026-10-09', againstInvoice: 'SNS/26-27/000001' },
      { ...invoiceRow, number: 'SNS/26-27/000002', buyerName: '=Fixture, "Buyer"', buyerCompany: null, buyerGstin: null, supplyType: 'B2C', placeOfSupplyCode: '29', placeOfSupplyName: 'Karnataka', cgstMinor: 0, sgstMinor: 0, igstMinor: 76_256 },
    ])
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(csv.endsWith('\r\n')).toBe(true)
    const lines = csv.slice(1).split('\r\n')
    expect(lines[0]).toBe('Document type,Number,Date,Against invoice,Buyer name,Buyer company,Buyer GSTIN,Place of supply code,Place of supply,Supply type,SAC,Currency,Taxable value,CGST,SGST,IGST,Total,Order ID')
    expect(lines[1]).toBe(`Invoice,SNS/26-27/000001,2026-10-05,,Fixture Learner,Fixture Shipping Pvt Ltd,${FIXTURE_BUYER_GSTIN},27,Maharashtra,B2B,999293,INR,4236.44,381.28,381.28,0.00,4999.00,crs_fixture_1`)
    expect(lines[2]).toBe(`Credit note,SNC/26-27/000001,2026-10-09,SNS/26-27/000001,Fixture Learner,Fixture Shipping Pvt Ltd,${FIXTURE_BUYER_GSTIN},27,Maharashtra,B2B,999293,INR,4236.44,381.28,381.28,0.00,4999.00,crs_fixture_1`)
    // Formula injection is neutralised and quotes are escaped.
    expect(lines[3]).toContain(`"'=Fixture, ""Buyer"""`)
    expect(lines[3]).toContain(',B2C,')
    expect(lines).toHaveLength(5)
  })
})

describe('listGstDocumentsForMonth', () => {
  it('reads the month from its first day and maps supply types', async () => {
    const query = vi.fn(async () => ({
      rows: [
        { document_type: 'Invoice', number: 'SNS/26-27/000003', document_date: new Date('2026-10-07T00:00:00.000Z'), against_invoice: null, buyer_name: 'Fixture Overseas Learner', buyer_company: null, buyer_gstin: null, place_of_supply_code: '96', place_of_supply_name: 'Outside India (export)', supply_type: 'export_lut', sac: '999293', currency: 'USD', taxable_minor: '4950', cgst_minor: '0', sgst_minor: '0', igst_minor: '0', total_minor: '4950', order_reference: 'crs_fixture_3' },
      ],
    }))
    const rows = await listGstDocumentsForMonth({ query } as never, '2026-10')
    expect((query.mock.calls[0] as unknown as [string, unknown[]])[1]).toEqual(['2026-10-01'])
    expect(rows[0]).toMatchObject({ supplyType: 'Export under LUT', date: '2026-10-07', totalMinor: 4950, currency: 'USD' })
    await expect(listGstDocumentsForMonth({ query } as never, 'October')).rejects.toThrow('gst_export_month_invalid')
  })
})
