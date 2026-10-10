import { describe, expect, it } from 'vitest'
import { accessExpiresAt, accessHasExpired, coursePlansSchema, orderPlanDetails } from './course-plans'

describe('course plans (round C, C3)', () => {
  const now = new Date('2026-10-10T06:00:00.000Z')

  it('starts time-limited access now, or extends it from the current end on an early renewal', () => {
    expect(accessExpiresAt(null, { now })).toBeNull()
    expect(accessExpiresAt(6, { now })?.toISOString()).toBe('2027-04-10T06:00:00.000Z')
    expect(accessExpiresAt(12, { now, currentExpiresAt: new Date('2026-12-01T00:00:00.000Z') })?.toISOString()).toBe('2027-12-01T00:00:00.000Z')
    expect(accessExpiresAt(6, { now, currentExpiresAt: new Date('2026-01-01T00:00:00.000Z') })?.toISOString()).toBe('2027-04-10T06:00:00.000Z')
  })

  it('treats lifetime access as never expiring', () => {
    expect(accessHasExpired(null, now)).toBe(false)
    expect(accessHasExpired('2026-10-10T05:59:59.000Z', now)).toBe(true)
    expect(accessHasExpired('2026-10-11T00:00:00.000Z', now)).toBe(false)
  })

  it('refuses an access period other than lifetime, 6 or 12 months', () => {
    const plan = { id: null, name: 'Short', priceMinor: 100_000, discountPriceMinor: null, currency: 'INR', accessMonths: 3 }
    expect(coursePlansSchema.safeParse([plan]).success).toBe(false)
    expect(coursePlansSchema.safeParse([{ ...plan, accessMonths: 6 }]).success).toBe(true)
  })

  it('shows the plan and code an order was bought with, and nothing for older orders', () => {
    expect(orderPlanDetails({ planName: '6-month', accessMonths: 6, promoCode: 'SIRE20', promoDiscountMinor: 20_000, currency: 'INR' }))
      .toEqual({ plan: '6-month · 6 months of access', code: expect.stringMatching(/^SIRE20 \(₹200 off\)$/) })
    expect(orderPlanDetails({ planName: null, accessMonths: null, promoCode: null, promoDiscountMinor: 0, currency: 'INR' }))
      .toEqual({ plan: null, code: null })
  })
})
