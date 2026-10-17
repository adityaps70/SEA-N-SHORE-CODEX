import { describe, expect, it } from 'vitest'
import { LIST_PRICE_EVIDENCE_DAYS, coursePrice, struckListPrice, wasListPriceCharged } from './course-pricing'

const courseId = '22222222-2222-4222-8222-222222222222'
const discounted = coursePrice({ accessType: 'paid', priceMinor: 300_000, discountPriceMinor: 100_000, currency: 'INR' })
const plain = coursePrice({ accessType: 'paid', priceMinor: 300_000, discountPriceMinor: null, currency: 'INR' })

describe('struck-through list prices (Round H, H7)', () => {
  it('looks back 90 days', () => {
    expect(LIST_PRICE_EVIDENCE_DAYS).toBe(90)
  })

  it('strikes through the list price only when it was really charged recently', () => {
    expect(struckListPrice(discounted, true)).toEqual({ listPriceMinor: 300_000, savePercent: 66 })
    expect(struckListPrice(discounted, false)).toBeNull()
  })

  it('never strikes through without a discount or a chargeable price', () => {
    expect(struckListPrice(plain, true)).toBeNull()
    expect(struckListPrice(null, true)).toBeNull()
  })

  it('matches a sale by course, list price and currency, and by plan when one is given', () => {
    const sales = [{ courseId, planId: 'plan-a', listPriceMinor: 300_000, currency: 'INR' }]
    expect(wasListPriceCharged(sales, { courseId, listPriceMinor: 300_000, currency: 'INR' })).toBe(true)
    expect(wasListPriceCharged(sales, { courseId, planId: 'plan-a', listPriceMinor: 300_000, currency: 'INR' })).toBe(true)
    expect(wasListPriceCharged(sales, { courseId, planId: 'plan-b', listPriceMinor: 300_000, currency: 'INR' })).toBe(false)
    expect(wasListPriceCharged(sales, { courseId, planId: null, listPriceMinor: 300_000, currency: 'INR' })).toBe(false)
    expect(wasListPriceCharged(sales, { courseId, listPriceMinor: 299_900, currency: 'INR' })).toBe(false)
    expect(wasListPriceCharged(sales, { courseId, listPriceMinor: 300_000, currency: 'USD' })).toBe(false)
    expect(wasListPriceCharged(sales, { courseId: 'other', listPriceMinor: 300_000, currency: 'INR' })).toBe(false)
    expect(wasListPriceCharged([], { courseId, listPriceMinor: 300_000, currency: 'INR' })).toBe(false)
  })
})
