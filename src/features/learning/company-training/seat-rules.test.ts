import { describe, expect, it } from 'vitest'
import { seatPackInvoiceDescription, seatPackQuote, seatRefundableUntil, seatValidUntil, volumeDiscountFor } from './seat-rules'

describe('company seat pack rules (D3)', () => {
  it('gives 10% off from 10 seats and 20% off from 50 seats', () => {
    expect([1, 9, 10, 49, 50, 1000].map(volumeDiscountFor)).toEqual([0, 0, 1000, 1000, 2000, 2000])
  })

  it('takes the discount off the price per seat, so every seat costs the same', () => {
    expect(seatPackQuote({ quantity: 12, listUnitMinor: 500_000, baseUnitMinor: 450_000, currency: 'INR' })).toEqual({
      quantity: 12, currency: 'INR', listUnitMinor: 500_000, baseUnitMinor: 450_000, volumeDiscountBasisPoints: 1000,
      unitMinor: 405_000, listTotalMinor: 6_000_000, discountTotalMinor: 4_860_000, totalMinor: 4_860_000,
    })
    // Rounded to the nearest paisa per seat.
    expect(seatPackQuote({ quantity: 50, listUnitMinor: 99_999, baseUnitMinor: 99_999, currency: 'INR' })).toMatchObject({ unitMinor: 79_999, totalMinor: 3_999_950 })
    // Full price with no sale and no volume: the pack has no discount price.
    expect(seatPackQuote({ quantity: 3, listUnitMinor: 100_000, baseUnitMinor: 100_000, currency: 'INR' })).toMatchObject({ discountTotalMinor: null, totalMinor: 300_000 })
    expect(() => seatPackQuote({ quantity: 0, listUnitMinor: 1, baseUnitMinor: 1, currency: 'INR' })).toThrow(RangeError)
    expect(() => seatPackQuote({ quantity: 1001, listUnitMinor: 1, baseUnitMinor: 1, currency: 'INR' })).toThrow(RangeError)
  })

  it('keeps unassigned seats for 12 months and refunds within 30 days', () => {
    const paidAt = new Date('2026-10-10T10:00:00.000Z')
    expect(seatValidUntil(paidAt).toISOString()).toBe('2027-10-10T10:00:00.000Z')
    expect(seatRefundableUntil(paidAt).toISOString()).toBe('2026-11-09T10:00:00.000Z')
  })

  it('describes a pack on one invoice line', () => {
    expect(seatPackInvoiceDescription({ courseTitle: 'SIRE 2.0 Readiness', planName: 'Standard', quantity: 12, unitMinor: 405_000, basisPoints: 1000, currency: 'INR' }))
      .toBe('SIRE 2.0 Readiness (Standard): online course access for company crew, 12 seats at ₹4,050 each (10% volume discount)')
    expect(seatPackInvoiceDescription({ courseTitle: 'Tanker Basics', planName: null, quantity: 1, unitMinor: 100_000, basisPoints: 0, currency: 'INR' }))
      .toBe('Tanker Basics: online course access for company crew, 1 seat at ₹1,000 each')
  })
})
