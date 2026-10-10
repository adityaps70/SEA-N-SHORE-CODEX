import { z } from 'zod'
import { formatMoney, minTicketPriceMinor } from '@/features/payments/currency'
import { PAYMENT_CURRENCIES, type PaymentCurrency } from '@/features/payments/types'

/**
 * Promo codes (learning round C, C2). A trainer's code takes a percentage or a fixed amount off a course plan's
 * current price (the sale price when one is set: the two discounts add up, owner decision), never below the gateway
 * minimum (₹1 / $1, owner decision), optionally capped at a maximum discount, with total and per-member usage limits
 * and a valid-from/to window. The amount is always worked out on the server from the stored code; the browser only
 * sends the code text. Safe to import from client components.
 */

export const PROMO_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{2,31}$/

export type PromoDiscountType = 'percent' | 'fixed'

export type PromoCodeTerms = {
  discountType: PromoDiscountType
  /** "20" or "12.5" (percent codes). */
  percentOff: string | null
  amountOffMinor: number | null
  currency: PaymentCurrency | null
  maxDiscountMinor: number | null
}

export type PromoCodeRefusal =
  | 'promo_not_found'
  | 'promo_not_started'
  | 'promo_expired'
  | 'promo_exhausted'
  | 'promo_member_limit'
  | 'promo_currency'
  | 'promo_no_discount'

export function normalisePromoCode(value: string) {
  return value.trim().toUpperCase()
}

/** Percent as integer basis points: "12.5" -> 1250. Null when it is not a valid 0–100 percent with ≤2 decimals. */
export function percentBasisPoints(percent: string) {
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(percent.trim())
  if (!match) return null
  const points = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'))
  return points > 0 && points <= 10_000 ? points : null
}

/**
 * The discount a code gives on `baseMinor` (what the buyer would otherwise pay), in integer minor units: a percent
 * rounds down to the paisa or cent, then the maximum discount applies, then the floor that keeps the gateway minimum.
 * Returns the refusal when the code cannot apply to this price.
 */
export function promoDiscount(terms: PromoCodeTerms, baseMinor: number, currency: PaymentCurrency):
  | { ok: true; discountMinor: number; amountMinor: number }
  | { ok: false; reason: PromoCodeRefusal } {
  if (!Number.isSafeInteger(baseMinor) || baseMinor <= 0) return { ok: false, reason: 'promo_no_discount' }
  if (terms.currency && terms.currency !== currency && (terms.discountType === 'fixed' || terms.maxDiscountMinor !== null)) {
    return { ok: false, reason: 'promo_currency' }
  }
  let discount: number
  if (terms.discountType === 'percent') {
    const points = terms.percentOff ? percentBasisPoints(terms.percentOff) : null
    if (points === null) return { ok: false, reason: 'promo_not_found' }
    discount = Number((BigInt(baseMinor) * BigInt(points)) / BigInt(10_000))
  } else {
    discount = terms.amountOffMinor ?? 0
  }
  if (terms.maxDiscountMinor !== null) discount = Math.min(discount, terms.maxDiscountMinor)
  const floor = minTicketPriceMinor(currency)
  discount = Math.min(discount, baseMinor - floor)
  if (discount <= 0) return { ok: false, reason: 'promo_no_discount' }
  return { ok: true, discountMinor: discount, amountMinor: baseMinor - discount }
}

export function promoRefusalMessage(reason: string) {
  switch (reason) {
    case 'promo_not_found': return 'This code is not valid for this course. Check the spelling and try again.'
    case 'promo_not_started': return 'This code is not active yet.'
    case 'promo_expired': return 'This code has expired.'
    case 'promo_exhausted': return 'This code has been fully used.'
    case 'promo_member_limit': return 'You have already used this code the maximum number of times.'
    case 'promo_currency': return 'This code is for a different currency than this plan.'
    case 'promo_no_discount': return 'This code cannot lower this price any further.'
    default: return 'We could not apply this code. Please try again.'
  }
}

