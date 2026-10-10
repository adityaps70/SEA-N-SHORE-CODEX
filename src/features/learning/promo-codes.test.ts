import { describe, expect, it } from 'vitest'
import { normalisePromoCode, percentBasisPoints, promoDiscount, promoTermsLabel, type PromoCodeTerms } from './promo-codes'

const percent = (percentOff: string, extra: Partial<PromoCodeTerms> = {}): PromoCodeTerms => ({
  discountType: 'percent', percentOff, amountOffMinor: null, currency: null, maxDiscountMinor: null, ...extra,
})
const fixed = (amountOffMinor: number, currency: 'INR' | 'USD', extra: Partial<PromoCodeTerms> = {}): PromoCodeTerms => ({
  discountType: 'fixed', percentOff: null, amountOffMinor, currency, maxDiscountMinor: null, ...extra,
})

describe('promo code maths (round C, C2)', () => {
  it('normalises typed codes and reads percentages as basis points', () => {
    expect(normalisePromoCode('  sire20 ')).toBe('SIRE20')
    expect(percentBasisPoints('20')).toBe(2000)
    expect(percentBasisPoints('12.5')).toBe(1250)
    expect(percentBasisPoints('0')).toBeNull()
    expect(percentBasisPoints('100.01')).toBeNull()
    expect(percentBasisPoints('abc')).toBeNull()
  })

  it('takes a percentage off, rounding the discount down', () => {
    expect(promoDiscount(percent('20'), 100_000, 'INR')).toEqual({ ok: true, discountMinor: 20_000, amountMinor: 80_000 })
    expect(promoDiscount(percent('33.33'), 999, 'INR')).toEqual({ ok: true, discountMinor: 332, amountMinor: 667 })
  })

  it('caps the discount at the maximum and never charges below ₹1 or $1', () => {
    expect(promoDiscount(percent('50', { currency: 'INR', maxDiscountMinor: 10_000 }), 100_000, 'INR')).toMatchObject({ discountMinor: 10_000, amountMinor: 90_000 })
    expect(promoDiscount(percent('100'), 50_000, 'INR')).toMatchObject({ amountMinor: 100 })
    expect(promoDiscount(fixed(10_000, 'USD'), 5_000, 'USD')).toMatchObject({ amountMinor: 100 })
  })

  it('refuses an amount in another currency and a price already at the floor', () => {
    expect(promoDiscount(fixed(500, 'USD'), 100_000, 'INR')).toEqual({ ok: false, reason: 'promo_currency' })
    expect(promoDiscount(percent('20'), 100, 'INR')).toEqual({ ok: false, reason: 'promo_no_discount' })
  })

  it('describes the terms in plain words', () => {
    expect(promoTermsLabel(percent('20'))).toBe('20% off')
    expect(promoTermsLabel(percent('20', { currency: 'INR', maxDiscountMinor: 100_000 }))).toMatch(/^20% off, up to ₹1,000/)
  })
})
