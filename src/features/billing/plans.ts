/**
 * Paid plans and their billing rules. Pure code, safe to import from client components.
 *
 * Access model (account_subscriptions.current_period_ends_at is the moment access stops,
 * see features/access/repository.ts):
 * - Paid through  = the end of the last period that was actually charged.
 * - Auto-renewing = access until paid through + RENEWAL_GRACE_DAYS, so the renewal charge
 *   has time to clear (UPI AutoPay retries for hours, eNACH debits take 1-2 working days).
 * - Past due      = a renewal failed: access until (the later of paid through and the
 *   failure) + RENEWAL_GRACE_DAYS while Cashfree retries.
 * - Auto-renew off = access until paid through, then the plan ends.
 */

export const PAID_PLAN_CODES = ['creator_pro', 'organization_pro'] as const
export type PaidPlanCode = typeof PAID_PLAN_CODES[number]

export const BILLING_INTERVALS = ['month', 'half_year', 'year'] as const
export type BillingInterval = typeof BILLING_INTERVALS[number]

/** How many monthly payments one payment of each interval replaces. */
export const INTERVAL_MONTHS: Record<BillingInterval, number> = { month: 1, half_year: 6, year: 12 }

/**
 * The prices Sea N Shore charges new subscribers, in paise: the ONE source of truth. The
 * database rows in plan_prices are seeded from this list by the round 9A migration (a
 * contract test keeps the two in step) and every page reads the active rows at runtime;
 * an admin can still replace a price, which only affects new subscribers.
 */
export const PLAN_PRICES: Record<PaidPlanCode, Partial<Record<BillingInterval, number>>> = {
  creator_pro: { month: 9900, year: 99900 },
  organization_pro: { month: 199900, half_year: 1000000, year: 1499900 },
}

/** Free trial length per plan, in months. One trial per member / organization, ever. */
export const TRIAL_MONTHS: Record<PaidPlanCode, number> = {
  creator_pro: 3,
  organization_pro: 2,
}

/** Days before a trial ends on which a "choose a plan" reminder goes out. */
export const TRIAL_REMINDER_DAYS = [7, 1] as const

export const RENEWAL_GRACE_DAYS = 3
/** Before the first charge of a new mandate: access until the first charge date + grace. */
export const FIRST_CHARGE_FALLBACK_DAYS = 4

const DAY_MS = 24 * 60 * 60 * 1000

export const PLAN_LABELS: Record<PaidPlanCode, string> = {
  creator_pro: 'Creator Pro',
  organization_pro: 'Organization Pro',
}

export const INTERVAL_LABELS: Record<BillingInterval, { adjective: string; per: string; noun: string }> = {
  month: { adjective: 'Monthly', per: 'per month', noun: 'month' },
  half_year: { adjective: 'Half-yearly', per: 'per 6 months', noun: '6 months' },
  year: { adjective: 'Yearly', per: 'per year', noun: 'year' },
}

/** Subject of a subscription: a member (Creator Pro) or an organization (Organization Pro). */
export type BillingSubject =
  | { kind: 'profile'; profileId: string }
  | { kind: 'company'; companyId: string }

export function planForSubject(subject: BillingSubject): PaidPlanCode {
  return subject.kind === 'profile' ? 'creator_pro' : 'organization_pro'
}

export function subjectKey(subject: BillingSubject) {
  return subject.kind === 'profile' ? `profile:${subject.profileId}` : `company:${subject.companyId}`
}

export function isPaidPlanCode(value: unknown): value is PaidPlanCode {
  return typeof value === 'string' && (PAID_PLAN_CODES as readonly string[]).includes(value)
}

export function isBillingInterval(value: unknown): value is BillingInterval {
  return typeof value === 'string' && (BILLING_INTERVALS as readonly string[]).includes(value)
}

/**
 * Adds one billing interval in UTC calendar terms. Month-end dates clamp to the last day
 * of the next month (31 Jan + 1 month = 28/29 Feb), like card and UPI mandates do.
 */
export function addInterval(date: Date, interval: BillingInterval, count = 1): Date {
  const result = new Date(date.getTime())
  const day = result.getUTCDate()
  result.setUTCDate(1)
  result.setUTCMonth(result.getUTCMonth() + count * INTERVAL_MONTHS[interval])
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate()
  result.setUTCDate(Math.min(day, lastDay))
  return result
}