export function promoTermsLabel(terms: PromoCodeTerms) {
  const value = terms.discountType === 'percent'
    ? `${terms.percentOff}% off`
    : `${formatMoney(terms.amountOffMinor ?? 0, terms.currency ?? 'INR')} off`
  return terms.maxDiscountMinor !== null && terms.currency
    ? `${value}, up to ${formatMoney(terms.maxDiscountMinor, terms.currency)}`
    : value
}

/** A code as a trainer creates or edits it. Amounts arrive in minor units (the form converts rupees). */
export const promoCodeInputSchema = z.object({
  code: z.string().trim().transform(normalisePromoCode)
    .pipe(z.string().regex(PROMO_CODE_PATTERN, 'Use 3–32 letters, numbers, hyphens or underscores for the code, for example SIRE20.')),
  /** Null = every course this trainer (or organisation) sells. */
  courseId: z.string().uuid('Choose a course or "All my courses".').nullable(),
  discountType: z.enum(['percent', 'fixed'], 'Choose a percentage or a fixed amount.'),
  percentOff: z.string().trim().nullable(),
  amountOffMinor: z.number().int().nullable(),
  currency: z.enum(PAYMENT_CURRENCIES, 'Choose INR or USD.').nullable(),
  maxDiscountMinor: z.number().int().nullable(),
  usageLimit: z.number().int('Enter a whole number of uses.').min(1, 'The usage limit is at least 1.').max(1_000_000, 'The usage limit is at most 1,000,000.').nullable(),
  perMemberLimit: z.number().int('Enter a whole number of uses per member.').min(1, 'Each member can use a code at least once.').max(1000, 'The per-member limit is at most 1,000.').nullable(),
  validFrom: z.string().datetime({ offset: true, message: 'Enter a valid start date.' }).nullable(),
  validUntil: z.string().datetime({ offset: true, message: 'Enter a valid end date.' }).nullable(),
}).superRefine((input, context) => {
  if (input.discountType === 'percent') {
    if (!input.percentOff || percentBasisPoints(input.percentOff) === null) {
      context.addIssue({ code: 'custom', path: ['percentOff'], message: 'Enter a percentage between 0.01 and 100.' })
    }
    if (input.amountOffMinor !== null) context.addIssue({ code: 'custom', path: ['amountOffMinor'], message: 'A percentage code has no fixed amount.' })
  } else {
    if (input.amountOffMinor === null || input.amountOffMinor <= 0) {
      context.addIssue({ code: 'custom', path: ['amountOffMinor'], message: 'Enter the amount the code takes off.' })
    }
    if (!input.currency) context.addIssue({ code: 'custom', path: ['currency'], message: 'Choose the currency of the amount.' })
    if (input.percentOff) context.addIssue({ code: 'custom', path: ['percentOff'], message: 'A fixed-amount code has no percentage.' })
  }
  if (input.maxDiscountMinor !== null) {
    if (input.maxDiscountMinor <= 0) context.addIssue({ code: 'custom', path: ['maxDiscountMinor'], message: 'The maximum discount must be more than 0.' })
    if (!input.currency) context.addIssue({ code: 'custom', path: ['currency'], message: 'Choose the currency of the maximum discount.' })
  }
  if (input.validFrom && input.validUntil && Date.parse(input.validUntil) <= Date.parse(input.validFrom)) {
    context.addIssue({ code: 'custom', path: ['validUntil'], message: 'The end date must be after the start date.' })
  }
})

export type PromoCodeInput = z.infer<typeof promoCodeInputSchema>

export const PROMO_CODE_FIELD_LABELS = {
  code: 'Code',
  courseId: 'Course',
  discountType: 'Discount type',
  percentOff: 'Percentage',
  amountOffMinor: 'Amount off',
  currency: 'Currency',
  maxDiscountMinor: 'Maximum discount',
  usageLimit: 'Total uses',
  perMemberLimit: 'Uses per member',
  validFrom: 'Valid from',
  validUntil: 'Valid until',
}
