/**
 * TDS on course-seller payouts (C4). Pure maths, no database: payout-tax.ts feeds it the seller's financial-year
 * totals and the platform settings.
 *
 * Course sellers (mentors and organisations) supply their service to Sea N Shore, which deducts TDS (by default
 * section 194J) from what it pays them for courses. Event-ticket earnings carry no TDS.
 *
 * Catch-up rule (owner's choice):
 *   fyGross = course part of this seller's earlier payouts in the financial year that are processing or paid,
 *             plus this payout's course part (never below 0)
 *   if no threshold is set, or fyGross > threshold:
 *     target  = rate × fyGross, rounded half-up to the nearest whole rupee
 *     tdsThis = min(max(target − TDS already deducted in the year, 0), this payout's course part)
 *   else tdsThis = 0
 *
 * A threshold that is not set (null) is treated as 0: TDS applies from the first rupee. When the cap (this payout's
 * course part) cuts the deduction short, the shortfall is caught up on the seller's next course payout, because the
 * target is always worked out on the whole year.
 */

export type TdsInput = {
  /** Sum of the course earnings in this payout (sales less fee, less course refunds). May be negative. */
  coursePartMinor: number
  /** Sum of the course parts of this seller's earlier processing/paid payouts in the same financial year (signed). */
  earlierCourseMinor: number
  /** TDS already deducted from those payouts. */
  earlierTdsMinor: number
  /** e.g. 1000 = 10%. Must be set before any course payout. */
  rateBasisPoints: number
  /** Null = no threshold (TDS from the first rupee). */
  thresholdMinor: number | null
}

export type TdsResult = {
  /** This payout's course part, never below 0 (stored as payouts.tds_base_minor). */
  tdsBaseMinor: number
  /** The seller's financial-year course total including this payout. */
  fyGrossMinor: number
  /** Whether the year total has passed the threshold. */
  thresholdCrossed: boolean
  /** Rate × fyGross, rounded to whole rupees (0 when the threshold is not crossed). */
  targetMinor: number
  /** TDS deducted from this payout. */
  tdsMinor: number
}

function assertWhole(value: number, name: string) {
  if (!Number.isSafeInteger(value)) throw new RangeError(`${name}_invalid`)
}

/** Rate × amount in paise, rounded half-up to whole rupees (a multiple of 100 paise). */
export function tdsOnAmount(amountMinor: number, rateBasisPoints: number) {
  assertWhole(amountMinor, 'amount')
  assertWhole(rateBasisPoints, 'rate')
  if (amountMinor <= 0) return 0
  // paise × bp / 10 000 = TDS in paise; / 100 more = rupees. Half-up: + 500 000 before dividing by 1 000 000.
  const rupees = (BigInt(amountMinor) * BigInt(rateBasisPoints) + BigInt(500_000)) / BigInt(1_000_000)
  return Number(rupees) * 100
}

export function computePayoutTds(input: TdsInput): TdsResult {
  assertWhole(input.coursePartMinor, 'course_part')
  assertWhole(input.earlierCourseMinor, 'earlier_course')
  assertWhole(input.earlierTdsMinor, 'earlier_tds')
  if (!Number.isSafeInteger(input.rateBasisPoints) || input.rateBasisPoints < 1 || input.rateBasisPoints > 3000) throw new RangeError('rate_invalid')
  if (input.thresholdMinor !== null && (!Number.isSafeInteger(input.thresholdMinor) || input.thresholdMinor < 0)) throw new RangeError('threshold_invalid')

  const tdsBaseMinor = Math.max(input.coursePartMinor, 0)
  const fyGrossMinor = Math.max(input.earlierCourseMinor + input.coursePartMinor, 0)
  const threshold = input.thresholdMinor ?? 0
  const thresholdCrossed = fyGrossMinor > threshold
  if (!thresholdCrossed || tdsBaseMinor === 0) {
    return { tdsBaseMinor, fyGrossMinor, thresholdCrossed, targetMinor: thresholdCrossed ? tdsOnAmount(fyGrossMinor, input.rateBasisPoints) : 0, tdsMinor: 0 }
  }
  const targetMinor = tdsOnAmount(fyGrossMinor, input.rateBasisPoints)
  const tdsMinor = Math.min(Math.max(targetMinor - Math.max(input.earlierTdsMinor, 0), 0), tdsBaseMinor)
  return { tdsBaseMinor, fyGrossMinor, thresholdCrossed, targetMinor, tdsMinor }
}

/** "ABCDE1234F" → "ABCDE****F": how a PAN is shown once saved. */
export function maskPan(pan: string) {
  const value = pan.trim().toUpperCase()
  if (value.length !== 10) return '**********'
  return `${value.slice(0, 5)}****${value.slice(9)}`
}

/** 1000 → "10%", 75 → "0.75%". */
export function formatRateBasisPoints(rateBasisPoints: number | null) {
  if (rateBasisPoints === null) return 'not set'
  const whole = Math.floor(rateBasisPoints / 100)
  const fraction = rateBasisPoints % 100
  return `${fraction ? `${whole}.${String(fraction).padStart(2, '0').replace(/0$/, '')}` : whole}%`
}
