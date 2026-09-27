import { formatMoney, isPaymentCurrency, minTicketPriceMinor } from '@/features/payments/currency'
import type { PaymentCurrency } from '@/features/payments/types'

/**
 * What a paid course costs right now. Shared by the course page (display), the
 * checkout (the amount charged always comes from the course row, never the browser)
 * and the studio fee preview. Safe to import from client components.
 */

export type CoursePriceSource = {
  accessType: 'free' | 'paid'
  priceMinor: number
  discountPriceMinor?: number | null
  currency: string
}

export type CoursePrice = {
  /** What the learner pays. */
  amountMinor: number
  /** The price before any discount. */
  listPriceMinor: number
  /** Set only when a real discount applies (lower than the list price). */
  discountPriceMinor: number | null
  currency: PaymentCurrency
}

export function isPaidCourse(course: Pick<CoursePriceSource, 'accessType' | 'priceMinor'>) {
  return course.accessType === 'paid' && course.priceMinor > 0
}

/**
 * The price of a paid course, or null when it is free or cannot be charged (no
 * price, a currency payments cannot take, or less than the gateway minimum).
 * A discount counts only when it is at least the minimum and below the list price.
 */
export function coursePrice(course: CoursePriceSource): CoursePrice | null {
  if (!isPaidCourse(course) || !Number.isSafeInteger(course.priceMinor)) return null
  if (!isPaymentCurrency(course.currency)) return null
  const minimum = minTicketPriceMinor(course.currency)
  if (course.priceMinor < minimum) return null
  const discount = course.discountPriceMinor ?? null
  const discounted = discount !== null && Number.isSafeInteger(discount) && discount >= minimum && discount < course.priceMinor
  return {
    amountMinor: discounted ? discount : course.priceMinor,
    listPriceMinor: course.priceMinor,
    discountPriceMinor: discounted ? discount : null,
    currency: course.currency,
  }
}

/** "₹4,999" or "₹499.50". Unknown currencies fall back to rupees for display only. */
export function formatCourseAmount(amountMinor: number, currency: string) {
  return formatMoney(amountMinor, currency)
}

/** Whole percent saved, e.g. 20 for ₹5,000 → ₹4,000. */
export function discountPercent(price: CoursePrice) {
  if (price.discountPriceMinor === null) return 0
  return Math.floor(((price.listPriceMinor - price.discountPriceMinor) * 100) / price.listPriceMinor)
}

/** The seller's terms for each sale: Sea N Shore's fee percent (e.g. "10.00") and the payout hold. */
export type SellerFeeTerms = { percent: string; holdDays: number }

/**
 * The seller's share of one sale, with the same integer rounding as the earnings
 * ledger (payments/earnings.ts computePlatformFee): fee = gross × percent, rounded
 * half-up to the paisa; net = gross − fee. Client-safe (no database imports).
 */
export function courseSellerNet(grossMinor: number, percent: string) {
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(percent.trim())
  if (!match || !Number.isSafeInteger(grossMinor) || grossMinor <= 0) return null
  const basisPoints = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'))
  if (basisPoints > 10_000) return null
  const feeMinor = Number((BigInt(grossMinor) * BigInt(basisPoints) + BigInt(5_000)) / BigInt(10_000))
  return { feeMinor, netMinor: grossMinor - feeMinor }
}

/** "10.00" -> "10", "12.50" -> "12.5". */
export function formatFeePercent(percent: string) {
  const value = Number(percent)
  return Number.isFinite(value) ? String(Math.round(value * 100) / 100) : percent
}
