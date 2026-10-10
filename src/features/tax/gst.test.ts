import { describe, expect, it } from 'vitest'
import {
  creditNoteNumber, financialYearOf, GST_SUPPLIER, gstBreakup, indiaDate, invoiceNumber, isValidGstin, supplyTypeFor,
} from './gst'

describe('GST maths (C4)', () => {
  it('works 18% GST back out of a GST-inclusive price, and the parts add up to the price', () => {
    expect(gstBreakup(499_900, 'intra_state')).toEqual({
      supplyType: 'intra_state', rateBasisPoints: 1800, totalMinor: 499_900, taxableMinor: 423_644, cgstMinor: 38_128, sgstMinor: 38_128, igstMinor: 0,
    })
    expect(gstBreakup(499_900, 'inter_state')).toMatchObject({ taxableMinor: 423_644, igstMinor: 76_256, cgstMinor: 0, sgstMinor: 0 })
    for (const total of [100, 101, 999, 11_800, 123_457, 9_999_999]) {
      for (const type of ['intra_state', 'inter_state'] as const) {
        const parts = gstBreakup(total, type)
        expect(parts.taxableMinor + parts.cgstMinor + parts.sgstMinor + parts.igstMinor).toBe(total)
        expect(Math.abs(parts.taxableMinor * 11_800 - total * 10_000)).toBeLessThanOrEqual(11_800 / 2)
      }
    }
    expect(gstBreakup(11_800, 'intra_state')).toMatchObject({ taxableMinor: 10_000, cgstMinor: 900, sgstMinor: 900 })
    expect(gstBreakup(101, 'intra_state')).toMatchObject({ taxableMinor: 86, cgstMinor: 8, sgstMinor: 7 })
  })

  it('carries no GST on an export under LUT', () => {
    expect(gstBreakup(4_900, 'export_lut')).toMatchObject({ rateBasisPoints: 0, taxableMinor: 4_900, cgstMinor: 0, sgstMinor: 0, igstMinor: 0 })
  })

  it('picks the supply type from the billing state and currency', () => {
    expect(supplyTypeFor({ currency: 'INR', billingStateCode: '27' })).toBe('intra_state')
    expect(supplyTypeFor({ currency: 'INR', billingStateCode: '29' })).toBe('inter_state')
    expect(supplyTypeFor({ currency: 'USD', billingStateCode: null })).toBe('export_lut')
  })

  it('validates GSTINs with the check character', () => {
    expect(isValidGstin(GST_SUPPLIER.gstin)).toBe(true)
    expect(isValidGstin(' 27aasfb2030k1ze ')).toBe(true)
    expect(isValidGstin('27AASFB2030K1ZF')).toBe(false)
    expect(isValidGstin('99AASFB2030K1ZE')).toBe(false)
    expect(isValidGstin('27AASFB2030K1Z')).toBe(false)
  })

  it('numbers documents per Indian financial year, which starts on 1 April in IST', () => {
    expect(financialYearOf(new Date('2026-03-31T18:29:59Z'))).toBe('2025-26')
    expect(financialYearOf(new Date('2026-03-31T18:30:00Z'))).toBe('2026-27')
    expect(indiaDate(new Date('2026-10-10T20:00:00Z'))).toBe('2026-10-11')
    expect(invoiceNumber('2026-27', 1)).toBe('SNS/26-27/000001')
    expect(creditNoteNumber('2099-00', 42)).toBe('SNC/99-00/000042')
    expect(invoiceNumber('2026-27', 1)).toHaveLength(16)
  })
})
