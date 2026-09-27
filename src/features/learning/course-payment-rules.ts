/**
 * Plain-language rules and labels for paid courses. Safe to import from client components.
 */

export const COURSE_PAYMENTS_NOT_CONFIGURED_LABEL = 'Purchases open soon'
export const COURSE_PAYMENTS_NOT_CONFIGURED_HELP = "Payments aren't switched on for Sea N Shore yet. You'll be able to buy this course here as soon as they are."

/** How long an open checkout is reused for a double click or a retry. */
export const COURSE_CHECKOUT_REUSE_MINUTES = 20
/** How long the course page offers "Check payment status" for a checkout that was started. */
export const COURSE_PENDING_CHECK_MINUTES = 120

export type CoursePurchaseBlocker =
  | 'course_not_found'
  | 'course_not_paid'
  | 'course_price_missing'
  | 'course_currency_unsupported'
  | 'course_team_has_access'
  | 'already_enrolled'
  | 'enrollment_revoked'

/** Why a payment that arrived could not unlock the course (the learner is refunded). */
export type CourseRefundDueReason = 'course_not_found' | 'already_enrolled' | 'enrollment_revoked' | 'amount_mismatch'

export function coursePurchaseBlockerMessage(code: string) {
  switch (code) {
    case 'course_not_found': return 'This course is no longer available to buy.'
    case 'course_not_paid': return 'This course is free. Use Enroll free instead.'
    case 'course_price_missing': return 'The trainer has not set a price that can be paid yet, so this course is not on sale.'
    case 'course_currency_unsupported': return "This course is priced in a currency Sea N Shore can't accept yet. Ask the trainer to price it in Indian rupees (INR)."
    case 'course_team_has_access': return 'You manage this course, so you already have access without buying it.'
    case 'already_enrolled': return 'You already have this course. Open it from My Learning.'
    case 'enrollment_revoked': return 'Your access to this course was removed, so it cannot be bought again here. Contact the Sea N Shore team.'
    default: return 'This course is not on sale right now.'
  }
}

/** Shown to learners and course teams when a paid purchase must be refunded. */
export function courseRefundReasonLabel(code: string | null) {
  switch (code) {
    case 'course_not_found': return 'The course was no longer available when the payment arrived.'
    case 'already_enrolled': return 'You already had this course, so this was a duplicate payment.'
    case 'enrollment_revoked': return 'Access to this course had been removed from your account.'
    case 'amount_mismatch': return 'The amount paid did not match the course price.'
    default: return code ? 'The course could not be unlocked.' : ''
  }
}

export type CourseOrderStatusView = {
  status: string
  enrollmentConfirmedAt: string | null
  refundStatus?: string | null
}

/** Status of one course purchase, for learners (receipts) and course teams (sales). */
export function coursePurchaseStatusLabel(row: CourseOrderStatusView) {
  if (row.refundStatus === 'requested') return { label: 'Refund in progress', tone: 'bg-amber-50 text-amber-900' }
  if (row.status === 'refunded' && row.refundStatus === 'failed') return { label: 'Refund failed', tone: 'bg-rose-50 text-rose-700' }
  if (row.status === 'refunded' && row.refundStatus === 'pending') return { label: 'Refund on its way', tone: 'bg-mist-50 text-navy-700' }
  if (row.status === 'paid' && row.refundStatus === 'failed') return { label: 'Refund failed', tone: 'bg-rose-50 text-rose-700' }
  if (row.status === 'paid' && row.enrollmentConfirmedAt) return { label: 'Paid', tone: 'bg-emerald-50 text-emerald-800' }
  if (row.status === 'paid') return { label: 'Refund due', tone: 'bg-amber-50 text-amber-900' }
  if (row.status === 'refunded') return { label: 'Refunded', tone: 'bg-mist-50 text-navy-700' }
  if (row.status === 'failed') return { label: 'Payment failed', tone: 'bg-rose-50 text-rose-700' }
  if (row.status === 'created') return { label: 'Checkout not finished', tone: 'bg-mist-50 text-navy-700' }
  return { label: 'Cancelled', tone: 'bg-mist-50 text-navy-700' }
}

/** Receipt reference shown to people: the gateway order id we created (e.g. crs_…). */
export function courseOrderReference(order: { id: string; providerOrderId: string | null }) {
  return order.providerOrderId ?? order.id
}