export function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * DAY_MS)
}

/** Money from integer paise with 2 decimals, e.g. 100000 -> "₹1,000.00". */
export function formatRupees(amountMinor: number) {
  const negative = amountMinor < 0
  const absolute = Math.abs(Math.trunc(amountMinor))
  const whole = Math.floor(absolute / 100)
  const paise = String(absolute % 100).padStart(2, '0')
  const grouped = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(whole)
  return `${negative ? '-' : ''}₹${grouped}.${paise}`
}

/** Short form for price lists: whole rupees drop the ".00" ("₹1,000"), otherwise 2 decimals. */
export function formatRupeesShort(amountMinor: number) {
  return amountMinor % 100 === 0 ? formatRupees(amountMinor).replace(/\.00$/, '') : formatRupees(amountMinor)
}

/**
 * What one payment of `interval` saves compared with paying monthly for the same months;
 * null when it saves nothing (or for the monthly price itself).
 */
export function intervalSaving(monthlyMinor: number, amountMinor: number, interval: BillingInterval) {
  const months = INTERVAL_MONTHS[interval]
  if (months <= 1 || monthlyMinor <= 0) return null
  const monthlyTotalMinor = monthlyMinor * months
  const savingMinor = monthlyTotalMinor - amountMinor
  if (savingMinor <= 0) return null
  const monthsFree = Math.floor(savingMinor / monthlyMinor)
  return { savingMinor, monthlyTotalMinor, monthsFree, months }
}

/** What paying yearly saves compared with 12 monthly payments; null when it saves nothing. */
export function yearlySaving(monthlyMinor: number, yearlyMinor: number) {
  const saving = intervalSaving(monthlyMinor, yearlyMinor, 'year')
  return saving ? { savingMinor: saving.savingMinor, twelveMonthsMinor: saving.monthlyTotalMinor, monthsFree: saving.monthsFree } : null
}

/** When a free trial that starts at `start` ends: TRIAL_MONTHS calendar months later. */
export function trialEndsAt(start: Date, plan: PaidPlanCode) {
  return addInterval(start, 'month', TRIAL_MONTHS[plan])
}

/** Whole days left in a trial (rounded up), never below zero. */
export function trialDaysLeft(now: Date, endsAt: Date) {
  return Math.max(0, Math.ceil((endsAt.getTime() - now.getTime()) / DAY_MS))
}

/** "3 months free" for the plan cards. */
export function trialBadge(plan: PaidPlanCode) {
  return `${TRIAL_MONTHS[plan]} months free`
}

/** Access end for an auto-renewing plan that is paid through `paidThrough`. */
export function autoRenewAccessUntil(paidThrough: Date) {
  return addDays(paidThrough, RENEWAL_GRACE_DAYS)
}

/** Access end after a failed renewal reported at `failedAt`. */
export function pastDueAccessUntil(paidThrough: Date | null, failedAt: Date) {
  const base = paidThrough && paidThrough.getTime() > failedAt.getTime() ? paidThrough : failedAt
  return addDays(base, RENEWAL_GRACE_DAYS)
}

/**
 * Access for a mandate that is approved but not charged yet: until the first scheduled
 * charge + grace (Cashfree schedules it T+1..T+4 after approval), never less than
 * FIRST_CHARGE_FALLBACK_DAYS and never more than FIRST_CHARGE_MAX_DAYS from now, so an
 * approved-but-never-charged mandate cannot give a free period.
 */
export const FIRST_CHARGE_MAX_DAYS = 8

export function firstChargeAccessUntil(now: Date, firstChargeAt: Date | null) {
  const fallback = addDays(now, FIRST_CHARGE_FALLBACK_DAYS)
  const candidate = firstChargeAt ? addDays(firstChargeAt, RENEWAL_GRACE_DAYS) : fallback
  const earliest = candidate.getTime() < fallback.getTime() ? fallback : candidate
  const cap = addDays(now, FIRST_CHARGE_MAX_DAYS)
  return earliest.getTime() > cap.getTime() ? cap : earliest
}
