import { describe, expect, it } from 'vitest'
import { computePayoutTds, formatRateBasisPoints, maskPan, tdsOnAmount } from './tds'

const TEN_PERCENT = 1000
/** ₹30,000 in paise. */
const THRESHOLD = 3_000_000

describe('tdsOnAmount (rate × amount, half-up to whole rupees)', () => {
  it('rounds to the nearest rupee, half up, and returns paise in multiples of 100', () => {
    expect(tdsOnAmount(5_000, TEN_PERCENT)).toBe(500) // ₹50 × 10% = ₹5
    expect(tdsOnAmount(15_000, 100)).toBe(200) // ₹150 × 1% = ₹1.50 → ₹2
    expect(tdsOnAmount(14_999, 100)).toBe(100) // ₹149.99 × 1% = ₹1.4999 → ₹1
    expect(tdsOnAmount(12_345, TEN_PERCENT)).toBe(1_200) // ₹12.345 → ₹12
    expect(tdsOnAmount(0, TEN_PERCENT)).toBe(0)
    expect(tdsOnAmount(-100, TEN_PERCENT)).toBe(0)
  })
})

describe('computePayoutTds (catch-up rule)', () => {
  it('deducts nothing while the year total stays at or below the threshold', () => {
    expect(computePayoutTds({ coursePartMinor: 1_000_000, earlierCourseMinor: 1_000_000, earlierTdsMinor: 0, rateBasisPoints: TEN_PERCENT, thresholdMinor: THRESHOLD }))
      .toEqual({ tdsBaseMinor: 1_000_000, fyGrossMinor: 2_000_000, thresholdCrossed: false, targetMinor: 0, tdsMinor: 0 })
    // Exactly at the threshold is not "passed".
    expect(computePayoutTds({ coursePartMinor: 1_000_000, earlierCourseMinor: 2_000_000, earlierTdsMinor: 0, rateBasisPoints: TEN_PERCENT, thresholdMinor: THRESHOLD }).tdsMinor).toBe(0)
  })

  it('catches up on the whole year once the threshold is crossed', () => {
    // ₹25,000 paid earlier without TDS, then ₹10,000: the year is ₹35,000, TDS due ₹3,500, all taken now.
    expect(computePayoutTds({ coursePartMinor: 1_000_000, earlierCourseMinor: 2_500_000, earlierTdsMinor: 0, rateBasisPoints: TEN_PERCENT, thresholdMinor: THRESHOLD }))
      .toEqual({ tdsBaseMinor: 1_000_000, fyGrossMinor: 3_500_000, thresholdCrossed: true, targetMinor: 350_000, tdsMinor: 350_000 })
  })

  it('caps the deduction at this payout’s course part and carries the rest to the next course payout', () => {
    // ₹29,000 earlier, then ₹2,000: the year is ₹31,000, TDS due ₹3,100, but only ₹2,000 of course earnings are in this payout.
    const first = computePayoutTds({ coursePartMinor: 200_000, earlierCourseMinor: 2_900_000, earlierTdsMinor: 0, rateBasisPoints: TEN_PERCENT, thresholdMinor: THRESHOLD })
    expect(first).toMatchObject({ fyGrossMinor: 3_100_000, targetMinor: 310_000, tdsMinor: 200_000 })
    // Next payout of ₹5,000: the year is ₹36,000, TDS due ₹3,600, ₹2,000 already taken → ₹1,600 now.
    const second = computePayoutTds({ coursePartMinor: 500_000, earlierCourseMinor: 3_100_000, earlierTdsMinor: first.tdsMinor, rateBasisPoints: TEN_PERCENT, thresholdMinor: THRESHOLD })
    expect(second).toMatchObject({ fyGrossMinor: 3_600_000, targetMinor: 360_000, tdsMinor: 160_000 })
    expect(first.tdsMinor + second.tdsMinor).toBe(tdsOnAmount(3_600_000, TEN_PERCENT))
  })

  it('treats a threshold that is not set as 0: TDS from the first rupee', () => {
    expect(computePayoutTds({ coursePartMinor: 15_000, earlierCourseMinor: 0, earlierTdsMinor: 0, rateBasisPoints: TEN_PERCENT, thresholdMinor: null }))
      .toEqual({ tdsBaseMinor: 15_000, fyGrossMinor: 15_000, thresholdCrossed: true, targetMinor: 1_500, tdsMinor: 1_500 })
  })

  it('deducts nothing from a payout without course earnings (event tickets only), even past the threshold', () => {
    expect(computePayoutTds({ coursePartMinor: 0, earlierCourseMinor: 5_000_000, earlierTdsMinor: 400_000, rateBasisPoints: TEN_PERCENT, thresholdMinor: THRESHOLD }))
      .toMatchObject({ tdsBaseMinor: 0, tdsMinor: 0 })
    // Only a course refund (negative course part): no TDS base either.
    expect(computePayoutTds({ coursePartMinor: -50_000, earlierCourseMinor: 5_000_000, earlierTdsMinor: 0, rateBasisPoints: TEN_PERCENT, thresholdMinor: THRESHOLD }))
      .toMatchObject({ tdsBaseMinor: 0, fyGrossMinor: 4_950_000, tdsMinor: 0 })
  })

  it('never returns a negative deduction when more was deducted earlier than is now due', () => {
    expect(computePayoutTds({ coursePartMinor: 100_000, earlierCourseMinor: 3_000_000, earlierTdsMinor: 400_000, rateBasisPoints: TEN_PERCENT, thresholdMinor: 0 }).tdsMinor).toBe(0)
  })

  it('refuses a missing or out-of-range rate', () => {
    expect(() => computePayoutTds({ coursePartMinor: 1, earlierCourseMinor: 0, earlierTdsMinor: 0, rateBasisPoints: 0, thresholdMinor: null })).toThrow('rate_invalid')
    expect(() => computePayoutTds({ coursePartMinor: 1.5, earlierCourseMinor: 0, earlierTdsMinor: 0, rateBasisPoints: 1000, thresholdMinor: null })).toThrow('course_part_invalid')
  })
})

describe('PAN and rate labels', () => {
  it('masks a PAN as ABCDE****F and formats basis points as a percentage', () => {
    expect(maskPan('abcde1234f')).toBe('ABCDE****F')
    expect(maskPan('short')).toBe('**********')
    expect(formatRateBasisPoints(1000)).toBe('10%')
    expect(formatRateBasisPoints(75)).toBe('0.75%')
    expect(formatRateBasisPoints(250)).toBe('2.5%')
    expect(formatRateBasisPoints(null)).toBe('not set')
  })
})
