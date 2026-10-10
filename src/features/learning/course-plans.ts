import { z } from 'zod'
import { formatMoney, maxTicketPriceMinor, minTicketPriceMinor } from '@/features/payments/currency'
import { PAYMENT_CURRENCIES, type PaymentCurrency } from '@/features/payments/types'
import { coursePrice, formatCourseAmount, type CoursePrice } from './course-pricing'

/**
 * Pricing plans and access periods (learning round C, C3). A paid course sells one or more plans, each with its own
 * price (and optional sale price), currency and access period: 6 or 12 months, or lifetime. Courses that existed
 * before round C have one "Standard" lifetime plan at their price, and every enrolment without a plan is lifetime.
 * Safe to import from client components.
 */

export const ACCESS_PERIODS = [null, 6, 12] as const
export type AccessMonths = 6 | 12 | null

export const COURSE_PLAN_LIMITS = { plans: 4, name: 60 } as const
export const DEFAULT_PLAN_NAME = 'Standard'

export type CoursePlan = {
  /** Null for a course that has no plan row yet (its own price, lifetime access). */
  id: string | null
  name: string
  priceMinor: number
  discountPriceMinor: number | null
  currency: PaymentCurrency
  accessMonths: AccessMonths
  position: number
}

export function accessPeriodLabel(months: AccessMonths) {
  return months === null ? 'Lifetime access' : `${months} months of access`
}

/** What the plan costs now, or null when it cannot be charged (see coursePrice). */
export function planPrice(plan: Pick<CoursePlan, 'priceMinor' | 'discountPriceMinor' | 'currency'>): CoursePrice | null {
  return coursePrice({ accessType: 'paid', priceMinor: plan.priceMinor, discountPriceMinor: plan.discountPriceMinor, currency: plan.currency })
}

export function planPriceLabel(plan: Pick<CoursePlan, 'priceMinor' | 'discountPriceMinor' | 'currency'>) {
  const price = planPrice(plan)
  return price ? formatCourseAmount(price.amountMinor, price.currency) : formatCourseAmount(plan.priceMinor, plan.currency)
}

/**
 * When access bought now ends. Buying while time-limited access is still running extends it from its current end
 * (renewing early never loses days); a lifetime plan has no end.
 */
export function accessExpiresAt(months: AccessMonths, input: { now: Date; currentExpiresAt?: Date | null }): Date | null {
  if (months === null) return null
  const current = input.currentExpiresAt ?? null
  const start = current && current.getTime() > input.now.getTime() ? current : input.now
  const end = new Date(start.getTime())
  end.setUTCMonth(end.getUTCMonth() + months)
  return end
}

/** Access that has ended: the course is read-only until the learner renews. */
export function accessHasExpired(expiresAt: string | Date | null | undefined, now = new Date()) {
  if (!expiresAt) return false
  const end = expiresAt instanceof Date ? expiresAt : new Date(expiresAt)
  return Number.isFinite(end.getTime()) && end.getTime() <= now.getTime()
}

const planInputSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  name: z.string().trim()
    .min(1, 'Give each plan a name, for example "Self-paced".')
    .max(COURSE_PLAN_LIMITS.name, 'A plan name can be at most 60 characters.'),
  priceMinor: z.number().int('Enter the plan price in whole paise or cents.'),
  discountPriceMinor: z.number().int('Enter the sale price in whole paise or cents.').nullable(),
  currency: z.enum(PAYMENT_CURRENCIES, 'Choose INR or USD for each plan.'),
  accessMonths: z.union([z.literal(6), z.literal(12), z.null()], 'Choose 6 months, 12 months or lifetime access.'),
})

export type CoursePlanInput = z.infer<typeof planInputSchema>

/** The plans of a paid course, in display order. The first plan's price is the course price shown in listings. */
export const coursePlansSchema = z.array(planInputSchema)
  .min(1, 'A paid course needs at least one plan.')
  .max(COURSE_PLAN_LIMITS.plans, 'A course can have at most 4 plans.')
  .superRefine((plans, context) => {
    const names = new Set<string>()
    plans.forEach((plan, index) => {
      const minimum = minTicketPriceMinor(plan.currency)
      const maximum = maxTicketPriceMinor(plan.currency)
      if (plan.priceMinor < minimum || plan.priceMinor > maximum) {
        context.addIssue({ code: 'custom', path: [index, 'priceMinor'], message: `${plan.name || 'Each plan'}: the price must be between ${formatCourseAmount(minimum, plan.currency)} and ${formatCourseAmount(maximum, plan.currency)}.` })
      }
      if (plan.discountPriceMinor !== null && (plan.discountPriceMinor < minimum || plan.discountPriceMinor >= plan.priceMinor)) {
        context.addIssue({ code: 'custom', path: [index, 'discountPriceMinor'], message: `${plan.name || 'Each plan'}: the sale price must be lower than the price and at least ${formatCourseAmount(minimum, plan.currency)}.` })
      }
      const key = plan.name.trim().toLocaleLowerCase('en')
      if (names.has(key)) context.addIssue({ code: 'custom', path: [index, 'name'], message: 'Each plan needs a different name.' })
      names.add(key)
    })
  })

export function isPaymentCurrencyPlan(currency: string): currency is PaymentCurrency {
  return (PAYMENT_CURRENCIES as readonly string[]).includes(currency)
}

/**
 * The plan and promo code an order was bought with, for receipts and the sales list ("6-month · 6 months of access",
 * "SIRE20 (₹1,000 off)"). Orders from before plans existed have no plan name and show nothing.
 */
export function orderPlanDetails(
  order: { planName: string | null; accessMonths: AccessMonths; promoCode: string | null; promoDiscountMinor: number; currency: PaymentCurrency },
) {
  return {
    plan: order.planName ? `${order.planName} · ${accessPeriodLabel(order.accessMonths)}` : null,
    code: order.promoCode
      ? `${order.promoCode}${order.promoDiscountMinor > 0 ? ` (${formatMoney(order.promoDiscountMinor, order.currency)} off)` : ''}`
      : null,
  }
}
